import { signInWithPopup, GoogleAuthProvider, signInAnonymously, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { ref } from 'vue';
import { DEFAULT_SECTOR, sanitizeSectorList, normalizeSectorValue } from '../constants/organization';

const googleProvider = new GoogleAuthProvider();

// Estado reactivo del rol
export const userRole = ref(null);
export const userProfile = ref(null);

const normalizePerfil = (data = {}) => {
  const role = data.role || 'mecanico';
  const sectorDefault = normalizeSectorValue(data.sectorDefault || DEFAULT_SECTOR);
  const sectoresAsignados = sanitizeSectorList(data.sectoresAsignados, sectorDefault);

  let alcance = data.alcance || (role === 'admin' ? 'global' : 'sector');
  if (role !== 'admin' && alcance === 'global') alcance = 'sector';

  const jefeDeSectores = role === 'jefe_sector'
    ? sanitizeSectorList(data.jefeDeSectores?.length ? data.jefeDeSectores : [sectorDefault], sectorDefault)
    : [];

  return {
    role,
    sectorDefault,
    sectoresAsignados,
    alcance,
    jefeDeSectores
  };
};

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
      
      const perfil = await this.getUsuarioPerfil(user.uid);
      userProfile.value = perfil;
      userRole.value = perfil.role;
      
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
    const basePerfil = normalizePerfil({
      role: initialRole,
      sectorDefault: DEFAULT_SECTOR,
      sectoresAsignados: [DEFAULT_SECTOR],
      alcance: isOwner ? 'global' : 'sector',
      jefeDeSectores: []
    });

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        email: user.email,
        displayName: user.displayName,
        role: basePerfil.role,
        sectorDefault: basePerfil.sectorDefault,
        sectoresAsignados: basePerfil.sectoresAsignados,
        alcance: basePerfil.alcance,
        jefeDeSectores: basePerfil.jefeDeSectores,
        createdAt: new Date()
      });
    } else {
      const current = userSnap.data() || {};
      const normalized = normalizePerfil({
        ...current,
        role: isOwner ? 'admin' : current.role || initialRole,
        alcance: isOwner ? 'global' : current.alcance
      });

      const patch = {};
      if (!current.role || (isOwner && current.role !== 'admin')) patch.role = normalized.role;
      if (!current.sectorDefault || normalizeSectorValue(current.sectorDefault) !== normalized.sectorDefault) {
        patch.sectorDefault = normalized.sectorDefault;
      }
      if (!Array.isArray(current.sectoresAsignados) || JSON.stringify(current.sectoresAsignados.map(normalizeSectorValue)) !== JSON.stringify(normalized.sectoresAsignados)) {
        patch.sectoresAsignados = normalized.sectoresAsignados;
      }
      if (!current.alcance || current.alcance !== normalized.alcance) patch.alcance = normalized.alcance;
      if (!Array.isArray(current.jefeDeSectores) || JSON.stringify(current.jefeDeSectores.map(normalizeSectorValue)) !== JSON.stringify(normalized.jefeDeSectores)) {
        patch.jefeDeSectores = normalized.jefeDeSectores;
      }

      if (Object.keys(patch).length > 0) {
        await updateDoc(userRef, patch);
      }
    }
  },

  async getUsuarioPerfil(uid) {
    if (!uid) {
      return normalizePerfil({ role: 'mecanico' });
    }

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout obteniendo perfil")), 10000)
    );

    try {
      const userRef = doc(db, 'usuarios', uid);
      const fetchPromise = getDoc(userRef);
      const userSnap = await Promise.race([fetchPromise, timeoutPromise]);

      if (userSnap.exists()) {
        return normalizePerfil(userSnap.data());
      }
      return normalizePerfil({ role: 'mecanico' });
    } catch (e) {
      console.error("Error obteniendo perfil (usando fallback):", e);
      return normalizePerfil({ role: 'mecanico' });
    }
  },

  /**
   * Obtiene el rol de un usuario
   */
  async getUsuarioRole(uid) {
    const perfil = await this.getUsuarioPerfil(uid);
    return perfil.role;
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
      userProfile.value = null;
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
        const perfil = await this.getUsuarioPerfil(user.uid);
        userProfile.value = perfil;
        userRole.value = perfil.role;
      } else {
        userRole.value = null;
        userProfile.value = null;
      }
      callback(user);
    });
  }
};
