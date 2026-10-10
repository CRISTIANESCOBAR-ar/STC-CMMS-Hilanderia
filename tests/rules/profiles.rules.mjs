import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteField, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

// Deliberately refuse execution without emulators; never test against live Firebase.
assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Run npm run test:rules with emulators');
assert.ok(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Storage emulator required');
let environment;
const identity = (uid, extra = {}) => environment.authenticatedContext(uid, {
  email: `${uid}@example.com`, firebase: { sign_in_provider: 'google.com' }, ...extra,
});
const newProfile = uid => ({
  email: `${uid}@example.com`, displayName: 'Operador', role: 'mecanico',
  sectorDefault: 'HILANDERIA', sectoresAsignados: ['HILANDERIA'],
  alcance: 'sector', jefeDeSectores: [], createdAt: serverTimestamp(),
});

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-cmms-production',
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
    storage: { rules: await readFile('storage.rules', 'utf8') },
  });
});
after(async () => { await environment?.cleanup(); });
beforeEach(async () => { await environment.clearFirestore(); });

test('identified account may create only its own default profile', async () => {
  const db = identity('operator').firestore();
  await assertSucceeds(setDoc(doc(db, 'usuarios/operator'), newProfile('operator')));
  await assertFails(setDoc(doc(db, 'usuarios/other'), newProfile('operator')));
});

test('new profile cannot inject role, permissions, sectors or timestamps', async () => {
  const db = identity('operator').firestore();
  const patches = [
    { role: 'admin' }, { vistasPersonalizadas: ['usuarios'] },
    { permisosPersonalizados: { configSistema: true } },
    { sectoresAsignados: ['HILANDERIA', 'TEJEDURIA'] },
    { alcance: 'global' }, { sectorDefault: 'TEJEDURIA' },
    { jefeDeSectores: ['HILANDERIA'] }, { createdAt: new Date(0) },
  ];
  for (const patch of patches) {
    await assertFails(setDoc(doc(db, 'usuarios/operator'), { ...newProfile('operator'), ...patch }));
  }
});

test('self updates cannot change or delete protected fields', async () => {
  const db = identity('operator').firestore();
  const profile = doc(db, 'usuarios/operator');
  await assertSucceeds(setDoc(profile, newProfile('operator')));
  await assertSucceeds(updateDoc(profile, { displayName: 'Nuevo nombre' }));
  for (const field of ['role', 'sectorDefault', 'sectoresAsignados', 'alcance', 'jefeDeSectores', 'createdAt']) {
    await assertFails(updateDoc(profile, { [field]: deleteField() }));
  }
  await assertFails(updateDoc(profile, { role: 'admin' }));
  await assertFails(updateDoc(profile, { sectoresAsignados: ['TEJEDURIA'] }));
  await assertFails(updateDoc(profile, { permisosPersonalizados: { cerrarOrden: true } }));
  await assertFails(updateDoc(profile, { vistasPersonalizadas: ['usuarios'] }));
  await assertFails(updateDoc(profile, { email: 'admin@example.com' }));
  await assertFails(updateDoc(profile, { aprobado: true }));
});

test('legacy profile without optional fields can update name but cannot add privileges', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'usuarios/legacy'), { role: 'mecanico' });
  });
  const profile = doc(identity('legacy').firestore(), 'usuarios/legacy');
  await assertSucceeds(updateDoc(profile, { displayName: 'Legacy' }));
  await assertFails(updateDoc(profile, { sectorDefault: 'TEJEDURIA' }));
});

test('existing admin may assign roles and sectors; other accounts may not', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'usuarios/admin'), { role: 'admin' });
    await setDoc(doc(context.firestore(), 'usuarios/operator'), { role: 'mecanico' });
  });
  await assertSucceeds(updateDoc(doc(identity('admin').firestore(), 'usuarios/operator'), {
    role: 'inspector', sectorDefault: 'TEJEDURIA', sectoresAsignados: ['TEJEDURIA'],
  }));
  await assertFails(updateDoc(doc(identity('other').firestore(), 'usuarios/operator'), { role: 'admin' }));
});

test('hardcoded former bootstrap email does not confer admin authority', async () => {
  const db = identity('owner', { email: 'cristiantescobar@gmail.com', email_verified: true }).firestore();
  await assertFails(setDoc(doc(db, 'usuarios/owner'), { ...newProfile('owner'), email: 'cristiantescobar@gmail.com', role: 'admin' }));
});

test('anonymous and unauthenticated accounts cannot read/write operational data or profiles', async () => {
  const contexts = [environment.unauthenticatedContext(), identity('guest', { firebase: { sign_in_provider: 'anonymous' } })];
  for (const context of contexts) {
    const db = context.firestore();
    await assertFails(setDoc(doc(db, 'usuarios/guest'), newProfile('guest')));
    await assertFails(getDoc(doc(db, 'usuarios/operator')));
    await assertFails(setDoc(doc(db, 'novedades/falla'), { sector: 'HILANDERIA' }));
    await assertFails(getDoc(doc(db, 'intervenciones/orden')));
  }
});

test('identified operations remain compatible while detailed permissions are pending S3', async () => {
  const db = identity('operator').firestore();
  await assertSucceeds(setDoc(doc(db, 'novedades/falla'), { sector: 'HILANDERIA' }));
  await assertSucceeds(setDoc(doc(db, 'patrullas/ronda'), { inspectorUid: 'operator' }));
  await assertFails(setDoc(doc(db, '_ai_rate_limits/operator'), { count: 0 }));
});

test('Storage rejects anonymous uploads while accepting identified image captures', async () => {
  const anonymous = identity('guest', { firebase: { sign_in_provider: 'anonymous' } });
  const image = new Uint8Array([1, 2, 3]);
  await assertFails(uploadBytes(ref(anonymous.storage(), 'novedades/guest.jpg'), image, { contentType: 'image/jpeg' }));
  await assertSucceeds(uploadBytes(ref(identity('operator').storage(), 'novedades/operator.jpg'), image, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(identity('operator').storage(), 'novedades/file.txt'), image, { contentType: 'text/plain' }));
});
