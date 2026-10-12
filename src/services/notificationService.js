import { messaging, messagingReady, db } from '../firebase/config';
import { getToken, onMessage,deleteToken } from 'firebase/messaging';
import { doc, setDoc, serverTimestamp,deleteDoc,updateDoc } from 'firebase/firestore';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

export const notificationService = {
  async finalizarTurno(userId) { await updateDoc(doc(db,'fcm_tokens',userId),{ turnoActivo:false,updatedAt:serverTimestamp() }); },
  async desregistrarDispositivo(userId) {
    await Promise.allSettled([messaging ? deleteToken(messaging):Promise.resolve(),deleteDoc(doc(db,'fcm_tokens',userId))]);
  },
  /**
   * Solicita permisos de notificación y registra el token en Firestore
   * @param {string} userId - ID del usuario (Jefe)
   */
  async solicitarPermisosYRegistrarToken(userId) {
    if (!await messagingReady) return;

    try {
      if (typeof Notification === 'undefined') {
        console.warn('Este navegador no soporta notificaciones de escritorio.');
        return;
      }
      console.log('Solicitando permisos de notificación...');
      // Registrar el service worker dedicado a FCM antes de solicitar token
      let swReg = null;
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        try {
          swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/firebase-messaging/' });
          console.log('Service Worker (firebase-messaging-sw.js) registrado:', swReg.scope);
        } catch (swErr) {
          console.warn('No se pudo registrar firebase-messaging-sw.js:', swErr);
        }
      }

      // Never let getToken implicitly register a competing worker at the app root.
      if (!swReg) throw new Error('No se pudo preparar el servicio de notificaciones.');

      const permission = await Notification.requestPermission();
      
      if (permission === 'granted') {
        console.log('Permiso concedido. Obteniendo token FCM...');
        
        const getTokenOptions = { vapidKey: VAPID_KEY };
        if (swReg) getTokenOptions.serviceWorkerRegistration = swReg;

        const currentToken = await getToken(messaging, getTokenOptions);

        if (currentToken) {
          
          // Guardar el token en Firestore asociado al usuario
          await setDoc(doc(db, 'fcm_tokens', userId), {
            token: currentToken,
            userId: userId,
            updatedAt: serverTimestamp(),
            platform: 'web',
            turnoActivo:true
          });
          
          return currentToken;
        } else {
          console.warn('No se pudo obtener el token. Asegúrate de que el Service Worker esté registrado.');
        }
      } else {
        console.warn('Permiso de notificación denegado.');
      }
    } catch (error) {
      console.error('Error al registrar token FCM:', error);
    }
  },

  /**
   * Escucha mensajes cuando la app está en primer plano
   */
  escucharMensajesEnPrimerPlano(receive) {
    let cancelled=false,stop;
    messagingReady.then(instance=>{ if(instance && !cancelled) stop=onMessage(instance,payload=>receive?.(payload)); });
    return ()=>{ cancelled=true; stop?.(); };
  }
};
