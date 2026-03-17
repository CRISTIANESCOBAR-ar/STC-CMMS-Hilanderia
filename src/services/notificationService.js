import { messaging, db } from '../firebase/config';
import { getToken, onMessage } from 'firebase/messaging';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

export const notificationService = {
  /**
   * Solicita permisos de notificación y registra el token en Firestore
   * @param {string} userId - ID del usuario (Jefe)
   */
  async solicitarPermisosYRegistrarToken(userId) {
    if (!messaging) return;

    try {
      console.log('Solicitando permisos de notificación...');
      const permission = await Notification.requestPermission();
      
      if (permission === 'granted') {
        console.log('Permiso concedido. Obteniendo token FCM...');
        
        const currentToken = await getToken(messaging, {
          vapidKey: VAPID_KEY
        });

        if (currentToken) {
          console.log('Token FCM obtenido:', currentToken);
          
          // Guardar el token en Firestore asociado al usuario
          await setDoc(doc(db, 'fcm_tokens', userId), {
            token: currentToken,
            userId: userId,
            updatedAt: serverTimestamp(),
            platform: 'web'
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
  escucharMensajesEnPrimerPlano() {
    if (!messaging) return;
    
    onMessage(messaging, (payload) => {
      console.log('Mensaje recibido en primer plano:', payload);
      // Aquí se podría mostrar un toast o alerta personalizada en la UI
    });
  }
};
