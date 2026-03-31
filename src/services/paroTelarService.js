/**
 * Servicio Firestore para Paros de Telares (Anudados y Reanudados).
 * Colección: paros_telares/{YYYY-MM-DD}/registros/{autoId}
 */
import { collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

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
  const q = query(registrosRef(fecha), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => {
    const paros = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(paros);
  });
}
