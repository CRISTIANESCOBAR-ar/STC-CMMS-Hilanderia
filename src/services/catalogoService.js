import { collection, addDoc, getDocs, query, where, writeBatch, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const COLLECTION_NAME = 'catalogo_puestos_control';

export const catalogoService = {
  /**
   * Obtiene los puntos de control para un modelo de máquina específico.
   * @param {string} modelo - Ejemplo: 'R-60'
   */
  async obtenerPuntosPorModelo(modelo) {
    try {
      const q = query(collection(db, COLLECTION_NAME), where('modelo', '==', modelo));
      const querySnapshot = await getDocs(q);
      const catalog = [];
      querySnapshot.forEach((doc) => {
        catalog.push({ id: doc.id, ...doc.data() });
      });
      return catalog;
    } catch (error) {
      console.error("Error al obtener puntos de control:", error);
      throw error;
    }
  },

  /**
   * Carga el catálogo completo desde un JSON a Firestore.
   * También actualiza las máquinas OPEN END existentes para que tengan el modelo 'R-60'.
   */
  async migrarCatalogo(items) {
    try {
      const { writeBatch, getDocs } = await import('firebase/firestore');
      const batch = writeBatch(db);
      
      // 1. Cargar el catálogo
      items.forEach((item) => {
        const itemConModelo = { ...item, modelo: item.modelo || 'R-60' };
        const docId = `r60_${item.seccion}_${item.grupo}_${item.subGrupo}_${item.denominacion}`
          .replace(/[\s/]+/g, '_')
          .toLowerCase();
        const docRef = doc(db, COLLECTION_NAME, docId);
        batch.set(docRef, { ...itemConModelo, updatedAt: new Date() }, { merge: true });
      });

      // 2. Parchear máquinas existentes
      const maquinasRef = collection(db, 'maquinas');
      const mSnap = await getDocs(maquinasRef);
      mSnap.forEach((mDoc) => {
        const data = mDoc.data();
        if (data.tipo === 'OPEN END' && !data.modelo) {
          batch.update(mDoc.ref, { modelo: 'R-60' });
        }
      });

      await batch.commit();
      console.log("Migración y parche de máquinas completos");
    } catch (error) {
      console.error("Error en migración:", error);
      throw error;
    }
  },

  /**
   * Obtiene los puntos de control filtrando por el campo 'tipo' del documento.
   * Útil para catálogos de máquinas TELAR, etc.
   * @param {string} tipo - Ejemplo: 'TELAR'
   */
  async obtenerPuntosPorTipo(tipo) {
    try {
      const q = query(collection(db, COLLECTION_NAME), where('tipo', '==', tipo));
      const snap = await getDocs(q);
      const catalog = [];
      snap.forEach((d) => catalog.push({ id: d.id, ...d.data() }));
      return catalog;
    } catch (error) {
      console.error('Error al obtener puntos de control por tipo:', error);
      throw error;
    }
  },

  /**
   * Obtiene todas las piezas del catálogo para un modelo específico (ej: 'JA2S-190TP-EF-T710')
   * ordenadas por sección > grupo > denominación.
   */
  async obtenerPorModelo(modelo) {
    const q = query(collection(db, COLLECTION_NAME), where('modelo', '==', modelo));
    const snap = await getDocs(q);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        if (a.seccion !== b.seccion) return a.seccion.localeCompare(b.seccion);
        if (a.grupo   !== b.grupo)   return String(a.grupo).localeCompare(String(b.grupo));
        return a.denominacion.localeCompare(b.denominacion);
      });
  },

  /**
   * Guarda el procedimiento (array de pasos) en un documento del catálogo.
   * @param {string} docId - ID del documento en Firestore
   * @param {Array<{texto: string, imagenUrl: string|null}>} pasos
   */
  async actualizarProcedimiento(docId, pasos) {
    const ref = doc(db, COLLECTION_NAME, docId);
    await updateDoc(ref, { procedimiento: pasos, procedimientoUpdatedAt: new Date() });
  },

  /**
   * Obtiene todos los registros del catálogo sin filtrar por modelo.
   * Ordenados por modelo > sección > grupo > denominación.
   */
  async obtenerTodo() {
    const snap = await getDocs(collection(db, COLLECTION_NAME));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        if ((a.modelo || '') !== (b.modelo || '')) return (a.modelo || '').localeCompare(b.modelo || '');
        if (a.seccion !== b.seccion) return (a.seccion || '').localeCompare(b.seccion || '');
        if (String(a.grupo) !== String(b.grupo)) return String(a.grupo || '').localeCompare(String(b.grupo || ''));
        return (a.denominacion || '').localeCompare(b.denominacion || '');
      });
  },

  /**
   * Verifica si el catálogo está vacío y lo inicializa si es necesario.
   */
  async inicializarSiVacio(items) {
    const q = query(collection(db, COLLECTION_NAME), where('modelo', '==', 'R-60'));
    const snap = await getDocs(q);
    if (snap.empty) {
      await this.migrarCatalogo(items);
    }
  }
};
