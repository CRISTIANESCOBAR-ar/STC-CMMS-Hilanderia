<script setup>
import { ref, onMounted } from 'vue';
import { collection, getDocs, doc, updateDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userRole } from '../services/authService';
import { Users, Shield, ShieldCheck, Mail, Calendar, Search } from 'lucide-vue-next';
import Swal from 'sweetalert2';

const usuarios = ref([]);
const isLoading = ref(true);
const searchQuery = ref('');

const cargarUsuarios = async () => {
  isLoading.value = true;
  try {
    const q = query(collection(db, 'usuarios'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    usuarios.value = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.error("Error cargando usuarios:", e);
    Swal.fire('Error', 'No se pudieron cargar los usuarios', 'error');
  } finally {
    isLoading.value = false;
  }
};

const cambiarRole = async (user, nuevoRole) => {
  if (userRole.value !== 'admin') {
    Swal.fire('Acceso Denegado', 'Solo administradores pueden cambiar roles', 'warning');
    return;
  }

  const result = await Swal.fire({
    title: '¿Confirmar cambio?',
    text: `El usuario ${user.email} pasará a ser ${nuevoRole.toUpperCase()}`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Sí, cambiar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#2563eb'
  });

  if (result.isConfirmed) {
    try {
      await updateDoc(doc(db, 'usuarios', user.id), { role: nuevoRole });
      user.role = nuevoRole;
      Swal.fire('Actualizado', 'Rol modificado correctamente', 'success');
    } catch (e) {
      Swal.fire('Error', 'No se pudo actualizar el rol', 'error');
    }
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
            {{ usuarios.length }} Registrados
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
          v-for="user in usuarios.filter(u => u.email.toLowerCase().includes(searchQuery.toLowerCase()) || u.displayName?.toLowerCase().includes(searchQuery.toLowerCase()))" 
          :key="user.id"
          class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between group hover:border-indigo-300 transition-all"
        >
          <div class="flex items-center space-x-4">
            <div :class="user.role === 'admin' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'" class="p-3 rounded-full shrink-0">
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

          <div class="flex flex-col items-end space-y-2">
            <span 
              :class="user.role === 'admin' ? 'bg-amber-500 text-white' : 'bg-blue-500 text-white'"
              class="px-3 py-1.5 rounded-md text-[10px] font-black tracking-widest cursor-pointer hover:opacity-80 transition-opacity active:scale-95"
              @click="cambiarRole(user, user.role === 'admin' ? 'mecanico' : 'admin')"
            >
              {{ user.role }}
            </span>
            <div class="flex items-center space-x-1.5 text-[10px] text-gray-400 font-bold">
              <Calendar class="w-3.5 h-3.5" />
              <span>{{ user.createdAt?.toDate ? user.createdAt.toDate().toLocaleDateString() : '---' }}</span>
            </div>
          </div>
        </div>
      </div>

    </main>
  </div>
</template>
