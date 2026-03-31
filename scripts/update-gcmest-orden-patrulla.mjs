/**
 * Actualiza g_cmest y agrega orden_patrulla a las máquinas (telares) en Firestore.
 * Usa la REST API de Firestore con access token obtenido vía firebase-tools.
 * Uso: node scripts/update-gcmest-orden-patrulla.mjs          (dry-run)
 *      node scripts/update-gcmest-orden-patrulla.mjs --apply   (aplica cambios)
 */
import { execSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const PROJECT_ID = 'stc-cmms-hilanderia';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Obtener access token fresco vía firebase-tools
function getAccessToken() {
  const raw = execSync('npx firebase-tools login:ci --no-localhost 2>nul || echo ""', { encoding: 'utf8' }).trim();
  // Mejor: usar el token directamente de la sesión activa
  // firebase-tools expone esto via su config interna
  const tokenRaw = execSync('node -e "const fs=require(\'fs\');const os=require(\'os\');const p=require(\'path\').join(os.homedir(),\'.config\',\'configstore\',\'firebase-tools.json\');const c=JSON.parse(fs.readFileSync(p,\'utf8\'));const rt=c.tokens.refresh_token;fetch(\'https://oauth2.googleapis.com/token\',{method:\'POST\',headers:{\'Content-Type\':\'application/x-www-form-urlencoded\'},body:new URLSearchParams({client_id:\'563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com\',client_secret:\'j9iVZfS8kkCEFUPaAeJV0sAi\',refresh_token:rt,grant_type:\'refresh_token\'})}).then(r=>r.json()).then(d=>process.stdout.write(d.access_token))"', { encoding: 'utf8' });
  return tokenRaw.trim();
}

async function firestoreGet(token, collectionPath) {
  const docs = [];
  let pageToken = '';
  do {
    const url = `${BASE_URL}/${collectionPath}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`GET ${collectionPath} failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    if (data.documents) docs.push(...data.documents);
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

async function firestorePatch(token, docPath, fields) {
  const body = { fields: {} };
  const updateMask = [];
  for (const [key, val] of Object.entries(fields)) {
    updateMask.push(key);
    if (val === null) {
      body.fields[key] = { nullValue: null };
    } else if (typeof val === 'number') {
      body.fields[key] = { integerValue: String(val) };
    } else {
      body.fields[key] = { stringValue: String(val) };
    }
  }
  const url = `https://firestore.googleapis.com/v1/${docPath}?updateMask.fieldPaths=${updateMask.join('&updateMask.fieldPaths=')}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${docPath} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Datos actualizados: { id_maquina: { g_cmest, orden_patrulla } }
const ACTUALIZACIONES = {
  '35088': { g_cmest: '07', orden_patrulla: null },
  '35087': { g_cmest: '07', orden_patrulla: null },
  '35086': { g_cmest: '07', orden_patrulla: null },
  '35085': { g_cmest: '07', orden_patrulla: null },
  '35084': { g_cmest: '07', orden_patrulla: null },
  '35083': { g_cmest: '07', orden_patrulla: null },
  '35082': { g_cmest: '07', orden_patrulla: null },
  '35081': { g_cmest: '07', orden_patrulla: null },
  '35080': { g_cmest: '02', orden_patrulla: 1 },
  '35079': { g_cmest: '02', orden_patrulla: 2 },
  '35078': { g_cmest: '02', orden_patrulla: 3 },
  '35077': { g_cmest: '02', orden_patrulla: 4 },
  '35076': { g_cmest: '01', orden_patrulla: 5 },
  '35075': { g_cmest: '01', orden_patrulla: 6 },
  '35074': { g_cmest: '01', orden_patrulla: 7 },
  '35073': { g_cmest: '01', orden_patrulla: 8 },
  '35072': { g_cmest: '02', orden_patrulla: 16 },
  '35071': { g_cmest: '02', orden_patrulla: 15 },
  '35070': { g_cmest: '02', orden_patrulla: 14 },
  '35069': { g_cmest: '02', orden_patrulla: 13 },
  '35068': { g_cmest: '01', orden_patrulla: 12 },
  '35067': { g_cmest: '01', orden_patrulla: 11 },
  '35066': { g_cmest: '01', orden_patrulla: 10 },
  '35065': { g_cmest: '01', orden_patrulla: 9 },
  '35064': { g_cmest: '02', orden_patrulla: 17 },
  '35063': { g_cmest: '02', orden_patrulla: 18 },
  '35062': { g_cmest: '02', orden_patrulla: 19 },
  '35061': { g_cmest: '02', orden_patrulla: 20 },
  '35060': { g_cmest: '01', orden_patrulla: 21 },
  '35059': { g_cmest: '01', orden_patrulla: 22 },
  '35058': { g_cmest: '01', orden_patrulla: 23 },
  '35057': { g_cmest: '01', orden_patrulla: 24 },
  '35056': { g_cmest: '04', orden_patrulla: 32 },
  '35055': { g_cmest: '04', orden_patrulla: 31 },
  '35054': { g_cmest: '04', orden_patrulla: 30 },
  '35053': { g_cmest: '04', orden_patrulla: 29 },
  '35052': { g_cmest: '03', orden_patrulla: 28 },
  '35051': { g_cmest: '03', orden_patrulla: 27 },
  '35050': { g_cmest: '03', orden_patrulla: 26 },
  '35049': { g_cmest: '03', orden_patrulla: 25 },
  '35048': { g_cmest: '04', orden_patrulla: 33 },
  '35047': { g_cmest: '04', orden_patrulla: 34 },
  '35046': { g_cmest: '04', orden_patrulla: 35 },
  '35045': { g_cmest: '04', orden_patrulla: 36 },
  '35044': { g_cmest: '03', orden_patrulla: 37 },
  '35043': { g_cmest: '03', orden_patrulla: 38 },
  '35042': { g_cmest: '03', orden_patrulla: 39 },
  '35041': { g_cmest: '03', orden_patrulla: 40 },
  '35040': { g_cmest: '04', orden_patrulla: 48 },
  '35039': { g_cmest: '04', orden_patrulla: 47 },
  '35038': { g_cmest: '04', orden_patrulla: 46 },
  '35037': { g_cmest: '04', orden_patrulla: 45 },
  '35036': { g_cmest: '03', orden_patrulla: 44 },
  '35035': { g_cmest: '03', orden_patrulla: 43 },
  '35034': { g_cmest: '03', orden_patrulla: 42 },
  '35033': { g_cmest: '03', orden_patrulla: 41 },
  '35032': { g_cmest: '04', orden_patrulla: 49 },
  '35031': { g_cmest: '04', orden_patrulla: 50 },
  '35030': { g_cmest: '06', orden_patrulla: 51 },
  '35029': { g_cmest: '06', orden_patrulla: 52 },
  '35028': { g_cmest: '05', orden_patrulla: 53 },
  '35027': { g_cmest: '05', orden_patrulla: 54 },
  '35026': { g_cmest: '03', orden_patrulla: 55 },
  '35025': { g_cmest: '03', orden_patrulla: 56 },
  '35024': { g_cmest: '06', orden_patrulla: 64 },
  '35023': { g_cmest: '06', orden_patrulla: 63 },
  '35022': { g_cmest: '06', orden_patrulla: 62 },
  '35021': { g_cmest: '06', orden_patrulla: 61 },
  '35020': { g_cmest: '05', orden_patrulla: 60 },
  '35019': { g_cmest: '05', orden_patrulla: 59 },
  '35018': { g_cmest: '05', orden_patrulla: 58 },
  '35017': { g_cmest: '05', orden_patrulla: 57 },
  '35016': { g_cmest: '06', orden_patrulla: 65 },
  '35015': { g_cmest: '06', orden_patrulla: 66 },
  '35014': { g_cmest: '06', orden_patrulla: 67 },
  '35013': { g_cmest: '06', orden_patrulla: 68 },
  '35012': { g_cmest: '05', orden_patrulla: 69 },
  '35011': { g_cmest: '05', orden_patrulla: 70 },
  '35010': { g_cmest: '05', orden_patrulla: 71 },
  '35009': { g_cmest: '05', orden_patrulla: 72 },
  '35008': { g_cmest: '06', orden_patrulla: 80 },
  '35007': { g_cmest: '06', orden_patrulla: 79 },
  '35006': { g_cmest: '06', orden_patrulla: 78 },
  '35005': { g_cmest: '06', orden_patrulla: 77 },
  '35004': { g_cmest: '05', orden_patrulla: 76 },
  '35003': { g_cmest: '05', orden_patrulla: 75 },
  '35002': { g_cmest: '05', orden_patrulla: 74 },
  '35001': { g_cmest: '05', orden_patrulla: 73 },
};

async function main() {
  console.log(`\n${APPLY ? '🔥 MODO APLICAR' : '🔍 DRY-RUN (usar --apply para ejecutar)'}\n`);
  console.log('🔑 Obteniendo access token...');
  const token = getAccessToken();
  if (!token) { console.error('❌ No se pudo obtener access token'); process.exit(1); }
  console.log('✅ Token obtenido\n');

  console.log('📥 Cargando máquinas de Firestore...');
  const docs = await firestoreGet(token, 'maquinas');
  console.log(`   ${docs.length} documentos encontrados\n`);

  // Indexar por maquina (campo numérico o string)
  const maquinasPorId = new Map();
  for (const doc of docs) {
    const fields = doc.fields || {};
    const maqId = fields.maquina?.integerValue || fields.maquina?.stringValue || '';
    maquinasPorId.set(String(maqId), {
      docPath: doc.name,
      g_cmest: fields.g_cmest?.stringValue || '',
      orden_patrulla: fields.orden_patrulla?.integerValue ? Number(fields.orden_patrulla.integerValue) : null,
    });
  }

  let actualizadas = 0;
  let sinCambios = 0;
  let noEncontradas = 0;

  for (const [maqId, nuevos] of Object.entries(ACTUALIZACIONES)) {
    const maq = maquinasPorId.get(maqId);
    if (!maq) {
      console.log(`  ⚠️  ${maqId} — no encontrada en Firestore`);
      noEncontradas++;
      continue;
    }

    const cambios = {};
    if (maq.g_cmest !== nuevos.g_cmest) {
      cambios.g_cmest = nuevos.g_cmest;
    }
    if (maq.orden_patrulla !== nuevos.orden_patrulla) {
      cambios.orden_patrulla = nuevos.orden_patrulla;
    }

    if (Object.keys(cambios).length === 0) {
      sinCambios++;
      continue;
    }

    const prev = `g_cmest=${maq.g_cmest || '?'} orden=${maq.orden_patrulla ?? '—'}`;
    const next = `g_cmest=${nuevos.g_cmest} orden=${nuevos.orden_patrulla ?? '—'}`;
    console.log(`  ✏️  ${maqId}: ${prev} → ${next}`);

    if (APPLY) {
      await firestorePatch(token, maq.docPath, cambios);
    }
    actualizadas++;
  }

  console.log(`\n📊 Resumen: ${actualizadas} a actualizar, ${sinCambios} sin cambios, ${noEncontradas} no encontradas`);

  if (APPLY && actualizadas > 0) {
    console.log('✅ Cambios aplicados en Firestore');
  } else if (!APPLY && actualizadas > 0) {
    console.log('💡 Ejecutar con --apply para aplicar cambios');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
