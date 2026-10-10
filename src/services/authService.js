import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { ref } from 'vue';
import { DEFAULT_SECTOR, ROLE_OPTIONS, ROLE_SECTOR_DEFAULT, sanitizeSectorList, normalizeSectorValue, isJefeRole } from '../constants/organization';
import { createSessionLoader, withTimeout } from './sessionLoader';
import { loadProfiles } from './profileService';

const googleProvider = new GoogleAuthProvider();
const knownRoles = new Set(ROLE_OPTIONS.map(role => role.value));
export const userRole = ref(null);
export const userProfile = ref(null);
export const previewSector = ref(null);
export const sessionUser = ref(null);
export const sessionError = ref(null);
export const sessionLoading = ref(true);
let resolveAuthReady;
export const authReady = new Promise(resolve => { resolveAuthReady = resolve; });
const subscribers = new Set();
let initialized = false;
let pendingSession = Promise.resolve();
let pendingUid = null;

const normalizePerfil = (data) => {
  if (data?.role === 'pendiente') throw new Error('Tu cuenta está pendiente de aprobación. Contactá al administrador para que asigne tu rol y sector.');
  if (!data || !knownRoles.has(data.role)) {
    throw new Error('Perfil sin rol válido. Contactá al administrador.');
  }
  const role = data.role;
  const sectorDefault = normalizeSectorValue(data.sectorDefault || ROLE_SECTOR_DEFAULT[role] || DEFAULT_SECTOR);
  return {
    role,
    sectorDefault,
    sectoresAsignados: sanitizeSectorList(data.sectoresAsignados, sectorDefault),
    alcance: role === 'admin' ? (data.alcance || 'global') : 'sector',
    jefeDeSectores: isJefeRole(role)
      ? sanitizeSectorList(data.jefeDeSectores?.length ? data.jefeDeSectores : [sectorDefault], sectorDefault) : [],
    nombre: data.nombre || data.displayName || null,
    email: data.email || null,
    vistasPersonalizadas: Array.isArray(data.vistasPersonalizadas) ? data.vistasPersonalizadas : null,
    permisosPersonalizados: data.permisosPersonalizados && typeof data.permisosPersonalizados === 'object'
      ? data.permisosPersonalizados : null,
  };
};

export const authService = {
  async loginConGoogle() {
    const result = await signInWithPopup(auth, googleProvider);
    // Auth observer also loads session; wait for the latest load before navigation.
    refreshSession(result.user);
    await waitForSession();
    if (sessionError.value) throw sessionError.value;
    return result.user;
  },

  async asegurarUsuarioEnFirestore(user) {
    if (user.isAnonymous) throw new Error('Se requiere una cuenta identificada.');
    const userRef = doc(db, 'usuarios', user.uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) return; // Never migrate protected fields as a side effect of login.
    await setDoc(userRef, {
      email: user.email,
      displayName: user.displayName || '',
      role: 'pendiente',
      sectorDefault: DEFAULT_SECTOR,
      sectoresAsignados: [DEFAULT_SECTOR],
      alcance: 'sector',
      jefeDeSectores: [],
      createdAt: serverTimestamp(),
    });
  },

  async getUsuarioPerfil(uid) {
    if (!uid) throw new Error('Se requiere una sesión válida.');
    const snap = await withTimeout(getDoc(doc(db, 'usuarios', uid)));
    if (!snap.exists()) throw new Error('Perfil no encontrado. Contactá al administrador.');
    return { ...normalizePerfil(snap.data()), uid };
  },

  async getUsuarioRole(uid) {
    return (await this.getUsuarioPerfil(uid)).role;
  },

  async cerrarSesion() {
    await signOut(auth);
    refreshSession(null);
    await waitForSession();
  },

  observarEstado(callback) {
    subscribers.add(callback);
    if (initialized && !sessionLoading.value) callback(sessionUser.value);
    return () => subscribers.delete(callback);
  },
};

const loadSession = createSessionLoader(async user => {
  await authService.asegurarUsuarioEnFirestore(user);
  const profile = await authService.getUsuarioPerfil(user.uid);
  await loadProfiles();
  return profile;
}, state => {
  sessionLoading.value = state.loading;
  sessionUser.value = state.user;
  userProfile.value = state.profile;
  userRole.value = state.profile?.role || null;
  sessionError.value = state.error;
  previewSector.value = null;
  if (!state.loading) {
    initialized = true;
    for (const callback of subscribers) callback(state.user);
  }
});

function refreshSession(user) {
  // Popup completion and Auth observer can report the same account concurrently.
  // Reuse the load to avoid competing profile creation with different timestamps.
  if (user && pendingUid === user.uid
      && (sessionLoading.value || (sessionUser.value?.uid === user.uid && !sessionError.value))) {
    return pendingSession;
  }
  pendingUid = user?.uid || null;
  pendingSession = loadSession(user);
  return pendingSession;
}

export async function waitForSession() {
  let waiting;
  do {
    waiting = pendingSession;
    await waiting;
  } while (waiting !== pendingSession);
}

onAuthStateChanged(auth, async user => {
  refreshSession(user);
  await waitForSession();
  resolveAuthReady();
}, error => {
  refreshSession(null);
  sessionError.value = error;
  resolveAuthReady();
});
