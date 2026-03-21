import fs from 'node:fs';
import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DEFAULT_SECTOR = 'HILANDERIA';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'stc-cmms-hilanderia';

const emailArg = process.argv.find((arg) => arg.startsWith('--email='));
const targetEmail = (emailArg ? emailArg.split('=')[1] : '').trim().toLowerCase();

if (!targetEmail) {
  console.error('Debes pasar --email=correo@dominio.com');
  process.exit(1);
}

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

const main = async () => {
  initAdmin();
  const db = getFirestore();

  const snap = await db.collection('usuarios').where('email', '==', targetEmail).get();

  if (snap.empty) {
    console.log(`No se encontro usuario con email ${targetEmail}.`);
    console.log('Primero debe existir un documento en usuarios (login previo) o crearlo manualmente con el UID correcto.');
    process.exit(2);
  }

  const batch = db.batch();
  snap.docs.forEach((docSnap) => {
    batch.update(docSnap.ref, {
      role: 'admin',
      alcance: 'global',
      sectorDefault: DEFAULT_SECTOR,
      sectoresAsignados: ['HILANDERIA', 'TEJEDURIA'],
      jefeDeSectores: []
    });
  });

  await batch.commit();
  console.log(`Actualizado como admin: ${targetEmail} (${snap.size} documento(s)).`);
};

main().catch((error) => {
  console.error('Error otorgando admin:', error.message);
  process.exit(1);
});
