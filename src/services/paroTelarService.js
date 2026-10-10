/**
 * Servicio Firestore para Paros de Telares (Anudados y Reanudados).
 * Colección: paros_telares/{YYYY-MM-DD}/registros/{autoId}
 */
import { collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SHIFT_DATE_CRITERION, addDays, normalizeShiftRecord } from '../utils/plantTime';

const COLLECTION = 'paros_telares';

function fechaToDocId(fecha) {
  return (fecha || '').replace(/\//g, '-');
}

function registrosRef(fecha) {
  return collection(db, COLLECTION, fechaToDocId(fecha), 'registros');
}

/**
 * Crea un nuevo registro de paro.
 */
export async function crearParo(fecha, datos) {
  const ref = registrosRef(fecha);
  const docRef = await addDoc(ref, {
    ...datos,
    fecha: fechaToDocId(fecha),
    fechaCriterio: SHIFT_DATE_CRITERION,
    createdAt: serverTimestamp()
  });
  return docRef.id;
}

/**
 * Actualiza un registro de paro existente.
 */
export async function actualizarParo(fecha, paroId, campos) {
  const ref = doc(db, COLLECTION, fechaToDocId(fecha), 'registros', paroId);
  await updateDoc(ref, { ...campos, updatedAt: serverTimestamp() });
}

/**
 * Elimina un registro de paro.
 */
export async function eliminarParo(fecha, paroId) {
  const ref = doc(db, COLLECTION, fechaToDocId(fecha), 'registros', paroId);
  await deleteDoc(ref);
}

/**
 * Suscripción en tiempo real a los paros de una fecha.
 * Retorna función unsubscribe.
 */
export function suscribirParos(fecha, callback) {
  const selected = fechaToDocId(fecha);
  const results = new Map();
  const dates = [selected, addDays(selected, 1)];
  const stops = dates.map(source => onSnapshot(query(registrosRef(source), orderBy('createdAt', 'asc')), snap => {
    results.set(source, snap.docs.map(d => normalizeShiftRecord({ ...d.data(), id: d.id, fecha: d.data().fecha || source, fechaDocumento: source })));
    if (results.size !== dates.length) return;
    callback([...results.values()].flat().filter(record => record.fecha === selected)
      .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)));
  }));
  return () => stops.forEach(stop => stop());
}
