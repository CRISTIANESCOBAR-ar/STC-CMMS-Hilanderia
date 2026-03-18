import { getAuth, signInWithPopup, GoogleAuthProvider, signInAnonymously, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, getFirestore } from 'firebase/firestore';
import { app } from '../firebase/config';
import { ref } from 'vue';

// Initialize Auth & DB
export const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Estado reactivo del rol
export const userRole = ref(null);

export const authService = {
  /**
   * Inicia sesión usando una cuenta de Google
   */
  async loginConGoogle() {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      // Asegurar que el usuario existe en la colección 'usuarios'
      await this.asegurarUsuarioEnFirestore(user);
      
      // Cargar rol
      userRole.value = await this.getUsuarioRole(user.uid);
      
      return user;
    } catch (error) {
      console.error("Error logging in with Google:", error);
      throw error;
    }
  },

  /**
   * Verifica si el usuario existe en Firestore, si no, lo crea como 'mecanico'
   */
  async asegurarUsuarioEnFirestore(user) {
    const userRef = doc(db, 'usuarios', user.uid);
    const userSnap = await getDoc(userRef);

    // Bootstrap Admin: El dueño del proyecto es admin por defecto
    const isOwner = user.email === 'cristiantescobar@gmail.com';
    const initialRole = isOwner ? 'admin' : 'mecanico';

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        email: user.email,
        displayName: user.displayName,
        role: initialRole, 
        createdAt: new Date()
      });
    } else if (isOwner && userSnap.data().role !== 'admin') {
      // Si ya existe pero no es admin (por pruebas previas), lo promocionamos
      await updateDoc(userRef, { role: 'admin' });
    }
  },

  /**
   * Obtiene el rol de un usuario
   */
  async getUsuarioRole(uid) {
    if (!uid) return null;
    try {
      const userRef = doc(db, 'usuarios', uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        return userSnap.data().role;
      }
      return 'mecanico'; // Fallback
    } catch (e) {
      console.error("Error obteniendo rol:", e);
      return 'mecanico';
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
      userRole.value = null; // Limpiar rol
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
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        userRole.value = await this.getUsuarioRole(user.uid);
      } else {
        userRole.value = null;
      }
      callback(user);
    });
  }
};
