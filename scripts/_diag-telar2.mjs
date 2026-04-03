import path from 'path';
import { readFileSync } from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sa = path.join(__dirname, '../.secrets/stc-cmms-hilanderia-firebase-adminsdk-fbsvc-5dc94a0016.json');
if (!getApps().length) initializeApp({ projectId: 'stc-cmms-hilanderia', credential: cert(JSON.parse(readFileSync(sa, 'utf8'))) });
const db = getFirestore();

const snap = await db.collection('catalogo_puestos_control').where('modelo', '==', 'JA2S-190TP-EF-T710').get();
console.log('Docs con modelo=JA2S-190TP-EF-T710:', snap.size);

const secs = {};
snap.docs.forEach(d => {
  const s = d.data().seccion || '(sin)';
  secs[s] = (secs[s] || 0) + 1;
});
console.log('Por seccion:', secs);

const acum = snap.docs.filter(d => d.data().grupo === 'ACUMULADORES');
console.log('\nACUMULADORES count:', acum.length);
acum.forEach(d => {
  const x = d.data();
  console.log(' ', JSON.stringify(x.denominacion), '| tipo:', x.tipo, '| subGrupo:', JSON.stringify(x.subGrupo));
});

// Buscar duplicados visuales por denom normalizada
const normMap = {};
snap.docs.forEach(d => {
  const x = d.data();
  const k = `${x.seccion}||${x.grupo}||${(x.denominacion||'').trim().toUpperCase()}`;
  if (!normMap[k]) normMap[k] = [];
  normMap[k].push({ id: d.id, denom: x.denominacion, subGrupo: x.subGrupo, tipo: x.tipo });
});
const dups = Object.entries(normMap).filter(([, v]) => v.length > 1);
console.log('\nDuplicados normalizados:', dups.length);
dups.slice(0, 10).forEach(([k, v]) => {
  console.log('\n  KEY:', k);
  v.forEach((x, i) => console.log(`    [${i}] id=${x.id} denom=${JSON.stringify(x.denom)} subGrupo=${JSON.stringify(x.subGrupo)} tipo=${x.tipo}`));
});
