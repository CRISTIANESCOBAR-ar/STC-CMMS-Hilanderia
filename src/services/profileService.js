import { ref } from 'vue';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { ROLE_PROFILES, VISTA_OPTIONS } from '../constants/organization';

// ── State reactivo ──
const profileOverrides = ref({});
let _loaded = false;

// Route → slug lookup
const ROUTE_TO_SLUG = Object.fromEntries(
  VISTA_OPTIONS.map(v => [v.route, v.slug])
);

// ── Load / Save ──
export const loadProfiles = async () => {
  if (_loaded) return;
  try {
    const snap = await getDoc(doc(db, 'config', 'organization'));
    if (snap.exists() && snap.data().profiles) {
      profileOverrides.value = snap.data().profiles;
    }
  } catch (e) {
    console.error('Error loading profiles:', e);
  }
  _loaded = true;
};

export const saveProfiles = async (profiles) => {
  profileOverrides.value = { ...profiles };
  await setDoc(doc(db, 'config', 'organization'), { profiles }, { merge: true });
};

// ── Getters efectivos (Firestore override > default) ──
export const getEffectiveVistas = (role) => {
  if (!role) return [];
  if (role === 'admin') return VISTA_OPTIONS.map(v => v.slug);
  const override = profileOverrides.value[role];
  if (override?.vistas) return override.vistas;
  return ROLE_PROFILES[role]?.vistas || [];
};

export const getEffectivePermisos = (role) => {
  if (!role) return {};
  if (role === 'admin') return { verCalidad: true, crearFalla: true, cerrarOrden: true, configSistema: true };
  const override = profileOverrides.value[role];
  if (override?.permisos) return override.permisos;
  return ROLE_PROFILES[role]?.permisos || {};
};

// ── Access checks ──
export const canAccessView = (role, vistaSlug) => {
  if (!role) return false;
  if (role === 'admin') return true;
  return getEffectiveVistas(role).includes(vistaSlug);
};

export const canAccessRoute = (role, routePath) => {
  if (!role) return false;
  if (role === 'admin') return true;
  const segments = routePath.split('/').filter(Boolean);
  const basePath = segments.length ? '/' + segments[0] : '/';
  const slug = ROUTE_TO_SLUG[basePath];
  if (!slug) return true; // Rutas no mapeadas son accesibles (ej: /login)
  return canAccessView(role, slug);
};

export const getDefaultRoute = (role) => {
  if (!role) return '/login';
  if (role === 'admin') return '/';
  const vistas = getEffectiveVistas(role);
  if (!vistas.length) return '/';
  const first = VISTA_OPTIONS.find(v => v.slug === vistas[0]);
  return first?.route || '/';
};

export { profileOverrides };
