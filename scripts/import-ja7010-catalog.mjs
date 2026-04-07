/**
 * Importa el catálogo extraído de JA7010.pdf a catalogo_puestos_control.
 *
 * Uso:
 *   node scripts/import-ja7010-catalog.mjs          ← dry-run (solo muestra)
 *   node scripts/import-ja7010-catalog.mjs --apply  ← escribe en Firestore
 *
 * Fuente: scripts/catalogo_toyota_ja7010_output.json
 *         (generado por scripts/extract-ja7010-catalog.mjs)
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync, existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Firebase Admin ────────────────────────────────────────────────────────────
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore }                  from 'firebase-admin/firestore';

const PROJECT_ID = 'stc-cmms-hilanderia';
const initAdmin = () => {
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

const APPLY      = process.argv.includes('--apply');
const COLLECTION = 'catalogo_puestos_control';
const JSON_PATH  = path.join(__dirname, 'catalogo_toyota_ja7010_output.json');
const BATCH_SIZE = 400;

// ── Slug para docId (idéntico al resto de scripts de importación) ─────────────
const slugify = (str) => String(str || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(JSON_PATH)) {
    console.error(`\n❌ No se encontró: ${JSON_PATH}`);
    console.error('   Ejecuta primero: node scripts/extract-ja7010-catalog.mjs\n');
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  console.log(`\n📋 JA7010 ítems en JSON: ${raw.length}`);

  // Deduplicar: mismo numeroCatalogo dentro del mismo grupo → sumar cantidad
  const deduped = new Map();
  for (const d of raw) {
    const key = `${slugify(d.seccion)}__${slugify(d.grupo)}__${slugify(d.numeroCatalogo)}`;
    if (deduped.has(key)) {
      deduped.get(key).cantidad += (d.cantidad || 1);
    } else {
      deduped.set(key, { ...d, cantidad: d.cantidad || 1 });
    }
  }
  const uniq = [...deduped.values()];
  console.log(`   (${raw.length - uniq.length} duplicados fusionados → ${uniq.length} únicos)`);

  const items = uniq.map((d) => {
    const docId = `toyota_ja7010_${slugify(d.seccion)}_${slugify(d.grupo)}_${slugify(d.numeroCatalogo)}`;
    return {
      docId,
      data: {
        marca:          d.marca,
        modelo:         d.modelo,
        asignacion:     d.asignacion,
        seccion:        d.seccion,
        abreviado:      d.abreviado,
        grupo:          d.grupo,
        subGrupo:       d.subGrupo,
        denominacion:   d.denominacion,
        numeroCatalogo: d.numeroCatalogo || null,
        numeroArticulo: d.numeroArticulo || null,
        cantidad:       d.cantidad       || 1,
        nivel:          d.nivel          || null,
        tiempo:         d.tiempo         || null,
        observacion:    d.observacion    || null,
        updatedAt:      new Date(),
      },
    };
  });

  // ── Resumen por sección ───────────────────────────────────────────────────
  const porSeccion = {};
  items.forEach(({ data: d }) => { porSeccion[d.seccion] = (porSeccion[d.seccion] || 0) + 1; });
  console.log('\nSecciones:');
  Object.entries(porSeccion)
    .sort((a, b) => b[1] - a[1])
    .forEach(([s, c]) => console.log(`  ${String(c).padStart(4)}  ${s}`));

  // ── Muestra de primeros 5 ────────────────────────────────────────────────
  console.log('\nMuestra (primeros 5):');
  items.slice(0, 5).forEach(({ docId, data: d }) =>
    console.log(`  [${d.grupo}] ${d.numeroCatalogo} | ${d.denominacion} | ${docId.slice(0, 60)}`)
  );

  if (!APPLY) {
    console.log('\n⚠️  Dry-run. Agrega --apply para escribir en Firestore.\n');
    return;
  }

  // ── Escritura en lotes de 400 ─────────────────────────────────────────────
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

  console.log(`\n✅ Importación completa: ${items.length} piezas JA7010 en '${COLLECTION}'.\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
