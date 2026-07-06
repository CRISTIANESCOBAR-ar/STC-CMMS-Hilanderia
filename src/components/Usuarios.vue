<script setup>
import { ref, onMounted, computed } from 'vue';
import { collection, getDocs, doc, updateDoc, getDoc, setDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userRole } from '../services/authService';
import { 
  Users, 
  ShieldCheck, 
  Shield, 
  Mail, 
  Calendar, 
  Search, 
  Save, 
  Building2, 
  UserCog, 
  Settings, 
  Plus, 
  Trash2, 
  ChevronDown, 
  ChevronUp, 
  Eye, 
  X, 
  Filter, 
  User, 
  Check, 
  AlertCircle,
  Undo2,
  Pencil,
  Layers,
  MapPin,
  LogIn,
  Lock,
  LayoutGrid
} from 'lucide-vue-next';
import Swal from 'sweetalert2';
import { 
  DEFAULT_SECTOR, 
  ROLE_OPTIONS as DEFAULT_ROLES, 
  SECTOR_OPTIONS as DEFAULT_SECTORS, 
  isJefeRole, 
  normalizeSectorValue, 
  sanitizeSectorList, 
  ROLE_PROFILES, 
  NIVEL_CONFIG, 
  VISTA_OPTIONS, 
  VISTA_LABEL, 
  PERMISO_LABELS,
  ROLE_SECTOR_DEFAULT
} from '../constants/organization';
import { 
  profileOverrides, 
  loadProfiles, 
  saveProfiles, 
  getEffectiveVistas, 
  getEffectivePermisos,
  getDefaultRoute,
  getEffectiveDescripcion,
  getEffectiveNivel,
  getEffectiveSectorDefault
} from '../services/profileService';

const usuarios = ref([]);
const isLoading = ref(true);
const searchQuery = ref('');
const filterRole = ref('');
const activeTab = ref('usuarios'); // 'usuarios' | 'perfiles' | 'config'
const selectedUser = ref(null);
const editSnapshot = ref('');
const drawerOpen = ref(false);

const perfilesViewMode = ref('resumen'); // 'resumen' | 'editor'

// Roles agrupados por nivel para la vista resumen
const rolesByNivel = computed(() => {
  const groups = {
    operativo:   { label: 'Operativo',    color: 'blue',    roles: [] },
    mandos:      { label: 'Mandos Medios', color: 'violet',  roles: [] },
    estrategico: { label: 'Estratégico',  color: 'emerald', roles: [] },
    global:      { label: 'Global',       color: 'amber',   roles: [] },
  };
  
  for (const role of activeRoles.value) {
    let desc = '';
    let nivel = 'operativo';
    let sectorDefault = DEFAULT_SECTOR;
    let vistas = [];
    let permisos = {};

    if (role.value === 'admin') {
      desc = ROLE_PROFILES.admin.descripcion || 'Acceso total al sistema';
      nivel = ROLE_PROFILES.admin.nivel || 'global';
      sectorDefault = DEFAULT_SECTOR;
      vistas = getEffectiveVistas(role.value);
      permisos = getEffectivePermisos(role.value);
    } else {
      const editProf = editableProfiles.value[role.value];
      if (editProf) {
        desc = editProf.descripcion || '';
        nivel = editProf.nivel || 'operativo';
        sectorDefault = editProf.sectorDefault || DEFAULT_SECTOR;
        vistas = editProf.vistas || [];
        permisos = editProf.permisos || {};
      } else {
        desc = getEffectiveDescripcion(role.value);
        nivel = getEffectiveNivel(role.value);
        sectorDefault = getEffectiveSectorDefault(role.value);
        vistas = getEffectiveVistas(role.value);
        permisos = getEffectivePermisos(role.value);
      }
    }

    if (groups[nivel]) {
      groups[nivel].roles.push({
        ...role,
        descripcion: desc,
        sectorDefault,
        defaultRoute: getDefaultRoute(role.value),
        effectiveVistas: vistas,
        effectivePermisos: permisos,
      });
    }
  }
  return Object.entries(groups).filter(([_, g]) => g.roles.length > 0);
});

// ── Config dinámica (Firestore: config/organization) ──
const dynamicRoles = ref([]);
const dynamicSectors = ref([]);
const newRoleValue = ref('');
const newRoleLabel = ref('');
const newSector = ref('');

const activeRoles = computed(() => {
  const defaults = [...DEFAULT_ROLES];
  const defaultKeys = new Set(defaults.map(r => r.value));
  for (const dr of dynamicRoles.value) {
    if (!defaultKeys.has(dr.value)) {
      defaults.push(dr);
    }
  }
  const overrideLabels = Object.fromEntries(dynamicRoles.value.map(r => [r.value, r.label]));
  return defaults.map(r => ({
    value: r.value,
    label: overrideLabels[r.value] || r.label
  }));
});
const activeSectors = computed(() => dynamicSectors.value.length ? dynamicSectors.value : DEFAULT_SECTORS);
const roleLabel = computed(() => Object.fromEntries(activeRoles.value.map(r => [r.value, r.label])));

const loadConfig = async () => {
  try {
    const snap = await getDoc(doc(db, 'config', 'organization'));
    if (snap.exists()) {
      const data = snap.data();
      if (data.roles?.length) dynamicRoles.value = data.roles;
      if (data.sectores?.length) dynamicSectors.value = data.sectores;
    }
  } catch (e) {
    console.error('Error cargando config:', e);
  }
};

const saveConfig = async () => {
  try {
    await setDoc(doc(db, 'config', 'organization'), {
      roles: dynamicRoles.value,
      sectores: dynamicSectors.value
    }, { merge: true });
    Swal.fire({ icon: 'success', title: 'Config guardada', timer: 1000, showConfirmButton: false, toast: true, position: 'top-end' });
  } catch (e) {
    Swal.fire('Error', 'No se pudo guardar la configuración', 'error');
  }
};

const addRole = () => {
  const v = newRoleValue.value.trim().toLowerCase().replace(/\s+/g, '_');
  const l = newRoleLabel.value.trim();
  if (!v || !l) return;
  if (dynamicRoles.value.some(r => r.value === v)) return;
  dynamicRoles.value.push({ value: v, label: l });
  newRoleValue.value = '';
  newRoleLabel.value = '';
  saveConfig();
};

const removeRole = (idx) => {
  dynamicRoles.value.splice(idx, 1);
  saveConfig();
};

const addSector = () => {
  const s = newSector.value.trim().toUpperCase();
  if (!s || dynamicSectors.value.includes(s)) return;
  dynamicSectors.value.push(s);
  newSector.value = '';
  saveConfig();
};

const removeSector = (idx) => {
  dynamicSectors.value.splice(idx, 1);
  saveConfig();
};

const seedDefaults = () => {
  if (!dynamicRoles.value.length) dynamicRoles.value = [...DEFAULT_ROLES];
  if (!dynamicSectors.value.length) dynamicSectors.value = [...DEFAULT_SECTORS];
  saveConfig();
};

// ── Profile Editor ──
const expandedProfile = ref(null);
const editableProfiles = ref({});

const editableRoleList = computed(() => activeRoles.value.filter(r => r.value !== 'admin'));

const initEditableProfiles = () => {
  const profiles = {};
  for (const role of activeRoles.value) {
    if (role.value === 'admin') continue;
    const override = profileOverrides.value[role.value];
    const defaults = ROLE_PROFILES[role.value];
    profiles[role.value] = {
      descripcion: override?.descripcion ?? defaults?.descripcion ?? '',
      nivel: override?.nivel ?? defaults?.nivel ?? 'operativo',
      sectorDefault: override?.sectorDefault ?? ROLE_SECTOR_DEFAULT[role.value] ?? DEFAULT_SECTOR,
      vistas: override?.vistas ? [...override.vistas] : (defaults?.vistas ? [...defaults.vistas] : []),
      permisos: override?.permisos ? { ...override.permisos } : (defaults?.permisos ? { ...defaults.permisos } : {}),
    };
  }
  editableProfiles.value = profiles;
};

const toggleProfileExpand = (role) => {
  expandedProfile.value = expandedProfile.value === role ? null : role;
};

const updateProfileField = (role, field, value) => {
  if (!editableProfiles.value[role]) return;
  editableProfiles.value[role][field] = value;
  saveProfileChanges();
};

const toggleVista = (role, slug) => {
  const vistas = editableProfiles.value[role].vistas;
  const idx = vistas.indexOf(slug);
  if (idx >= 0) vistas.splice(idx, 1);
  else vistas.push(slug);
  saveProfileChanges();
};

const togglePermiso = (role, perm) => {
  editableProfiles.value[role].permisos[perm] = !editableProfiles.value[role].permisos[perm];
  saveProfileChanges();
};

const saveProfileChanges = async () => {
  try {
    await saveProfiles(JSON.parse(JSON.stringify(editableProfiles.value)));
    Swal.fire({ icon: 'success', title: 'Perfil actualizado', timer: 800, showConfirmButton: false, toast: true, position: 'top-end' });
  } catch (e) {
    Swal.fire('Error', 'No se pudo guardar el perfil', 'error');
  }
};

const addRoleFromPerfiles = async () => {
  const { value: formValues } = await Swal.fire({
    title: '➕ Nuevo Perfil de Rol',
    html:
      '<input id="swal-role-label" class="swal2-input" placeholder="Nombre visible (ej: Supervisor Hilado)">' +
      '<input id="swal-role-id" class="swal2-input" placeholder="ID técnico (auto-generado)" style="font-family:monospace">',
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: 'Crear Perfil',
    cancelButtonText: 'Cancelar',
    preConfirm: () => {
      const label = document.getElementById('swal-role-label').value.trim();
      const rawId = document.getElementById('swal-role-id').value.trim();
      const id = rawId ? rawId.toLowerCase().replace(/\s+/g, '_') : label.toLowerCase().replace(/\s+/g, '_');
      if (!label) { Swal.showValidationMessage('El nombre es obligatorio'); return false; }
      if (activeRoles.value.some(r => r.value === id)) { Swal.showValidationMessage('Ya existe un rol con ese ID'); return false; }
      return { id, label };
    }
  });
  if (!formValues) return;
  
  // 1. Agregar a dynamicRoles y persistir config
  dynamicRoles.value.push({ value: formValues.id, label: formValues.label });
  await saveConfig();
  
  // 2. Crear perfil editable con defaults
  editableProfiles.value[formValues.id] = {
    descripcion: '',
    nivel: 'operativo',
    sectorDefault: DEFAULT_SECTOR,
    vistas: [],
    permisos: { verCalidad: false, crearFalla: false, cerrarOrden: false, configSistema: false },
  };
  await saveProfileChanges();
  
  // 3. Cambiar a modo editor y expandir
  perfilesViewMode.value = 'editor';
  expandedProfile.value = formValues.id;
};

// ── Vistas Personalizadas por Usuario ──
const expandedVistaUser = ref(null);

const toggleVistaUserExpand = (userId) => {
  expandedVistaUser.value = expandedVistaUser.value === userId ? null : userId;
};

const enableCustomVistas = (user) => {
  user.vistasPersonalizadas = [...getEffectiveVistas(user.role)];
  user.permisosPersonalizados = { ...getEffectivePermisos(user.role) };
};

const disableCustomVistas = (user) => {
  user.vistasPersonalizadas = null;
  user.permisosPersonalizados = null;
};

const toggleUserVista = (user, slug) => {
  if (!Array.isArray(user.vistasPersonalizadas)) enableCustomVistas(user);
  const idx = user.vistasPersonalizadas.indexOf(slug);
  if (idx >= 0) user.vistasPersonalizadas.splice(idx, 1);
  else user.vistasPersonalizadas.push(slug);
};

const toggleUserPermiso = (user, key) => {
  if (!user.permisosPersonalizados) enableCustomVistas(user);
  user.permisosPersonalizados[key] = !user.permisosPersonalizados[key];
};

// ── Usuarios ──
const getRoleColor = (role) => {
  if (role === 'admin') return { bg: 'bg-amber-100', text: 'text-amber-700', badge: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (isJefeRole(role) || role === 'gerente_produccion') return { bg: 'bg-emerald-100', text: 'text-emerald-700', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (role?.startsWith('supervisor')) return { bg: 'bg-violet-100', text: 'text-violet-700', badge: 'bg-violet-50 text-violet-700 border-violet-200' };
  return { bg: 'bg-blue-100', text: 'text-blue-700', badge: 'bg-blue-50 text-blue-700 border-blue-200' };
};

const normalizarUsuario = (user) => {
  const role = user.role || 'mecanico';
  const sectorDefault = normalizeSectorValue(user.sectorDefault || DEFAULT_SECTOR);
  const sectoresAsignados = sanitizeSectorList(user.sectoresAsignados, sectorDefault);
  const jefeDeSectores = isJefeRole(role)
    ? sanitizeSectorList(user.jefeDeSectores?.length ? user.jefeDeSectores : [sectorDefault], sectorDefault)
    : [];

  return {
    ...user,
    role,
    nombre: user.nombre || '',
    apellido: user.apellido || '',
    alcance: role === 'admin' ? (user.alcance || 'global') : 'sector',
    sectorDefault,
    sectoresAsignados,
    jefeDeSectores,
    vistasPersonalizadas: Array.isArray(user.vistasPersonalizadas) ? user.vistasPersonalizadas : null,
    permisosPersonalizados: (user.permisosPersonalizados && typeof user.permisosPersonalizados === 'object') ? user.permisosPersonalizados : null,
  };
};

const cargarUsuarios = async () => {
  isLoading.value = true;
  try {
    const q = query(collection(db, 'usuarios'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    usuarios.value = snap.docs.map(d => normalizarUsuario({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error("Error cargando usuarios:", e);
    Swal.fire('Error', 'No se pudieron cargar los usuarios', 'error');
  } finally {
    isLoading.value = false;
  }
};

const filteredUsuarios = computed(() => {
  const s = searchQuery.value.toLowerCase();
  return usuarios.value.filter((u) => {
    const email = String(u.email || '').toLowerCase();
    const name = String(u.displayName || '').toLowerCase();
    const nombre = String(u.nombre || '').toLowerCase();
    const apellido = String(u.apellido || '').toLowerCase();
    
    const matchesSearch = email.includes(s) || name.includes(s) || nombre.includes(s) || apellido.includes(s);
    const matchesRole = !filterRole.value || u.role === filterRole.value;
    
    return matchesSearch && matchesRole;
  });
});

// ── Snapshot & Dirty State Helpers ──
const getUserSnapshot = (user) => {
  if (!user) return null;
  return {
    nombre: user.nombre || '',
    apellido: user.apellido || '',
    role: user.role,
    alcance: user.role === 'admin' ? (user.alcance || 'global') : 'sector',
    sectorDefault: user.sectorDefault || DEFAULT_SECTOR,
    sectoresAsignados: [...(user.sectoresAsignados || [])].sort(),
    jefeDeSectores: [...(user.jefeDeSectores || [])].sort(),
    vistasPersonalizadas: user.vistasPersonalizadas ? [...user.vistasPersonalizadas].sort() : null,
    permisosPersonalizados: user.permisosPersonalizados ? { ...user.permisosPersonalizados } : null,
  };
};

const isDirty = computed(() => {
  if (!selectedUser.value || !editSnapshot.value) return false;
  const currentSnap = getUserSnapshot(selectedUser.value);
  return JSON.stringify(currentSnap) !== editSnapshot.value;
});

const selectUser = (user) => {
  selectedUser.value = user;
  editSnapshot.value = JSON.stringify(getUserSnapshot(user));
  drawerOpen.value = true;
};

const discardChanges = () => {
  if (!selectedUser.value || !editSnapshot.value) return;
  const original = JSON.parse(editSnapshot.value);
  selectedUser.value.nombre = original.nombre;
  selectedUser.value.apellido = original.apellido;
  selectedUser.value.role = original.role;
  selectedUser.value.alcance = original.alcance;
  selectedUser.value.sectorDefault = original.sectorDefault;
  selectedUser.value.sectoresAsignados = [...original.sectoresAsignados];
  selectedUser.value.jefeDeSectores = [...original.jefeDeSectores];
  selectedUser.value.vistasPersonalizadas = original.vistasPersonalizadas ? [...original.vistasPersonalizadas] : null;
  selectedUser.value.permisosPersonalizados = original.permisosPersonalizados ? { ...original.permisosPersonalizados } : null;
  editSnapshot.value = JSON.stringify(getUserSnapshot(selectedUser.value));
};

const guardarConfiguracion = async (user) => {
  if (userRole.value !== 'admin') {
    Swal.fire('Acceso Denegado', 'Solo administradores pueden gestionar usuarios', 'warning');
    return;
  }

  const sectoresAsignados = sanitizeSectorList(user.sectoresAsignados, user.sectorDefault || DEFAULT_SECTOR);
  const jefeDeSectores = isJefeRole(user.role)
    ? sanitizeSectorList(user.jefeDeSectores, user.sectorDefault || DEFAULT_SECTOR)
    : [];

  const payload = {
    nombre: user.nombre || '',
    apellido: user.apellido || '',
    role: user.role,
    alcance: user.role === 'admin' ? (user.alcance || 'global') : 'sector',
    sectorDefault: normalizeSectorValue(user.sectorDefault || DEFAULT_SECTOR),
    sectoresAsignados,
    jefeDeSectores,
    vistasPersonalizadas: Array.isArray(user.vistasPersonalizadas) ? user.vistasPersonalizadas : null,
    permisosPersonalizados: (user.permisosPersonalizados && typeof user.permisosPersonalizados === 'object') ? user.permisosPersonalizados : null,
  };

  try {
    await updateDoc(doc(db, 'usuarios', user.id), payload);
    Object.assign(user, payload);
    editSnapshot.value = JSON.stringify(getUserSnapshot(user));
    Swal.fire({ icon: 'success', title: 'Guardado', text: 'Configuración actualizada', timer: 1200, showConfirmButton: false, toast: true, position: 'top-end' });
  } catch (e) {
    Swal.fire('Error', 'No se pudo actualizar el usuario', 'error');
  }
};

onMounted(async () => {
  await loadConfig();
  await loadProfiles();
  initEditableProfiles();
  await cargarUsuarios();
});
</script>

<template>
  <div class="h-full bg-gray-50 flex flex-col overflow-hidden">
    <!-- Header / Navigation -->
    <header class="bg-white border-b border-gray-200 px-4 py-2 shrink-0 shadow-xs">
      <div class="max-w-[1800px] w-full mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <!-- Compact Title -->
        <div class="flex items-center gap-2">
          <div class="bg-indigo-600 p-1.5 rounded-lg text-white shadow-sm shadow-indigo-100">
            <Users class="w-4 h-4" />
          </div>
          <h1 class="text-sm font-black text-gray-800 tracking-tight leading-none hidden sm:block">Gestión de Usuarios</h1>
        </div>

        <!-- Segmented Tab Bar Control -->
        <div class="flex bg-gray-100 p-0.5 rounded-xl border border-gray-200 shrink-0 self-start sm:self-center">
          <button 
            @click="activeTab = 'usuarios'"
            :class="activeTab === 'usuarios' ? 'bg-white text-indigo-700 shadow-xs' : 'text-gray-500 hover:text-gray-800'"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
          >
            <User class="w-3.5 h-3.5" />
            <span>Usuarios</span>
            <span class="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded-md text-[9px] font-black" :class="{'bg-indigo-50 text-indigo-600': activeTab === 'usuarios'}">
              {{ filteredUsuarios.length }}
            </span>
          </button>
          <button 
            @click="activeTab = 'perfiles'"
            :class="activeTab === 'perfiles' ? 'bg-white text-indigo-700 shadow-xs' : 'text-gray-500 hover:text-gray-800'"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
          >
            <Shield class="w-3.5 h-3.5" />
            <span>Perfiles de Rol</span>
          </button>
          <button 
            @click="activeTab = 'config'"
            :class="activeTab === 'config' ? 'bg-white text-indigo-700 shadow-xs' : 'text-gray-500 hover:text-gray-800'"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
          >
            <Settings class="w-3.5 h-3.5" />
            <span>Configuración</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Main Workspace -->
    <main class="flex-1 max-w-[1800px] w-full mx-auto p-4 overflow-hidden min-h-0">
      
      <!-- LOADING STATE -->
      <div v-if="isLoading" class="h-full flex flex-col items-center justify-center text-gray-400">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-3"></div>
        <p class="font-bold text-xs tracking-widest uppercase">Cargando datos...</p>
      </div>

      <!-- TABS CONTENTS -->
      <div v-else class="h-full flex flex-col min-h-0">
        
        <!-- ── TAB 1: USUARIOS (MASTER-DETAIL) ── -->
        <div v-if="activeTab === 'usuarios'" class="h-full flex gap-5 min-h-0">
          
          <!-- MASTER PANEL (List View) -->
          <div class="w-full lg:w-[350px] shrink-0 bg-white border border-gray-200 rounded-2xl shadow-xs flex flex-col overflow-hidden min-h-0">
            <!-- Search & Filters Header -->
            <div class="p-3.5 border-b border-gray-100 space-y-2.5 shrink-0 bg-gray-50/50">
              <div class="relative">
                <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="Buscar nombre o email..."
                  class="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all font-medium"
                />
                <button 
                  v-if="searchQuery" 
                  @click="searchQuery = ''" 
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X class="w-3 h-3" />
                </button>
              </div>

              <!-- Filter by Role -->
              <div class="flex items-center gap-1.5">
                <Filter class="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <select
                  v-model="filterRole"
                  class="flex-1 bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-gray-600 outline-none focus:ring-1 focus:ring-indigo-500/20 transition-all"
                >
                  <option value="">Todos los Roles</option>
                  <option v-for="r in activeRoles" :key="r.value" :value="r.value">{{ r.label }}</option>
                </select>
              </div>
            </div>

            <!-- List scroll area -->
            <div class="flex-1 overflow-y-auto divide-y divide-gray-50 p-2 space-y-1">
              <div
                v-for="user in filteredUsuarios"
                :key="user.id"
                @click="selectUser(user)"
                :class="[
                  selectedUser?.id === user.id 
                    ? 'bg-indigo-50/55 border-indigo-200 shadow-2xs' 
                    : 'hover:bg-gray-50 border-transparent'
                ]"
                class="flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all"
              >
                <!-- Avatar & Shield Badge -->
                <div :class="[getRoleColor(user.role).bg, getRoleColor(user.role).text]" class="w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-2xs font-black text-xs">
                  <ShieldCheck v-if="user.role === 'admin'" class="w-4.5 h-4.5" />
                  <UserCog v-else-if="isJefeRole(user.role) || user.role === 'gerente_produccion'" class="w-4.5 h-4.5" />
                  <span v-else>{{ (user.nombre || user.displayName || 'U').substring(0,2).toUpperCase() }}</span>
                </div>

                <!-- Identity text -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-1">
                    <p class="text-xs font-black text-gray-800 truncate">{{ user.nombre && user.apellido ? `${user.nombre} ${user.apellido}` : (user.displayName || 'Sin nombre') }}</p>
                    <!-- Indicator dot for dirty state on this user -->
                    <span 
                      v-if="selectedUser?.id === user.id && isDirty"
                      class="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0"
                      title="Tiene cambios sin guardar"
                    ></span>
                  </div>
                  <p class="text-[10px] text-gray-400 font-medium truncate mt-0.5">{{ user.email }}</p>
                  
                  <!-- Badges info -->
                  <div class="flex items-center gap-1.5 mt-1">
                    <span :class="getRoleColor(user.role).badge" class="px-1.5 py-0.5 text-[9px] font-black rounded-md border shrink-0">
                      {{ roleLabel[user.role] || user.role }}
                    </span>
                    <span class="px-1.5 py-0.5 bg-gray-100 text-gray-600 border border-gray-200 text-[9px] font-black rounded-md shrink-0 uppercase">
                      {{ user.sectorDefault }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Empty Results -->
              <div v-if="filteredUsuarios.length === 0" class="py-12 px-4 text-center text-gray-400">
                <Users class="w-8 h-8 mx-auto text-gray-300 mb-2" />
                <p class="text-xs font-bold">No se encontraron usuarios</p>
                <p class="text-[10px] text-gray-400 mt-1">Probá con otro término de búsqueda</p>
              </div>
            </div>
          </div>

          <!-- DETAIL PANEL (Desktop View) -->
          <div class="hidden lg:flex flex-1 bg-white border border-gray-200 rounded-2xl shadow-xs flex-col overflow-hidden min-h-0">
            <!-- Empty state right side -->
            <div v-if="!selectedUser" class="flex-1 flex flex-col items-center justify-center p-8 text-center text-gray-400">
              <div class="bg-gray-50 p-4 rounded-full border border-gray-100 mb-3">
                <UserCog class="w-10 h-10 text-gray-300" />
              </div>
              <h3 class="text-sm font-black text-gray-700">Seleccioná un usuario</h3>
              <p class="text-xs text-gray-400 max-w-xs mt-1.5 leading-relaxed">
                Elegí un miembro del equipo de la lista de la izquierda para configurar su función, permisos y vistas habilitadas.
              </p>
            </div>

            <!-- Full Editor details -->
            <div v-else class="flex-1 flex flex-col overflow-hidden min-h-0">
              <!-- Detail Header -->
              <div class="px-5 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between shrink-0">
                <div class="flex items-center gap-3 min-w-0">
                  <div :class="[getRoleColor(selectedUser.role).bg, getRoleColor(selectedUser.role).text]" class="w-11 h-11 rounded-full flex items-center justify-center shrink-0 shadow-sm font-black text-sm">
                    <ShieldCheck v-if="selectedUser.role === 'admin'" class="w-5.5 h-5.5" />
                    <UserCog v-else-if="isJefeRole(selectedUser.role) || selectedUser.role === 'gerente_produccion'" class="w-5.5 h-5.5" />
                    <span v-else>{{ (selectedUser.nombre || 'U').substring(0,2).toUpperCase() }}</span>
                  </div>
                  <div class="min-w-0">
                    <h3 class="text-sm font-black text-gray-800 truncate leading-none">
                      {{ selectedUser.nombre && selectedUser.apellido ? `${selectedUser.nombre} ${selectedUser.apellido}` : (selectedUser.displayName || 'Sin nombre') }}
                    </h3>
                    <p class="text-xs text-gray-500 font-medium truncate mt-1 flex items-center gap-1.5">
                      <Mail class="w-3 h-3 text-gray-400" />
                      {{ selectedUser.email }}
                    </p>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <span class="px-2.5 py-1 bg-white border border-gray-200 text-gray-500 rounded-xl text-[10px] font-black flex items-center gap-1">
                    <Calendar class="w-3.5 h-3.5 text-gray-400" />
                    {{ selectedUser.createdAt?.toDate ? selectedUser.createdAt.toDate().toLocaleDateString() : '---' }}
                  </span>
                </div>
              </div>

              <!-- Detail Scrollable form -->
              <div class="flex-1 overflow-y-auto p-5 space-y-5">
                
                <!-- Section: Identidad -->
                <div class="space-y-3">
                  <h4 class="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Información Personal</h4>
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider block mb-1">Nombre</label>
                      <input
                        v-model="selectedUser.nombre"
                        type="text"
                        placeholder="Nombre"
                        class="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-400 focus:bg-white transition-all"
                      />
                    </div>
                    <div>
                      <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider block mb-1">Apellido</label>
                      <input
                        v-model="selectedUser.apellido"
                        type="text"
                        placeholder="Apellido"
                        class="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-400 focus:bg-white transition-all"
                      />
                    </div>
                  </div>
                </div>

                <!-- Section: Rol y Sector -->
                <div class="border-t border-gray-100 pt-4 space-y-3">
                  <h4 class="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Rol & Sector Organizacional</h4>
                  
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider block mb-1">Función del Cargo</label>
                      <select
                        v-model="selectedUser.role"
                        class="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-400 focus:bg-white transition-all"
                      >
                        <option v-for="r in activeRoles" :key="r.value" :value="r.value">{{ r.label }}</option>
                      </select>
                    </div>

                    <div>
                      <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider block mb-1">Sector Principal</label>
                      <select
                        v-model="selectedUser.sectorDefault"
                        class="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-400 focus:bg-white transition-all"
                      >
                        <option v-for="s in activeSectors" :key="s" :value="s">{{ s }}</option>
                      </select>
                    </div>
                  </div>

                  <!-- Role Profile Description Card -->
                  <div
                    v-if="ROLE_PROFILES[selectedUser.role]"
                    class="rounded-xl border p-3 space-y-2.5 transition-all text-left"
                    :class="{
                      'bg-blue-50/50 border-blue-100 text-blue-900':   ROLE_PROFILES[selectedUser.role].nivel === 'operativo',
                      'bg-violet-50/50 border-violet-100 text-violet-900': ROLE_PROFILES[selectedUser.role].nivel === 'mandos',
                      'bg-emerald-50/50 border-emerald-100 text-emerald-900': ROLE_PROFILES[selectedUser.role].nivel === 'estrategico',
                      'bg-amber-50/50 border-amber-100 text-amber-900':   ROLE_PROFILES[selectedUser.role].nivel === 'global',
                    }"
                  >
                    <div class="flex items-center gap-2">
                      <span
                        class="px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider rounded"
                        :class="{
                          'bg-blue-100 text-blue-700':     ROLE_PROFILES[selectedUser.role].nivel === 'operativo',
                          'bg-violet-100 text-violet-700': ROLE_PROFILES[selectedUser.role].nivel === 'mandos',
                          'bg-emerald-100 text-emerald-700': ROLE_PROFILES[selectedUser.role].nivel === 'estrategico',
                          'bg-amber-100 text-amber-700':   ROLE_PROFILES[selectedUser.role].nivel === 'global',
                        }"
                      >
                        Nivel {{ NIVEL_CONFIG[ROLE_PROFILES[selectedUser.role].nivel]?.label || 'Operativo' }}
                      </span>
                    </div>
                    <p class="text-[10px] text-gray-500 font-medium leading-relaxed">
                      {{ ROLE_PROFILES[selectedUser.role].descripcion }}
                    </p>
                  </div>
                </div>

                <!-- Section: Autorizaciones y Alcance -->
                <div class="border-t border-gray-100 pt-4 space-y-4">
                  <h4 class="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Sectores Autorizados & Alcance</h4>
                  
                  <!-- Sectores Asignados Checkboxes -->
                  <div class="space-y-1.5">
                    <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider block">Sectores Autorizados (Acceso a Pantallas)</label>
                    <div class="flex flex-wrap gap-2.5">
                      <label v-for="s in activeSectors" :key="s" class="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors select-none">
                        <input
                          type="checkbox"
                          :value="s"
                          v-model="selectedUser.sectoresAsignados"
                          class="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30 cursor-pointer"
                        />
                        <span class="text-xs font-bold text-gray-700">{{ s }}</span>
                      </label>
                    </div>
                  </div>

                  <!-- Jefe de Sectores Checkboxes -->
                  <div v-if="isJefeRole(selectedUser.role)" class="bg-emerald-50/30 rounded-xl p-3 border border-emerald-100/70 space-y-2">
                    <label class="text-[10px] font-black text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                      <Building2 class="w-3.5 h-3.5" />
                      Jefe de Sectores (Responsabilidad Directa)
                    </label>
                    <div class="flex flex-wrap gap-2.5">
                      <label v-for="s in activeSectors" :key="s" class="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-emerald-100 rounded-xl cursor-pointer hover:bg-emerald-50 transition-colors select-none">
                        <input
                          type="checkbox"
                          :value="s"
                          v-model="selectedUser.jefeDeSectores"
                          class="w-3.5 h-3.5 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500/30 cursor-pointer"
                        />
                        <span class="text-xs font-bold text-emerald-800">{{ s }}</span>
                      </label>
                    </div>
                  </div>

                  <!-- Alcance Admin Select -->
                  <div v-if="selectedUser.role === 'admin'" class="bg-amber-50/30 rounded-xl p-3 border border-amber-100/75 space-y-1.5">
                    <label class="text-[10px] font-black text-amber-700 uppercase tracking-wider block">Alcance Administrativo</label>
                    <select
                      v-model="selectedUser.alcance"
                      class="w-full bg-white border border-amber-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-amber-800 outline-none focus:ring-2 focus:ring-amber-500/20 transition-all"
                    >
                      <option value="global">Administrador global (Todo el sistema)</option>
                      <option value="sector">Administrador sectorizado (Filtro por Sector Principal)</option>
                    </select>
                  </div>
                </div>

                <!-- Section: Vistas y Permisos Personalizados -->
                <div class="border-t border-gray-100 pt-4">
                  <div class="rounded-xl border overflow-hidden transition-all" :class="selectedUser.vistasPersonalizadas ? 'border-indigo-200 bg-indigo-50/15' : 'border-gray-200'">
                    <!-- Header -->
                    <div 
                      class="flex items-center justify-between px-3 py-2.5 transition-colors border-b"
                      :class="selectedUser.vistasPersonalizadas ? 'bg-indigo-50/30 border-indigo-100' : 'bg-gray-50 border-gray-100'"
                    >
                      <div class="flex items-center gap-2">
                        <Eye class="w-4 h-4" :class="selectedUser.vistasPersonalizadas ? 'text-indigo-600' : 'text-gray-400'" />
                        <span class="text-[10px] font-black uppercase tracking-wider" :class="selectedUser.vistasPersonalizadas ? 'text-indigo-700' : 'text-gray-600'">Acceso Personalizado</span>
                        <span v-if="selectedUser.vistasPersonalizadas" class="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-[8px] font-black rounded-md">
                          Activo · {{ selectedUser.vistasPersonalizadas.length }} vistas
                        </span>
                      </div>
                      
                      <!-- iOS style Switch Toggle -->
                      <button
                        @click="selectedUser.vistasPersonalizadas ? disableCustomVistas(selectedUser) : enableCustomVistas(selectedUser)"
                        class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none cursor-pointer"
                        :class="selectedUser.vistasPersonalizadas ? 'bg-indigo-600' : 'bg-gray-300'"
                      >
                        <span
                          class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transform transition-transform"
                          :class="selectedUser.vistasPersonalizadas ? 'translate-x-4.5' : 'translate-x-0.5'"
                        />
                      </button>
                    </div>

                    <!-- Body -->
                    <div class="p-3.5 space-y-4">
                      <p class="text-[10px] text-gray-400 font-medium leading-relaxed">
                        {{ selectedUser.vistasPersonalizadas 
                            ? 'Este usuario posee una configuración personalizada que sobreescribe los permisos predefinidos para su rol.' 
                            : 'El usuario utiliza las vistas y permisos estándar definidos para su función.' }}
                      </p>

                      <!-- Custom lists (If customized) -->
                      <template v-if="selectedUser.vistasPersonalizadas">
                        <div class="space-y-1.5">
                          <span class="text-[9px] font-black text-gray-400 uppercase tracking-wider block">Vistas Habilitadas</span>
                          <div class="grid grid-cols-2 gap-2">
                            <label
                              v-for="vista in VISTA_OPTIONS"
                              :key="vista.slug"
                              class="flex items-center gap-2 p-1.5 border border-gray-100 rounded-lg hover:bg-white cursor-pointer select-none transition-colors"
                            >
                              <input
                                type="checkbox"
                                :checked="selectedUser.vistasPersonalizadas.includes(vista.slug)"
                                @change="toggleUserVista(selectedUser, vista.slug)"
                                class="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30 cursor-pointer"
                              />
                              <span class="text-[10px] font-bold text-gray-600 truncate">{{ vista.label }}</span>
                            </label>
                          </div>
                        </div>

                        <div class="space-y-1.5 pt-2">
                          <span class="text-[9px] font-black text-gray-400 uppercase tracking-wider block">Permisos Especiales</span>
                          <div class="grid grid-cols-2 gap-2">
                            <label
                              v-for="(label, key) in PERMISO_LABELS"
                              :key="key"
                              class="flex items-center gap-2 p-1.5 border border-gray-100 rounded-lg hover:bg-white cursor-pointer select-none transition-colors"
                            >
                              <input
                                type="checkbox"
                                :checked="selectedUser.permisosPersonalizados?.[key]"
                                @change="toggleUserPermiso(selectedUser, key)"
                                class="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30 cursor-pointer"
                              />
                              <span class="text-[10px] font-bold text-gray-600 truncate">{{ label }}</span>
                            </label>
                          </div>
                        </div>
                      </template>

                      <!-- Non-customized list (read-only view) -->
                      <div v-else class="space-y-2.5">
                        <div>
                          <span class="text-[9px] font-black text-gray-400 uppercase tracking-wider block">Vistas predefinidas del Rol</span>
                          <div class="flex flex-wrap gap-1 mt-1">
                            <span
                              v-for="v in getEffectiveVistas(selectedUser.role)"
                              :key="v"
                              class="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-[9px] font-bold text-gray-500"
                            >{{ VISTA_LABEL[v] || v }}</span>
                          </div>
                        </div>
                        
                        <div>
                          <span class="text-[9px] font-black text-gray-400 uppercase tracking-wider block">Permisos asignados del Rol</span>
                          <div class="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                            <span v-for="(val, key) in getEffectivePermisos(selectedUser.role)" :key="key" class="inline-flex items-center gap-1 text-[10px] font-bold">
                              <span :class="val ? 'text-green-500' : 'text-gray-300'">{{ val ? '✓' : '✗' }}</span>
                              <span :class="val ? 'text-gray-600' : 'text-gray-400'">{{ PERMISO_LABELS[key] || key }}</span>
                            </span>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>

              </div>

              <!-- Detail Footer with Sticky Actions -->
              <div class="px-5 py-3.5 border-t border-gray-100 bg-gray-50 flex items-center justify-between shrink-0">
                <!-- Unsaved alert indicator -->
                <div class="flex items-center gap-2 text-xs">
                  <div v-if="isDirty" class="flex items-center gap-1.5 text-amber-600 font-bold">
                    <AlertCircle class="w-4 h-4 text-amber-500 shrink-0" />
                    <span>Cambios sin guardar</span>
                  </div>
                  <div v-else class="flex items-center gap-1.5 text-gray-400 font-medium">
                    <Check class="w-4 h-4 text-green-500 shrink-0" />
                    <span>Datos al día</span>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <!-- Discard button -->
                  <button
                    v-if="isDirty"
                    @click="discardChanges"
                    class="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 hover:bg-gray-100 rounded-xl text-gray-500 text-xs font-bold transition-all cursor-pointer"
                  >
                    <Undo2 class="w-3.5 h-3.5" />
                    Descartar
                  </button>

                  <!-- Save Button -->
                  <button
                    @click="guardarConfiguracion(selectedUser)"
                    :disabled="!isDirty"
                    :class="isDirty ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer active:scale-97' : 'bg-gray-100 text-gray-400 cursor-not-allowed'"
                    class="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black tracking-wide shadow-xs transition-all"
                  >
                    <Save class="w-3.5 h-3.5" />
                    Guardar
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- MOBILE/TABLET DRAWER (Detail View on smaller screens) -->
          <Teleport to="body">
            <div v-if="drawerOpen && selectedUser" class="fixed inset-0 z-50 lg:hidden flex justify-end">
              <!-- Back-drop overlay -->
              <div 
                class="fixed inset-0 bg-black/45 backdrop-blur-xs transition-opacity duration-300 animate-fade-in"
                @click="drawerOpen = false"
              ></div>
              
              <!-- Drawer Content Pane -->
              <div class="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col z-10 animate-slide-in">
                <!-- Header -->
                <div class="px-4 py-3.5 border-b border-gray-150 flex items-center justify-between bg-gray-50 shrink-0">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <div :class="[getRoleColor(selectedUser.role).bg, getRoleColor(selectedUser.role).text]" class="w-8 h-8 rounded-full flex items-center justify-center font-black text-xs shrink-0">
                      {{ (selectedUser.nombre || 'U').substring(0,2).toUpperCase() }}
                    </div>
                    <div class="min-w-0">
                      <span class="text-xs font-black text-gray-800 truncate block">{{ selectedUser.nombre && selectedUser.apellido ? `${selectedUser.nombre} ${selectedUser.apellido}` : (selectedUser.displayName || 'Sin nombre') }}</span>
                      <span class="text-[10px] text-gray-400 font-medium truncate block">{{ selectedUser.email }}</span>
                    </div>
                  </div>
                  <button @click="drawerOpen = false" class="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer">
                    <X class="w-4 h-4" />
                  </button>
                </div>

                <!-- Form Inputs Body -->
                <div class="flex-1 overflow-y-auto p-4 space-y-4">
                  <!-- Identidad -->
                  <div class="space-y-2">
                    <span class="text-[9px] font-black text-indigo-600 uppercase tracking-wider block">Información Personal</span>
                    <div class="grid grid-cols-2 gap-2">
                      <input
                        v-model="selectedUser.nombre"
                        type="text"
                        placeholder="Nombre"
                        class="w-full bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-gray-700 outline-none focus:border-indigo-400 focus:bg-white"
                      />
                      <input
                        v-model="selectedUser.apellido"
                        type="text"
                        placeholder="Apellido"
                        class="w-full bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-gray-700 outline-none focus:border-indigo-400 focus:bg-white"
                      />
                    </div>
                  </div>

                  <!-- Rol y Sector -->
                  <div class="border-t border-gray-100 pt-3.5 space-y-2">
                    <span class="text-[9px] font-black text-indigo-600 uppercase tracking-wider block">Rol & Sector Principal</span>
                    <div class="grid grid-cols-2 gap-2">
                      <div>
                        <label class="text-[9px] text-gray-400 font-black uppercase mb-1 block">Función</label>
                        <select
                          v-model="selectedUser.role"
                          class="w-full bg-gray-50 border border-gray-200 rounded-xl px-2 py-1.5 text-xs font-bold text-gray-700 outline-none"
                        >
                          <option v-for="r in activeRoles" :key="r.value" :value="r.value">{{ r.label }}</option>
                        </select>
                      </div>
                      <div>
                        <label class="text-[9px] text-gray-400 font-black uppercase mb-1 block">Sector Principal</label>
                        <select
                          v-model="selectedUser.sectorDefault"
                          class="w-full bg-gray-50 border border-gray-200 rounded-xl px-2 py-1.5 text-xs font-bold text-gray-700 outline-none"
                        >
                          <option v-for="s in activeSectors" :key="s" :value="s">{{ s }}</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <!-- Sectores Autorizados checkboxes -->
                  <div class="border-t border-gray-100 pt-3.5 space-y-2">
                    <span class="text-[9px] font-black text-indigo-600 uppercase tracking-wider block">Sectores Autorizados</span>
                    <div class="flex flex-wrap gap-2">
                      <label v-for="s in activeSectors" :key="s" class="inline-flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer select-none">
                        <input
                          type="checkbox"
                          :value="s"
                          v-model="selectedUser.sectoresAsignados"
                          class="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600"
                        />
                        <span class="text-xs font-bold text-gray-700">{{ s }}</span>
                      </label>
                    </div>
                  </div>

                  <!-- Jefe de Sectores Checkboxes -->
                  <div v-if="isJefeRole(selectedUser.role)" class="bg-emerald-50/30 rounded-xl p-3 border border-emerald-100 space-y-2">
                    <label class="text-[9px] font-black text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                      <Building2 class="w-3.5 h-3.5" />
                      Jefe de Sectores
                    </label>
                    <div class="flex flex-wrap gap-2">
                      <label v-for="s in activeSectors" :key="s" class="inline-flex items-center gap-2 px-2.5 py-1.5 bg-white border border-emerald-150 rounded-xl cursor-pointer select-none">
                        <input
                          type="checkbox"
                          :value="s"
                          v-model="selectedUser.jefeDeSectores"
                          class="w-3.5 h-3.5 rounded border-emerald-300 text-emerald-600"
                        />
                        <span class="text-xs font-bold text-emerald-800">{{ s }}</span>
                      </label>
                    </div>
                  </div>

                  <!-- Alcance Admin Select -->
                  <div v-if="selectedUser.role === 'admin'" class="bg-amber-50/30 rounded-xl p-3 border border-amber-100 space-y-1.5">
                    <label class="text-[9px] font-black text-amber-700 uppercase tracking-wider block">Alcance Administrativo</label>
                    <select
                      v-model="selectedUser.alcance"
                      class="w-full bg-white border border-amber-200 rounded-xl px-2 py-1 text-xs font-bold text-amber-800 outline-none"
                    >
                      <option value="global">Administrador global</option>
                      <option value="sector">Administrador sectorizado</option>
                    </select>
                  </div>

                  <!-- Personalización del acceso -->
                  <div class="border-t border-gray-100 pt-3.5">
                    <div class="rounded-xl border overflow-hidden" :class="selectedUser.vistasPersonalizadas ? 'border-indigo-200 bg-indigo-50/15' : 'border-gray-200'">
                      <!-- Toggle Header -->
                      <div class="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-150">
                        <span class="text-[9px] font-black text-gray-700 uppercase">Acceso Personalizado</span>
                        <button
                          @click="selectedUser.vistasPersonalizadas ? disableCustomVistas(selectedUser) : enableCustomVistas(selectedUser)"
                          class="relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full transition-colors focus:outline-none cursor-pointer"
                          :class="selectedUser.vistasPersonalizadas ? 'bg-indigo-600' : 'bg-gray-300'"
                        >
                          <span
                            class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform"
                            :class="selectedUser.vistasPersonalizadas ? 'translate-x-4' : 'translate-x-0.5'"
                          />
                        </button>
                      </div>

                      <div class="p-3 space-y-3">
                        <template v-if="selectedUser.vistasPersonalizadas">
                          <!-- Vistas check -->
                          <div class="space-y-1">
                            <span class="text-[8px] font-black text-gray-400 uppercase tracking-wider block">Vistas Habilitadas</span>
                            <div class="flex flex-col gap-1">
                              <label v-for="vista in VISTA_OPTIONS" :key="vista.slug" class="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  :checked="selectedUser.vistasPersonalizadas.includes(vista.slug)"
                                  @change="toggleUserVista(selectedUser, vista.slug)"
                                  class="w-3.5 h-3.5 rounded text-indigo-600 border-gray-300"
                                />
                                <span class="text-[10px] font-bold text-gray-600">{{ vista.label }}</span>
                              </label>
                            </div>
                          </div>

                          <!-- Permisos check -->
                          <div class="space-y-1 pt-2">
                            <span class="text-[8px] font-black text-gray-400 uppercase tracking-wider block">Permisos</span>
                            <div class="flex flex-col gap-1">
                              <label v-for="(label, key) in PERMISO_LABELS" :key="key" class="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  :checked="selectedUser.permisosPersonalizados?.[key]"
                                  @change="toggleUserPermiso(selectedUser, key)"
                                  class="w-3.5 h-3.5 rounded text-indigo-600 border-gray-300"
                                />
                                <span class="text-[10px] font-bold text-gray-600">{{ label }}</span>
                              </label>
                            </div>
                          </div>
                        </template>

                        <div v-else class="text-[10px] font-medium text-gray-400">
                          Utilizando las vistas y permisos predefinidos para el rol: <span class="font-bold text-gray-500">{{ roleLabel[selectedUser.role] }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Footer with actions -->
                <div class="p-4 border-t border-gray-150 bg-gray-50 flex items-center justify-between gap-3 shrink-0">
                  <div class="flex items-center gap-1.5 text-[10px] font-bold">
                    <span v-if="isDirty" class="text-amber-600">Con cambios</span>
                    <span v-else class="text-gray-400">Sin cambios</span>
                  </div>

                  <div class="flex items-center gap-2">
                    <button
                      v-if="isDirty"
                      @click="discardChanges"
                      class="px-3 py-1.5 border border-gray-200 rounded-xl text-gray-500 text-xs font-bold transition-all cursor-pointer"
                    >
                      Descartar
                    </button>
                    <button
                      @click="guardarConfiguracion(selectedUser); drawerOpen = false"
                      :disabled="!isDirty"
                      :class="isDirty ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'"
                      class="flex items-center gap-1 px-4 py-2 rounded-xl text-xs font-black cursor-pointer"
                    >
                      <Save class="w-3.5 h-3.5 mr-1" />
                      Guardar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Teleport>

        </div>

        <!-- ── TAB 2: PERFILES DE ROL (ACCORDIONS & RESUMEN) ── -->
        <div v-else-if="activeTab === 'perfiles'" class="flex-1 overflow-y-auto space-y-5 mx-auto w-full p-4 bg-white rounded-2xl border border-gray-200 shadow-xs">
          
          <!-- Tab Title & Toggle -->
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-gray-100 pb-4 gap-4">
            <div>
              <h3 class="text-base font-black text-gray-800 flex items-center gap-2">
                <ShieldCheck class="w-5 h-5 text-indigo-600" />
                Perfiles de Rol — Vistas y Permisos Predeterminados
                <span class="px-2.5 py-1 bg-indigo-100 text-indigo-700 text-[10px] font-black rounded-full ml-1">{{ activeRoles.length }} roles</span>
              </h3>
              <p class="text-[11px] text-gray-400 font-medium mt-1">Configura las vistas y permisos iniciales de cada cargo y edita su metadata operativa.</p>
            </div>
            
            <!-- Selector de Vista -->
            <div class="flex items-center gap-3 self-start sm:self-center shrink-0">
              <button 
                @click="addRoleFromPerfiles"
                class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-black shadow-xs hover:shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Plus class="w-3.5 h-3.5" /> Nuevo Perfil
              </button>
              <div class="flex bg-gray-100 p-0.5 rounded-xl border border-gray-200">
                <button 
                @click="perfilesViewMode = 'resumen'"
                :class="perfilesViewMode === 'resumen' ? 'bg-white text-indigo-700 shadow-xs' : 'text-gray-500 hover:text-gray-800'"
                class="px-3.5 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1.5"
              >
                <LayoutGrid class="w-3.5 h-3.5" />
                Resumen
              </button>
              <button 
                @click="perfilesViewMode = 'editor'"
                :class="perfilesViewMode === 'editor' ? 'bg-white text-indigo-700 shadow-xs' : 'text-gray-500 hover:text-gray-800'"
                class="px-3.5 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Pencil class="w-3.5 h-3.5" />
                Editar
              </button>
            </div>
            </div>
          </div>

          <!-- MODO RESUMEN: Vista General Tabla / Cards -->
          <div v-if="perfilesViewMode === 'resumen'" class="space-y-6 animate-fade-in">
            <!-- Leyenda compacta -->
            <div class="flex flex-wrap items-center justify-between gap-3 bg-indigo-50/40 px-4 py-3 rounded-2xl border border-indigo-100/60 text-xs font-bold text-indigo-800 shrink-0">
              <div class="flex items-center gap-2">
                <AlertCircle class="w-4 h-4 text-indigo-600 shrink-0" />
                <span class="font-extrabold uppercase tracking-wider text-[10px]">Leyenda Permisos Especiales</span>
              </div>
              <div class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-indigo-700">
                <span><strong>VC</strong> = Ver Calidad</span>
                <span><strong>CF</strong> = Crear Falla</span>
                <span><strong>CO</strong> = Cerrar Orden</span>
                <span><strong>CS</strong> = Config. Sistema</span>
              </div>
            </div>

            <!-- Grilla/Tabla por cada nivel -->
            <div v-for="[nivelKey, nivelGroup] in rolesByNivel" :key="nivelKey" class="space-y-3">
              <!-- Separador nivel -->
              <div class="flex items-center gap-2.5 pt-2 px-3 py-2 rounded-xl"
                :class="{
                  'bg-blue-50/50':    nivelKey === 'operativo',
                  'bg-violet-50/50':  nivelKey === 'mandos',
                  'bg-emerald-50/50': nivelKey === 'estrategico',
                  'bg-amber-50/50':   nivelKey === 'global',
                }"
              >
                <span class="text-base font-extrabold">{{ NIVEL_CONFIG[nivelKey]?.emoji || '⚙️' }}</span>
                <h4 class="text-xs font-black uppercase tracking-wider text-gray-500">{{ NIVEL_CONFIG[nivelKey]?.label || nivelGroup.label }}</h4>
                <div class="flex-1 h-px bg-gray-100/70"></div>
              </div>

              <!-- Vista Desktop: Tabla -->
              <div class="hidden md:block overflow-x-auto border border-gray-150 rounded-2xl shadow-2xs bg-white">
                <table class="w-full text-left border-collapse">
                  <thead>
                    <tr class="bg-gray-50/75 text-[10px] font-black text-gray-400 uppercase border-b border-gray-150">
                      <th class="py-3 px-4">🏷️ Rol / Cargo</th>
                      <th class="py-3 px-4">📝 Descripción Funcional</th>
                      <th class="py-3 px-4 text-center">🏭 Sector Def.</th>
                      <th class="py-3 px-4 text-center">👁️ Vistas</th>
                      <th class="py-3 px-4 text-center">🔐 Permisos (VC · CF · CO · CS)</th>
                      <th class="py-3 px-4">🚪 Entrada</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100 text-xs">
                    <tr 
                      v-for="role in nivelGroup.roles" 
                      :key="role.value" 
                      class="hover:bg-gray-50/30 transition-colors border-l-3"
                      :class="{
                        'border-l-blue-400':    nivelKey === 'operativo',
                        'border-l-violet-400':  nivelKey === 'mandos',
                        'border-l-emerald-400': nivelKey === 'estrategico',
                        'border-l-amber-400':   nivelKey === 'global',
                      }"
                    >
                      <td class="py-3.5 px-4 font-black text-gray-800 whitespace-nowrap">
                        {{ role.label }}
                      </td>
                      <td v-if="role.descripcion" class="py-3.5 px-4 text-gray-600 font-medium max-w-xs truncate" :title="role.descripcion">
                        {{ role.descripcion }}
                      </td>
                      <td v-else class="py-3.5 px-4">
                        <span class="text-gray-350 italic text-[11px] flex items-center gap-1">
                          <Pencil class="w-3 h-3" /> Sin descripción — 
                          <button @click="perfilesViewMode = 'editor'; expandedProfile = role.value" class="text-indigo-500 hover:text-indigo-700 underline cursor-pointer">editar</button>
                        </span>
                      </td>
                      <td class="py-3.5 px-4 text-center">
                        <span class="px-2 py-0.5 bg-gray-100 border border-gray-200 rounded-lg text-[9px] font-black text-gray-600 uppercase">
                          {{ role.sectorDefault }}
                        </span>
                      </td>
                      <td class="py-3.5 px-4 text-center">
                        <span 
                          class="px-2 py-0.5 bg-indigo-50 border border-indigo-100 text-indigo-700 text-[10px] font-black rounded-lg cursor-help relative group"
                        >
                          {{ role.value === 'admin' ? '*' : role.effectiveVistas.length }}
                          <!-- Tooltip al hacer hover -->
                          <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-900 text-white text-[10px] font-medium p-2.5 rounded-xl shadow-xl z-20 whitespace-nowrap max-w-xs transition-all pointer-events-none">
                            <span class="block border-b border-gray-700 pb-1 mb-1 text-[8px] font-black text-indigo-400 uppercase">Pantallas Habilitadas</span>
                            <span v-if="role.value === 'admin'" class="block">Todas las vistas (*)</span>
                            <span v-else-if="role.effectiveVistas.length === 0" class="block text-gray-400">Ninguna</span>
                            <span v-else v-for="v in role.effectiveVistas" :key="v" class="block text-left">
                              · {{ VISTA_LABEL[v] || v }}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td class="py-3.5 px-4 text-center font-bold text-xs select-none">
                        <div class="flex items-center justify-center gap-2">
                          <span 
                            class="px-1.5 py-0.5 rounded text-[9px] font-black border"
                            :class="role.effectivePermisos.verCalidad ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-400 border-gray-200 opacity-60'"
                          >VC</span>
                          <span 
                            class="px-1.5 py-0.5 rounded text-[9px] font-black border"
                            :class="role.effectivePermisos.crearFalla ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-400 border-gray-200 opacity-60'"
                          >CF</span>
                          <span 
                            class="px-1.5 py-0.5 rounded text-[9px] font-black border"
                            :class="role.effectivePermisos.cerrarOrden ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-400 border-gray-200 opacity-60'"
                          >CO</span>
                          <span 
                            class="px-1.5 py-0.5 rounded text-[9px] font-black border"
                            :class="role.effectivePermisos.configSistema ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-400 border-gray-200 opacity-60'"
                          >CS</span>
                        </div>
                      </td>
                      <td class="py-3.5 px-4 text-gray-500 font-mono text-[11px] font-bold">
                        {{ role.defaultRoute }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- Vista Mobile: Grid de Tarjetas -->
              <div class="grid grid-cols-1 gap-3 md:hidden">
                <div 
                  v-for="role in nivelGroup.roles" 
                  :key="role.value"
                  class="bg-gray-50/50 border border-gray-150 rounded-2xl p-4 space-y-3"
                >
                  <div class="flex items-center justify-between">
                    <span class="font-extrabold text-sm text-gray-800">{{ role.label }}</span>
                    <span class="px-2 py-0.5 bg-white border border-gray-200 rounded-lg text-[9px] font-black text-gray-600 uppercase">
                      🏭 {{ role.sectorDefault }}
                    </span>
                  </div>

                  <p class="text-xs text-gray-500 font-medium leading-relaxed">
                    {{ role.descripcion || 'Sin descripción asignada' }}
                  </p>

                  <div class="flex flex-wrap gap-2 text-[10px] font-bold">
                    <span class="px-2.5 py-1 bg-indigo-50 border border-indigo-100 rounded-xl text-indigo-700">
                      👁️ {{ role.value === 'admin' ? '*' : role.effectiveVistas.length }} vistas
                    </span>
                    <span class="px-2.5 py-1 bg-gray-100 border border-gray-200 rounded-xl text-gray-600 font-mono">
                      🚪 {{ role.defaultRoute }}
                    </span>
                  </div>

                  <!-- Permisos móviles -->
                  <div class="border-t border-gray-100 pt-2.5 flex gap-1.5">
                    <span 
                      class="px-1.5 py-0.5 rounded text-[8px] font-black border"
                      :class="role.effectivePermisos.verCalidad ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-400 border-gray-150'"
                    >VC</span>
                    <span 
                      class="px-1.5 py-0.5 rounded text-[8px] font-black border"
                      :class="role.effectivePermisos.crearFalla ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-400 border-gray-150'"
                    >CF</span>
                    <span 
                      class="px-1.5 py-0.5 rounded text-[8px] font-black border"
                      :class="role.effectivePermisos.cerrarOrden ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-400 border-gray-150'"
                    >CO</span>
                    <span 
                      class="px-1.5 py-0.5 rounded text-[8px] font-black border"
                      :class="role.effectivePermisos.configSistema ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-400 border-gray-150'"
                    >CS</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- MODO EDITOR: Accordion de Configuración -->
          <div v-else class="space-y-3 animate-fade-in">
            <div 
              v-for="role in editableRoleList" 
              :key="role.value" 
              class="border rounded-2xl overflow-hidden shadow-3xs transition-all duration-200"
              :class="expandedProfile === role.value ? 'border-indigo-300 bg-white ring-1 ring-indigo-100/50' : 'border-gray-200 bg-gray-50/20 hover:bg-gray-50/50'"
            >
              <!-- Cabecera del Accordion -->
              <button 
                @click="toggleProfileExpand(role.value)" 
                class="w-full flex flex-col sm:flex-row sm:items-center justify-between px-5 py-4 text-left cursor-pointer gap-2"
              >
                <div class="flex items-center gap-3">
                  <span class="text-base leading-none">
                    {{ NIVEL_CONFIG[editableProfiles[role.value]?.nivel]?.emoji || '🔧' }}
                  </span>
                  <div class="min-w-0">
                    <span class="text-xs font-black text-gray-800 block sm:inline-block mr-2">{{ role.label }}</span>
                    <span
                      v-if="editableProfiles[role.value]?.nivel"
                      class="inline-block px-2 py-0.5 text-[8px] font-black uppercase rounded-md tracking-wider"
                      :class="{
                        'bg-blue-50 text-blue-600 border border-blue-200':     editableProfiles[role.value].nivel === 'operativo',
                        'bg-violet-50 text-violet-600 border border-violet-200': editableProfiles[role.value].nivel === 'mandos',
                        'bg-emerald-50 text-emerald-600 border border-emerald-200': editableProfiles[role.value].nivel === 'estrategico',
                      }"
                    >
                      {{ NIVEL_CONFIG[editableProfiles[role.value].nivel]?.label }}
                    </span>
                  </div>
                </div>

                <div class="flex items-center gap-3 self-end sm:self-center shrink-0">
                  <span class="text-[10px] text-gray-400 font-bold bg-white border border-gray-150 px-2 py-0.5 rounded-lg">
                    {{ (editableProfiles[role.value]?.vistas || []).length }} vistas
                  </span>
                  <ChevronUp v-if="expandedProfile === role.value" class="w-4 h-4 text-indigo-500" />
                  <ChevronDown v-else class="w-4 h-4 text-gray-400" />
                </div>
              </button>
              
              <!-- Cuerpo Expandido -->
              <div v-if="expandedProfile === role.value" class="px-5 pb-5 pt-1 space-y-5 border-t border-gray-100 bg-white">
                
                <!-- 📝 Descripción Funcional -->
                <div class="space-y-1.5">
                  <label class="text-[10px] font-black text-indigo-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Pencil class="w-3.5 h-3.5" />
                    Descripción Funcional del Cargo
                  </label>
                  <textarea
                    :value="editableProfiles[role.value]?.descripcion"
                    @change="updateProfileField(role.value, 'descripcion', $event.target.value)"
                    rows="2"
                    class="w-full bg-gray-50 border border-gray-250 rounded-xl px-3.5 py-2 text-xs font-bold text-gray-750 outline-none focus:border-indigo-400 focus:bg-white focus:ring-1 focus:ring-indigo-100 transition-all resize-none leading-relaxed"
                    placeholder="Escribe la función principal de este rol en la planta..."
                  ></textarea>
                </div>

                <!-- ⚙️ Configuración Operativa -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-b border-gray-100 py-4 my-2">
                  
                  <!-- Nivel Select -->
                  <div class="space-y-1.5">
                    <label class="text-[10px] font-black text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Layers class="w-3.5 h-3.5 text-gray-400" />
                      Nivel Jerárquico
                    </label>
                    <select
                      :value="editableProfiles[role.value]?.nivel"
                      @change="updateProfileField(role.value, 'nivel', $event.target.value)"
                      class="w-full bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-2 text-xs font-bold text-gray-700 outline-none focus:border-indigo-400 focus:bg-white transition-all"
                    >
                      <option v-for="(cfg, key) in NIVEL_CONFIG" :key="key" :value="key">
                        {{ cfg.emoji }} {{ cfg.label }}
                      </option>
                    </select>
                  </div>

                  <!-- Sector Default Select -->
                  <div class="space-y-1.5">
                    <label class="text-[10px] font-black text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                      <MapPin class="w-3.5 h-3.5 text-gray-400" />
                      Sector Default
                    </label>
                    <select
                      :value="editableProfiles[role.value]?.sectorDefault"
                      @change="updateProfileField(role.value, 'sectorDefault', $event.target.value)"
                      class="w-full bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-2 text-xs font-bold text-gray-700 outline-none focus:border-indigo-400 focus:bg-white transition-all"
                    >
                      <option v-for="sec in activeSectors" :key="sec" :value="sec">
                        🏭 {{ sec }}
                      </option>
                    </select>
                  </div>

                  <!-- Entrada Default (Read-only) -->
                  <div class="space-y-1.5">
                    <label class="text-[10px] font-black text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                      <LogIn class="w-3.5 h-3.5 text-gray-400" />
                      Entrada Inicial
                    </label>
                    <div class="w-full bg-gray-50 border border-gray-150 rounded-xl px-3 py-2 text-xs font-mono text-gray-500 select-none flex items-center gap-1.5 h-[34px]">
                      <span>🚪</span>
                      <span class="font-bold">{{ getDefaultRoute(role.value) }}</span>
                    </div>
                  </div>
                </div>

                <!-- 👁️ Vistas Checkboxes -->
                <div class="space-y-2">
                  <span class="text-[10px] font-black text-indigo-700 uppercase tracking-wider flex items-center gap-1.5">
                    <LayoutGrid class="w-3.5 h-3.5" />
                    Vistas Habilitadas
                  </span>
                  <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <label 
                      v-for="vista in VISTA_OPTIONS" 
                      :key="vista.slug" 
                      class="flex items-center gap-2.5 p-2.5 border rounded-xl hover:bg-indigo-50/20 cursor-pointer select-none transition-all duration-150"
                      :class="editableProfiles[role.value]?.vistas?.includes(vista.slug) ? 'border-indigo-200 bg-indigo-50/10' : 'border-gray-150 bg-gray-50/30'"
                    >
                      <input
                        type="checkbox"
                        :checked="editableProfiles[role.value]?.vistas?.includes(vista.slug)"
                        @change="toggleVista(role.value, vista.slug)"
                        class="w-4 h-4 rounded border-gray-300 text-indigo-600 cursor-pointer"
                      />
                      <span class="text-xs font-bold text-gray-700 truncate">{{ vista.label }}</span>
                    </label>
                  </div>
                </div>

                <!-- 🔐 Permisos Checkboxes -->
                <div class="space-y-2 pt-2 border-t border-gray-100">
                  <span class="text-[10px] font-black text-indigo-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Lock class="w-3.5 h-3.5" />
                    Permisos Especiales
                  </span>
                  <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <label 
                      v-for="(label, key) in PERMISO_LABELS" 
                      :key="key" 
                      class="flex items-center gap-2.5 p-2.5 border rounded-xl hover:bg-emerald-50/20 cursor-pointer select-none transition-all duration-150"
                      :class="editableProfiles[role.value]?.permisos?.[key] ? 'border-emerald-250 bg-emerald-50/10' : 'border-gray-150 bg-gray-50/30'"
                    >
                      <input
                        type="checkbox"
                        :checked="editableProfiles[role.value]?.permisos?.[key]"
                        @change="togglePermiso(role.value, key)"
                        class="w-4 h-4 rounded border-gray-300 text-emerald-600 cursor-pointer"
                      />
                      <span class="text-xs font-bold text-gray-700 truncate">{{ label }}</span>
                    </label>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>

        <!-- ── TAB 3: CONFIGURACIÓN DINÁMICA (ROLES & SECTORES) ── -->
        <div v-else-if="activeTab === 'config'" class="flex-1 overflow-y-auto mx-auto w-full p-2 grid grid-cols-1 md:grid-cols-2 lg:max-w-5xl gap-6">
          
          <!-- ROLES CONFIG -->
          <div class="bg-white border border-gray-200 rounded-2xl p-5 shadow-xs flex flex-col h-fit">
            <div class="mb-4">
              <h3 class="text-sm font-black text-gray-800">Funciones (Roles) del Sistema</h3>
              <p class="text-[10px] text-gray-400 font-medium mt-1">Crea o elimina cargos disponibles para el personal.</p>
            </div>

            <!-- List of current roles -->
            <div class="flex flex-wrap gap-1.5 mb-4">
              <span
                v-for="(r, i) in activeRoles"
                :key="r.value"
                class="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-bold rounded-xl"
              >
                {{ r.label }}
                <!-- Disallow deleting admin role for safety -->
                <button 
                  v-if="r.value !== 'admin'" 
                  @click="removeRole(i)" 
                  class="text-indigo-400 hover:text-red-500 transition-colors ml-1 p-0.5 rounded-md hover:bg-indigo-100 cursor-pointer"
                >
                  <Trash2 class="w-3 h-3" />
                </button>
              </span>
            </div>

            <!-- Form to add new role -->
            <div class="space-y-2 border-t border-gray-100 pt-4">
              <span class="text-[9px] font-black text-gray-400 uppercase tracking-wider block">Agregar Cargo</span>
              <div class="flex flex-col sm:flex-row gap-2">
                <input
                  v-model="newRoleValue"
                  type="text"
                  placeholder="ID (ej: supervisor_hilado)"
                  class="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-2 text-xs font-bold outline-none focus:bg-white focus:border-indigo-400"
                />
                <input
                  v-model="newRoleLabel"
                  type="text"
                  placeholder="Etiqueta (ej: Supervisor Hilado)"
                  class="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-2 text-xs font-bold outline-none focus:bg-white focus:border-indigo-400"
                />
                <button 
                  @click="addRole" 
                  class="px-3.5 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all active:scale-95 shrink-0 flex items-center justify-center cursor-pointer"
                >
                  <Plus class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <!-- SECTORES CONFIG -->
          <div class="bg-white border border-gray-200 rounded-2xl p-5 shadow-xs flex flex-col h-fit">
            <div class="mb-4">
              <h3 class="text-sm font-black text-gray-800">Sectores Disponibles</h3>
              <p class="text-[10px] text-gray-400 font-medium mt-1">Administra los sectores o áreas operativas de la fábrica.</p>
            </div>

            <!-- List of current sectors -->
            <div class="flex flex-wrap gap-1.5 mb-4">
              <span
                v-for="(s, i) in activeSectors"
                :key="s"
                class="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-bold rounded-xl"
              >
                {{ s }}
                <button 
                  @click="removeSector(i)" 
                  class="text-emerald-400 hover:text-red-500 transition-colors ml-1 p-0.5 rounded-md hover:bg-emerald-100 cursor-pointer"
                >
                  <Trash2 class="w-3 h-3" />
                </button>
              </span>
            </div>

            <!-- Form to add sector -->
            <div class="space-y-2 border-t border-gray-100 pt-4">
              <span class="text-[9px] font-black text-gray-400 uppercase tracking-wider block">Agregar Sector</span>
              <div class="flex gap-2">
                <input
                  v-model="newSector"
                  type="text"
                  placeholder="Nombre del sector (ej: TINTORERIA)"
                  @keydown.enter="addSector"
                  class="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-2 text-xs font-bold outline-none focus:bg-white focus:border-emerald-400"
                />
                <button 
                  @click="addSector" 
                  class="px-3.5 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all active:scale-95 shrink-0 flex items-center justify-center cursor-pointer"
                >
                  <Plus class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Reset Seed Defaults Button -->
            <div v-if="!dynamicRoles.length || !dynamicSectors.length" class="mt-4 pt-3 border-t border-gray-50 text-center">
              <button
                @click="seedDefaults"
                class="text-[10px] font-black text-indigo-600 hover:underline tracking-wider uppercase cursor-pointer"
              >
                Cargar configuración por defecto
              </button>
            </div>
          </div>

        </div>

      </div>
    </main>
  </div>
</template>

<style scoped>
@keyframes slideIn {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.animate-slide-in {
  animation: slideIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.animate-fade-in {
  animation: fadeIn 0.2s ease-out forwards;
}
</style>
