/**
 * import-procedimientos-benninger.mjs
 *
 * Importa los procedimientos generados por Gemini al catálogo BENNINGER en Firestore.
 * Para cada ítem del JSON busca en Firestore el documento correspondiente por:
 *   1. modelo = 'BENNINGER'
 *   2. grupo   = grupo del JSON
 *   3. denominacion (matching flexible por similitud de palabras clave)
 *
 * También escribe: tiempo, tipoTarea, herramientas, repuestos.
 *
 * Uso:
 *   node scripts/import-procedimientos-benninger.mjs          ← dry-run (solo muestra)
 *   node scripts/import-procedimientos-benninger.mjs --apply  ← escribe en Firestore
 */

import fs          from 'node:fs';
import path        from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore }                  from 'firebase-admin/firestore';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 'stc-cmms-hilanderia';
const APPLY      = process.argv.includes('--apply');
const COLLECTION = 'catalogo_puestos_control';
const INPUT_FILE = path.join(__dirname, 'procedimientos_benninger_input.json');

// ── Firebase Admin ────────────────────────────────────────────────────────────
const initAdmin = () => {
  if (getApps().length) return;
  const saPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, '../.secrets/stc-cmms-hilanderia-firebase-adminsdk-fbsvc-5dc94a0016.json');
  if (saPath && fs.existsSync(saPath)) {
    initializeApp({ projectId: PROJECT_ID, credential: cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))) });
  } else {
    initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
  }
};

// ── Similitud simple entre strings (Jaccard sobre palabras) ──────────────────
// Devuelve un número entre 0 y 1. 1 = idéntico.
const tokenize = (s) =>
  String(s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // quitar tildes
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

const jaccard = (a, b) => {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (!sa.size && !sb.size) return 1;
  const inter = [...sa].filter(x => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return inter / union;
};

// ── Busca el mejor match en la lista de docs de Firestore ───────────────────
const findBestMatch = (inputItem, fsDocs) => {
  // Filtra primero por grupo exacto
  const byGrupo = fsDocs.filter(d => String(d.grupo || '') === String(inputItem.grupo));

  const candidates = byGrupo.length ? byGrupo : fsDocs; // fallback sin filtro
  if (!candidates.length) return null;

  let best = null;
  let bestScore = -1;

  for (const doc of candidates) {
    const score = jaccard(inputItem.denominacion, doc.denominacion);
    if (score > bestScore) {
      bestScore = score;
      best = { doc, score };
    }
  }

  // Umbral mínimo de similitud para considerar match válido
  return (best && best.score >= 0.20) ? best : null;
};

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  initAdmin();
  const db = getFirestore();

  // Leer input JSON
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ No se encontró el archivo de entrada: ${INPUT_FILE}`);
    process.exit(1);
  }
  const inputItems = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  console.log(`\n📄 Ítems en el JSON de Gemini: ${inputItems.length}`);

  // Cargar todos los docs BENNINGER de Firestore
  console.log(`\n🔍 Cargando catálogo BENNINGER desde Firestore...`);
  const snap = await db.collection(COLLECTION)
    .where('modelo', '==', 'BENNINGER')
    .get();

  const fsDocs = snap.docs.map(d => ({ _ref: d.ref, _id: d.id, ...d.data() }));
  console.log(`   Documentos BENNINGER encontrados en Firestore: ${fsDocs.length}`);

  if (!fsDocs.length) {
    console.warn('\n⚠️  No hay documentos BENNINGER en Firestore.');
    console.warn('   Primero importa el catálogo con: node scripts/import-catalogo-excel.mjs --apply');
    console.warn('\n   Continuando en modo SIMULADO para previsualizar el JSON...\n');
  }

  // ── Estadísticas ─────────────────────────────────────────────────────────
  let matched   = 0;
  let unmatched = 0;
  let skipped   = 0;  // ya tenía procedimiento
  const unmatchedList = [];

  const batch = db.batch();
  let batchCount = 0;

  console.log('\n' + '─'.repeat(80));
  console.log('RESULTADO DEL MATCHING');
  console.log('─'.repeat(80));

  for (const item of inputItems) {
    const { seccion, grupo, denominacion, procedimiento, tiempoEstimado, tipoTarea, herramientas, repuestos } = item;

    if (!procedimiento || !procedimiento.length) {
      console.log(`⏭️  SKIP (sin pasos)  ${denominacion}`);
      skipped++;
      continue;
    }

    const matchResult = fsDocs.length ? findBestMatch(item, fsDocs) : null;

    if (matchResult) {
      const { doc, score } = matchResult;
      const pct = (score * 100).toFixed(0);
      const yaConProc = doc.procedimiento?.length > 0;

      console.log(
        `${yaConProc ? '🔄' : '✅'} MATCH (${pct}%)  [${grupo}] ${denominacion}\n` +
        `   → Firestore: "${doc.denominacion}" (id: ${doc._id})\n` +
        `   → Pasos: ${procedimiento.length}${yaConProc ? ' — ya tenía procedimiento, SE SOBREESCRIBE' : ''}`
      );

      if (APPLY) {
        batch.update(doc._ref, {
          procedimiento,
          tiempo:      tiempoEstimado || doc.tiempo || '',
          tipoTarea:   tipoTarea      || '',
          herramientas: herramientas  || [],
          repuestos:    repuestos     || [],
          updatedAt:   new Date(),
        });
        batchCount++;
      }
      matched++;
    } else {
      // Sin match en Firestore → crear nuevo documento standalone
      const newId = `benninger_proc_${String(grupo).replace(/\s/g,'_')}_${
        String(denominacion).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').slice(0,40)
      }`;

      console.log(
        `🆕 SIN MATCH → CREA NUEVO  [${grupo}] ${denominacion}\n` +
        `   → nuevo id: ${newId}\n` +
        `   → Pasos: ${procedimiento.length}`
      );

      if (APPLY) {
        const newRef = db.collection(COLLECTION).doc(newId);
        batch.set(newRef, {
          marca:        'BENNINGER',
          modelo:       'BENNINGER',
          seccion:      seccion  || '',
          grupo:        String(grupo),
          subGrupo:     '-',
          denominacion: denominacion,
          numeroCatalogo: '-',
          numeroArticulo: '-',
          tiempo:          tiempoEstimado || '',
          tipoTarea:       tipoTarea      || '',
          herramientas:    herramientas   || [],
          repuestos:       repuestos      || [],
          procedimiento,
          createdAt: new Date(),
          updatedAt: new Date(),
        }, { merge: true });
        batchCount++;
      }

      unmatchedList.push({ grupo, denominacion });
      unmatched++;
    }

    // Commit por lotes de 400
    if (batchCount >= 400) {
      if (APPLY) await batch.commit();
      batchCount = 0;
    }
  }

  // Commit final
  if (APPLY && batchCount > 0) await batch.commit();

  // ── Resumen ───────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(80));
  console.log('RESUMEN');
  console.log('─'.repeat(80));
  console.log(`  Total ítems procesados : ${inputItems.length}`);
  console.log(`  Actualizados (match)   : ${matched}`);
  console.log(`  Creados (sin match)    : ${unmatched}`);
  console.log(`  Omitidos (sin pasos)   : ${skipped}`);

  if (unmatchedList.length) {
    console.log('\n  ⚠️  Ítems creados como nuevos documentos (sin match en catálogo):');
    unmatchedList.forEach(u => console.log(`     [${u.grupo}] ${u.denominacion}`));
  }

  if (!APPLY) {
    console.log('\n  ℹ️  DRY-RUN — No se escribió nada en Firestore.');
    console.log('  Para aplicar los cambios: node scripts/import-procedimientos-benninger.mjs --apply\n');
  } else {
    console.log('\n  ✅ Cambios escritos en Firestore correctamente.\n');
  }
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
