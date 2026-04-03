/**
 * Elimina los 120 docs legacy "toyota_..." del modelo JA2S-190TP-EF-T710.
 * Estos docs NO tienen campo 'tipo' y son duplicados exactos de los docs 'telar_ja2s_...'
 *
 * Uso:
 *   node scripts/dedup-telar-toyota.mjs          → dry-run
 *   node scripts/dedup-telar-toyota.mjs --apply  → elimina de Firestore
 */
import path from 'path';
import { readFileSync } from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const sa = path.join(__dirname, '../.secrets/stc-cmms-hilanderia-firebase-adminsdk-fbsvc-5dc94a0016.json');

if (!getApps().length) {
  initializeApp({ projectId: 'stc-cmms-hilanderia', credential: cert(JSON.parse(readFileSync(sa, 'utf8'))) });
}
const db = getFirestore();

const snap = await db.collection('catalogo_puestos_control')
  .where('modelo', '==', 'JA2S-190TP-EF-T710')
  .get();

// Identificar los duplicados legacy: docs sin campo 'tipo' (los toyota_...)
const toDelete = snap.docs.filter(d => !d.data().tipo);

console.log(`Total docs JA2S-190TP-EF-T710: ${snap.size}`);
console.log(`Docs sin campo 'tipo' (legacy toyota): ${toDelete.length}`);
console.log(`Docs con tipo='TELAR' (correctos):     ${snap.size - toDelete.length}`);

if (toDelete.length === 0) {
  console.log('✅ No hay duplicados legacy. Nada que eliminar.');
  process.exit(0);
}

// Muestra los primeros 5 para confirmación visual
console.log('\nEjemplos de docs a eliminar:');
toDelete.slice(0, 5).forEach(d => {
  const x = d.data();
  console.log(`  ${d.id}  →  "${x.denominacion}"  (${x.seccion} / ${x.grupo})`);
});

if (!APPLY) {
  console.log(`\n⚠️  DRY-RUN: no se borró nada. Ejecutá con --apply para eliminar los ${toDelete.length} docs.`);
  process.exit(0);
}

// Borrado en lotes de 400
let deleted = 0;
const BATCH_SIZE = 400;
for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
  const batch = db.batch();
  toDelete.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
  await batch.commit();
  deleted += Math.min(BATCH_SIZE, toDelete.length - i);
  console.log(`  Borrados: ${deleted}/${toDelete.length}`);
}

console.log(`\n✅ ${deleted} docs legacy eliminados. El catálogo TELAR quedó con ${snap.size - deleted} ítems únicos.`);
