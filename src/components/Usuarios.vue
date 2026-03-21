<script setup>
import { ref, onMounted, computed } from 'vue';
import { collection, getDocs, doc, updateDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userRole } from '../services/authService';
import { Users, Shield, ShieldCheck, Mail, Calendar, Search } from 'lucide-vue-next';
import Swal from 'sweetalert2';
import { DEFAULT_SECTOR, ROLE_OPTIONS, SECTOR_OPTIONS, normalizeSectorValue, sanitizeSectorList } from '../constants/organization';

const usuarios = ref([]);
const isLoading = ref(true);
const searchQuery = ref('');

const normalizarUsuario = (user) => {
  const role = user.role || 'mecanico';
  const sectorDefault = normalizeSectorValue(user.sectorDefault || DEFAULT_SECTOR);
  const sectoresAsignados = sanitizeSectorList(user.sectoresAsignados, sectorDefault);
  const jefeDeSectores = role === 'jefe_sector'
    ? sanitizeSectorList(user.jefeDeSectores?.length ? user.jefeDeSectores : [sectorDefault], sectorDefault)
    : [];

  return {
    ...user,
    role,
    alcance: role === 'admin' ? (user.alcance || 'global') : 'sector',
    sectorDefault,
    sectoresAsignados,
    jefeDeSectores,
    sectoresAsignadosText: sectoresAsignados.join(', '),
    jefeDeSectoresText: jefeDeSectores.join(', ')
  };
};

const cargarUsuarios = async () => {
  isLoading.value = true;
  try {
    const q = query(collection(db, 'usuarios'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    usuarios.value = snap.docs.map(doc => normalizarUsuario({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.error("Error cargando usuarios:", e);
    Swal.fire('Error', 'No se pudieron cargar los usuarios', 'error');
  } finally {
    isLoading.value = false;
  }
};

const filteredUsuarios = computed(() => {
  const search = searchQuery.value.toLowerCase();
  return usuarios.value.filter((u) => {
    const email = String(u.email || '').toLowerCase();
    const name = String(u.displayName || '').toLowerCase();
    return email.includes(search) || name.includes(search);
  });
});

const guardarConfiguracion = async (user) => {
  if (userRole.value !== 'admin') {
    Swal.fire('Acceso Denegado', 'Solo administradores pueden gestionar usuarios', 'warning');
    return;
  }

  const sectoresAsignados = sanitizeSectorList(
    String(user.sectoresAsignadosText || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    user.sectorDefault || DEFAULT_SECTOR
  );

  const jefeDeSectores = user.role === 'jefe_sector'
    ? sanitizeSectorList(
      String(user.jefeDeSectoresText || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      user.sectorDefault || DEFAULT_SECTOR
    )
    : [];

  const payload = {
    role: user.role,
    alcance: user.role === 'admin' ? (user.alcance || 'global') : 'sector',
    sectorDefault: normalizeSectorValue(user.sectorDefault || DEFAULT_SECTOR),
    sectoresAsignados,
    jefeDeSectores
  };

  try {
    await updateDoc(doc(db, 'usuarios', user.id), payload);
    Object.assign(user, {
      ...payload,
      sectoresAsignadosText: payload.sectoresAsignados.join(', '),
      jefeDeSectoresText: payload.jefeDeSectores.join(', ')
    });
    Swal.fire({ icon: 'success', title: 'Guardado', text: 'Configuración actualizada', timer: 1200, showConfirmButton: false, toast: true, position: 'top-end' });
  } catch (e) {
    Swal.fire('Error', 'No se pudo actualizar el usuario', 'error');
  }
};

onMounted(cargarUsuarios);
</script>

<template>
  <div class="h-[calc(100vh-64px)] bg-gray-50 flex flex-col overflow-hidden">
    <main class="flex-1 max-w-4xl mx-auto w-full px-2 lg:px-4 pt-4 pb-2 flex flex-col space-y-4 overflow-hidden">
      
      <!-- Header Local -->
      <div class="bg-white p-4 lg:p-5 rounded-xl shadow-sm border border-gray-100 shrink-0 space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-3">
            <div class="bg-indigo-600 p-2 rounded-xl text-white">
              <Users class="w-5 h-5" />
            </div>
            <h1 class="text-base font-black text-gray-800 tracking-tight">Gestión de usuarios</h1>
          </div>
          <span class="px-3 py-1 bg-indigo-50 text-xs font-black text-indigo-600 rounded-full">
            {{ filteredUsuarios.length }} Registrados
          </span>
        </div>
        
        <div class="relative">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input 
            v-model="searchQuery" 
            type="text" 
            placeholder="Buscar por nombre o email..." 
            class="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium" 
          />
        </div>
      </div>

      <!-- Lista de Usuarios -->
      <div v-if="isLoading" class="flex-1 flex flex-col items-center justify-center text-gray-400">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-3"></div>
        <p class="font-bold text-sm tracking-widest">Cargando usuarios...</p>
      </div>

      <div v-else class="flex-1 overflow-y-auto space-y-3 pr-1">
        <div 
          v-for="user in filteredUsuarios" 
          :key="user.id"
          class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 group hover:border-indigo-300 transition-all"
        >
          <div class="flex items-center space-x-4">
            <div :class="user.role === 'admin' ? 'bg-amber-100 text-amber-600' : user.role === 'jefe_sector' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'" class="p-3 rounded-full shrink-0">
              <ShieldCheck v-if="user.role === 'admin'" class="w-6 h-6" />
              <Shield v-else class="w-6 h-6" />
            </div>
            <div class="space-y-1">
              <h3 class="text-sm font-black text-gray-800 leading-none">{{ user.displayName || 'Usuario Google' }}</h3>
              <div class="flex items-center space-x-2">
                <Mail class="w-4 h-4 text-gray-400" />
                <span class="text-xs font-bold text-gray-500">{{ user.email }}</span>
              </div>
            </div>
          </div>

          <div class="w-full lg:w-auto lg:min-w-95">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select v-model="user.role" class="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/20">
                <option v-for="role in ROLE_OPTIONS" :key="role" :value="role">{{ role }}</option>
              </select>

              <select v-model="user.sectorDefault" class="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/20">
                <option v-for="sector in SECTOR_OPTIONS" :key="sector" :value="sector">{{ sector }}</option>
              </select>

              <input
                v-model="user.sectoresAsignadosText"
                type="text"
                placeholder="Sectores asignados: HILANDERIA, TEJEDURIA"
                class="sm:col-span-2 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
              />

              <input
                v-if="user.role === 'jefe_sector'"
                v-model="user.jefeDeSectoresText"
                type="text"
                placeholder="Sectores jefe: HILANDERIA"
                class="sm:col-span-2 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-2 text-xs font-semibold text-emerald-700 outline-none focus:ring-2 focus:ring-emerald-500/20"
              />

              <select
                v-if="user.role === 'admin'"
                v-model="user.alcance"
                class="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 text-xs font-bold text-amber-700 outline-none focus:ring-2 focus:ring-amber-500/20"
              >
                <option value="global">Admin global</option>
                <option value="sector">Admin sectorizado</option>
              </select>
            </div>

            <div class="flex items-center justify-between mt-2">
              <div class="flex items-center space-x-1.5 text-[10px] text-gray-400 font-bold">
                <Calendar class="w-3.5 h-3.5" />
                <span>{{ user.createdAt?.toDate ? user.createdAt.toDate().toLocaleDateString() : '---' }}</span>
              </div>
              <button
                @click="guardarConfiguracion(user)"
                class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[10px] font-black tracking-widest hover:bg-indigo-700 transition-all active:scale-95"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      </div>

    </main>
  </div>
</template>
