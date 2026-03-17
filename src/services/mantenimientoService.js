import { collection, addDoc, onSnapshot, updateDoc, doc, serverTimestamp, query, where, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase/config';
import { getAuth } from 'firebase/auth';

const COLLECTION_NAME = 'novedades';

export const mantenimientoService = {
  /**
   * Crea una nueva novedad en Firestore y sube foto si existe.
   * @param {Object} datos - Datos de la novedad (maquina, critico, etc)
   * @param {File} [foto] - Archivo de imagen opcional
   */
  async crearNovedad(datos, foto = null) {
    try {
      let fotoUrl = null;

      if (foto) {
        // Generar un nombre único para la imagen
        const fileName = `${Date.now()}_${foto.name}`;
        const storageRef = ref(storage, `novedades/${fileName}`);
        
        // Subir a Storage
        const snapshot = await uploadBytes(storageRef, foto);
        fotoUrl = await getDownloadURL(snapshot.ref);
      }

      // Guardar en Firestore
      // Recuperar usuario actual de firebase auth
      const currentAuthUser = getAuth().currentUser;

      const docRef = await addDoc(collection(db, COLLECTION_NAME), {
        ...datos,
        fotoUrl,
        estado: 'pendiente', 
        createdAt: serverTimestamp(),
        creadoPorUid: currentAuthUser ? currentAuthUser.uid : null,
        creadoPorNombre: currentAuthUser?.displayName || 'Mecánico Anónimo',
        creadoPorEmail: currentAuthUser?.email || null
      });
      
      return docRef.id;
    } catch (error) {
      console.error("Error al crear la novedad:", error);
      throw error;
    }
  },

  /**
   * Obtiene novedades pendientes (distintas a resuelto) en tiempo real
   * @param {Function} callback - Función que recibe las novedades cada vez que cambian
   * @returns {Function} - Función para desuscribirse (unsubscribe) del snapshot
   */
  obtenerNovedadesPendientes(callback) {
    const q = query(
      collection(db, COLLECTION_NAME),
      where('estado', 'in', ['pendiente', 'en proceso']),
      // Para usar resuelto necesitaríamos querys sin orderBy si queremos otro campo, pero mantenemos simple:
      // Note: usar in limits queries, and "where != resuelto" would require index on estado.
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const novedades = [];
      snapshot.forEach((doc) => {
        novedades.push({ id: doc.id, ...doc.data() });
      });
      
      // Ordenamiento manual en cliente por fecha de creación (createdAt a veces llega crudo como pending en offline)
      novedades.sort((a, b) => {
        const timeA = a.createdAt?.toMillis() || Date.now();
        const timeB = b.createdAt?.toMillis() || Date.now();
        return timeB - timeA; // más recientes primero
      });

      callback(novedades);
    }, (error) => {
      console.error("Error obteniendo novedades pendientes:", error);
    });

    return unsubscribe;
  },

  /**
   * Actualiza el estado de una novedad y agrega feedback del jefe.
   * @param {string} id - ID del documento en Firestore
   * @param {string} estado - Nuevo estado ('en proceso' o 'resuelto')
   * @param {string} feedbackJefe - Texto con respuesta del jefe
   */
  async aprobarNovedad(id, estado, feedbackJefe) {
    try {
      const docRef = doc(db, COLLECTION_NAME, id);
      await updateDoc(docRef, {
        estado: estado,
        feedbackJefe: feedbackJefe,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error al actualizar la novedad:", error);
      throw error;
    }
  }
};
