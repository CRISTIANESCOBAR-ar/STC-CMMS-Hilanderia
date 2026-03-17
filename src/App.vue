<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { authService } from './services/authService';

const router = useRouter();
const isAuthReady = ref(false);
const user = ref(null);

onMounted(() => {
  authService.observarEstado((currentUser) => {
    user.value = currentUser;
    isAuthReady.value = true;
    
    // Simple redirect si detectamos cambio de estado
    if (!currentUser && router.currentRoute.value.meta.requiresAuth) {
      router.push('/login');
    }
  });
});

const handleLogout = async () => {
  await authService.cerrarSesion();
  router.push('/login');
};
</script>

<template>
  <div v-if="!isAuthReady" class="min-h-screen flex items-center justify-center bg-gray-50">
    <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
  </div>
  
  <div v-else>
    <!-- Barra de Navegación Global -->
    <nav v-if="user" class="bg-gray-800 text-white p-3 flex justify-between items-center shadow">
      <div class="flex space-x-4">
        <router-link to="/" class="hover:text-blue-300 font-medium px-2 py-1 rounded" active-class="bg-gray-900 ring-1 ring-gray-700">Mecánico</router-link>
        <router-link to="/jefe" class="hover:text-blue-300 font-medium px-2 py-1 rounded" active-class="bg-gray-900 ring-1 ring-gray-700">Jefe Mantenimiento</router-link>
      </div>
      <div class="flex items-center space-x-4">
        <router-link to="/init" class="hover:text-amber-300 text-amber-500 text-sm px-2 py-1 font-bold">⚙️ Poblar BD</router-link>
        <span class="text-xs text-gray-400 hidden sm:inline-block">{{ user.isAnonymous ? 'Invitado' : user.email }}</span>
        <button @click="handleLogout" class="text-sm bg-red-600 hover:bg-red-700 px-3 py-1 rounded font-medium transition">Salir</button>
      </div>
    </nav>

    <!-- Vistas dinámicas -->
    <router-view></router-view>
  </div>
</template>
