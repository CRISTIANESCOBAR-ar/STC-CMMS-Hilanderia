<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { authService } from './services/authService';
import { Menu, X, LogOut, User, Wrench, ShieldCheck, History, Settings2 } from 'lucide-vue-next';

const router = useRouter();
const isAuthReady = ref(false);
const user = ref(null);
const isMenuOpen = ref(false);

const closeMenu = () => {
  isMenuOpen.value = false;
};

// Cerrar con ESC
const handleKeydown = (e) => {
  if (e.key === 'Escape' && isMenuOpen.value) {
    closeMenu();
  }
};

watch(isMenuOpen, (val) => {
  if (val) {
    window.addEventListener('keydown', handleKeydown);
  } else {
    window.removeEventListener('keydown', handleKeydown);
  }
});

onMounted(() => {
  authService.observarEstado((currentUser) => {
    user.value = currentUser;
    isAuthReady.value = true;
    
    if (!currentUser && router.currentRoute.value.meta.requiresAuth) {
      router.push('/login');
    }
  });
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});

const handleLogout = async () => {
  closeMenu();
  await authService.cerrarSesion();
  router.push('/login');
};

const pageTitle = computed(() => {
  const path = router.currentRoute.value.path;
  if (path === '/') return 'Reportar Falla';
  if (path === '/jefe') return 'Panel de Control';
  if (path === '/historico') return 'Historial de Novedades';
  if (path === '/maquinas') return 'Gestión de Máquinas';
  if (path === '/login') return 'Ingreso al Sistema';
  return 'CMMS Santana';
});
</script>

<template>
  <div v-if="!isAuthReady" class="fixed inset-0 flex items-center justify-center bg-white z-[9999]">
    <img 
      src="/LogoSantana.jpg" 
      alt="Santana" 
      class="max-w-[400px] w-4/5 h-auto animate-pulse-soft"
    />
  </div>
  
  <div v-else class="min-h-screen bg-transparent">
    <!-- Overlay de cierre (Click-away) -->
    <transition
      enter-active-class="transition-opacity duration-300"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div 
        v-if="isMenuOpen" 
        @click="closeMenu"
        class="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
      ></div>
    </transition>

    <!-- Barra de Navegación Global con Menú Hamburguesa -->
    <nav v-if="user" class="bg-gray-900 text-white shadow-xl sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-4 h-16 flex justify-between items-center">
        <!-- Logo y Nombre -->
        <div class="flex items-center space-x-3 shrink-0">
          <div class="bg-white p-0.5 rounded-lg overflow-hidden flex items-center justify-center shrink-0">
            <img src="/LogoSantana.jpg" class="h-8 w-auto object-contain" alt="Logo" />
          </div>
          <span v-if="!['/maquinas', '/historico'].includes(router.currentRoute.value.path)" class="font-bold text-lg tracking-tight truncate max-w-[150px] sm:max-w-none">{{ pageTitle }}</span>
        </div>

        <!-- Portales para acciones (Solo Desktop) -->
        <div id="navbar-actions" class="hidden lg:flex flex-1 mx-6 items-center justify-center"></div>

        <!-- Botón Hamburguesa -->
        <button 
          @click="isMenuOpen = !isMenuOpen"
          class="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 transition-all focus:outline-none ring-1 ring-gray-700 shrink-0"
          :aria-label="isMenuOpen ? 'Cerrar menú' : 'Abrir menú'"
        >
          <Menu v-if="!isMenuOpen" class="w-6 h-6" />
          <X v-else class="w-6 h-6" />
        </button>
      </div>

      <!-- Menú Desplegable (Animado) -->
      <transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="transform -translate-y-4 opacity-0"
        enter-to-class="transform translate-y-0 opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="transform translate-y-0 opacity-100"
        leave-to-class="transform -translate-y-4 opacity-0"
      >
        <div v-if="isMenuOpen" class="bg-gray-900 border-t border-gray-800 shadow-2xl overflow-hidden">
          <div class="px-3 pt-2 pb-6 space-y-2">
            <router-link 
              to="/" 
              @click="closeMenu"
              class="flex items-center px-4 py-4 rounded-2xl text-base font-semibold transition-all hover:bg-gray-800 active:bg-black"
              active-class="bg-blue-600 text-white shadow-lg shadow-blue-900/20"
            >
              <Wrench class="w-5 h-5 mr-4" />
              Mecánico (Carga Novedad)
            </router-link>
            
            <router-link 
              to="/jefe" 
              @click="closeMenu"
              class="flex items-center px-4 py-4 rounded-2xl text-base font-semibold transition-all hover:bg-gray-800 active:bg-black"
              active-class="bg-blue-600 text-white shadow-lg shadow-blue-900/20"
            >
              <ShieldCheck class="w-5 h-5 mr-4" />
              Jefe de Mantenimiento
            </router-link>

            <router-link 
              to="/historico" 
              @click="closeMenu"
              class="flex items-center px-4 py-4 rounded-2xl text-base font-semibold transition-all hover:bg-gray-800 active:bg-black"
              active-class="bg-blue-600 text-white shadow-lg shadow-blue-900/20"
            >
              <History class="w-5 h-5 mr-4" />
              Historial de Novedades
            </router-link>

            <router-link 
              to="/maquinas" 
              @click="closeMenu"
              class="flex items-center px-4 py-4 rounded-2xl text-base font-semibold transition-all hover:bg-gray-800 active:bg-black"
              active-class="bg-indigo-600 text-white shadow-lg shadow-indigo-900/20"
            >
              <Settings2 class="w-5 h-5 mr-4" />
              Gestión de Máquinas
            </router-link>

            <div class="h-px bg-gray-800 my-4 mx-4"></div>
            
            <div class="px-4 py-2 flex items-center text-xs text-gray-500 uppercase tracking-widest font-bold">
               <User class="w-4 h-4 mr-2" />
               {{ user.isAnonymous ? 'Usuario Invitado' : user.email }}
            </div>

            <button 
              @click="handleLogout"
              class="w-full flex items-center px-4 py-4 rounded-2xl text-base font-bold text-red-400 transition-all hover:bg-red-950/30 active:bg-red-950/50"
            >
              <LogOut class="w-5 h-5 mr-4" />
              Cerrar Sesión
            </button>
          </div>
        </div>
      </transition>
    </nav>

    <!-- Vistas dinámicas -->
    <main :class="{'blur-[2px] pointer-events-none transition-all duration-300': isMenuOpen}" class="pt-4">
      <router-view></router-view>
    </main>
  </div>
</template>
