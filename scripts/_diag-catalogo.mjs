import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync } from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (!getApps().length) {
  const saPath = path.join(__dirname, '../.secrets/stc-cmms-hilanderia-firebase-adminsdk-fbsvc-5dc94a0016.json');
  initializeApp({ projectId: 'stc-cmms-hilanderia', credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))) });
}
const db = getFirestore();
const snap = await db.collection('catalogo_puestos_control').get();
const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

const modelos = [...new Set(docs.map(d => d.modelo))].sort();
console.log('Modelos:', modelos);
console.log('Total docs:', docs.length);

for (const m of modelos) {
  const mdocs = docs.filter(d => d.modelo === m);
  const secciones = [...new Set(mdocs.map(d => d.seccion))].sort();
  for (const s of secciones) {
    const sdocs = mdocs.filter(d => d.seccion === s);
    const rawGrupos = sdocs.map(d => d.grupo);
    // Detectar duplicados exactos
    const exact = {};
    rawGrupos.forEach(g => { exact[g] = (exact[g]||0)+1; });
    const dupExact = Object.entries(exact).filter(([,c]) => c > 1);
    // Detectar duplicados por trim
    const trimmed = {};
    rawGrupos.forEach(g => { const k = (g||'').trim(); trimmed[k] = (trimmed[k]||0)+1; });
    const dupTrim = Object.entries(trimmed).filter(([,c]) => c > 1);
    if (dupExact.length || dupTrim.length) {
      console.log(`\n[${m}] Sección "${s}":`);
      if (dupExact.length) console.log('  Grupos duplicados (exacto):', dupExact.map(([g,c])=>`"${g}"(${c})`));
      if (dupTrim.length)  console.log('  Grupos duplicados (trim):  ', dupTrim.map(([g,c])=>`"${g}"(${c})`));
      // Mostrar los docs con ese grupo duplicado
      for (const [g] of dupTrim) {
        const matches = sdocs.filter(d => (d.grupo||'').trim() === g);
        console.log(`  Docs con grupo "${g}":`);
        matches.forEach(d => console.log(`    id=${d.id}  grupo=|${JSON.stringify(d.grupo)}|  denom="${d.denominacion}"  sub="${d.subGrupo}"`));
      }
    }
  }
}
console.log('\nDiagnóstico completo.');
