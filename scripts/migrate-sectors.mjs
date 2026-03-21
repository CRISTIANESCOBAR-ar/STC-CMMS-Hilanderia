import fs from 'node:fs';
import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';

const DEFAULT_SECTOR = 'HILANDERIA';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'stc-cmms-hilanderia';
const BATCH_SIZE = 300;
const APPLY = process.argv.includes('--apply');

const normalizeSector = (value) => {
  if (!value || typeof value !== 'string') return DEFAULT_SECTOR;
  return value.trim().toUpperCase();
};

const sanitizeSectorList = (values, fallback = DEFAULT_SECTOR) => {
  const raw = Array.isArray(values) ? values : [fallback];
  const normalized = raw.map((item) => normalizeSector(item)).filter(Boolean);
  return [...new Set(normalized.length ? normalized : [normalizeSector(fallback)])];
};

const arraysEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

const buildUserPatch = (data) => {
  const patch = {};

  const role = data.role || 'mecanico';
  if (!data.role) patch.role = role;

  const sectorDefault = normalizeSector(data.sectorDefault || data.sector || DEFAULT_SECTOR);
  if (normalizeSector(data.sectorDefault) !== sectorDefault) {
    patch.sectorDefault = sectorDefault;
  }

  const sectoresAsignados = sanitizeSectorList(data.sectoresAsignados, sectorDefault);
  if (!Array.isArray(data.sectoresAsignados) || !arraysEqual(data.sectoresAsignados.map((s) => normalizeSector(s)), sectoresAsignados)) {
    patch.sectoresAsignados = sectoresAsignados;
  }

  const alcance = role === 'admin' ? (data.alcance || 'global') : 'sector';
  if (data.alcance !== alcance) {
    patch.alcance = alcance;
  }

  const jefeDeSectores = role === 'jefe_sector'
    ? sanitizeSectorList(data.jefeDeSectores?.length ? data.jefeDeSectores : [sectorDefault], sectorDefault)
    : [];

  if (!Array.isArray(data.jefeDeSectores) || !arraysEqual((data.jefeDeSectores || []).map((s) => normalizeSector(s)), jefeDeSectores)) {
    patch.jefeDeSectores = jefeDeSectores;
  }

  return patch;
};

const buildMachinePatch = (data) => {
  const patch = {};
  const sector = normalizeSector(data.sector || DEFAULT_SECTOR);

  if (normalizeSector(data.sector) !== sector) {
    patch.sector = sector;
  }

  if (!data.jefeDestinoSector) {
    patch.jefeDestinoSector = sector;
  }

  return patch;
};

const buildNovedadPatch = (data) => {
  const patch = {};
  const sector = normalizeSector(data.sector || data.jefeDestinoSector || DEFAULT_SECTOR);

  if (normalizeSector(data.sector) !== sector) {
    patch.sector = sector;
  }

  if (!data.jefeDestinoSector) {
    patch.jefeDestinoSector = sector;
  }

  return patch;
};

const migrateCollection = async (db, collectionName, buildPatch) => {
  let lastDocId = null;
  let processed = 0;
  let updates = 0;

  while (true) {
    let q = db.collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(BATCH_SIZE);

    if (lastDocId) {
      q = q.startAfter(lastDocId);
    }

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let pendingInBatch = 0;

    for (const docSnap of snap.docs) {
      processed += 1;
      const patch = buildPatch(docSnap.data());

      if (Object.keys(patch).length === 0) {
        continue;
      }

      updates += 1;
      if (APPLY) {
        batch.update(docSnap.ref, patch);
        pendingInBatch += 1;
      }
    }

    if (APPLY && pendingInBatch > 0) {
      await batch.commit();
    }

    lastDocId = snap.docs[snap.docs.length - 1].id;
    console.log(`[${collectionName}] Procesados: ${processed} | Pendientes/actualizados: ${updates}`);
  }

  return { collectionName, processed, updates };
};

const main = async () => {
  console.log(`Modo: ${APPLY ? 'APPLY (escritura real)' : 'DRY RUN (sin escritura)'}`);
  console.log(`Proyecto: ${PROJECT_ID}`);

  initAdmin();
  const db = getFirestore();

  const results = [];
  results.push(await migrateCollection(db, 'usuarios', buildUserPatch));
  results.push(await migrateCollection(db, 'maquinas', buildMachinePatch));
  results.push(await migrateCollection(db, 'novedades', buildNovedadPatch));

  console.log('\nResumen de migracion');
  for (const result of results) {
    console.log(`- ${result.collectionName}: procesados=${result.processed}, actualizaciones=${result.updates}`);
  }

  if (!APPLY) {
    console.log('\nPara aplicar cambios reales ejecuta: npm run migrate:sectors:apply');
  }
};

main().catch((error) => {
  console.error('Error ejecutando migracion:', error.message);
  console.error('Tip: define GOOGLE_APPLICATION_CREDENTIALS con la ruta del service account JSON.');
  process.exit(1);
});
