import { collection, addDoc, getDocs, onSnapshot, updateDoc, doc, serverTimestamp, query, where, orderBy } from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase/config';
import { getAuth } from 'firebase/auth';
import { DEFAULT_SECTOR, normalizeSectorValue } from '../constants/organization';

const COLLECTION_NAME = 'intervenciones';

export const intervencionService = {
  /**
   * Crea una nueva solicitud de intervención en Firestore y sube foto si existe.
   * @param {Object} datos - Datos de la intervención
   * @param {File} [foto] - Imagen opcional
   * @param {Function} [onProgress] - Callback de progreso (0-100)
   */
  async crearIntervencion(datos, foto = null, onProgress = null) {
    const currentUser = getAuth().currentUser;
    const base = {
      ...datos,
      sector: normalizeSectorValue(datos.sector || DEFAULT_SECTOR),
      estado: 'PENDIENTE',
      asignadoA: null,
      fechaAsignacion: null,
      fechaInicio: null,
      fechaFin: null,
      createdAt: serverTimestamp(),
      creadoPorUid: currentUser?.uid || null,
      creadoPorNombre: currentUser?.displayName || 'Usuario',
      creadoPorEmail: currentUser?.email || null,
    };

    if (!foto) {
      const ref = await addDoc(collection(db, COLLECTION_NAME), { ...base, fotoUrl: null });
      return ref.id;
    }

    return new Promise((resolve, reject) => {
      const fileName = `${Date.now()}_${foto.name.replace(/\s+/g, '_')}`;
      const fileRef = storageRef(storage, `intervenciones/${fileName}`);
      const uploadTask = uploadBytesResumable(fileRef, foto);

      const timeoutId = setTimeout(() => {
        uploadTask.cancel();
        reject(new Error('Tiempo excedido al subir la imagen.'));
      }, 30000);

      uploadTask.on('state_changed',
        (snapshot) => {
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          if (onProgress) onProgress(pct);
        },
        (error) => { clearTimeout(timeoutId); reject(error); },
        async () => {
          clearTimeout(timeoutId);
          const fotoUrl = await getDownloadURL(uploadTask.snapshot.ref);
          const ref = await addDoc(collection(db, COLLECTION_NAME), { ...base, fotoUrl });
          resolve(ref.id);
        }
      );
    });
  },

  /**
   * Actualiza el estado de una intervención.
   */
  async actualizarEstado(id, nuevoEstado, extra = {}) {
    const updates = { estado: nuevoEstado, ...extra };
    if (nuevoEstado === 'EN_PROCESO') {
      updates.fechaInicio = serverTimestamp();
      if (!updates.fechaAsignacion) updates.fechaAsignacion = serverTimestamp();
    }
    if (nuevoEstado === 'COMPLETADO') updates.fechaFin = serverTimestamp();
    await updateDoc(doc(db, COLLECTION_NAME, id), updates);
  },

  /**
   * Suscripción realtime a intervenciones activas (PENDIENTE + EN_PROCESO) de un sector.
   * Filtra por estado en el cliente para evitar índice compuesto en Firestore.
   */
  suscribirActivas(sector, callback) {
    const q = query(
      collection(db, COLLECTION_NAME),
      where('sector', '==', normalizeSectorValue(sector))
    );
    return onSnapshot(q, (snap) => {
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => ['PENDIENTE', 'EN_PROCESO'].includes(d.estado))
        .sort((a, b) => {
          if (a.estado !== b.estado) return a.estado === 'PENDIENTE' ? -1 : 1;
          return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
        });
      callback(docs);
    });
  },

  /**
   * Suscripción en tiempo real a intervenciones pendientes de un sector.
   */
  suscribirPendientes(sector, callback) {
    const q = query(
      collection(db, COLLECTION_NAME),
      where('sector', '==', normalizeSectorValue(sector)),
      where('estado', '==', 'PENDIENTE'),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  /**
   * Obtiene el historial de intervenciones con filtros opcionales.
   */
  async obtenerHistorial({ sector, estado, limite = 50 } = {}) {
    const filters = [orderBy('createdAt', 'desc')];
    if (sector) filters.unshift(where('sector', '==', normalizeSectorValue(sector)));
    if (estado) filters.unshift(where('estado', '==', estado));
    const q = query(collection(db, COLLECTION_NAME), ...filters);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).slice(0, limite);
  }
};
