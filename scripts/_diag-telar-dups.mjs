/**
 * Diagnostica duplicados visuales en TELAR (mismo sec+grp+denom distinto subGrupo)
 */
import path from 'path';
import { readFileSync } from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const saPath = path.join(__dirname, '../.secrets/stc-cmms-hilanderia-firebase-adminsdk-fbsvc-5dc94a0016.json');

if (!getApps().length) {
  initializeApp({ projectId: 'stc-cmms-hilanderia', credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))) });
}
const db = getFirestore();

const snap = await db.collection('catalogo_puestos_control').where('tipo', '==', 'TELAR').get();
console.log('Total TELAR docs:', snap.size);

// Mostrar todos los items de ACUMULADORES, con denominación exacta (JSON para ver espacios)
const acum = snap.docs.filter(d => (d.data().grupo || '') == '1').map(d => ({
  id: d.id,
  seccion: d.data().seccion,
  grupo: d.data().grupo,
  subGrupo: d.data().subGrupo,
  denominacion: JSON.stringify(d.data().denominacion),
}));
console.log('\nDocs grupo 1 (ACUMULADORES):');
acum.forEach(d => console.log(' ', d.denominacion, '| subGrupo:', JSON.stringify(d.subGrupo), '| id:', d.id));

// Buscar todos los grupos en INSERCION
const insercion = snap.docs.filter(d => d.data().seccion === 'INSERCION');
const grupos = [...new Set(insercion.map(d => d.data().grupo))].sort();
console.log('\nGrupos en INSERCION:', grupos);

// Contar por denominacion normalizada (trim+uppercase)
const normCounts = {};
for (const doc of snap.docs) {
  const d = doc.data();
  const k = [d.modelo||'', d.seccion||'', d.grupo||'', (d.denominacion||'').trim().toUpperCase()].join('||');
  if (!normCounts[k]) normCounts[k] = [];
  normCounts[k].push({ id: doc.id, denom: d.denominacion, subGrupo: d.subGrupo });
}
const normDups = Object.entries(normCounts).filter(([, v]) => v.length > 1);
console.log('\nDuplicados por denominacion normalizada (trim+uppercase):', normDups.length);
normDups.slice(0, 20).forEach(([k, v]) => {
  const p = k.split('||');
  console.log(`\n  [${p[0]}] ${p[1]} / gr${p[2]} / "${p[3]}"`);
  v.forEach((x, i) => console.log(`    [${i}] id=${x.id}  denom=${JSON.stringify(x.denom)}  subGrupo=${JSON.stringify(x.subGrupo)}`));
});

