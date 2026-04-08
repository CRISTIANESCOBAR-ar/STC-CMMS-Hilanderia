import { collection, addDoc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { getTurnoActual } from '../constants/organization';

const COL_PATRULLAS = 'patrullas';
const DOC_CONFIG    = 'config/patrulla';

// ── Configuración de umbrales ────────────────────────────────────
const DEFAULTS_CONFIG = {
  umbralRoturaU: 2,
  umbralRoturaT: 3,
};

export async function loadPatrullaConfig() {
  const snap = await getDoc(doc(db, DOC_CONFIG));
  if (snap.exists()) {
    const stored = snap.data();
    // Detectar si los defaults cambiaron y actualizar
    let needsUpdate = false;
    for (const [k, v] of Object.entries(DEFAULTS_CONFIG)) {
      if (stored[k] === undefined) needsUpdate = true;
    }
    // Migración: si stored tiene valores viejos, sobrescribir con nuevos defaults
    if (stored.umbralRoturaU === 5 && stored.umbralRoturaT === 5) needsUpdate = true;
    if (needsUpdate) {
      await setDoc(doc(db, DOC_CONFIG), DEFAULTS_CONFIG, { merge: true });
      return { ...stored, ...DEFAULTS_CONFIG };
    }
    return { ...DEFAULTS_CONFIG, ...stored };
  }
  await setDoc(doc(db, DOC_CONFIG), DEFAULTS_CONFIG);
  return { ...DEFAULTS_CONFIG };
}

export async function savePatrullaConfig(cfg) {
  await setDoc(doc(db, DOC_CONFIG), cfg, { merge: true });
}

// ── Patrullas ────────────────────────────────────────────────────

/**
 * Busca la patrulla activa del turno actual para un inspector dado.
 * Activa = estado 'en_curso' + turno + fecha de hoy.
 */
export async function cargarPatrullaActiva(inspectorUid) {
  const hoy = new Date();
  const fechaStr = hoy.toISOString().slice(0, 10); // YYYY-MM-DD
  const turno = getTurnoActual(hoy);

  const q = query(
    collection(db, COL_PATRULLAS),
    where('inspectorUid', '==', inspectorUid),
    where('fecha', '==', fechaStr),
    where('turno', '==', turno),
    where('estado', '==', 'en_curso'),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

/**
 * Carga TODAS las patrullas activas del turno actual (para vista de calidad global).
 */
export async function cargarPatrullasTurnoActual() {
  const hoy = new Date();
  const fechaStr = hoy.toISOString().slice(0, 10);
  const turno = getTurnoActual(hoy);

  const q = query(
    collection(db, COL_PATRULLAS),
    where('fecha', '==', fechaStr),
    where('turno', '==', turno),
    where('estado', '==', 'en_curso'),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Crea una nueva patrulla para el turno actual.
 */
export async function crearPatrulla({ inspectorUid, inspectorNombre, inspectorEmail, sector }) {
  const hoy = new Date();
  const data = {
    inspectorUid,
    inspectorNombre,
    inspectorEmail: inspectorEmail || null,
    sector,
    turno: getTurnoActual(hoy),
    fecha: hoy.toISOString().slice(0, 10),
    estado: 'en_curso',
    rondas: {},
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, COL_PATRULLAS), data);
  return { id: ref.id, ...data };
}

/**
 * Auto-guardado parcial: guarda datos sin marcar completada.
 */
export async function guardarRondaParcial(patrullaId, rondaKey, datos) {
  const ref = doc(db, COL_PATRULLAS, patrullaId);
  await updateDoc(ref, {
    [`rondas.${rondaKey}.tipo`]: 'roturas',
    [`rondas.${rondaKey}.datos`]: datos,
    [`rondas.${rondaKey}.ultimoGuardado`]: new Date().toISOString(),
  });
}

/**
 * Auto-guardado parcial genérico (paro_defecto u otro tipo).
 */
export async function guardarRondaParcialGenerico(patrullaId, rondaKey, tipo, datos) {
  const ref = doc(db, COL_PATRULLAS, patrullaId);
  await updateDoc(ref, {
    [`rondas.${rondaKey}.tipo`]: tipo,
    [`rondas.${rondaKey}.datos`]: datos,
    [`rondas.${rondaKey}.ultimoGuardado`]: new Date().toISOString(),
  });
}

/**
 * Marca el inicio de una ronda (timestamp).
 */
export async function iniciarRonda(patrullaId, rondaKey, tipo) {
  const ref = doc(db, COL_PATRULLAS, patrullaId);
  await updateDoc(ref, {
    [`rondas.${rondaKey}.tipo`]: tipo,
    [`rondas.${rondaKey}.horaInicio`]: new Date().toISOString(),
  });
}

/**
 * Guarda los datos de una ronda de roturas y marca como completada.
 * @param {string} patrullaId
 * @param {string} rondaKey - 'ronda_1' | 'ronda_6'
 * @param {Object} datos - { maq_id: { roU: number, roT: number }, ... }
 */
export async function guardarRondaRoturas(patrullaId, rondaKey, datos) {
  const ref = doc(db, COL_PATRULLAS, patrullaId);
  await updateDoc(ref, {
    [`rondas.${rondaKey}.tipo`]: 'roturas',
    [`rondas.${rondaKey}.completada`]: true,
    [`rondas.${rondaKey}.hora`]: new Date().toISOString(),
    [`rondas.${rondaKey}.datos`]: datos,
  });
}

/**
 * Guarda los datos de una ronda de trama negra.
 * @param {string} patrullaId
 * @param {Object} datos - { maq_id: { defectos: [], sinDefectos: bool, metros: number, hora: string }, ... }
 */
export async function guardarRondaTrama(patrullaId, datos) {
  const ref = doc(db, COL_PATRULLAS, patrullaId);
  await updateDoc(ref, {
    ['rondas.ronda_3.tipo']: 'trama_negra',
    ['rondas.ronda_3.completada']: true,
    ['rondas.ronda_3.hora']: new Date().toISOString(),
    ['rondas.ronda_3.datos']: datos,
  });
}

/**
 * Guarda datos de una ronda de paro/defecto y marca completada.
 */
export async function guardarRondaParoDefecto(patrullaId, rondaKey, datos, meta = {}) {
  const ref = doc(db, COL_PATRULLAS, patrullaId);
  const metaFields = Object.fromEntries(
    Object.entries(meta).map(([k, v]) => [`rondas.${rondaKey}.${k}`, v])
  );
  await updateDoc(ref, {
    [`rondas.${rondaKey}.tipo`]: 'paro_defecto',
    [`rondas.${rondaKey}.completada`]: true,
    [`rondas.${rondaKey}.hora`]: new Date().toISOString(),
    [`rondas.${rondaKey}.datos`]: datos,
    ...metaFields,
  });
}

/**
 * Guarda datos de una ronda de eficiencia y marca completada.
 * @param {string} patrullaId
 * @param {string} rondaKey - 'ronda_e1' | 'ronda_e2' | 'ronda_e3'
 * @param {Object} datos - { maq_id: { eficiencia: number, hora: string }, ... }
 */
export async function guardarRondaEficiencia(patrullaId, rondaKey, datos) {
  const ref = doc(db, COL_PATRULLAS, patrullaId);
  await updateDoc(ref, {
    [`rondas.${rondaKey}`]: {
      tipo: 'eficiencia',
      completada: true,
      hora: new Date().toISOString(),
      datos,
    },
  });
}

/**
 * Auto-guardado parcial de eficiencia (sin marcar completada).
 */
export async function guardarRondaParcialEficiencia(patrullaId, rondaKey, datos) {
  const ref = doc(db, COL_PATRULLAS, patrullaId);
  await updateDoc(ref, {
    [`rondas.${rondaKey}.tipo`]: 'eficiencia',
    [`rondas.${rondaKey}.datos`]: datos,
    [`rondas.${rondaKey}.ultimoGuardado`]: new Date().toISOString(),
  });
}

/**
 * Carga historial de patrullas.
 * Si inspectorUid se pasa, filtra por ese inspector; si no, trae todas (para supervisores).
 */
export async function cargarHistorialPatrullas(inspectorUid = null, limite = 30) {
  // Un solo orderBy evita requerir índice compuesto en Firestore.
  // El ordenado secundario por turno se hace en cliente.
  const constraints = [orderBy('fecha', 'desc'), limit(limite)];
  if (inspectorUid) constraints.unshift(where('inspectorUid', '==', inspectorUid));
  const q = query(collection(db, COL_PATRULLAS), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Carga una patrulla específica por ID.
 */
export async function cargarPatrullaPorId(patrullaId) {
  const snap = await getDoc(doc(db, COL_PATRULLAS, patrullaId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Reabre una ronda completada quitando el flag completada.
 * Conserva los datos cargados para que el inspector pueda corregirlos.
 */
export async function reabrirRonda(patrullaId, rondaKey) {
  const ref = doc(db, COL_PATRULLAS, patrullaId);
  await updateDoc(ref, {
    [`rondas.${rondaKey}.completada`]: false,
    [`rondas.${rondaKey}.hora`]: null,
    [`rondas.${rondaKey}.reabierta`]: new Date().toISOString(),
  });
}

// ── Rutas de Patrulla ────────────────────────────────────────────

const COL_RUTAS = 'rutas_patrulla';

/**
 * Carga rutas activas filtradas por tipo y sector (para uso en inspector).
 * tipo: 'roturas' | 'eficiencia' | 'ambos' | null
 * sector: 'TEJEDURIA' | 'HILANDERIA' | null
 */
export async function cargarRutasPatrulla(tipo = null, sector = null) {
  const snap = await getDocs(collection(db, COL_RUTAS));
  let rutas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  rutas = rutas.filter(r => r.activa !== false);
  if (tipo) rutas = rutas.filter(r => {
    const t = String(r.tipo || '').toLowerCase();
    return t === tipo.toLowerCase() || t === 'ambos';
  });
  if (sector) rutas = rutas.filter(r => !r.sector || r.sector === sector);
  return rutas.sort((a, b) => (a.orden || 999) - (b.orden || 999));
}

/**
 * Carga TODAS las rutas (incluyendo inactivas) para el panel admin.
 */
export async function cargarTodasRutasPatrulla() {
  const snap = await getDocs(collection(db, COL_RUTAS));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.orden || 999) - (b.orden || 999));
}

/**
 * Crea o actualiza una ruta de patrulla.
 * Si rutaId es null/undefined, crea un documento nuevo.
 */
export async function guardarRutaPatrulla(rutaId, data) {
  if (rutaId) {
    await setDoc(doc(db, COL_RUTAS, rutaId), data, { merge: true });
    return rutaId;
  } else {
    const ref = await addDoc(collection(db, COL_RUTAS), data);
    return ref.id;
  }
}

/**
 * Elimina permanentemente una ruta de patrulla.
 */
export async function eliminarRutaPatrulla(rutaId) {
  await deleteDoc(doc(db, COL_RUTAS, rutaId));
}
