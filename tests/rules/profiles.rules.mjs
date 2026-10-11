import { saveManualShiftChanges } from '../../src/services/shiftReportWrites.js';
import { faultEventsQuery, loadFaultEventsPage } from '../../src/services/faultEvents.js';
import { Timestamp } from 'firebase/firestore';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, query, where, collection, updateDoc, deleteDoc, deleteField, serverTimestamp, runTransaction } from 'firebase/firestore';
import { ref, uploadBytes, getMetadata, getDownloadURL, getBytes } from 'firebase/storage';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';
import { revokeDownloadToken } from '../../functions/operationalImages.js';

// Deliberately refuse execution without emulators; never test against live Firebase.
assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Run npm run test:rules with emulators');
assert.ok(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Storage emulator required');
let environment;
let serverApp;
const identity = (uid, extra = {}) => environment.authenticatedContext(uid, {
  email: `${uid}@example.com`, firebase: { sign_in_provider: 'google.com' }, ...extra,
});
const newProfile = uid => ({
  email: `${uid}@example.com`, displayName: 'Operador', role: 'pendiente',
  sectorDefault: 'HILANDERIA', sectoresAsignados: ['HILANDERIA'],
  alcance: 'sector', jefeDeSectores: [], createdAt: serverTimestamp(),
});

async function approve(uid, role = 'mecanico', sector = 'HILANDERIA', extra = {}) {
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), `usuarios/${uid}`), {
    role, sectorDefault: sector, sectoresAsignados: [sector], ...extra,
  }));
}
const novelty = (uid, sector = 'HILANDERIA') => ({
  sector, estado: 'pendiente', creadoPorUid: uid, createdAt: serverTimestamp(),
});

test('history state changes allow administrator transactions but reject operators and invalid payloads', async () => {
  await approve('history-admin', 'admin');
  await approve('history-operator', 'mecanico');
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'novedades/history-state'), novelty('creator')));
  const db = identity('history-admin').firestore(), reference = doc(db, 'novedades/history-state');
  await assertSucceeds(runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    assert.equal(snapshot.data().estado, 'pendiente');
    transaction.update(reference, { estado:'resuelto', updatedAt:serverTimestamp() });
  }));
  assert.equal((await getDoc(reference)).data().estado, 'resuelto');
  await assertFails(updateDoc(doc(identity('history-operator').firestore(), 'novedades/history-state'), { estado:'en proceso', updatedAt:serverTimestamp() }));
  await assertFails(updateDoc(reference, { estado:'COMPLETADO', updatedAt:serverTimestamp() }));
  await assertFails(updateDoc(reference, { estado:'pendiente', numeroMaquina:35001, updatedAt:serverTimestamp() }));
  await assertFails(updateDoc(reference, { estado:'pendiente' }));
});

test('fault event pagination enforces sectors, time windows and older pending state', async () => {
  await approve('reader');
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all(Array.from({ length: 55 }, (_, i) => setDoc(doc(db, `novedades/event-${String(i).padStart(2, '0')}`), {
      sector:'HILANDERIA', estado:'pendiente', tipoProblema:i % 2 ? 'Eléctrico' : 'Mecánico', createdAt:Timestamp.fromDate(new Date('2026-10-11T10:00:00Z')),
    })));
    await setDoc(doc(db, 'novedades/other-sector'), { sector:'TEJEDURIA', estado:'pendiente', createdAt:Timestamp.fromDate(new Date('2026-10-11T10:00:00Z')) });
    await setDoc(doc(db, 'novedades/older'), { sector:'HILANDERIA', estado:'pendiente', createdAt:Timestamp.fromDate(new Date('2026-10-10T10:00:00Z')) });
    await setDoc(doc(db, 'novedades/resolved'), { sector:'HILANDERIA', estado:'resuelto', createdAt:Timestamp.fromDate(new Date('2026-10-10T10:00:00Z')) });
  });
  const db = identity('reader').firestore();
  const options = { period:'today', order:'asc', now:new Date('2026-10-11T12:00:00Z') };
  const first = await assertSucceeds(getDocs(faultEventsQuery(db, ['HILANDERIA'], options)));
  assert.equal(first.size, 50);
  const next = await loadFaultEventsPage(db, ['HILANDERIA'], options, first.docs.at(-1));
  assert.equal(next.events.length, 5);
  assert.equal(next.hasMore, false);
  assert.equal(new Set([...first.docs.map(doc => doc.id), ...next.events.map(event => event.id)]).size, 55);
  const filtered = await getDocs(faultEventsQuery(db, ['HILANDERIA'], { ...options, category:'Eléctrico', state:'pendiente' }));
  assert.equal(filtered.size, 27);
  assert.ok(filtered.docs.every(doc => doc.data().tipoProblema === 'Eléctrico'));
  await assertFails(getDocs(faultEventsQuery(db, null, options)));
  const older = await getDocs(faultEventsQuery(db, ['HILANDERIA'], { ...options, period:'older' }));
  assert.deepEqual(older.docs.map(doc => doc.id), ['older']);
});

test('intervention event queries paginate and filter quality while enforcing sector scope', async () => {
  await approve('request-reader', 'jefe_sector', 'TEJEDURIA');
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all(Array.from({ length:54 }, (_, i) => setDoc(doc(db, `intervenciones/request-${String(i).padStart(2, '0')}`), {
      sector:'TEJEDURIA', estado:'PENDIENTE', tipoIntervencion:i % 2 ? 'MECANICO' : 'CALIDAD', createdAt:Timestamp.fromDate(new Date('2026-10-11T10:00:00Z')),
    })));
    await setDoc(doc(db, 'intervenciones/other-sector'), { sector:'HILANDERIA', estado:'PENDIENTE', tipoIntervencion:'CALIDAD', createdAt:Timestamp.fromDate(new Date('2026-10-11T10:00:00Z')) });
    await setDoc(doc(db, 'intervenciones/older-request'), { sector:'TEJEDURIA', estado:'EN_PROCESO', tipoIntervencion:'CALIDAD', createdAt:Timestamp.fromDate(new Date('2026-10-10T10:00:00Z')) });
    await setDoc(doc(db, 'intervenciones/closed-request'), { sector:'TEJEDURIA', estado:'COMPLETADO', tipoIntervencion:'CALIDAD', createdAt:Timestamp.fromDate(new Date('2026-10-10T10:00:00Z')) });
  });
  const db = identity('request-reader').firestore();
  const options = { kind:'interventions', period:'today', order:'asc', now:new Date('2026-10-11T12:00:00Z') };
  const first = await getDocs(faultEventsQuery(db, ['TEJEDURIA'], options));
  assert.equal(first.size, 50);
  const second = await loadFaultEventsPage(db, ['TEJEDURIA'], options, first.docs.at(-1));
  assert.equal(second.events.length, 4);
  const quality = await getDocs(faultEventsQuery(db, ['TEJEDURIA'], { ...options, category:'CALIDAD', state:'PENDIENTE' }));
  assert.equal(quality.size, 27);
  await assertFails(getDocs(faultEventsQuery(db, null, options)));
  const older = await getDocs(faultEventsQuery(db, ['TEJEDURIA'], { ...options, period:'older' }));
  assert.deepEqual(older.docs.map(doc => doc.id), ['older-request']);
  assert.throws(() => faultEventsQuery(db, ['TEJEDURIA'], { ...options, period:'older', state:'COMPLETADO' }));
});
const intervention = (uid, sector = 'HILANDERIA', type = 'MECANICO') => ({
  sector, tipoIntervencion: type, estado: 'PENDIENTE', creadoPorUid: uid,
  createdAt: serverTimestamp(), asignadoA: null, fechaAsignacion: null, fechaInicio: null, fechaFin: null,
});

const roles = ['mecanico', 'tejedor', 'inspector', 'auxiliar', 'supervisor',
  'supervisor_mecanico', 'supervisor_electrico', 'jefe_sector', 'jefe_electricos',
  'jefe_produccion', 'gerente_produccion', 'admin'];

test('night shift metadata is accepted while patrol date and criterion stay immutable', async () => {
  await approve('night', 'inspector', 'TEJEDURIA');
  const db = identity('night').firestore();
  const patrol = doc(db, 'patrullas/night');
  await assertSucceeds(setDoc(patrol, {
    sector: 'TEJEDURIA', inspectorUid: 'night', fecha: '2026-10-10', turno: 'C',
    fechaCriterio: 'inicio-turno-v1', estado: 'en_curso', rondas: {}, createdAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(patrol, { 'rondas.ronda_1': { datos: {} } }));
  await assertFails(updateDoc(patrol, { fecha: '2026-10-11' }));
  await assertFails(updateDoc(patrol, { fechaCriterio: 'calendario' }));
  await assertSucceeds(setDoc(doc(db, 'muestras_anudados/night'), {
    fecha: '2026-10-10', turno: 'C', fechaCriterio: 'inicio-turno-v1', creadoPor: 'night', createdAt: serverTimestamp(),
  }));
});

for (const role of roles) {
  test(`${role}: reporting and dispatch defaults are enforced on the server`, async () => {
    await approve('actor', role);
    const db = identity('actor').firestore();
    const report = setDoc(doc(db, 'novedades/new'), novelty('actor'));
    await (role === 'auxiliar' ? assertFails(report) : assertSucceeds(report));
    const dispatch = setDoc(doc(db, 'intervenciones/new'), intervention('actor'));
    await (['mecanico', 'tejedor', 'auxiliar'].includes(role) ? assertFails(dispatch) : assertSucceeds(dispatch));
  });
}

for (const role of roles) {
  test(`${role}: mechanical order execution respects granular permission`, async () => {
    await approve('dispatcher', 'admin');
    await approve('actor', role);
    await assertSucceeds(setDoc(doc(identity('dispatcher').firestore(), 'intervenciones/order'), intervention('dispatcher')));
    const order = doc(identity('actor').firestore(), 'intervenciones/order');
    const taking = updateDoc(order, { estado: 'EN_PROCESO', asignadoA: 'actor', fechaInicio: serverTimestamp(), fechaAsignacion: serverTimestamp() });
    if (['tejedor', 'inspector', 'auxiliar', 'supervisor'].includes(role)) {
      await assertFails(taking);
    } else {
      await assertSucceeds(taking);
      await assertSucceeds(updateDoc(order, { causaRaiz: 'Verificado', diagnosticoUpdatedAt: serverTimestamp() }));
      await assertSucceeds(updateDoc(order, { estado: 'COMPLETADO', fechaFin: serverTimestamp() }));
    }
  });
}

test('patrol coverage stays inside sector; efficiency cannot rewrite quality rounds', async () => {
  await approve('inspector', 'inspector', 'TEJEDURIA');
  await approve('supervisor', 'supervisor', 'TEJEDURIA');
  await approve('other', 'inspector');
  const db = identity('inspector').firestore();
  const patrol = doc(db, 'patrullas/day');
  await assertSucceeds(setDoc(patrol, { sector: 'TEJEDURIA', inspectorUid: 'inspector',
    createdAt: serverTimestamp(), estado: 'en_curso', rondas: {} }));
  await assertSucceeds(updateDoc(patrol, { 'rondas.ronda_1': { datos: {} } }));
  await assertFails(updateDoc(patrol, { inspectorUid: 'other' }));
  await assertFails(getDoc(doc(identity('other').firestore(), 'patrullas/day')));
  const efficiency = doc(identity('supervisor').firestore(), 'patrullas/day');
  await assertSucceeds(updateDoc(efficiency, { 'rondas.ronda_e1': { datos: {} } }));
  await assertFails(updateDoc(efficiency, { 'rondas.ronda_1': { datos: { forged: true } } }));
});

test('AI caches cannot expose summaries outside assigned sectors or legacy unscoped contents', async () => {
  await approve('leader', 'jefe_sector');
  const db = identity('leader').firestore();
  await assertSucceeds(setDoc(doc(db, 'ai_summaries/own'), { sectores: ['HILANDERIA'], resumen: 'Seguro' }));
  await assertFails(setDoc(doc(db, 'ai_summaries/other'), { sectores: ['TEJEDURIA'], resumen: 'Fuera de alcance' }));
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'ai_summaries/legacy'), { resumen: 'Sin sector' }));
  await assertFails(getDoc(doc(db, 'ai_summaries/legacy')));
});

test('custom dispatch view allows dispatch but does not grant execution automatically', async () => {
  await approve('actor', 'auxiliar', 'TEJEDURIA', { vistasPersonalizadas: ['llamar'] });
  const db = identity('actor').firestore();
  const order = doc(db, 'intervenciones/custom');
  await assertSucceeds(setDoc(order, intervention('actor', 'TEJEDURIA')));
  await assertFails(updateDoc(order, { estado: 'EN_PROCESO', asignadoA: 'actor', fechaInicio: serverTimestamp(), fechaAsignacion: serverTimestamp() }));
});

test('quality permission denial applies even to inspector in the same sector', async () => {
  await approve('inspector', 'inspector', 'TEJEDURIA', { permisosPersonalizados: { verCalidad: false } });
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'patrullas/day'), {
    sector: 'TEJEDURIA', inspectorUid: 'inspector', estado: 'en_curso', rondas: {},
  }));
  const patrol = doc(identity('inspector').firestore(), 'patrullas/day');
  await assertFails(getDoc(patrol));
  await assertFails(updateDoc(patrol, { 'rondas.ronda_1': { datos: {} } }));
});

test('legacy image is accessible only after trusted sector metadata and only in that sector', async () => {
  await approve('hil');
  await approve('tej', 'mecanico', 'TEJEDURIA');
  await environment.withSecurityRulesDisabled(context => uploadBytes(ref(context.storage(), 'novedades/legacy-scoped.jpg'),
    new Uint8Array([1,2,3]), { contentType: 'image/jpeg', customMetadata: { sector: 'HILANDERIA' } }));
  await assertSucceeds(getMetadata(ref(identity('hil').storage(), 'novedades/legacy-scoped.jpg')));
  await assertFails(getMetadata(ref(identity('tej').storage(), 'novedades/legacy-scoped.jpg')));
});

test('sector scope protects direct reads, collection queries and event creation', async () => {
  await approve('actor');
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'novedades/hil'), { sector: 'HILANDERIA', estado: 'pendiente' });
    await setDoc(doc(context.firestore(), 'novedades/tej'), { sector: 'TEJEDURIA', estado: 'pendiente' });
  });
  const db = identity('actor').firestore();
  await assertSucceeds(getDoc(doc(db, 'novedades/hil')));
  await assertFails(getDoc(doc(db, 'novedades/tej')));
  await assertFails(getDocs(collection(db, 'novedades')));
  await assertSucceeds(getDocs(query(collection(db, 'novedades'), where('sector', '==', 'HILANDERIA'))));
  await assertFails(setDoc(doc(db, 'novedades/new'), novelty('actor', 'TEJEDURIA')));
  await assertFails(setDoc(doc(db, 'novedades/forged'), novelty('another')));
});

test('configured grants/denials apply but never grant access to an unassigned sector', async () => {
  await approve('actor', 'auxiliar', 'TEJEDURIA', { permisosPersonalizados: { crearFalla: true } });
  const db = identity('actor').firestore();
  await assertSucceeds(setDoc(doc(db, 'novedades/granted'), novelty('actor', 'TEJEDURIA')));
  await assertFails(setDoc(doc(db, 'novedades/other'), novelty('actor', 'HILANDERIA')));
  await approve('actor', 'mecanico', 'HILANDERIA', { permisosPersonalizados: { crearFalla: false } });
  await assertFails(setDoc(doc(db, 'novedades/denied'), novelty('actor')));
  await approve('actor', 'mecanico');
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'config/organization'), {
    profiles: { mecanico: { permisos: { crearFalla: false } } },
  }));
  await assertFails(setDoc(doc(db, 'novedades/config-denied'), novelty('actor')));
});

test('order cannot be taken twice, reassigned, closed by another actor or reopened', async () => {
  await approve('dispatcher', 'supervisor');
  await approve('one');
  await approve('two');
  await assertSucceeds(setDoc(doc(identity('dispatcher').firestore(), 'intervenciones/order'), intervention('dispatcher')));
  const first = doc(identity('one').firestore(), 'intervenciones/order');
  const second = doc(identity('two').firestore(), 'intervenciones/order');
  const take = uid => ({ estado: 'EN_PROCESO', asignadoA: uid, fechaInicio: serverTimestamp(), fechaAsignacion: serverTimestamp() });
  const simultaneous = await Promise.allSettled([updateDoc(first, take('one')), updateDoc(second, take('two'))]);
  assert.equal(simultaneous.filter(result => result.status === 'fulfilled').length, 1);
  const winner = simultaneous[0].status === 'fulfilled' ? first : second;
  const loser = winner === first ? second : first;
  await assertFails(updateDoc(loser, { estado: 'COMPLETADO', fechaFin: serverTimestamp() }));
  await assertFails(updateDoc(winner, { sector: 'TEJEDURIA' }));
  await assertFails(updateDoc(winner, { creadoPorUid: 'one' }));
  await assertSucceeds(updateDoc(winner, { causaRaiz: 'Desgaste', diagnosticoUpdatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(winner, { estado: 'COMPLETADO', fechaFin: serverTimestamp() }));
  await assertFails(updateDoc(winner, take('one')));
});

test('inspector may execute quality orders but not mechanical orders', async () => {
  await approve('dispatcher', 'supervisor', 'TEJEDURIA');
  await approve('inspector', 'inspector', 'TEJEDURIA');
  const dispatch = identity('dispatcher').firestore();
  await assertSucceeds(setDoc(doc(dispatch, 'intervenciones/quality'), intervention('dispatcher', 'TEJEDURIA', 'CALIDAD')));
  await assertSucceeds(setDoc(doc(dispatch, 'intervenciones/mechanical'), intervention('dispatcher', 'TEJEDURIA')));
  const db = identity('inspector').firestore();
  const take = { estado: 'EN_PROCESO', asignadoA: 'inspector', fechaInicio: serverTimestamp(), fechaAsignacion: serverTimestamp() };
  await assertSucceeds(updateDoc(doc(db, 'intervenciones/quality'), take));
  await assertFails(updateDoc(doc(db, 'intervenciones/mechanical'), take));
});

test('auxiliary production access is scoped and does not authorize patrol edits', async () => {
  await approve('aux', 'auxiliar', 'TEJEDURIA');
  await approve('hil', 'auxiliar');
  const db = identity('aux').firestore();
  await assertSucceeds(setDoc(doc(db, 'shift_reports/day'), { fecha: '2026/10/10', registros: {}, updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(db, 'operarios_horarios/day'), { fecha: '2026-10-10' }));
  await assertFails(getDoc(doc(identity('hil').firestore(), 'shift_reports/day')));
  await assertFails(setDoc(doc(db, 'patrullas/day'), { sector: 'TEJEDURIA', inspectorUid: 'aux', createdAt: serverTimestamp() }));
});

test('images enforce sector, owner, role, approval and immutable files', async () => {
  await approve('actor');
  await approve('other', 'mecanico', 'TEJEDURIA');
  const bytes = new Uint8Array([1,2,3]);
  const options = { contentType: 'image/jpeg' };
  const storage = identity('actor').storage();
  const own = ref(storage, 'novedades/HILANDERIA/actor/scoped.jpg');
  await assertSucceeds(uploadBytes(own, bytes, options));
  await assertFails(uploadBytes(own, new Uint8Array([4,5,6]), options));
  await assertFails(uploadBytes(ref(storage, 'novedades/TEJEDURIA/actor/scoped.jpg'), bytes, options));
  await assertFails(uploadBytes(ref(storage, 'novedades/HILANDERIA/other/scoped.jpg'), bytes, options));
  await assertFails(uploadBytes(ref(storage, 'intervenciones/HILANDERIA/actor/scoped.jpg'), bytes, options));
  await assertFails(getMetadata(ref(identity('other').storage(), 'novedades/HILANDERIA/actor/scoped.jpg')));
  await assertFails(uploadBytes(ref(identity('pending').storage(), 'novedades/HILANDERIA/pending/test.jpg'), bytes, options));
});

before(async () => {
  assert.match(process.env.FIREBASE_STORAGE_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):/);
  process.env.STORAGE_EMULATOR_HOST = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}`;
  serverApp = initializeAdminApp({ projectId: 'demo-cmms-production', storageBucket: 'demo-cmms-production.appspot.com' }, 'image-security-test');
  environment = await initializeTestEnvironment({
    projectId: 'demo-cmms-production',
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
    storage: { rules: await readFile('storage.rules', 'utf8') },
  });
});
after(async () => { await environment?.cleanup(); if (serverApp) await deleteAdminApp(serverApp); });
beforeEach(async () => { await environment.clearFirestore(); });

test('identified account may create only its own default profile', async () => {
  const db = identity('operator').firestore();
  await assertSucceeds(setDoc(doc(db, 'usuarios/operator'), newProfile('operator')));
  await assertFails(setDoc(doc(db, 'usuarios/other'), newProfile('operator')));
});

test('new profile cannot inject role, permissions, sectors or timestamps', async () => {
  const db = identity('operator').firestore();
  const patches = [
    { role: 'admin' }, { role: 'mecanico' }, { vistasPersonalizadas: ['usuarios'] },
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

test('pending profile is excluded from operation until admin assigns a recognized role', async () => {
  const db = identity('operator').firestore();
  await assertSucceeds(setDoc(doc(db, 'usuarios/operator'), newProfile('operator')));
  await assertFails(setDoc(doc(db, 'novedades/falla'), novelty('operator')));
  await approve('operator');
  await assertSucceeds(setDoc(doc(db, 'novedades/falla'), novelty('operator')));
  await assertFails(setDoc(doc(db, 'patrullas/ronda'), { inspectorUid: 'operator' }));
  await assertFails(setDoc(doc(db, '_ai_rate_limits/operator'), { count: 0 }));
});

test('Storage rejects anonymous uploads while accepting identified image captures', async () => {
  await approve('operator');
  const anonymous = identity('guest', { firebase: { sign_in_provider: 'anonymous' } });
  const image = new Uint8Array([1, 2, 3]);
  await assertFails(uploadBytes(ref(anonymous.storage(), 'novedades/guest.jpg'), image, { contentType: 'image/jpeg' }));
  await assertSucceeds(uploadBytes(ref(identity('operator').storage(), 'novedades/HILANDERIA/operator/operator.jpg'), image, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(identity('operator').storage(), 'novedades/file.txt'), image, { contentType: 'text/plain' }));
});

test('inspector may read missing/configured thresholds but only admin may save them', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'usuarios/admin'), { role: 'admin' });
    await setDoc(doc(context.firestore(), 'usuarios/inspector'), { role: 'inspector' });
  });
  const inspectorConfig = doc(identity('inspector').firestore(), 'config/patrulla');
  await assertSucceeds(getDoc(inspectorConfig));
  await assertFails(setDoc(inspectorConfig, { umbralRoturaU: 2, umbralRoturaT: 3 }));
  await assertSucceeds(setDoc(doc(identity('admin').firestore(), 'config/patrulla'), { umbralRoturaU: 5, umbralRoturaT: 5 }));
  const config = await assertSucceeds(getDoc(inspectorConfig));
  assert.equal(config.data().umbralRoturaU, 5);
});

test('finalizer fails closed when emulator retains tokens; authenticated bytes remain available', async () => {
  await approve('actor');
  const reference = ref(identity('actor').storage(), 'novedades/HILANDERIA/actor/token-test.jpg');
  await assertSucceeds(uploadBytes(reference, new Uint8Array([1,2,3]), { contentType: 'image/jpeg' }));
  const url = await getDownloadURL(reference);
  assert.equal((await fetch(url)).status, 200);
  // firebase-tools metadata.js retains its separate downloadTokens array when GCS
  // custom metadata is patched to null. Do not mistake this emulator for a real
  // token-revocation acceptance test: the finalizer must refuse that result.
  await assert.rejects(revokeDownloadToken(getAdminStorage(serverApp).bucket(reference.bucket).file(reference.fullPath)), /revocar/);
  const revoked = await fetch(url);
  assert.equal(revoked.status, 200);
  const bytes = await assertSucceeds(getBytes(reference));
  assert.equal(bytes.byteLength, 3);
});


test('manual shift transactions create one day without losing independent concurrent records', async () => {
  await approve('production', 'auxiliar', 'TEJEDURIA');
  const db = identity('production').firestore();
  const a = { loom: '1', turno: 'A', picks: 261, rpm: 750, source: 'manual' };
  const b = { loom: '2', turno: 'A', picks: 297, rpm: 750, source: 'manual' };
  await Promise.all([
    saveManualShiftChanges(db, '2026/10/10', [{ key: '1_A', base: null, data: a }]),
    saveManualShiftChanges(db, '2026/10/10', [{ key: '2_A', base: null, data: b }]),
  ]);
  const snapshot = await getDoc(doc(db, 'shift_reports/2026-10-10'));
  assert.equal(snapshot.data().registros['1_A'].picks, 261);
  assert.equal(snapshot.data().registros['2_A'].picks, 297);
});

test('a conflicting shift transaction cannot partially write or overwrite imported records', async () => {
  await approve('production', 'auxiliar', 'TEJEDURIA');
  const db = identity('production').firestore();
  const base = { loom: '1', turno: 'A', picks: 261, rpm: 750, source: 'manual' };
  await saveManualShiftChanges(db, '2026/10/10', [{ key: '1_A', base: null, data: base }]);
  const imported = { ...base, picks: 300, source: 'csv' };
  await updateDoc(doc(db, 'shift_reports/2026-10-10'), { 'registros.1_A': imported, updatedAt: serverTimestamp() });
  await assert.rejects(saveManualShiftChanges(db, '2026/10/10', [
    { key: '1_A', base, data: { ...base, picks: 262 } },
    { key: '2_A', base: null, data: { ...base, loom: '2' } },
  ]), { code: 'shiftreport/conflict' });
  const snapshot = await getDoc(doc(db, 'shift_reports/2026-10-10'));
  assert.equal(snapshot.data().registros['1_A'].source, 'csv');
  assert.equal(snapshot.data().registros['1_A'].picks, 300);
  assert.equal(snapshot.data().registros['2_A'], undefined);
});

test('symptom scoped queries and transactions remain available only to approved members and administrators', async () => {
  await approve('symptom-admin', 'admin'); await approve('symptom-reader', 'tejedor', 'TEJEDURIA');
  const db = identity('symptom-admin').firestore(), reference = doc(db, 'sintomas/test-symptom');
  await assertSucceeds(runTransaction(db, async transaction => {
    assert.equal((await transaction.get(reference)).exists(), false);
    transaction.set(reference, { nombre:'Trama', sector:'TEJEDURIA', tipoMaquina:'TELAR', activo:true, orden:1, creadoEn:serverTimestamp() });
  }));
  const reader = identity('symptom-reader').firestore();
  const records = await assertSucceeds(getDocs(query(collection(reader,'sintomas'), where('sector','==','TEJEDURIA'), where('tipoMaquina','==','TELAR'))));
  assert.equal(records.size,1);
  await assertFails(updateDoc(doc(reader,'sintomas/test-symptom'), { nombre:'Cambio no permitido' }));
  await assertFails(deleteDoc(doc(reader,'sintomas/test-symptom')));
  await assertFails(setDoc(doc(reader,'sintomas/other'), { nombre:'No permitido' }));
  await assertSucceeds(runTransaction(db, async transaction => { await transaction.get(reference); transaction.update(reference, { nombre:'Renombrado', orden:2 }); }));
  await assertSucceeds(runTransaction(db, async transaction => { await transaction.get(reference); transaction.delete(reference); }));
});
