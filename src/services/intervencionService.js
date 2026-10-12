import { collection, addDoc, getDocs, getDoc, onSnapshot, updateDoc, doc, serverTimestamp, query, where, orderBy, writeBatch,documentId } from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { db, storage } from '../firebase/config';
import { getAuth } from 'firebase/auth';
import { DEFAULT_SECTOR, normalizeSectorValue } from '../constants/organization';
import { sectorConstraints } from './accessScope';
import { finalizeOperationalUpload } from './operationalImageService';
import { subscribeActiveInterventions } from './interventionLiveQueue';

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
      const safeName = (foto.name || 'foto.jpg').replace(/\s+/g, '_');
      const fileName = `${Date.now()}_${safeName}`;
      const fileRef = storageRef(storage, `intervenciones/${base.sector}/${currentUser.uid}/${fileName}`);
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
          try {
            const fotoUrl = await finalizeOperationalUpload(uploadTask.snapshot.ref);
            const ref = await addDoc(collection(db, COLLECTION_NAME), { ...base, fotoUrl });
            resolve(ref.id);
          } catch (error) { reject(error); }
        }
      );
    });
  },

  /**
   * Obtiene una intervención por ID (lectura única).
   */
  async obtenerPorId(id) {
    const snap = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  },

  /**
   * Suscripción realtime a una intervención específica.
   */
  suscribirPorId(id, callback, onError) {
    const scopedQuery=query(collection(db,COLLECTION_NAME),...sectorConstraints(),where(documentId(),'==',id));
    return onSnapshot(scopedQuery, (snap) => {
      const record=snap.docs[0];
      callback(record ? { id: record.id, ...record.data() } : null);
    }, onError);
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
   * Toma múltiples intervenciones en batch atómico (máx 500).
   * @param {string[]} ids - IDs de intervenciones
   * @param {string} nuevoEstado - EN_PROCESO o COMPLETADO
   * @param {Object} extra - campos adicionales (asignadoA, asignadoNombre, etc.)
   */
  async actualizarEstadoBatch(ids, nuevoEstado, extra = {}) {
    if (!ids.length) return;
    const batch = writeBatch(db);
    for (const id of ids) {
      const ref = doc(db, COLLECTION_NAME, id);
      const updates = { estado: nuevoEstado, ...extra };
      if (nuevoEstado === 'EN_PROCESO') {
        updates.fechaInicio = serverTimestamp();
        if (!updates.fechaAsignacion) updates.fechaAsignacion = serverTimestamp();
      }
      if (nuevoEstado === 'COMPLETADO') updates.fechaFin = serverTimestamp();
      batch.update(ref, updates);
    }
    await batch.commit();
  },

  /**
   * Suscripción realtime a intervenciones (PENDIENTE + EN_PROCESO + COMPLETADO recientes) de uno o varios sectores.
   * Acepta string o array de sectores.
   */
  suscribirActivas(sector, callback, onError) {
    const sectores=(Array.isArray(sector) ? sector:[sector]).map(s=>normalizeSectorValue(s));
    return subscribeActiveInterventions(db,sectores,callback,onError);
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
   * Guarda el diagnóstico del mecánico en una intervención.
   */
  async guardarDiagnostico(id, diagnostico) {
    await updateDoc(doc(db, COLLECTION_NAME, id), {
      ...diagnostico,
      diagnosticoUpdatedAt: serverTimestamp(),
    });
  },

  /**
   * Obtiene el historial de intervenciones con filtros opcionales.
   */
  async obtenerHistorial({ sector, estado, limite = 50 } = {}) {
    const filters = [orderBy('createdAt', 'desc')];
    if (!sector) filters.unshift(...sectorConstraints());
    if (sector) filters.unshift(where('sector', '==', normalizeSectorValue(sector)));
    if (estado) filters.unshift(where('estado', '==', estado));
    const q = query(collection(db, COLLECTION_NAME), ...filters);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).slice(0, limite);
  }
};
