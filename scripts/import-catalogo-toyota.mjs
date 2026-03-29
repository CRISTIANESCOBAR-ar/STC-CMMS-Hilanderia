/**
 * Importa el catálogo de piezas Toyota JA2S desde public/Catalogo.xlsx
 * a la colección `catalogo_puestos_control` en Firestore.
 *
 * Uso:
 *   node scripts/import-catalogo-toyota.mjs          ← dry-run (solo muestra)
 *   node scripts/import-catalogo-toyota.mjs --apply  ← escribe en Firestore
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync, existsSync } from 'fs';

const require   = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ExcelJS   = require('exceljs');

// ── Firebase Admin ────────────────────────────────────────────────────────────
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore }                  from 'firebase-admin/firestore';

const PROJECT_ID = 'stc-cmms-hilanderia';
const initAdmin  = () => {
  if (getApps().length) return;
  const saPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, '../.secrets/stc-cmms-hilanderia-firebase-adminsdk-fbsvc-5dc94a0016.json');
  if (saPath && existsSync(saPath)) {
    initializeApp({ projectId: PROJECT_ID, credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))) });
  } else {
    initializeApp({ projectId: PROJECT_ID });
  }
};
initAdmin();
const db = getFirestore();

const APPLY = process.argv.includes('--apply');
const COLLECTION = 'catalogo_puestos_control';

// ── Normalizar tiempo ─────────────────────────────────────────────────────────
// "  3 - 5 min " → "3 - 5 min"   |  "10 – 15 min" → "10 - 15 min"
const normalizeTiempo = (raw) => {
  if (!raw || !raw.trim()) return null;
  return raw.trim().replace(/\u2013/g, '-').replace(/\s+/g, ' ');
};

// ── Slug para docId ───────────────────────────────────────────────────────────
const slugify = (str) => String(str || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, '../public/Catalogo.xlsx'));
  const ws = wb.worksheets[0];

  const items = [];
  ws.eachRow((row, n) => {
    if (n === 1) return; // header
    const marca = row.getCell(1).text.trim();
    if (marca !== 'TOYOTA') return;

    const modelo        = row.getCell(2).text.trim();
    const asignacion    = row.getCell(3).text.trim();
    const seccion       = row.getCell(4).text.trim();
    const abreviado     = row.getCell(5).text.trim();
    const grupo         = row.getCell(6).text.trim();
    const subGrupo      = row.getCell(7).text.trim();
    const denominacion  = row.getCell(8).text.trim();
    const numCatalogo   = row.getCell(9).text.trim();
    const numArticulo   = row.getCell(10).text.trim();
    const tiempo        = normalizeTiempo(row.getCell(11).text);
    const observacion   = row.getCell(12).text.trim() || null;

    if (!denominacion) return;

    const docId = `toyota_${slugify(seccion)}_${slugify(grupo)}_${slugify(subGrupo)}_${slugify(denominacion)}`;

    items.push({
      docId,
      data: {
        marca, modelo, asignacion,
        seccion, abreviado, grupo, subGrupo,
        denominacion,
        numeroCatalogo: numCatalogo !== '-' ? numCatalogo : null,
        numeroArticulo: numArticulo !== '-' ? numArticulo : null,
        tiempo,
        observacion,
        updatedAt: new Date(),
      },
    });
  });

  console.log(`\n📋 Toyota items a importar: ${items.length}`);

  // Resumen por sección
  const porSeccion = {};
  items.forEach(({ data: d }) => {
    porSeccion[d.seccion] = (porSeccion[d.seccion] || 0) + 1;
  });
  console.log('\nSecciones:');
  Object.entries(porSeccion).forEach(([s, c]) => console.log(`  ${s}: ${c} piezas`));

  if (!APPLY) {
    console.log('\n⚠️  Dry-run. Agrega --apply para escribir en Firestore.\n');
    return;
  }

  // ── Escritura en lotes de 500 ─────────────────────────────────────────────
  const BATCH_SIZE = 400;
  let count = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = db.batch();
    items.slice(i, i + BATCH_SIZE).forEach(({ docId, data }) => {
      batch.set(db.collection(COLLECTION).doc(docId), data, { merge: true });
    });
    await batch.commit();
    count += Math.min(BATCH_SIZE, items.length - i);
    console.log(`  ✓ ${count}/${items.length} escritos`);
  }

  console.log(`\n✅ Importación completa: ${items.length} piezas Toyota en '${COLLECTION}'.\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
