/**
 * Importa / enriquece el catálogo desde public/Catalogo.xlsx
 *
 * Uso:
 *   node scripts/import-catalogo-excel.mjs            -> dry run (no escribe)
 *   node scripts/import-catalogo-excel.mjs --apply    -> escribe en Firestore
 *
 * Acciones:
 *   R-60    -> Actualiza docs existentes con marca + asignacion (merge)
 *   JA2S-*  -> Crea/actualiza docs con tipo:'TELAR' (merge)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'stc-cmms-hilanderia';
const APPLY = process.argv.includes('--apply');
const FILE_PATH = path.join(__dirname, '../public/Catalogo.xlsx');
const COLLECTION = 'catalogo_puestos_control';
const BATCH_SIZE = 400;

// ── Inicialización Admin SDK ────────────────────────────────────────────────
const initAdmin = () => {
  if (getApps().length) return;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const appConfig = { projectId: PROJECT_ID };
  if (credPath && fs.existsSync(credPath)) {
    const sa = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    initializeApp({ ...appConfig, credential: cert(sa) });
  } else {
    initializeApp({ ...appConfig, credential: applicationDefault() });
  }
};

// ── Helpers ─────────────────────────────────────────────────────────────────
const str = (v) => String(v ?? '').trim();
const norm = (s) => s.replace(/[\s/\\:*?"<>|]+/g, '_').toLowerCase();

const makeDocId = (prefix, seccion, grupo, subGrupo, denominacion) =>
  `${prefix}_${norm(seccion)}_${norm(grupo)}_${norm(subGrupo)}_${norm(denominacion)}`.slice(0, 100);

// ── Lectura del Excel ────────────────────────────────────────────────────────
const readExcel = async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE_PATH);
  const ws = wb.getWorksheet('Catalogo');
  if (!ws) throw new Error('No se encontró la hoja "Catalogo" en el Excel.');

  const r60 = new Map();   // key -> item  (dedup, tomamos primer valor)
  const ja2s = new Map();

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const modelo = str(row.getCell(2).value);
    if (!modelo) continue;

    const item = {
      marca:          str(row.getCell(1).value),
      modelo,
      asignacion:     str(row.getCell(3).value),
      seccion:        str(row.getCell(4).value),
      abreviado:      str(row.getCell(5).value),
      grupo:          str(row.getCell(6).value),
      subGrupo:       str(row.getCell(7).value) || '-',
      denominacion:   str(row.getCell(8).value),
      numeroCatalogo: str(row.getCell(9).value) || '-',
      numeroArticulo: str(row.getCell(10).value) || '-',
      tiempo:         str(row.getCell(11).value),
      observacion:    str(row.getCell(12).value),
    };

    if (!item.denominacion) continue;

    const key = `${item.seccion}|${item.grupo}|${item.denominacion}`;

    if (modelo === 'R-60') {
      if (!r60.has(key)) {
        r60.set(key, item);
      } else {
        // Enriquecer si la primera ocurrencia tenía campos vacíos
        const ex = r60.get(key);
        if (!ex.tiempo && item.tiempo) ex.tiempo = item.tiempo;
        if (!ex.observacion && item.observacion) ex.observacion = item.observacion;
      }
    } else {
      // JA2S u otro modelo TELAR
      if (!ja2s.has(key)) ja2s.set(key, item);
    }
  }

  return { r60: [...r60.values()], ja2s: [...ja2s.values()] };
};

// ── Escritura en lotes ───────────────────────────────────────────────────────
const writeBatches = async (db, operations) => {
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const chunk = operations.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach(({ ref, data }) => batch.set(ref, data, { merge: true }));
    await batch.commit();
    console.log(`  Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} documentos escritos`);
  }
};

// ── Main ─────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log(`\n[import-catalogo-excel] Modo: ${APPLY ? 'APPLY (escribe)' : 'DRY RUN (solo muestra)'}\n`);

  const { r60, ja2s } = await readExcel();
  console.log(`Leídos: R-60 únicos=${r60.length}  JA2S únicos=${ja2s.length}`);

  // ── Preparar operaciones R-60 ──
  const opsR60 = r60.map((item) => {
    const docId = makeDocId('r60', item.seccion, item.grupo, item.subGrupo, item.denominacion);
    return {
      docId,
      ref: null,  // se rellena abajo si APPLY
      data: {
        marca: item.marca,
        asignacion: item.asignacion,
        tiempo: item.tiempo,
        observacion: item.observacion,
        modelo: 'R-60',
        updatedAt: new Date(),
      },
    };
  });

  // ── Preparar operaciones JA2S ──
  const opsJA2S = ja2s.map((item) => {
    const docId = makeDocId('telar_ja2s', item.seccion, item.grupo, item.subGrupo, item.denominacion);
    return {
      docId,
      ref: null,
      data: {
        marca: item.marca,
        modelo: item.modelo,
        tipo: 'TELAR',
        asignacion: item.asignacion,
        seccion: item.seccion,
        abreviado: item.abreviado,
        grupo: item.grupo,
        subGrupo: item.subGrupo,
        denominacion: item.denominacion,
        numeroCatalogo: item.numeroCatalogo,
        numeroArticulo: item.numeroArticulo,
        tiempo: item.tiempo,
        observacion: item.observacion,
        updatedAt: new Date(),
      },
    };
  });

  // ── Dry run: mostrar resumen ──
  console.log('\n--- R-60: se actualizarán con merge (marca + asignacion + tiempo + observacion) ---');
  opsR60.slice(0, 5).forEach(op => console.log(' ', op.docId, '->', JSON.stringify(op.data)));
  if (opsR60.length > 5) console.log(`  ... y ${opsR60.length - 5} más`);

  console.log('\n--- JA2S (TELAR): se crearán/actualizarán con merge ---');
  opsJA2S.slice(0, 5).forEach(op => console.log(' ', op.docId, '->', JSON.stringify(op.data)));
  if (opsJA2S.length > 5) console.log(`  ... y ${opsJA2S.length - 5} más`);

  if (!APPLY) {
    console.log('\n⚠  DRY RUN completo. Ejecuta con --apply para escribir en Firestore.\n');
    return;
  }

  // ── Escritura ──
  initAdmin();
  const db = getFirestore();
  const col = db.collection(COLLECTION);

  console.log('\nEscribiendo R-60...');
  await writeBatches(db, opsR60.map(op => ({ ref: col.doc(op.docId), data: op.data })));

  console.log('\nEscribiendo JA2S (TELAR)...');
  await writeBatches(db, opsJA2S.map(op => ({ ref: col.doc(op.docId), data: op.data })));

  console.log(`\n✅  Importación completa: ${opsR60.length} R-60 enriquecidos, ${opsJA2S.length} JA2S creados/actualizados.\n`);
};

main().catch((err) => { console.error('Error:', err); process.exit(1); });
