/**
 * Importación de máquinas desde Maquinas_STC.xlsx → Firestore (colección: maquinas)
 *
 * Uso:
 *   node scripts/import-maquinas.mjs                   ← dry run (solo muestra lo que haría)
 *   node scripts/import-maquinas.mjs --apply            ← escribe en Firestore
 *   node scripts/import-maquinas.mjs --apply --dry-ids  ← muestra los IDs sin escribir
 *
 * Clave de upsert: campo `nro_tipo` (columna Nro del Excel) — es único en todo el XLSX.
 * El documento se crea/actualiza como: maquinas/{nro_tipo}
 *
 * Sector asignado: TEJEDURIA (todas las máquinas del XLSX pertenecen a este sector)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// ─── Configuración ─────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'stc-cmms-hilanderia';
const APPLY = process.argv.includes('--apply');
const FILE_PATH = path.join(__dirname, '../public/Maquinas_STC.xlsx');
const SECTOR = 'TEJEDURIA';
const BATCH_SIZE = 400;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const normalizeActivo = (value) => {
  if (value === null || value === undefined || value === '') return true;
  const v = String(value).trim().toUpperCase();
  return v !== 'NO' && v !== 'FALSE' && v !== '0' && v !== 'N';
};

const toTimestamp = (value) => {
  if (!value) return null;
  // ExcelJS ya parsea las fechas como objetos Date nativos
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return Timestamp.fromDate(value);
  }
  // Fallback: número serial de Excel
  if (typeof value === 'number') {
    const ms = (value - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
  }
  // Fallback: string
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
  }
  return null;
};

const normText = (v) => String(v ?? '').trim();
const nullableText = (v) => normText(v) || null;

// ─── Firebase Admin ───────────────────────────────────────────────────────────

const initAdmin = () => {
  if (getApps().length) return;

  const serviceAccountPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, '../.secrets/stc-cmms-hilanderia-firebase-adminsdk-fbsvc-5dc94a0016.json');

  const appConfig = { projectId: PROJECT_ID };

  if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    initializeApp({ ...appConfig, credential: cert(serviceAccount) });
    return;
  }

  console.log('No se encontró service account key, usando applicationDefault()');
  initializeApp({ ...appConfig, credential: applicationDefault() });
};

// ─── Leer XLSX ────────────────────────────────────────────────────────────────

const parseMaquinas = async () => {
  if (!fs.existsSync(FILE_PATH)) {
    throw new Error(`Archivo no encontrado: ${FILE_PATH}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(FILE_PATH);

  const ws = workbook.worksheets[0];
  if (!ws) throw new Error('El workbook no tiene hojas.');

  console.log(`Hoja: "${ws.name}" | Filas: ${ws.rowCount - 1} (sin header)`);

  // Verificar columnas esperadas
  const headerRow = ws.getRow(1).values; // index-1 based
  const expectedCols = ['ID', 'Tipo_Maquina', 'Nro', 'Maquina', 'Adquisicion', 'Local', 'Modelo', 'Activo'];
  const detectedCols = expectedCols.filter(col => headerRow.some(h => String(h || '').trim() === col));
  if (detectedCols.length < expectedCols.length) {
    console.warn('⚠️  Columnas esperadas no encontradas:', expectedCols.filter(c => !detectedCols.includes(c)));
  }

  const maquinas = [];
  const omitidos = [];

  for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);

    const excelId  = row.getCell(1).value;  // ID
    const tipo     = normText(row.getCell(2).value).toUpperCase();   // Tipo_Maquina
    const nroTipo  = row.getCell(3).value;  // Nro (único)
    const maquina  = row.getCell(4).value;  // Maquina (nombre/número)
    const adqRaw   = row.getCell(5).value;  // Adquisicion
    const local    = normText(row.getCell(6).value);                 // Local
    const modelo   = nullableText(row.getCell(7).value);             // Modelo
    const activoRaw = row.getCell(8).value;                          // Activo

    // Validación mínima: necesita tipo y nro
    if (!tipo || nroTipo == null) {
      omitidos.push({ rowNum, motivo: 'tipo o nro vacío', raw: row.values });
      continue;
    }

    maquinas.push({
      docId:        String(nroTipo),        // ID del documento en Firestore
      excel_id:     Number(excelId) || null,
      tipo,
      nro_tipo:     Number(nroTipo),
      maquina:      String(maquina ?? '').trim(),
      local_fisico: local,
      modelo,
      adquisicion:  toTimestamp(adqRaw),
      activo:       normalizeActivo(activoRaw),
      // Campos con defaults para compatibilidad con el resto del sistema
      sector:       SECTOR,
      nombre_maquina: '',
      lado:         'U',
      nro_serie:    null,
      unidad:       5,
    });
  }

  return { maquinas, omitidos };
};

// ─── Escritura en Firestore ───────────────────────────────────────────────────

const writeMaquinas = async (db, maquinas) => {
  let written = 0;

  for (let i = 0; i < maquinas.length; i += BATCH_SIZE) {
    const chunk = maquinas.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const m of chunk) {
      const { docId, ...payload } = m;
      const ref = db.collection('maquinas').doc(docId);
      batch.set(ref, payload, { merge: true });
      written++;
    }

    if (APPLY) {
      await batch.commit();
      console.log(`  ✅ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} documentos escritos`);
    }
  }

  return written;
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log('══════════════════════════════════════════════');
  console.log('  Importación Maquinas_STC.xlsx → Firestore');
  console.log(`  Modo: ${APPLY ? '🟢 APPLY (escribe en Firestore)' : '🟡 DRY RUN (solo lectura)'}`);
  console.log('══════════════════════════════════════════════\n');

  const { maquinas, omitidos } = await parseMaquinas();

  // Resumen de lo que se va a importar
  const porTipo = {};
  const activas = maquinas.filter(m => m.activo).length;
  const inactivas = maquinas.filter(m => !m.activo).length;
  maquinas.forEach(m => { porTipo[m.tipo] = (porTipo[m.tipo] || 0) + 1; });

  console.log('\n📊 Resumen de datos parseados:');
  Object.entries(porTipo).sort(([,a],[,b]) => b - a).forEach(([tipo, count]) => {
    console.log(`   ${tipo.padEnd(18)} → ${count} máquinas`);
  });
  console.log(`\n   Total:     ${maquinas.length} máquinas`);
  console.log(`   Activas:   ${activas}`);
  console.log(`   Inactivas: ${inactivas}`);
  console.log(`   Omitidas:  ${omitidos.length}`);

  if (omitidos.length) {
    console.warn('\n⚠️  Filas omitidas:');
    omitidos.forEach(o => console.warn(`   Fila ${o.rowNum}: ${o.motivo}`));
  }

  console.log('\n📋 Muestra de primeros 3 documentos:');
  maquinas.slice(0, 3).forEach(m => {
    const { docId, adquisicion, ...rest } = m;
    console.log(`   [${docId}]`, JSON.stringify({ ...rest, adquisicion: adquisicion?.toDate?.().toISOString().split('T')[0] || null }));
  });

  if (!APPLY) {
    console.log('\n🟡 Dry run completado. Usa --apply para escribir en Firestore.\n');
    return;
  }

  console.log('\n🔥 Conectando a Firestore...');
  initAdmin();
  const db = getFirestore();

  console.log('📤 Escribiendo documentos...');
  const written = await writeMaquinas(db, maquinas);

  console.log('\n══════════════════════════════════════════════');
  console.log('  ✅ IMPORTACIÓN COMPLETADA');
  console.log(`  Documentos escritos en maquinas/: ${written}`);
  console.log('══════════════════════════════════════════════\n');
};

main().catch((error) => {
  console.error('\n❌ Error en la importación:', error.message);
  process.exit(1);
});
