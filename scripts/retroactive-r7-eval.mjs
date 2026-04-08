/**
 * Aplica retroactivamente el cálculo automático de R7 (Evaluación)
 * a patrullas con R1+R6 completadas y R7 pendiente.
 *
 * Uso:
 *   node scripts/retroactive-r7-eval.mjs                     ← dry-run, fecha hoy
 *   node scripts/retroactive-r7-eval.mjs --apply             ← guarda en Firestore
 *   node scripts/retroactive-r7-eval.mjs --apply --fecha=2026-04-08 --turno=A
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'stc-cmms-hilanderia';

const fechaArg   = process.argv.find(a => a.startsWith('--fecha='));
const turnoArg   = process.argv.find(a => a.startsWith('--turno='));
const APPLY      = process.argv.includes('--apply');
const fecha      = fechaArg  ? fechaArg.split('=')[1]  : '2026-04-08';
const filtroTurno = turnoArg ? turnoArg.split('=')[1]  : 'A';

const TOLS_ABS = 0.5;
const TOLS_PCT = 20;

function evalCambio(r1, r6) {
  if (r1 == null || r6 == null || isNaN(r1) || isNaN(r6)) return null;
  const diff = r6 - r1, abs = Math.abs(diff);
  if (abs <= TOLS_ABS) return 'igual';
  if (r1 === 0) return diff > 0 ? 'peor' : 'mejor';
  const pct = (abs / Math.abs(r1)) * 100;
  if (pct <= TOLS_PCT) return diff > 0 ? 'leve' : 'mejor';
  return diff < 0 ? 'mejor' : 'peor';
}

function calcularResumen(d1, d6) {
  let mejoras = 0, empeoramientos = 0, leves = 0, iguales = 0;
  const allIds = new Set([...Object.keys(d1), ...Object.keys(d6)]);
  for (const id of allIds) {
    for (const [v1, v6] of [
      [d1[id]?.roU, d6[id]?.roU],
      [d1[id]?.roT, d6[id]?.roT],
    ]) {
      const e = evalCambio(
        v1 != null ? parseFloat(v1) : null,
        v6 != null ? parseFloat(v6) : null,
      );
      if (e === 'mejor') mejoras++;
      else if (e === 'peor') empeoramientos++;
      else if (e === 'leve') leves++;
      else if (e === 'igual') iguales++;
    }
  }
  return { mejoras, empeoramientos, leves, iguales };
}

const initAdmin = () => {
  if (getApps().length) return;
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || path.join(__dirname, '../.secrets/stc-cmms-hilanderia-firebase-adminsdk-fbsvc-5dc94a0016.json');
  const appConfig = { projectId: PROJECT_ID };
  if (fs.existsSync(saPath)) {
    const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    initializeApp({ ...appConfig, credential: cert(sa) });
  } else {
    initializeApp({ ...appConfig, credential: applicationDefault() });
  }
};

initAdmin();
const db = getFirestore();

console.log(`\n🔍 Buscando patrullas fecha="${fecha}" turno="${filtroTurno}"  [${APPLY ? 'APPLY' : 'dry-run'}]\n`);

const q = db.collection('patrullas').where('fecha', '==', fecha).where('turno', '==', filtroTurno);
const snap = await q.get();

if (snap.empty) {
  console.log('❌ No se encontraron patrullas para esos filtros.');
  process.exit(0);
}

let updated = 0;

for (const docSnap of snap.docs) {
  const p = { id: docSnap.id, ...docSnap.data() };
  const rondas = p.rondas || {};
  const nombre = p.inspectorNombre || p.inspectorEmail || p.id;

  const r1ok = !!rondas.ronda_1?.completada;
  const r6ok = !!rondas.ronda_6?.completada;
  const r7ok = !!rondas.ronda_7?.completada;

  console.log(`📋 [Turno ${p.turno}] ${nombre}`);
  console.log(`   ID: ${p.id}`);
  console.log(`   R1:${r1ok ? '✓' : '✗'}  R6:${r6ok ? '✓' : '✗'}  R7:${r7ok ? '✓ (ya existe)' : '✗ (pendiente)'}`);

  if (r7ok)           { console.log('   ⏭  R7 ya completada, se omite.\n'); continue; }
  if (!r1ok || !r6ok) { console.log('   ⚠  Faltan R1 o R6 — se omite.\n'); continue; }

  const d1 = rondas.ronda_1.datos || {};
  const d6 = rondas.ronda_6.datos || {};
  const resumen = calcularResumen(d1, d6);
  console.log(`   📊 mejoras=${resumen.mejoras}  empeoró=${resumen.empeoramientos}  leves=${resumen.leves}  igual=${resumen.iguales}`);

  if (!APPLY) {
    console.log('   🔵 [dry-run] No se guardó nada.\n');
  } else {
    await docSnap.ref.update({
      'rondas.ronda_7.tipo':                'evaluacion',
      'rondas.ronda_7.completada':          true,
      'rondas.ronda_7.hora':                new Date().toISOString(),
      'rondas.ronda_7.calculadoAutomatico': true,
      'rondas.ronda_7.resumen':             resumen,
    });
    console.log('   ✅ R7 guardada.\n');
    updated++;
  }
}

console.log(`\n✔  Patrullas actualizadas: ${updated} / ${snap.size}\n`);
