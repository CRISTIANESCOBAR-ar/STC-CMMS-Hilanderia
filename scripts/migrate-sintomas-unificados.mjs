/**
 * Migra todos los documentos de `sintomas_tejeduria` a la nueva colección unificada `sintomas`.
 * Agrega los campos: sector='TEJEDURIA', tipoMaquina='TELAR'
 *
 * La colección original NO se toca (migración no destructiva).
 *
 * Uso:
 *   node scripts/migrate-sintomas-unificados.mjs           → dry-run (solo muestra)
 *   node scripts/migrate-sintomas-unificados.mjs --apply   → escribe en Firestore
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const PROJECT_ID = 'stc-cmms-hilanderia';
const SRC_COL  = 'sintomas_tejeduria';
const DEST_COL = 'sintomas';

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

async function main() {
  console.log(`\n🔄 Migración: ${SRC_COL} → ${DEST_COL}`);
  console.log(`   Modo: ${APPLY ? '⚡ APPLY (escribe en Firestore)' : '🔍 DRY-RUN (sin cambios)'}\n`);

  // ── Leer origen ───────────────────────────────────────────────────────────
  const srcSnap = await db.collection(SRC_COL).get();
  if (srcSnap.empty) {
    console.log(`⚠️  La colección "${SRC_COL}" está vacía o no existe.`);
    return;
  }

  // ── Verificar destino (para no sobreescribir si ya fue migrado) ───────────
  const destSnap = await db.collection(DEST_COL)
    .where('sector', '==', 'TEJEDURIA')
    .where('tipoMaquina', '==', 'TELAR')
    .limit(1)
    .get();

  if (!destSnap.empty && !process.argv.includes('--force')) {
    console.log(`⚠️  Ya existen documentos TEJEDURIA/TELAR en "${DEST_COL}".`);
    console.log(`   Usá --force para sobreescribir de todas formas.\n`);
    return;
  }

  // ── Convertir y mostrar ───────────────────────────────────────────────────
  // Se descarta el campo `id` del data para que no sobreescriba el id calculado
  const docs = srcSnap.docs.map(d => {
    const { id: _ignore, ...data } = d.data();
    return {
      id: `tejeduria_telar_${d.id}`,  // prefijo para evitar colisiones con otros sectores
      ...data,
      sector:      'TEJEDURIA',
      tipoMaquina: 'TELAR',
    };
  });

  console.log(`📋 ${docs.length} síntomas encontrados en "${SRC_COL}":`);
  docs.forEach(d => {
    console.log(`   [${String(d.orden ?? '?').padStart(2)}] ${d.nombre.padEnd(30)} → destino id: ${d.id}`);
  });

  if (!APPLY) {
    console.log(`\n✅ Dry-run completado. Ejecutá con --apply para migrar.\n`);
    return;
  }

  // ── Escribir en batches ───────────────────────────────────────────────────
  const BATCH_SIZE = 400;
  let escritos = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);
    chunk.forEach(({ id, ...data }) => {
      batch.set(db.collection(DEST_COL).doc(id), data, { merge: false });
    });
    await batch.commit();
    escritos += chunk.length;
    console.log(`   ✅ Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} documentos escritos`);
  }

  console.log(`\n🎉 Migración completada: ${escritos} síntomas escritos en "${DEST_COL}".`);
  console.log(`   La colección original "${SRC_COL}" no fue modificada.\n`);
}

main().catch(err => {
  console.error('❌ Error durante la migración:', err);
  process.exit(1);
});
