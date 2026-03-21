import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'stc-cmms-hilanderia';
const APPLY = process.argv.includes('--apply');
const FILE_PATH = process.argv.find((arg) => arg.startsWith('--file='))?.split('=')[1] || 'public/Codigos_Defectos_y_Paradas.xlsx';
const SOURCE_FILE = 'Codigos_Defectos_y_Paradas.xlsx';
const SECTOR = 'TEJEDURIA';

const normalizeText = (value) => String(value ?? '').trim();
const nullableText = (value) => {
  const text = normalizeText(value);
  return text || null;
};

const initAdmin = () => {
  if (getApps().length) return;

  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const appConfig = { projectId: PROJECT_ID };

  if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    initializeApp({ ...appConfig, credential: cert(serviceAccount) });
    return;
  }

  initializeApp({ ...appConfig, credential: applicationDefault() });
};

const parseWorkbook = async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(FILE_PATH);

  const wsParadas = workbook.getWorksheet('Codigos Paradas');
  const wsDefectos = workbook.getWorksheet('Codigos Defectos');

  if (!wsParadas || !wsDefectos) {
    throw new Error('No se encontraron las hojas esperadas: Codigos Paradas y Codigos Defectos.');
  }

  const paradas = [];
  for (let rowNumber = 2; rowNumber <= wsParadas.rowCount; rowNumber += 1) {
    const row = wsParadas.getRow(rowNumber);
    const grupoCodigo = Number(row.getCell(1).value);
    const grupoMotivo = normalizeText(row.getCell(2).value);
    const codigo = Number(row.getCell(3).value);
    const motivoPt = normalizeText(row.getCell(4).value);
    const motivoEs = nullableText(row.getCell(5).value);

    if (!Number.isFinite(grupoCodigo) || !Number.isFinite(codigo) || !motivoPt) continue;

    paradas.push({
      id: `${grupoCodigo}_${codigo}`,
      grupoCodigo,
      grupoMotivo,
      codigo,
      motivoPt,
      motivoEs,
      idiomaOrigen: 'pt-BR',
      sector: SECTOR,
      tipo: 'PARADA',
      activo: true,
      translationPending: !motivoEs,
      sourceFile: SOURCE_FILE,
      sourceSheet: 'Codigos Paradas'
    });
  }

  const defectos = [];
  for (let rowNumber = 2; rowNumber <= wsDefectos.rowCount; rowNumber += 1) {
    const row = wsDefectos.getRow(rowNumber);
    const codigo = Number(row.getCell(1).value);
    const descripcionPt = normalizeText(row.getCell(2).value);
    const local = nullableText(row.getCell(3).value);
    const descripcionEs = nullableText(row.getCell(4).value);

    if (!Number.isFinite(codigo) || !descripcionPt) continue;

    defectos.push({
      id: String(codigo),
      codigo,
      descripcionPt,
      descripcionEs,
      local,
      idiomaOrigen: 'pt-BR',
      sector: SECTOR,
      tipo: 'DEFECTO',
      activo: true,
      translationPending: !descripcionEs,
      sourceFile: SOURCE_FILE,
      sourceSheet: 'Codigos Defectos'
    });
  }

  return { paradas, defectos };
};

const writeCollection = async (db, collectionName, items) => {
  let written = 0;
  const chunkSize = 400;

  for (let index = 0; index < items.length; index += chunkSize) {
    const chunk = items.slice(index, index + chunkSize);
    const batch = db.batch();

    for (const item of chunk) {
      const { id, ...payload } = item;
      batch.set(db.collection(collectionName).doc(id), payload, { merge: true });
      written += 1;
    }

    if (APPLY) {
      await batch.commit();
    }
  }

  return written;
};

const main = async () => {
  console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Archivo: ${FILE_PATH}`);

  const { paradas, defectos } = await parseWorkbook();

  console.log(`Paradas detectadas: ${paradas.length}`);
  console.log(`Defectos detectados: ${defectos.length}`);
  console.log(`Paradas sin traduccion: ${paradas.filter((item) => item.translationPending).length}`);
  console.log(`Defectos sin traduccion: ${defectos.filter((item) => item.translationPending).length}`);

  if (!APPLY) {
    console.log('Dry run completado. Usa --apply para escribir en Firestore.');
    return;
  }

  initAdmin();
  const db = getFirestore();

  const paradasWritten = await writeCollection(db, 'codigos_paradas', paradas);
  const defectosWritten = await writeCollection(db, 'codigos_defectos', defectos);

  console.log(`Paradas cargadas en Firestore: ${paradasWritten}`);
  console.log(`Defectos cargados en Firestore: ${defectosWritten}`);
};

main().catch((error) => {
  console.error('Error importando codigos textiles:', error.message);
  process.exit(1);
});
