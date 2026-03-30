/**
 * Elimina documentos duplicados en `catalogo_puestos_control`.
 * Un duplicado es cualquier doc que comparta (modelo + seccion + grupo + subGrupo + denominacion)
 * con otro ya procesado. Se conserva el primer doc encontrado y se borran los restantes.
 *
 * Uso:
 *   node scripts/dedup-catalogo.mjs           → dry-run (solo muestra)
 *   node scripts/dedup-catalogo.mjs --apply   → borra duplicados en Firestore
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const PROJECT_ID = 'stc-cmms-hilanderia';
const COLLECTION = 'catalogo_puestos_control';
const BATCH_SIZE = 400;

// ── Firebase Admin ────────────────────────────────────────────────────────────
if (!getApps().length) {
  const saPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, '../.secrets/stc-cmms-hilanderia-firebase-adminsdk-fbsvc-5dc94a0016.json');
  if (existsSync(saPath)) {
    initializeApp({ projectId: PROJECT_ID, credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))) });
  } else {
    initializeApp({ projectId: PROJECT_ID });
  }
}
const db = getFirestore();

// ── Main ──────────────────────────────────────────────────────────────────────
const snap = await db.collection(COLLECTION).get();
console.log(`Total documentos en colección: ${snap.size}`);

const seen = new Map();      // key → docId conservado
const toDelete = [];         // docIds a eliminar

for (const doc of snap.docs) {
  const d = doc.data();
  const key = [
    (d.modelo       || '').trim(),
    (d.seccion      || '').trim(),
    (d.grupo        || '').trim(),
    (d.subGrupo     || '').trim(),
    (d.denominacion || '').trim(),
  ].join('||');

  if (seen.has(key)) {
    toDelete.push(doc.id);
  } else {
    seen.set(key, doc.id);
  }
}

console.log(`Duplicados detectados: ${toDelete.length}`);
if (toDelete.length === 0) {
  console.log('✅ No hay duplicados. Base de datos limpia.');
  process.exit(0);
}

// Muestra los primeros 20 para referencia
console.log('Primeros duplicados a eliminar:', toDelete.slice(0, 20));

if (!APPLY) {
  console.log('\n⚠️  DRY-RUN: no se borró nada. Ejecutá con --apply para confirmar.');
  process.exit(0);
}

// ── Borrado en lotes de 400 ───────────────────────────────────────────────────
let deleted = 0;
for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
  const batch = db.batch();
  toDelete.slice(i, i + BATCH_SIZE).forEach(id => {
    batch.delete(db.collection(COLLECTION).doc(id));
  });
  await batch.commit();
  deleted += Math.min(BATCH_SIZE, toDelete.length - i);
  console.log(`  Progreso: ${deleted}/${toDelete.length} borrados`);
}

console.log(`\n✅ Deduplicación completa. ${toDelete.length} documentos eliminados.`);
