import { getAuth, signInWithPopup, GoogleAuthProvider, signInAnonymously, signOut, onAuthStateChanged } from 'firebase/auth';
import { app } from '../firebase/config';

// Initialize Auth
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export const authService = {
  /**
   * Inicia sesión usando una cuenta de Google
   */
  async loginConGoogle() {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      return result.user;
    } catch (error) {
      console.error("Error logging in with Google:", error);
      throw error;
    }
  },

  /**
   * Inicia sesión de manera anónima (Guest)
   */
  async loginAnonimo() {
    try {
      const result = await signInAnonymously(auth);
      return result.user;
    } catch (error) {
      console.error("Error con login anónimo:", error);
      throw error;
    }
  },

  /**
   * Cierra la sesión activa
   */
  async cerrarSesion() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error cerrando sesión:", error);
      throw error;
    }
  },

  /**
   * Observa el estado de la autenticación
   * @param {Function} callback - Función que se ejecuta con el usuario o null
   */
  observarEstado(callback) {
    return onAuthStateChanged(auth, callback);
  }
};
