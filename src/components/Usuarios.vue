<script setup>
import { ref, onMounted, computed } from 'vue';
import { collection, getDocs, doc, updateDoc, getDoc, setDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userRole } from '../services/authService';
import { Users, ShieldCheck, Shield, Mail, Calendar, Search, Save, Building2, UserCog, Settings, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-vue-next';
import Swal from 'sweetalert2';
import { DEFAULT_SECTOR, ROLE_OPTIONS as DEFAULT_ROLES, SECTOR_OPTIONS as DEFAULT_SECTORS, isJefeRole, normalizeSectorValue, sanitizeSectorList, ROLE_PROFILES, NIVEL_CONFIG, VISTA_OPTIONS, VISTA_LABEL, PERMISO_LABELS } from '../constants/organization';
import { profileOverrides, loadProfiles, saveProfiles, getEffectiveVistas, getEffectivePermisos } from '../services/profileService';

const usuarios = ref([]);
const isLoading = ref(true);
const searchQuery = ref('');
const showConfig = ref(false);

// ── Config dinámica (Firestore: config/organization) ──
const dynamicRoles = ref([]);
const dynamicSectors = ref([]);
const newRoleValue = ref('');
const newRoleLabel = ref('');
const newSector = ref('');

const activeRoles = computed(() => dynamicRoles.value.length ? dynamicRoles.value : DEFAULT_ROLES);
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
      vistas: override?.vistas ? [...override.vistas] : (defaults?.vistas ? [...defaults.vistas] : []),
      permisos: override?.permisos ? { ...override.permisos } : (defaults?.permisos ? { ...defaults.permisos } : {}),
    };
  }
  editableProfiles.value = profiles;
};

const toggleProfileExpand = (role) => {
  expandedProfile.value = expandedProfile.value === role ? null : role;
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

// ── Usuarios ──
const getRoleColor = (role) => {
  if (role === 'admin') return { bg: 'bg-amber-100', text: 'text-amber-600', badge: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (isJefeRole(role) || role === 'gerente_produccion') return { bg: 'bg-emerald-100', text: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (role?.startsWith('supervisor')) return { bg: 'bg-violet-100', text: 'text-violet-600', badge: 'bg-violet-50 text-violet-700 border-violet-200' };
  return { bg: 'bg-blue-100', text: 'text-blue-600', badge: 'bg-blue-50 text-blue-700 border-blue-200' };
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
    jefeDeSectores
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
    return email.includes(s) || name.includes(s) || nombre.includes(s) || apellido.includes(s);
  });
});

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
    jefeDeSectores
  };

  try {
    await updateDoc(doc(db, 'usuarios', user.id), payload);
    Object.assign(user, payload);
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
  <div class="h-[calc(100vh-110px)] bg-gray-50 flex flex-col overflow-hidden">
    <main class="flex-1 max-w-4xl mx-auto w-full px-2 lg:px-4 pt-3 pb-2 flex flex-col space-y-3 overflow-hidden">

      <!-- Header -->
      <div class="bg-white p-3 lg:p-4 rounded-xl shadow-sm border border-gray-100 shrink-0 space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2.5">
            <div class="bg-indigo-600 p-2 rounded-xl text-white">
              <Users class="w-5 h-5" />
            </div>
            <h1 class="text-base font-black text-gray-800 tracking-tight">Usuarios</h1>
          </div>
          <div class="flex items-center gap-2">
            <button
              @click="showConfig = !showConfig"
              class="p-1.5 rounded-lg transition-all"
              :class="showConfig ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'"
            >
              <Settings class="w-4 h-4" />
            </button>
            <span class="px-2.5 py-1 bg-indigo-50 text-[11px] font-black text-indigo-600 rounded-full">
              {{ filteredUsuarios.length }}
            </span>
          </div>
        </div>

        <!-- ⚙ Panel Config (colapsable) -->
        <transition
          enter-active-class="transition-all duration-200 ease-out"
          enter-from-class="max-h-0 opacity-0"
          enter-to-class="max-h-[2000px] opacity-100"
          leave-active-class="transition-all duration-150 ease-in"
          leave-from-class="max-h-[2000px] opacity-100"
          leave-to-class="max-h-0 opacity-0"
        >
          <div v-if="showConfig" class="overflow-hidden">
            <div class="mt-3 border-t border-gray-100 pt-3 space-y-4">

              <!-- FUNCIONES (roles) -->
              <div>
                <h3 class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Funciones disponibles</h3>
                <div class="flex flex-wrap gap-1.5 mb-2">
                  <span
                    v-for="(r, i) in activeRoles"
                    :key="r.value"
                    class="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 text-[11px] font-bold rounded-md border border-indigo-100"
                  >
                    {{ r.label }}
                    <button @click="removeRole(i)" class="text-indigo-400 hover:text-red-500 transition-colors ml-0.5">
                      <Trash2 class="w-3 h-3" />
                    </button>
                  </span>
                </div>
                <div class="flex gap-1.5">
                  <input
                    v-model="newRoleValue"
                    type="text"
                    placeholder="slug (ej: electricista)"
                    class="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-medium outline-none focus:ring-1 focus:ring-indigo-500/30"
                  />
                  <input
                    v-model="newRoleLabel"
                    type="text"
                    placeholder="Etiqueta (ej: Electricista)"
                    class="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-medium outline-none focus:ring-1 focus:ring-indigo-500/30"
                  />
                  <button @click="addRole" class="px-2.5 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all active:scale-95">
                    <Plus class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <!-- SECTORES -->
              <div>
                <h3 class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Sectores disponibles</h3>
                <div class="flex flex-wrap gap-1.5 mb-2">
                  <span
                    v-for="(s, i) in activeSectors"
                    :key="s"
                    class="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 text-[11px] font-bold rounded-md border border-emerald-100"
                  >
                    {{ s }}
                    <button @click="removeSector(i)" class="text-emerald-400 hover:text-red-500 transition-colors ml-0.5">
                      <Trash2 class="w-3 h-3" />
                    </button>
                  </span>
                </div>
                <div class="flex gap-1.5">
                  <input
                    v-model="newSector"
                    type="text"
                    placeholder="Nuevo sector (ej: TINTORERIA)"
                    @keydown.enter="addSector"
                    class="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-medium outline-none focus:ring-1 focus:ring-emerald-500/30"
                  />
                  <button @click="addSector" class="px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all active:scale-95">
                    <Plus class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <!-- Botón Seed Defaults -->
              <button
                v-if="!dynamicRoles.length || !dynamicSectors.length"
                @click="seedDefaults"
                class="text-[10px] font-bold text-gray-400 hover:text-indigo-600 transition-colors underline"
              >
                Cargar valores por defecto
              </button>

              <!-- PERFILES DE ROL -->
              <div>
                <h3 class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Perfiles de Rol — Vistas y Permisos</h3>
                <div class="space-y-1">
                  <div v-for="role in editableRoleList" :key="role.value" class="border border-gray-200 rounded-lg overflow-hidden">
                    <button @click="toggleProfileExpand(role.value)" class="w-full flex items-center justify-between px-2.5 py-2 bg-gray-50/80 hover:bg-gray-100 transition-all text-left">
                      <div class="flex items-center gap-2">
                        <span class="text-[11px] font-bold text-gray-700">{{ role.label }}</span>
                        <span
                          v-if="ROLE_PROFILES[role.value]?.nivel"
                          class="px-1 py-0.5 text-[8px] font-black uppercase rounded"
                          :class="{
                            'bg-blue-100 text-blue-600':     ROLE_PROFILES[role.value].nivel === 'operativo',
                            'bg-violet-100 text-violet-600': ROLE_PROFILES[role.value].nivel === 'mandos',
                            'bg-emerald-100 text-emerald-600': ROLE_PROFILES[role.value].nivel === 'estrategico',
                          }"
                        >{{ NIVEL_CONFIG[ROLE_PROFILES[role.value].nivel]?.label }}</span>
                        <span class="text-[9px] text-gray-400 font-medium">{{ (editableProfiles[role.value]?.vistas || []).length }} vistas</span>
                      </div>
                      <ChevronUp v-if="expandedProfile === role.value" class="w-3.5 h-3.5 text-gray-400" />
                      <ChevronDown v-else class="w-3.5 h-3.5 text-gray-400" />
                    </button>
                    <div v-if="expandedProfile === role.value" class="px-2.5 py-2.5 space-y-2.5 border-t border-gray-100 bg-white">
                      <div>
                        <span class="text-[9px] font-black text-gray-400 uppercase tracking-wider">Vistas habilitadas</span>
                        <div class="flex flex-wrap gap-x-3 gap-y-1.5 mt-1">
                          <label v-for="vista in VISTA_OPTIONS" :key="vista.slug" class="flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              :checked="editableProfiles[role.value]?.vistas?.includes(vista.slug)"
                              @change="toggleVista(role.value, vista.slug)"
                              class="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30 cursor-pointer"
                            />
                            <span class="text-[10px] font-bold text-gray-600">{{ vista.label }}</span>
                          </label>
                        </div>
                      </div>
                      <div>
                        <span class="text-[9px] font-black text-gray-400 uppercase tracking-wider">Permisos</span>
                        <div class="flex flex-wrap gap-x-3 gap-y-1.5 mt-1">
                          <label v-for="(label, key) in PERMISO_LABELS" :key="key" class="flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              :checked="editableProfiles[role.value]?.permisos?.[key]"
                              @change="togglePermiso(role.value, key)"
                              class="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30 cursor-pointer"
                            />
                            <span class="text-[10px] font-bold text-gray-600">{{ label }}</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </transition>

        <div class="relative">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Buscar por nombre o email..."
            class="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium"
          />
        </div>
      </div>

      <!-- Loading -->
      <div v-if="isLoading" class="flex-1 flex flex-col items-center justify-center text-gray-400">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-3"></div>
        <p class="font-bold text-xs tracking-widest">Cargando usuarios...</p>
      </div>

      <!-- Lista -->
      <div v-else class="flex-1 overflow-y-auto space-y-3 pr-1">
        <div
          v-for="user in filteredUsuarios"
          :key="user.id"
          class="bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-indigo-200 transition-all"
        >
          <!-- ① CABECERA: Avatar + Email + Badge rol -->
          <div class="flex items-center gap-3 px-3 py-2.5 bg-gray-50/80 border-b border-gray-100">
            <div :class="[getRoleColor(user.role).bg, getRoleColor(user.role).text]" class="w-9 h-9 rounded-full flex items-center justify-center shrink-0">
              <ShieldCheck v-if="user.role === 'admin'" class="w-5 h-5" />
              <UserCog v-else-if="isJefeRole(user.role) || user.role === 'gerente_produccion'" class="w-5 h-5" />
              <Shield v-else class="w-5 h-5" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-black text-gray-800 truncate leading-tight">{{ user.displayName || 'Sin nombre' }}</p>
              <div class="flex items-center gap-1 mt-0.5">
                <Mail class="w-3 h-3 text-gray-400 shrink-0" />
                <span class="text-[11px] text-gray-500 font-medium truncate">{{ user.email }}</span>
              </div>
            </div>
            <span :class="getRoleColor(user.role).badge" class="px-2 py-0.5 text-[10px] font-black rounded-md border shrink-0 hidden sm:inline-block">
              {{ roleLabel[user.role] || user.role }}
            </span>
          </div>

          <!-- ② CUERPO: Campos editables -->
          <div class="p-3 space-y-3">

            <!-- Identidad: Nombre + Apellido -->
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider ml-0.5">Nombre</label>
                <input
                  v-model="user.nombre"
                  type="text"
                  placeholder="Nombre"
                  class="w-full mt-0.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition-all"
                />
              </div>
              <div>
                <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider ml-0.5">Apellido</label>
                <input
                  v-model="user.apellido"
                  type="text"
                  placeholder="Apellido"
                  class="w-full mt-0.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition-all"
                />
              </div>
            </div>

            <!-- Función (Rol) - dinámico -->
            <div>
              <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider ml-0.5">Función</label>
              <select
                v-model="user.role"
                class="w-full mt-0.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition-all"
              >
                <option v-for="r in activeRoles" :key="r.value" :value="r.value">{{ r.label }}</option>
              </select>

              <!-- Tarjeta informativa del perfil -->
              <div
                v-if="ROLE_PROFILES[user.role]"
                class="mt-2 rounded-lg border p-2.5 space-y-2 transition-all"
                :class="{
                  'bg-blue-50/50 border-blue-100':   ROLE_PROFILES[user.role].nivel === 'operativo',
                  'bg-violet-50/50 border-violet-100': ROLE_PROFILES[user.role].nivel === 'mandos',
                  'bg-emerald-50/50 border-emerald-100': ROLE_PROFILES[user.role].nivel === 'estrategico',
                  'bg-amber-50/50 border-amber-100': ROLE_PROFILES[user.role].nivel === 'global',
                }"
              >
                <!-- Nivel badge + descripción -->
                <div class="flex items-start gap-2">
                  <span
                    class="px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider rounded shrink-0"
                    :class="{
                      'bg-blue-100 text-blue-700':     ROLE_PROFILES[user.role].nivel === 'operativo',
                      'bg-violet-100 text-violet-700': ROLE_PROFILES[user.role].nivel === 'mandos',
                      'bg-emerald-100 text-emerald-700': ROLE_PROFILES[user.role].nivel === 'estrategico',
                      'bg-amber-100 text-amber-700':   ROLE_PROFILES[user.role].nivel === 'global',
                    }"
                  >
                    {{ NIVEL_CONFIG[ROLE_PROFILES[user.role].nivel]?.label }}
                  </span>
                  <p class="text-[11px] text-gray-600 font-medium leading-tight">
                    {{ ROLE_PROFILES[user.role].descripcion }}
                  </p>
                </div>

                <!-- Vistas -->
                <div>
                  <span class="text-[9px] font-black text-gray-400 uppercase tracking-wider">Vistas</span>
                  <div class="flex flex-wrap gap-1 mt-0.5">
                    <span
                      v-for="v in getEffectiveVistas(user.role)"
                      :key="v"
                      class="px-1.5 py-0.5 bg-white/80 border border-gray-200 rounded text-[10px] font-bold text-gray-600"
                    >{{ VISTA_LABEL[v] || v }}</span>
                  </div>
                </div>

                <!-- Permisos -->
                <div class="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span class="w-full text-[9px] font-black text-gray-400 uppercase tracking-wider">Permisos</span>
                  <span v-for="(val, key) in getEffectivePermisos(user.role)" :key="key" class="inline-flex items-center gap-0.5 text-[10px] font-bold">
                    <span :class="val ? 'text-green-500' : 'text-gray-300'">{{ val ? '✓' : '✗' }}</span>
                    <span :class="val ? 'text-gray-700' : 'text-gray-400'">{{ PERMISO_LABELS[key] || key }}</span>
                  </span>
                </div>
              </div>
            </div>

            <!-- Sector Principal - dinámico -->
            <div>
              <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider ml-0.5">Sector Principal</label>
              <select
                v-model="user.sectorDefault"
                class="w-full mt-0.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition-all"
              >
                <option v-for="s in activeSectors" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>

            <!-- Sectores Autorizados (Checkboxes) - dinámico -->
            <div>
              <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider ml-0.5">Sectores Autorizados</label>
              <div class="flex flex-wrap gap-x-4 gap-y-1 mt-1 ml-0.5">
                <label v-for="s in activeSectors" :key="s" class="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    :value="s"
                    v-model="user.sectoresAsignados"
                    class="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30 cursor-pointer"
                  />
                  <span class="text-xs font-bold text-gray-600">{{ s }}</span>
                </label>
              </div>
            </div>

            <!-- Jefe de Sectores (si es rol jefe) -->
            <div v-if="isJefeRole(user.role)" class="bg-emerald-50/50 rounded-lg p-2.5 border border-emerald-100">
              <label class="text-[10px] font-black text-emerald-600 uppercase tracking-wider flex items-center gap-1">
                <Building2 class="w-3 h-3" />
                Jefe de Sectores
              </label>
              <div class="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                <label v-for="s in activeSectors" :key="s" class="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    :value="s"
                    v-model="user.jefeDeSectores"
                    class="w-4 h-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500/30 cursor-pointer"
                  />
                  <span class="text-xs font-bold text-emerald-700">{{ s }}</span>
                </label>
              </div>
            </div>

            <!-- Alcance Admin -->
            <div v-if="user.role === 'admin'" class="bg-amber-50/50 rounded-lg p-2.5 border border-amber-100">
              <label class="text-[10px] font-black text-amber-600 uppercase tracking-wider">Alcance</label>
              <select
                v-model="user.alcance"
                class="w-full mt-0.5 bg-white border border-amber-200 rounded-lg px-2.5 py-2 text-xs font-bold text-amber-700 outline-none focus:ring-2 focus:ring-amber-500/20 transition-all"
              >
                <option value="global">Admin global</option>
                <option value="sector">Admin sectorizado</option>
              </select>
            </div>
          </div>

          <!-- ③ PIE: Fecha + Guardar -->
          <div class="flex items-center justify-between px-3 py-2 bg-gray-50/80 border-t border-gray-100">
            <div class="flex items-center gap-1.5 text-[10px] text-gray-400 font-bold">
              <Calendar class="w-3 h-3" />
              <span>{{ user.createdAt?.toDate ? user.createdAt.toDate().toLocaleDateString() : '---' }}</span>
            </div>
            <button
              @click="guardarConfiguracion(user)"
              class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-black tracking-wide hover:bg-indigo-700 transition-all active:scale-95"
            >
              <Save class="w-3.5 h-3.5" />
              Guardar
            </button>
          </div>
        </div>
      </div>

    </main>
  </div>
</template>
