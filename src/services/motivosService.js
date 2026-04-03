/**
 * motivosService.js
 * Maneja la colección 'motivos_tipo' en Firestore.
 *
 * Estructura del documento (1 doc por tipo de máquina):
 * {
 *   tipo: 'INDIGO',                       // ID del documento también
 *   'Mecánico':  [{ nombre, visible }],
 *   'Eléctrico': [{ nombre, visible }],
 * }
 */
import {
  doc, getDoc, setDoc, updateDoc, collection, getDocs
} from 'firebase/firestore';
import { db } from '../firebase/config';

const COL = 'motivos_tipo';

/** Obtiene todos los motivos de un tipo. Devuelve { 'Mecánico': [...], 'Eléctrico': [...] } */
export async function getMotivosFirestore(tipo) {
  const snap = await getDoc(doc(db, COL, tipo));
  if (!snap.exists()) return null;
  return snap.data();
}

/** Obtiene todos los tipos con motivos cargados */
export async function getAllMotivosFirestore() {
  const snap = await getDocs(collection(db, COL));
  const result = {};
  snap.docs.forEach(d => { result[d.id] = d.data(); });
  return result;
}

/** Crea o reemplaza el doc completo de un tipo */
export async function setMotivosFirestore(tipo, data) {
  await setDoc(doc(db, COL, tipo), { tipo, ...data });
}

/** Guarda solo una categoría (Mecánico o Eléctrico) de un tipo */
export async function updateCategoriaMotivos(tipo, categoria, motivos) {
  const ref = doc(db, COL, tipo);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, { [categoria]: motivos });
  } else {
    await setDoc(ref, { tipo, [categoria]: motivos });
  }
}

/**
 * Devuelve la lista de nombres de motivos visibles para CargaNovedad.
 * Si no hay doc en Firestore, retorna null (fallback a motivos.js).
 */
export async function getMotivosList(tipo, categoria) {
  const data = await getMotivosFirestore(tipo);
  if (!data || !data[categoria]) return null;
  return data[categoria]
    .filter(m => m.visible !== false)
    .map(m => m.nombre);
}
