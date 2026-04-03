/**
 * import-procedimientos-catalogo.mjs
 *
 * Script genérico para importar procedimientos de mantenimiento al catálogo
 * en Firestore. A diferencia de import-procedimientos-benninger.mjs, este
 * script maneja múltiples modelos dentro del mismo JSON (ej: C60 + TC7).
 *
 * Para cada ítem del JSON:
 *  1. Busca en Firestore un documento con modelo == item.modelo
 *     y matching flexible de denominacion (Jaccard ≥ 0.20).
 *  2. Si hay match: actualiza procedimiento, tiempo, tipoTarea, herramientas, repuestos.
 *  3. Si no hay match: crea un documento nuevo standalone con todos los campos.
 *
 * Uso:
 *   node scripts/import-procedimientos-catalogo.mjs --file scripts/procedimientos_carda_input.json
 *   node scripts/import-procedimientos-catalogo.mjs --file scripts/procedimientos_carda_input.json --apply
 *
 * Opciones:
 *   --file <ruta>   Ruta al archivo JSON de entrada (requerido)
 *   --apply         Escribe cambios en Firestore. Sin esta flag, solo simula (dry-run).
 *   --modelo <X>    Filtra solo los ítems del modelo indicado (ej: --modelo C60)
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore }                                      from 'firebase-admin/firestore';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 'stc-cmms-hilanderia';
const COLLECTION = 'catalogo_puestos_control';

// ── Parseo de argumentos ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY        = args.includes('--apply');
const fileArgIdx   = args.indexOf('--file');
const modeloArgIdx = args.indexOf('--modelo');

if (fileArgIdx === -1 || !args[fileArgIdx + 1]) {
  console.error('❌ Debes indicar el archivo de entrada con: --file <ruta>');
  console.error('   Ejemplo: node scripts/import-procedimientos-catalogo.mjs --file scripts/procedimientos_carda_input.json --apply');
  process.exit(1);
}

const INPUT_FILE   = path.resolve(args[fileArgIdx + 1]);
const FILTRO_MODELO = modeloArgIdx !== -1 ? args[modeloArgIdx + 1] : null;

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

// ── Similitud Jaccard sobre palabras ─────────────────────────────────────────
const tokenize = (s) =>
  String(s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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

// ── Busca el mejor match en la lista de docs de Firestore ────────────────────
const findBestMatch = (inputItem, fsDocs) => {
  // Filtrar primero por grupo exacto (si existe en Firestore)
  const byGrupo = fsDocs.filter(d => String(d.grupo || '') === String(inputItem.grupo));
  const candidates = byGrupo.length ? byGrupo : fsDocs;
  if (!candidates.length) return null;

  let best = null;
  let bestScore = -1;

  for (const doc of candidates) {
    const score = jaccard(inputItem.denominacion, doc.denominacion);
    if (score > bestScore) { bestScore = score; best = { doc, score }; }
  }

  return (best && best.score >= 0.20) ? best : null;
};

// ── Genera un ID de documento deterministico ─────────────────────────────────
const makeDocId = (modelo, grupo, denominacion) => {
  const sanitize = (s) => String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const slug = sanitize(denominacion).slice(0, 40);
  return `${sanitize(modelo)}_${sanitize(grupo)}_${slug}`;
};

// ── Mapa modelo → marca (extendible) ─────────────────────────────────────────
const MARCA_POR_MODELO = {
  'C60':       'RIETER',
  'CBA-4':     'RIETER',
  'TC7':       'TRUTZSCHLER',
  'TD03':      'TRUTZSCHLER',
  'BO-A':      'TRUTZSCHLER',
  'CL-C3':     'TRUTZSCHLER',
  'BR-F/FD':   'TRUTZSCHLER',
  'FD-S':      'TRUTZSCHLER',
  'FD-T':      'TRUTZSCHLER',
  'BENNINGER': 'BENNINGER',
  'R-37':      'RIETER',
  'R-60':      'RIETER',
  // Agregar más modelos aquí según se incorporen
};
const marcaDe = (modelo) => MARCA_POR_MODELO[String(modelo).toUpperCase()] || String(modelo).toUpperCase();

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  initAdmin();
  const db = getFirestore();

  // Leer input JSON
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ No se encontró el archivo de entrada: ${INPUT_FILE}`);
    process.exit(1);
  }

  let inputItems = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));

  if (FILTRO_MODELO) {
    inputItems = inputItems.filter(i => String(i.modelo).toUpperCase() === FILTRO_MODELO.toUpperCase());
    console.log(`\n🔎 Filtro activo: solo modelo "${FILTRO_MODELO}" → ${inputItems.length} ítems`);
  }

  console.log(`\n📄 Archivo: ${INPUT_FILE}`);
  console.log(`   Total ítems a procesar: ${inputItems.length}`);

  // Obtener modelos únicos presentes en el JSON
  const modelosPresentes = [...new Set(inputItems.map(i => i.modelo).filter(Boolean))];
  console.log(`   Modelos detectados: ${modelosPresentes.join(', ')}`);

  // Cargar docs de Firestore para cada modelo encontrado
  const fsDocsPorModelo = {};
  for (const modelo of modelosPresentes) {
    process.stdout.write(`\n🔍 Cargando catálogo "${modelo}" desde Firestore...`);
    const snap = await db.collection(COLLECTION).where('modelo', '==', modelo).get();
    fsDocsPorModelo[modelo] = snap.docs.map(d => ({ _ref: d.ref, _id: d.id, ...d.data() }));
    console.log(` ${fsDocsPorModelo[modelo].length} docs encontrados.`);
  }

  // ── Estadísticas ──────────────────────────────────────────────────────────
  let matched   = 0;
  let unmatched = 0;
  let skipped   = 0;
  const unmatchedList = [];

  const batch = db.batch();
  let batchCount = 0;

  console.log('\n' + '─'.repeat(80));
  console.log('RESULTADO DEL MATCHING');
  console.log('─'.repeat(80));

  for (const item of inputItems) {
    const { modelo, seccion, grupo, denominacion, procedimiento, tiempoEstimado, tipoTarea, herramientas, repuestos } = item;

    if (!procedimiento || !procedimiento.length) {
      console.log(`⏭️  SKIP (sin pasos)  [${modelo}] ${denominacion}`);
      skipped++;
      continue;
    }

    const fsDocs = fsDocsPorModelo[modelo] || [];
    const matchResult = fsDocs.length ? findBestMatch(item, fsDocs) : null;

    if (matchResult) {
      const { doc, score } = matchResult;
      const pct = (score * 100).toFixed(0);
      const yaConProc = doc.procedimiento?.length > 0;

      console.log(
        `${yaConProc ? '🔄' : '✅'} MATCH (${pct}%)  [${modelo}] [${grupo}] ${denominacion}\n` +
        `   → Firestore: "${doc.denominacion}" (id: ${doc._id})\n` +
        `   → Pasos: ${procedimiento.length}${yaConProc ? ' — ya tenía procedimiento, SE SOBREESCRIBE' : ''}`
      );

      if (APPLY) {
        batch.update(doc._ref, {
          procedimiento,
          tiempo:       tiempoEstimado || doc.tiempo || '',
          tipoTarea:    tipoTarea      || '',
          herramientas: herramientas   || [],
          repuestos:    repuestos      || [],
          updatedAt:    new Date(),
        });
        batchCount++;
      }
      matched++;

    } else {
      const newId  = makeDocId(modelo, grupo, denominacion);
      const marca  = marcaDe(modelo);

      console.log(
        `🆕 SIN MATCH → CREA NUEVO  [${modelo}] [${grupo}] ${denominacion}\n` +
        `   → nuevo id: ${newId}\n` +
        `   → Pasos: ${procedimiento.length}`
      );

      if (APPLY) {
        const newRef = db.collection(COLLECTION).doc(newId);
        batch.set(newRef, {
          marca,
          modelo:         String(modelo),
          seccion:        seccion       || '',
          grupo:          String(grupo),
          subGrupo:       '-',
          denominacion:   denominacion,
          numeroCatalogo: '-',
          numeroArticulo: '-',
          tiempo:         tiempoEstimado || '',
          tipoTarea:      tipoTarea      || '',
          herramientas:   herramientas   || [],
          repuestos:      repuestos      || [],
          procedimiento,
          createdAt: new Date(),
          updatedAt: new Date(),
        }, { merge: true });
        batchCount++;
      }

      unmatchedList.push({ modelo, grupo, denominacion });
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
    unmatchedList.forEach(u => console.log(`     [${u.modelo}][${u.grupo}] ${u.denominacion}`));
  }

  if (!APPLY) {
    console.log('\n  ℹ️  DRY-RUN — No se escribió nada en Firestore.');
    console.log(`  Para aplicar los cambios:\n  node scripts/import-procedimientos-catalogo.mjs --file ${path.relative(process.cwd(), INPUT_FILE)} --apply\n`);
  } else {
    console.log('\n  ✅ Cambios escritos en Firestore correctamente.\n');
  }
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
