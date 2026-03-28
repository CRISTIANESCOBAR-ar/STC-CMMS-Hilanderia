/**
 * add-tipofalla-prioridad.mjs
 * Agrega los campos `tipoDeFalla` y `prioridad` a los documentos existentes
 * en las colecciones `codigos_defectos` y `codigos_paradas`.
 *
 * Solo actualiza docs que NO tienen aún esos campos (idempotente).
 *
 * Uso:
 *   node scripts/add-tipofalla-prioridad.mjs          → dry-run (solo muestra)
 *   node scripts/add-tipofalla-prioridad.mjs --apply  → escribe en Firestore
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 'stc-cmms-hilanderia';
const APPLY      = process.argv.includes('--apply');

// ── Firebase Admin ────────────────────────────────────────────────────────────
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

// ── Migración ─────────────────────────────────────────────────────────────────
const COLLECTIONS = ['codigos_defectos', 'codigos_paradas'];

async function migrateCollection(colName) {
  const snap = await db.collection(colName).get();
  const docs = snap.docs;

  // Separa los que ya tienen los campos vs los que faltan
  const needs = docs.filter(d => {
    const data = d.data();
    return data.tipoDeFalla === undefined || data.prioridad === undefined;
  });

  console.log(`\n📂 ${colName}`);
  console.log(`   Total: ${docs.length}  |  Necesitan migración: ${needs.length}`);

  if (!needs.length) {
    console.log('   ✅ Ya migrada, nada que hacer.');
    return;
  }

  // Muestra preview
  needs.slice(0, 5).forEach(d => {
    const data = d.data();
    const desc = data.motivo_es || data.descripcion_es || '?';
    const cod  = data.codigo;
    console.log(`   → [${cod}] ${desc.substring(0, 50)}`);
  });
  if (needs.length > 5) console.log(`   ... y ${needs.length - 5} más`);

  if (!APPLY) return;

  // Batch: solo actualiza campos faltantes (no sobreescribe valores existentes)
  const BATCH_SIZE = 400;
  let count = 0;
  for (let i = 0; i < needs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    needs.slice(i, i + BATCH_SIZE).forEach(d => {
      const data   = d.data();
      const update = {};
      if (data.tipoDeFalla === undefined) update.tipoDeFalla = null;          // admin lo configura luego
      if (data.prioridad   === undefined) update.prioridad   = 50;             // prioridad media por defecto
      batch.update(d.ref, update);
      count++;
    });
    await batch.commit();
  }
  console.log(`   ✅ Actualizados: ${count} docs`);
}

async function main() {
  console.log(APPLY ? '🚀 MODO APPLY — escribiendo en Firestore' : '👁  DRY-RUN — solo lectura');
  for (const col of COLLECTIONS) {
    await migrateCollection(col);
  }
  if (!APPLY) {
    console.log('\n💡 Agregar --apply para aplicar los cambios.');
  } else {
    console.log('\n✅ Migración completada.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
