import { collection, getDocs, doc, updateDoc, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';

const COLECCION_DEFECTOS = 'codigos_defectos';
const COLECCION_PARADAS  = 'codigos_paradas';

export const codigosService = {
  async getDefectos(soloActivos = false) {
    const q = soloActivos
      ? query(collection(db, COLECCION_DEFECTOS), where('activo', '==', true))
      : query(collection(db, COLECCION_DEFECTOS));
    const snap = await getDocs(q);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      // Solo docs de nuestro import (tienen campo 'activo' definido)
      .filter(d => d.activo !== undefined)
      .sort((a, b) => (a.codigo ?? 0) - (b.codigo ?? 0));
  },

  async getParadas(soloActivos = false) {
    const q = soloActivos
      ? query(collection(db, COLECCION_PARADAS), where('activo', '==', true))
      : query(collection(db, COLECCION_PARADAS));
    const snap = await getDocs(q);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      // Solo docs de nuestro import (tienen campo 'activo' definido)
      .filter(d => d.activo !== undefined)
      .sort((a, b) => (a.codigo ?? 0) - (b.codigo ?? 0));
  },

  async actualizarCodigo(coleccion, id, campos) {
    await updateDoc(doc(db, coleccion, id), campos);
  },
};
