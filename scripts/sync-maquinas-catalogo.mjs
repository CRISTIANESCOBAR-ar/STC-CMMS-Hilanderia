import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'stc-cmms-hilanderia';
const APPLY = process.argv.includes('--apply');
const FILE_PATH = path.join(__dirname, '../public/Maquinas_STC.xlsx');
const BATCH_SIZE = 400;

const TYPE_ORDER = {
  APERTURA: 1,
  CARDA: 2,
  MANUAR: 3,
  'OPEN END': 4,
  FILTRO: 7,
  URDIDORA: 10,
  INDIGO: 11,
  TELAR: 12,
  REVISADORA: 13,
  MERCERIZADORA: 14,
  INTEGRADA: 16
};

const DISPLAY_NAME_BY_TYPE = {
  URDIDORA: 'URDIDORA',
  INDIGO: 'INDIGO',
  TELAR: 'TOYOTA',
  REVISADORA: 'MESA',
  MERCERIZADORA: 'MERCERIZADORA',
  INTEGRADA: 'INTEGRADA'
};

const TELAR_GROUPS = [
  { start: 35001, end: 35004, grp_tear: '0305', g_cmest: '01' },
  { start: 35005, end: 35008, grp_tear: '0306', g_cmest: '02' },
  { start: 35009, end: 35012, grp_tear: '0305', g_cmest: '01' },
  { start: 35013, end: 35016, grp_tear: '0306', g_cmest: '02' },
  { start: 35017, end: 35020, grp_tear: '0305', g_cmest: '01' },
  { start: 35021, end: 35024, grp_tear: '0306', g_cmest: '02' },
  { start: 35025, end: 35026, grp_tear: '0303', g_cmest: '01' },
  { start: 35027, end: 35028, grp_tear: '0305', g_cmest: '01' },
  { start: 35029, end: 35030, grp_tear: '0306', g_cmest: '02' },
  { start: 35031, end: 35032, grp_tear: '0304', g_cmest: '02' },
  { start: 35033, end: 35036, grp_tear: '0303', g_cmest: '01' },
  { start: 35037, end: 35040, grp_tear: '0304', g_cmest: '02' },
  { start: 35041, end: 35044, grp_tear: '0303', g_cmest: '01' },
  { start: 35045, end: 35048, grp_tear: '0304', g_cmest: '02' },
  { start: 35049, end: 35052, grp_tear: '0303', g_cmest: '01' },
  { start: 35053, end: 35056, grp_tear: '0304', g_cmest: '02' },
  { start: 35057, end: 35060, grp_tear: '0301', g_cmest: '01' },
  { start: 35061, end: 35064, grp_tear: '0302', g_cmest: '02' },
  { start: 35065, end: 35068, grp_tear: '0301', g_cmest: '01' },
  { start: 35069, end: 35072, grp_tear: '0302', g_cmest: '02' },
  { start: 35073, end: 35076, grp_tear: '0301', g_cmest: '01' },
  { start: 35077, end: 35080, grp_tear: '0302', g_cmest: '02' }
];

const normalizeText = (value) => String(value ?? '').trim();

const normalizeOptionalText = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeText(value).toUpperCase();
  return !['NO', 'FALSE', '0', 'N'].includes(normalized);
};

const normalizeNumericValue = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : normalizeText(value);
};

const toTimestamp = (value) => {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : Timestamp.fromDate(value);
  }
  if (typeof value === 'number') {
    const date = new Date((value - 25569) * 86400 * 1000);
    return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
};

const timestampKey = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value._seconds === 'number') return (value._seconds * 1000) + Math.floor((value._nanoseconds || 0) / 1000000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
};

const buildDocId = (maquina, lado) => `${maquina}_${lado}`;

const buildMachineRecord = ({
  sector,
  tipo,
  maquina,
  nombre_maquina,
  local_fisico,
  lado = 'U',
  modelo = '',
  nro_serie = '',
  activo = true,
  adquisicion = null,
  excel_id = null,
  grp_tear = '',
  g_cmest = ''
}) => ({
  id: buildDocId(maquina, lado),
  unidad: 5,
  sector,
  tipo,
  nro_tipo: TYPE_ORDER[tipo],
  maquina,
  nombre_maquina,
  local_fisico,
  lado,
  modelo: normalizeOptionalText(modelo),
  nro_serie: normalizeOptionalText(nro_serie),
  activo: normalizeBoolean(activo),
  adquisicion: toTimestamp(adquisicion),
  excel_id: excel_id === null || excel_id === undefined || excel_id === '' ? null : Number(excel_id),
  grp_tear: normalizeOptionalText(grp_tear),
  g_cmest: normalizeOptionalText(g_cmest)
});

const getTelarGroup = (maquina) => {
  const group = TELAR_GROUPS.find((item) => maquina >= item.start && maquina <= item.end);
  return group || { grp_tear: '', g_cmest: '' };
};

const buildHilanderiaCatalog = () => {
  const catalog = [];

  catalog.push(
    buildMachineRecord({ sector: 'HILANDERIA', tipo: 'APERTURA', maquina: 50102, nombre_maquina: 'APERTURA', local_fisico: 2 }),
    buildMachineRecord({ sector: 'HILANDERIA', tipo: 'APERTURA', maquina: 50103, nombre_maquina: 'APERTURA', local_fisico: 2 })
  );

  for (let local = 1; local <= 17; local += 1) {
    const maquina = 50200 + local;
    const nombre = local <= 7 ? 'TRUTZSCHLER' : 'RIETER';
    catalog.push(buildMachineRecord({ sector: 'HILANDERIA', tipo: 'CARDA', maquina, nombre_maquina: nombre, local_fisico: local }));
  }

  for (let local = 1; local <= 3; local += 1) {
    catalog.push(buildMachineRecord({ sector: 'HILANDERIA', tipo: 'MANUAR', maquina: 50300 + local, nombre_maquina: 'TRUTZSCHLER', local_fisico: local }));
  }

  catalog.push(
    buildMachineRecord({ sector: 'HILANDERIA', tipo: 'OPEN END', maquina: 50402, nombre_maquina: 'RIETER', local_fisico: 2, lado: 'A', modelo: 'R-37' }),
    buildMachineRecord({ sector: 'HILANDERIA', tipo: 'OPEN END', maquina: 50402, nombre_maquina: 'RIETER', local_fisico: 2, lado: 'B', modelo: 'R-37' }),
    buildMachineRecord({ sector: 'HILANDERIA', tipo: 'OPEN END', maquina: 50403, nombre_maquina: 'RIETER', local_fisico: 3, lado: 'A', modelo: 'R-37' }),
    buildMachineRecord({ sector: 'HILANDERIA', tipo: 'OPEN END', maquina: 50403, nombre_maquina: 'RIETER', local_fisico: 3, lado: 'B', modelo: 'R-37' })
  );

  for (let local = 5; local <= 10; local += 1) {
    catalog.push(buildMachineRecord({ sector: 'HILANDERIA', tipo: 'OPEN END', maquina: 50400 + local, nombre_maquina: 'RIETER', local_fisico: local, modelo: 'R-60' }));
  }

  for (let local = 1; local <= 3; local += 1) {
    catalog.push(buildMachineRecord({ sector: 'HILANDERIA', tipo: 'FILTRO', maquina: 50700 + local, nombre_maquina: 'FILTRO', local_fisico: local }));
  }

  return catalog;
};

const buildTejeduriaCatalog = async () => {
  if (!fs.existsSync(FILE_PATH)) {
    throw new Error(`Archivo no encontrado: ${FILE_PATH}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(FILE_PATH);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    throw new Error('El archivo de máquinas no contiene hojas para procesar.');
  }

  const catalog = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const excelId = row.getCell(1).value;
    const tipo = normalizeText(row.getCell(2).value).toUpperCase();
    const maquina = Number(row.getCell(3).value);
    const adquisicion = row.getCell(5).value;
    const localFisico = normalizeNumericValue(row.getCell(6).value);
    const modelo = row.getCell(7).value;
    const activo = row.getCell(8).value;

    if (!tipo || !Number.isFinite(maquina)) {
      continue;
    }

    const telarGroup = tipo === 'TELAR' ? getTelarGroup(maquina) : { grp_tear: '', g_cmest: '' };

    catalog.push(buildMachineRecord({
      sector: 'TEJEDURIA',
      tipo,
      maquina,
      nombre_maquina: DISPLAY_NAME_BY_TYPE[tipo] || tipo,
      local_fisico: localFisico,
      lado: 'U',
      modelo,
      nro_serie: '',
      activo,
      adquisicion,
      excel_id: excelId,
      grp_tear: telarGroup.grp_tear,
      g_cmest: telarGroup.g_cmest
    }));
  }

  return catalog;
};

const normalizeCurrentRecord = (record) => ({
  id: record.id,
  unidad: record.unidad ?? 5,
  sector: normalizeText(record.sector),
  tipo: normalizeText(record.tipo),
  nro_tipo: Number(record.nro_tipo),
  maquina: Number(record.maquina),
  nombre_maquina: normalizeOptionalText(record.nombre_maquina),
  local_fisico: normalizeNumericValue(record.local_fisico),
  lado: normalizeText(record.lado || 'U'),
  modelo: normalizeOptionalText(record.modelo),
  nro_serie: normalizeOptionalText(record.nro_serie),
  activo: normalizeBoolean(record.activo),
  adquisicion: record.adquisicion || null,
  excel_id: record.excel_id === null || record.excel_id === undefined || record.excel_id === '' ? null : Number(record.excel_id),
  grp_tear: normalizeOptionalText(record.grp_tear),
  g_cmest: normalizeOptionalText(record.g_cmest)
});

const comparableRecord = (record) => ({
  unidad: record.unidad,
  sector: record.sector,
  tipo: record.tipo,
  nro_tipo: record.nro_tipo,
  maquina: record.maquina,
  nombre_maquina: record.nombre_maquina,
  local_fisico: record.local_fisico,
  lado: record.lado,
  modelo: record.modelo,
  nro_serie: record.nro_serie,
  activo: record.activo,
  adquisicion: timestampKey(record.adquisicion),
  excel_id: record.excel_id,
  grp_tear: record.grp_tear,
  g_cmest: record.g_cmest
});

const diffRecords = (currentRecord, desiredRecord) => {
  const currentComparable = comparableRecord(currentRecord);
  const desiredComparable = comparableRecord(desiredRecord);
  const changedFields = Object.keys(desiredComparable).filter((key) => currentComparable[key] !== desiredComparable[key]);

  return changedFields.map((field) => ({
    field,
    current: currentComparable[field],
    desired: desiredComparable[field]
  }));
};

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

  console.log('No se encontró service account key, usando applicationDefault()');
  initializeApp({ ...appConfig, credential: applicationDefault() });
};

const loadCurrentCatalog = async (db) => {
  const snapshot = await db.collection('maquinas').get();
  return snapshot.docs.map((doc) => normalizeCurrentRecord({ id: doc.id, ...doc.data() }));
};

const sortCatalog = (catalog) => [...catalog].sort((a, b) => {
  if (a.nro_tipo !== b.nro_tipo) return a.nro_tipo - b.nro_tipo;
  if (a.local_fisico !== b.local_fisico) return String(a.local_fisico).localeCompare(String(b.local_fisico), 'es');
  if (a.maquina !== b.maquina) return a.maquina - b.maquina;
  return a.lado.localeCompare(b.lado, 'es');
});

const buildDesiredCatalog = async () => {
  const hilanderia = buildHilanderiaCatalog();
  const tejeduria = await buildTejeduriaCatalog();
  return sortCatalog([...hilanderia, ...tejeduria]);
};

const summarizeCatalog = (catalog) => catalog.reduce((summary, machine) => {
  summary.total += 1;
  summary.bySector[machine.sector] = (summary.bySector[machine.sector] || 0) + 1;
  summary.byTipo[machine.tipo] = (summary.byTipo[machine.tipo] || 0) + 1;
  return summary;
}, { total: 0, bySector: {}, byTipo: {} });

const writeCatalog = async (db, desiredCatalog, obsoleteIds) => {
  let written = 0;
  let deleted = 0;

  for (let index = 0; index < desiredCatalog.length; index += BATCH_SIZE) {
    const chunk = desiredCatalog.slice(index, index + BATCH_SIZE);
    const batch = db.batch();

    chunk.forEach((machine) => {
      const { id, ...payload } = machine;
      const ref = db.collection('maquinas').doc(id);
      batch.set(ref, payload);
      written += 1;
    });

    if (APPLY) {
      await batch.commit();
    }
  }

  for (let index = 0; index < obsoleteIds.length; index += BATCH_SIZE) {
    const chunk = obsoleteIds.slice(index, index + BATCH_SIZE);
    const batch = db.batch();

    chunk.forEach((id) => {
      batch.delete(db.collection('maquinas').doc(id));
      deleted += 1;
    });

    if (APPLY && chunk.length > 0) {
      await batch.commit();
    }
  }

  return { written, deleted };
};

const main = async () => {
  console.log('════════════════════════════════════════════════════');
  console.log('  Sincronización catálogo maquinas → Firestore');
  console.log(`  Modo: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log('════════════════════════════════════════════════════\n');

  const desiredCatalog = await buildDesiredCatalog();
  const desiredSummary = summarizeCatalog(desiredCatalog);

  console.log('Catálogo deseado:');
  console.log(JSON.stringify(desiredSummary, null, 2));

  initAdmin();
  const db = getFirestore();
  const currentCatalog = sortCatalog(await loadCurrentCatalog(db));

  const desiredById = new Map(desiredCatalog.map((machine) => [machine.id, machine]));
  const currentById = new Map(currentCatalog.map((machine) => [machine.id, machine]));

  const missing = desiredCatalog.filter((machine) => !currentById.has(machine.id));
  const obsolete = currentCatalog.filter((machine) => !desiredById.has(machine.id));
  const changed = desiredCatalog
    .filter((machine) => currentById.has(machine.id))
    .map((machine) => ({ id: machine.id, diffs: diffRecords(currentById.get(machine.id), machine) }))
    .filter((entry) => entry.diffs.length > 0);

  console.log('\nEstado actual en Firestore:');
  console.log(JSON.stringify(summarizeCatalog(currentCatalog), null, 2));

  console.log('\nDiferencias detectadas:');
  console.log(JSON.stringify({
    missing: missing.length,
    changed: changed.length,
    obsolete: obsolete.length,
    sampleMissing: missing.slice(0, 5).map((machine) => machine.id),
    sampleChanged: changed.slice(0, 5),
    sampleObsolete: obsolete.slice(0, 5).map((machine) => machine.id)
  }, null, 2));

  if (!APPLY) {
    console.log('\nDry run completado. Usa --apply para escribir en Firestore.');
    return;
  }

  const result = await writeCatalog(db, desiredCatalog, obsolete.map((machine) => machine.id));

  console.log('\nSincronización completada:');
  console.log(JSON.stringify(result, null, 2));
};

main().catch((error) => {
  console.error('\nError en la sincronización:', error);
  process.exit(1);
});