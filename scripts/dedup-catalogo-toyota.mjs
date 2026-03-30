/**
 * Elimina los documentos duplicados del catálogo Toyota JA2S que fueron
 * importados dos veces con distintos IDs:
 *   - IDs "toyota_..."   →  subGrupo: ""   ← A ELIMINAR
 *   - IDs "telar_ja2s_..." → subGrupo: "-" ← A CONSERVAR
 *
 * Uso:
 *   node scripts/dedup-catalogo-toyota.mjs          → dry-run
 *   node scripts/dedup-catalogo-toyota.mjs --apply  → borra en Firestore
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync } from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const COLLECTION = 'catalogo_puestos_control';
const MODELO_TARGET = 'JA2S-190TP-EF-T710';
const BATCH_SIZE = 400;

if (!getApps().length) {
  const saPath = path.join(__dirname, '../.secrets/stc-cmms-hilanderia-firebase-adminsdk-fbsvc-5dc94a0016.json');
  initializeApp({ projectId: 'stc-cmms-hilanderia', credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))) });
}
const db = getFirestore();

const snap = await db.collection(COLLECTION).get();
const toDelete = snap.docs
  .filter(d => {
    const data = d.data();
    // Eliminar los docs con ID prefijo "toyota_" del modelo target
    return data.modelo === MODELO_TARGET && d.id.startsWith('toyota_');
  })
  .map(d => d.id);

console.log(`Total docs en colección: ${snap.size}`);
console.log(`Docs a eliminar (toyota_ + modelo ${MODELO_TARGET}): ${toDelete.length}`);
if (toDelete.length) console.log('Ejemplos:', toDelete.slice(0, 5));

if (!APPLY) {
  console.log('\n⚠️  DRY-RUN. Ejecutá con --apply para confirmar.');
  process.exit(0);
}

let deleted = 0;
for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
  const batch = db.batch();
  toDelete.slice(i, i + BATCH_SIZE).forEach(id => batch.delete(db.collection(COLLECTION).doc(id)));
  await batch.commit();
  deleted += Math.min(BATCH_SIZE, toDelete.length - i);
  process.stdout.write(`\r  Borrados: ${deleted}/${toDelete.length}`);
}
console.log(`\n✅ Listo. ${toDelete.length} documentos duplicados eliminados.`);
