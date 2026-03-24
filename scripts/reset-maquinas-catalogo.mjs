/**
 * Reset total de catalogo de maquinas en Firestore (coleccion: maquinas)
 *
 * Uso:
 *   node scripts/reset-maquinas-catalogo.mjs            -> dry run (no escribe)
 *   node scripts/reset-maquinas-catalogo.mjs --apply    -> borra y repuebla
 *
 * Reglas:
 * - Borra TODOS los documentos existentes en 'maquinas'
 * - Inserta el catalogo definido en este archivo
 * - Doc ID: {maquina}_{lado}
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'stc-cmms-hilanderia';
const BATCH_SIZE = 400;
const BACKUP_DIR = path.join(__dirname, '../backups/maquinas');

const TYPE_NUMBER_MAP = {
  'APERTURA': 1,
  'CARDA': 2,
  'MANUAR': 3,
  'OPEN END': 4,
  'FILTRO': 7,
  'URDIDORA': 10,
  'INDIGO': 11,
  'TELAR': 12,
  'REVISADORA': 13,
  'MERCERIZADORA': 14,
  'INTEGRADA': 16,
};

const toBoolActivo = (v) => String(v || '').trim().toUpperCase() === 'SI';

const toTimestamp = (ddmmyyyy) => {
  const raw = String(ddmmyyyy || '').trim();
  if (!raw || raw === '---') return null;
  const parts = raw.split('/');
  if (parts.length !== 3) return null;
  const d = Number(parts[0]);
  const m = Number(parts[1]);
  const y = Number(parts[2]);
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y)) return null;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
};

const normalizeText = (v) => {
  const t = String(v || '').trim();
  return !t || t === '---' ? '' : t;
};

const row = ({
  sector,
  tipo,
  id,
  nombre,
  local,
  lado,
  modelo,
  serie,
  activo,
  adquisicion,
  excelId,
}) => {
  const docId = `${id}_${lado}`.replace(/\s+/g, '');
  const tipoNorm = String(tipo || '').trim().toUpperCase();
  const numeroTipo = TYPE_NUMBER_MAP[tipoNorm] || Number(excelId) || 99;
  return {
    docId,
    payload: {
      unidad: 5,
      sector: String(sector || 'HILANDERIA').trim().toUpperCase(),
      tipo: tipoNorm,
      nro_tipo: numeroTipo,
      maquina: Number(id),
      nombre_maquina: normalizeText(nombre),
      local_fisico: Number(local),
      lado: String(lado || 'U').trim().toUpperCase(),
      modelo: normalizeText(modelo),
      nro_serie: normalizeText(serie),
      activo: toBoolActivo(activo),
      adquisicion: toTimestamp(adquisicion),
      excel_id: String(excelId || '').trim() === '---' || excelId == null ? null : Number(excelId),
    },
  };
};

const BASE_ROWS = [
  row({ sector: 'HILANDERIA', tipo: 'APERTURA', id: 50102, nombre: 'APERTURA', local: 2, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'APERTURA', id: 50103, nombre: 'APERTURA', local: 2, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50201, nombre: 'TRUTZSCHLER', local: 1, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50202, nombre: 'TRUTZSCHLER', local: 2, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50203, nombre: 'TRUTZSCHLER', local: 3, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50204, nombre: 'TRUTZSCHLER', local: 4, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50205, nombre: 'TRUTZSCHLER', local: 5, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50206, nombre: 'TRUTZSCHLER', local: 6, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50207, nombre: 'TRUTZSCHLER', local: 7, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50208, nombre: 'RIETER', local: 8, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50209, nombre: 'RIETER', local: 9, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50210, nombre: 'RIETER', local: 10, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50211, nombre: 'RIETER', local: 11, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50212, nombre: 'RIETER', local: 12, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50213, nombre: 'RIETER', local: 13, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50214, nombre: 'RIETER', local: 14, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50215, nombre: 'RIETER', local: 15, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50216, nombre: 'RIETER', local: 16, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'CARDA', id: 50217, nombre: 'RIETER', local: 17, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'MANUAR', id: 50301, nombre: 'TRUTZSCHLER', local: 1, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'MANUAR', id: 50302, nombre: 'TRUTZSCHLER', local: 2, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'MANUAR', id: 50303, nombre: 'TRUTZSCHLER', local: 3, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'OPEN END', id: 50402, nombre: 'RIETER', local: 2, lado: 'A', modelo: 'R-37', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'OPEN END', id: 50402, nombre: 'RIETER', local: 2, lado: 'B', modelo: 'R-37', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'OPEN END', id: 50403, nombre: 'RIETER', local: 3, lado: 'A', modelo: 'R-37', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'OPEN END', id: 50403, nombre: 'RIETER', local: 3, lado: 'B', modelo: 'R-37', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'OPEN END', id: 50405, nombre: 'RIETER', local: 5, lado: 'U', modelo: 'R-60', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'OPEN END', id: 50406, nombre: 'RIETER', local: 6, lado: 'U', modelo: 'R-60', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'OPEN END', id: 50407, nombre: 'RIETER', local: 7, lado: 'U', modelo: 'R-60', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'OPEN END', id: 50408, nombre: 'RIETER', local: 8, lado: 'U', modelo: 'R-60', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'OPEN END', id: 50409, nombre: 'RIETER', local: 9, lado: 'U', modelo: 'R-60', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'OPEN END', id: 50410, nombre: 'RIETER', local: 10, lado: 'U', modelo: 'R-60', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'FILTRO', id: 50701, nombre: 'FILTRO', local: 1, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'FILTRO', id: 50702, nombre: 'FILTRO', local: 2, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'HILANDERIA', tipo: 'FILTRO', id: 50703, nombre: 'FILTRO', local: 3, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '---', excelId: '---' }),
  row({ sector: 'TEJEDURIA', tipo: 'URDIDORA', id: 15001, nombre: 'URDIDORA', local: 531, lado: 'U', modelo: 'BEN DIRECT', serie: '---', activo: 'SI', adquisicion: '12/2/2008', excelId: 1 }),
  row({ sector: 'TEJEDURIA', tipo: 'INDIGO', id: 25001, nombre: 'INDIGO', local: 532, lado: 'U', modelo: 'BENNINGER', serie: '---', activo: 'SI', adquisicion: '12/2/2008', excelId: 2 }),
  row({ sector: 'TEJEDURIA', tipo: 'REVISADORA', id: 85001, nombre: 'MESA', local: 547, lado: 'U', modelo: 'AVELINO', serie: '---', activo: 'SI', adquisicion: '12/2/2008', excelId: 8 }),
  row({ sector: 'TEJEDURIA', tipo: 'REVISADORA', id: 85002, nombre: 'MESA', local: 547, lado: 'U', modelo: 'AVELINO', serie: '---', activo: 'SI', adquisicion: '12/2/2008', excelId: 8 }),
  row({ sector: 'TEJEDURIA', tipo: 'REVISADORA', id: 85003, nombre: 'MESA', local: 547, lado: 'U', modelo: 'AVELINO', serie: '---', activo: 'SI', adquisicion: '12/2/2008', excelId: 8 }),
  row({ sector: 'TEJEDURIA', tipo: 'REVISADORA', id: 85004, nombre: 'MESA', local: 547, lado: 'U', modelo: 'AVELINO', serie: '---', activo: 'SI', adquisicion: '12/2/2008', excelId: 8 }),
  row({ sector: 'TEJEDURIA', tipo: 'REVISADORA', id: 85005, nombre: 'MESA', local: 547, lado: 'U', modelo: 'AVELINO', serie: '---', activo: 'SI', adquisicion: '12/2/2008', excelId: 8 }),
  row({ sector: 'TEJEDURIA', tipo: 'REVISADORA', id: 85006, nombre: 'MESA', local: 547, lado: 'U', modelo: 'AVELINO', serie: '---', activo: 'SI', adquisicion: '12/2/2008', excelId: 8 }),
  row({ sector: 'TEJEDURIA', tipo: 'REVISADORA', id: 85007, nombre: 'MESA', local: 547, lado: 'U', modelo: 'AVELINO', serie: '---', activo: 'SI', adquisicion: '12/2/2008', excelId: 8 }),
  row({ sector: 'TEJEDURIA', tipo: 'REVISADORA', id: 85008, nombre: 'MESA', local: 547, lado: 'U', modelo: 'AVELINO', serie: '---', activo: 'SI', adquisicion: '12/2/2008', excelId: 8 }),
  row({ sector: 'TEJEDURIA', tipo: 'MERCERIZADORA', id: 125001, nombre: 'MERCERIZADORA', local: 501, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '24/9/2013', excelId: 12 }),
  row({ sector: 'TEJEDURIA', tipo: 'MERCERIZADORA', id: 125010, nombre: 'MERCERIZADORA', local: 511, lado: 'U', modelo: '---', serie: '---', activo: 'SI', adquisicion: '21/8/2016', excelId: 12 }),
  row({ sector: 'TEJEDURIA', tipo: 'INTEGRADA', id: 165001, nombre: 'INTEGRADA', local: 535, lado: 'U', modelo: 'BRUCKER', serie: '---', activo: 'SI', adquisicion: '12/2/2008', excelId: 16 }),
];

const TELAR_DATE_MAP = {
  1: '12/2/2008', 2: '12/2/2008', 3: '8/11/2007', 4: '8/11/2007', 5: '8/11/2007',
  6: '9/10/2007', 7: '9/10/2007', 8: '9/10/2007', 9: '9/10/2007', 10: '9/10/2007',
  11: '9/10/2007', 12: '9/10/2008', 13: '9/10/2007', 14: '9/10/2007', 15: '9/10/2007',
  16: '9/10/2007', 17: '9/10/2007', 18: '9/10/2007', 19: '9/10/2007', 20: '9/10/2008',
  21: '9/10/2007', 22: '9/10/2007', 23: '9/10/2008', 24: '9/10/2007', 25: '9/10/2007',
  26: '9/10/2007', 27: '9/10/2007', 28: '9/10/2008', 29: '9/10/2008', 30: '9/10/2007',
  31: '31/7/2019', 32: '31/7/2019', 33: '9/10/2007', 34: '9/10/2007', 35: '9/10/2007',
  36: '9/10/2008', 37: '9/10/2007', 38: '9/10/2008', 39: '31/7/2019', 40: '31/7/2019',
  41: '9/10/2008', 42: '9/10/2008', 43: '9/10/2007', 44: '9/10/2007', 45: '9/10/2007',
  46: '9/10/2007', 47: '31/7/2019', 48: '31/7/2019', 49: '9/10/2007', 50: '9/10/2008',
  51: '9/10/2008', 52: '9/10/2008', 53: '9/10/2008', 54: '9/10/2008', 55: '31/7/2019',
  56: '31/7/2019', 57: '9/10/2007', 58: '9/10/2008', 59: '9/10/2007', 60: '9/10/2007',
  61: '9/10/2007', 62: '9/10/2007', 63: '9/10/2007', 64: '9/10/2007', 65: '9/10/2007',
  66: '9/10/2007', 67: '9/10/2007', 68: '9/10/2008', 69: '9/10/2007', 70: '9/10/2007',
  71: '9/10/2007', 72: '9/10/2007', 73: '14/10/2011', 74: '14/10/2011', 75: '14/10/2011',
  76: '14/10/2011', 77: '14/10/2011', 78: '14/10/2011', 79: '14/10/2011', 80: '14/10/2011',
  81: '31/1/2017', 82: '31/1/2017', 83: '31/1/2017', 84: '31/1/2017', 85: '31/1/2017',
  86: '31/1/2017', 87: '31/1/2017', 88: '31/1/2017',
};

const TELAR_ROWS = Array.from({ length: 88 }, (_, idx) => {
  const n = idx + 1;
  return row({
    sector: 'TEJEDURIA',
    tipo: 'TELAR',
    id: Number(`530${String(n).padStart(2, '0')}`),
    nombre: 'TOYOTA',
    local: 534,
    lado: 'U',
    modelo: 'JA2S-190TP-EF-T710',
    serie: '---',
    activo: n <= 80 ? 'SI' : 'NO',
    adquisicion: TELAR_DATE_MAP[n],
    excelId: 3,
  });
});

const CATALOGO_ROWS = [...BASE_ROWS, ...TELAR_ROWS];

const initAdmin = () => {
  if (getApps().length) return;

  const serviceAccountPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, '../.secrets/stc-cmms-hilanderia-firebase-adminsdk-fbsvc-5dc94a0016.json');

  const appConfig = { projectId: PROJECT_ID };
  if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    initializeApp({ ...appConfig, credential: cert(serviceAccount) });
    return;
  }

  initializeApp({ ...appConfig, credential: applicationDefault() });
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const deleteAllMaquinas = async (db) => {
  const snapshot = await db.collection('maquinas').get();
  if (snapshot.empty) return 0;

  const docs = snapshot.docs;
  for (const part of chunk(docs, BATCH_SIZE)) {
    const batch = db.batch();
    part.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  return docs.length;
};

const makeBackup = async (db) => {
  const snapshot = await db.collection('maquinas').get();
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const outPath = path.join(BACKUP_DIR, `maquinas-backup-${stamp}.json`);

  const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2), 'utf8');
  return { outPath, count: rows.length };
};

const writeCatalogo = async (db, rows) => {
  for (const part of chunk(rows, BATCH_SIZE)) {
    const batch = db.batch();
    part.forEach(({ docId, payload }) => {
      batch.set(db.collection('maquinas').doc(docId), payload, { merge: false });
    });
    await batch.commit();
  }
};

const summarize = (rows) => {
  const byTipo = {};
  let activas = 0;
  let inactivas = 0;
  rows.forEach(({ payload }) => {
    byTipo[payload.tipo] = (byTipo[payload.tipo] || 0) + 1;
    if (payload.activo) activas += 1;
    else inactivas += 1;
  });
  return { byTipo, activas, inactivas, total: rows.length };
};

const main = async () => {
  console.log('==============================================');
  console.log(' Reset catalogo maquinas Firestore');
  console.log(` Modo: ${APPLY ? 'APPLY (BORRA + ESCRIBE)' : 'DRY RUN (NO ESCRIBE)'}`);
  console.log('==============================================\n');

  const s = summarize(CATALOGO_ROWS);
  console.log('Resumen del catalogo a cargar:');
  Object.entries(s.byTipo)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([tipo, n]) => console.log(` - ${tipo.padEnd(14)}: ${n}`));
  console.log(`Total: ${s.total}`);
  console.log(`Activas: ${s.activas}`);
  console.log(`Inactivas: ${s.inactivas}\n`);

  if (!APPLY) {
    console.log('DRY RUN completado. Ejecuta con --apply para aplicar cambios.');
    return;
  }

  initAdmin();
  const db = getFirestore();

  const backup = await makeBackup(db);
  console.log(`Backup generado: ${backup.outPath} (${backup.count} docs)`);

  const deleted = await deleteAllMaquinas(db);
  console.log(`Documentos borrados de maquinas: ${deleted}`);

  await writeCatalogo(db, CATALOGO_ROWS);
  console.log(`Documentos insertados en maquinas: ${CATALOGO_ROWS.length}`);
  console.log('Proceso completado correctamente.');
};

main().catch((err) => {
  console.error('Error en reset-maquinas-catalogo:', err.message);
  process.exit(1);
});
