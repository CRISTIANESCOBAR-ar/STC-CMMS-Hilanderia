import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { DEFAULT_SECTOR, normalizeSectorValue } from '../constants/organization';

const COLLECTION_NAME = 'maquinas';

const normalizeOptionalText = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const normalizarMaquina = (data = {}) => ({
  ...data,
  sector: normalizeSectorValue(data.sector || DEFAULT_SECTOR),
  grp_tear: normalizeOptionalText(data.grp_tear),
  g_cmest: normalizeOptionalText(data.g_cmest)
});

export const maquinaService = {
  /**
   * Obtiene todas las máquinas en tiempo real
   * @param {Function} callback 
   */
  obtenerMaquinas(callback) {
    const q = query(collection(db, COLLECTION_NAME));
    return onSnapshot(q, (snapshot) => {
      const maquinas = [];
      snapshot.forEach((doc) => {
        maquinas.push({ id: doc.id, ...doc.data() });
      });
      
      // Ordenar por nro_tipo y luego por local_fisico
      maquinas.sort((a, b) => {
        if ((a.nro_tipo || 0) !== (b.nro_tipo || 0)) return (a.nro_tipo || 0) - (b.nro_tipo || 0);
        return (a.local_fisico || 0) - (b.local_fisico || 0);
      });

      callback(maquinas);
    });
  },

  /**
   * Obtiene todas las máquinas una sola vez (Once)
   */
  async obtenerMaquinasOnce() {
    const q = query(collection(db, COLLECTION_NAME));
    const snapshot = await getDocs(q);
    const maquinas = [];
    snapshot.forEach((doc) => {
      maquinas.push({ id: doc.id, ...doc.data() });
    });
    
    // Ordenar por nro_tipo y luego por local_fisico
    maquinas.sort((a, b) => {
      if ((a.nro_tipo || 0) !== (b.nro_tipo || 0)) return (a.nro_tipo || 0) - (b.nro_tipo || 0);
      return (a.local_fisico || 0) - (b.local_fisico || 0);
    });

    return maquinas;
  },

  /**
   * Agrega una nueva máquina
   * @param {Object} data 
   */
  async agregarMaquina(data) {
    const payload = normalizarMaquina(data);
    // Usamos el mismo patrón de ID: maquina_lado
    const docId = `${payload.maquina}_${payload.lado}`.replace(/\s+/g, '');
    const docRef = doc(db, COLLECTION_NAME, docId);
    await updateDoc(docRef, payload).catch(async (err) => {
      // Si no existe (falló el update), lo creamos
      await addDoc(collection(db, COLLECTION_NAME), payload);
    });
    // Nota: El InitData usaba docId específico, mantendremos la posibilidad de ID automático si falla el set.
    // Pero mejor forzar el ID para evitar duplicados.
  },

  async guardarMaquina(data) {
    const normalized = normalizarMaquina(data);
    const docId = normalized.id || `${normalized.maquina}_${normalized.lado}`.replace(/\s+/g, '');
    const { id, ...payload } = normalized;
    await updateDoc(doc(db, COLLECTION_NAME, docId), payload).catch(async () => {
        // Por si se usa add o el ID no existe
        const maquinasRef = collection(db, COLLECTION_NAME);
        await addDoc(maquinasRef, payload);
    });
  },
  
  // Versión más limpia
  async upsertMaquina(data) {
    const normalized = normalizarMaquina(data);
    const docId = normalized.id || `${normalized.maquina}_${normalized.lado}`.replace(/\s+/g, '');
    const { id, ...payload } = normalized;
    const docRef = doc(db, COLLECTION_NAME, docId);
    try {
        // Intentar setear con merge para crear o actualizar
        const { setDoc } = await import('firebase/firestore');
        await setDoc(docRef, payload, { merge: true });
    } catch (e) {
        console.error("Error in upsertMaquina", e);
        throw e;
    }
  },

  async eliminarMaquina(id) {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
  },

  async inicializarCatalogo() {
    const { writeBatch } = await import('firebase/firestore');
    const batch = writeBatch(db);
    const maquinasRef = collection(db, COLLECTION_NAME);
    
    const maquinasBase = [
      { unidad: 5, maquina: 50201, local_fisico: 1, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA TRUTZSCHLER", lado: "U", sector: DEFAULT_SECTOR },
      { unidad: 5, maquina: 50202, local_fisico: 2, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA TRUTZSCHLER", lado: "U", sector: DEFAULT_SECTOR },
      { unidad: 5, maquina: 50203, local_fisico: 3, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA TRUTZSCHLER", lado: "U", sector: DEFAULT_SECTOR },
      { unidad: 5, maquina: 50204, local_fisico: 4, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA TRUTZSCHLER", lado: "U", sector: DEFAULT_SECTOR },
      { unidad: 5, maquina: 50205, local_fisico: 5, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA TRUTZSCHLER", lado: "U", sector: DEFAULT_SECTOR },
      { unidad: 5, maquina: 50206, local_fisico: 6, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA TRUTZSCHLER", lado: "U", sector: DEFAULT_SECTOR },
      { unidad: 5, maquina: 50207, local_fisico: 7, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA TRUTZSCHLER", lado: "U", sector: DEFAULT_SECTOR },
      { unidad: 5, maquina: 50208, local_fisico: 8, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U", sector: DEFAULT_SECTOR },
      { unidad: 5, maquina: 50209, local_fisico: 9, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
      { unidad: 5, maquina: 50210, local_fisico: 10, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
      { unidad: 5, maquina: 50211, local_fisico: 11, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
      { unidad: 5, maquina: 50212, local_fisico: 12, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
      { unidad: 5, maquina: 50213, local_fisico: 13, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
      { unidad: 5, maquina: 50214, local_fisico: 14, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
      { unidad: 5, maquina: 50215, local_fisico: 15, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
      { unidad: 5, maquina: 50216, local_fisico: 16, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
      { unidad: 5, maquina: 50217, local_fisico: 17, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
      { unidad: 5, maquina: 50301, local_fisico: 1, nro_tipo: 3, tipo: "MANUAR", nombre_maquina: "MANUAR TRUTZSCHLER", lado: "U" },
      { unidad: 5, maquina: 50302, local_fisico: 2, nro_tipo: 3, tipo: "MANUAR", nombre_maquina: "MANUAR TRUTZSCHLER", lado: "U" },
      { unidad: 5, maquina: 50303, local_fisico: 3, nro_tipo: 3, tipo: "MANUAR", nombre_maquina: "MANUAR TRUTZSCHLER", lado: "U" },
      { unidad: 5, maquina: 50402, local_fisico: 2, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END II", lado: "A" },
      { unidad: 5, maquina: 50402, local_fisico: 2, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END II", lado: "B" },
      { unidad: 5, maquina: 50403, local_fisico: 3, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END III", lado: "A" },
      { unidad: 5, maquina: 50403, local_fisico: 3, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END III", lado: "B" },
      { unidad: 5, maquina: 50405, local_fisico: 5, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END RIETER R-60", lado: "U" },
      { unidad: 5, maquina: 50406, local_fisico: 6, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END RIETER R60", lado: "U" },
      { unidad: 5, maquina: 50407, local_fisico: 7, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END R60", lado: "U" },
      { unidad: 5, maquina: 50408, local_fisico: 8, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END RIETER R60", lado: "U" },
      { unidad: 5, maquina: 50409, local_fisico: 9, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END RIETER R60", lado: "U" },
      { unidad: 5, maquina: 50410, local_fisico: 10, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END RIETER R60", lado: "U" },
      { unidad: 5, maquina: 50101, local_fisico: 2, nro_tipo: 1, tipo: "APERTURA", nombre_maquina: "APERTURA 2", lado: "U" },
      { unidad: 5, maquina: 50101, local_fisico: 3, nro_tipo: 1, tipo: "APERTURA", nombre_maquina: "APERTURA 3", lado: "U" },
      { unidad: 5, maquina: 50701, local_fisico: 1, nro_tipo: 7, tipo: "FILTRO", nombre_maquina: "FILTRO 1", lado: "U" },
      { unidad: 5, maquina: 50702, local_fisico: 2, nro_tipo: 7, tipo: "FILTRO", nombre_maquina: "FILTRO 2", lado: "U" },
      { unidad: 5, maquina: 50703, local_fisico: 3, nro_tipo: 7, tipo: "FILTRO", nombre_maquina: "FILTRO 3", lado: "U" }
    ];

    maquinasBase.forEach((maquina) => {
      const maquinaNormalizada = normalizarMaquina(maquina);
      const docId = `${maquinaNormalizada.maquina}_${maquinaNormalizada.lado}`.replace(/\s+/g, '');
      const docRef = doc(maquinasRef, docId);
      batch.set(docRef, maquinaNormalizada, { merge: true });
    });

    await batch.commit();
  }
};
