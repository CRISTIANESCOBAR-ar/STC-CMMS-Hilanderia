/**
 * add-alias.mjs
 * Agrega el campo `alias` (null) a todos los docs existentes en
 * codigos_defectos y codigos_paradas que todavía no lo tengan.
 *
 * Uso:
 *   node scripts/add-alias.mjs          → dry-run
 *   node scripts/add-alias.mjs --apply  → escribe en Firestore
 */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 'stc-cmms-hilanderia';
const APPLY      = process.argv.includes('--apply');

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

async function migrateCollection(colName) {
  const snap  = await db.collection(colName).get();
  const needs = snap.docs.filter(d => d.data().alias === undefined);
  console.log(`\n📂 ${colName}  →  ${needs.length} / ${snap.size} docs necesitan 'alias'`);
  if (!needs.length || !APPLY) return;

  const BATCH = 400;
  let count = 0;
  for (let i = 0; i < needs.length; i += BATCH) {
    const batch = db.batch();
    needs.slice(i, i + BATCH).forEach(d => { batch.update(d.ref, { alias: null }); count++; });
    await batch.commit();
  }
  console.log(`   ✅ Actualizados: ${count}`);
}

async function main() {
  console.log(APPLY ? '🚀 APPLY' : '👁  DRY-RUN');
  await migrateCollection('codigos_defectos');
  await migrateCollection('codigos_paradas');
  if (!APPLY) console.log('\n💡 Agregar --apply para aplicar.');
  else        console.log('\n✅ Listo.');
}
main().catch(e => { console.error(e); process.exit(1); });
