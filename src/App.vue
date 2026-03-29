<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { authService, userRole } from './services/authService';
import { Menu, X, LogOut, User, Wrench, ShieldCheck, History, Settings2, Users, Languages, BellRing, ClipboardList, ListFilter, Stethoscope } from 'lucide-vue-next';
import { canAccessJefePanel, canDespacharIntervencion } from './constants/organization';
import Swal from 'sweetalert2';

const router = useRouter();
const isAuthReady = ref(false);
const user = ref(null);
const isMenuOpen = ref(false);
const hasUpdate = ref(false);
let updateCheckInterval = null;

const closeMenu = () => {
  isMenuOpen.value = false;
};

// Función para verificar actualizaciones del Service Worker
const checkForUpdates = async () => {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (let reg of regs) {
        if (reg.waiting) {
          hasUpdate.value = true;
          // Mostrar toast con Swal
          Swal.fire({
            icon: 'info',
            title: 'Nueva versión disponible',
            text: 'Se ha detectado una actualización de la aplicación.',
            toast: true,
            position: 'top-end',
            showConfirmButton: true,
            timer: 10000,
            timerProgressBar: true,
            confirmButtonText: 'Actualizar',
            confirmButtonColor: '#16a34a'
          }).then((result) => {
            if (result.isConfirmed) {
              limpiarCacheYActualizar();
            }
          });
          return;
        }
      }
    }
  } catch (err) {
    console.warn('Error checking for updates:', err);
  }
};

// Limpiar cache y actualizar
const limpiarCacheYActualizar = async () => {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (let registration of registrations) {
        await registration.unregister();
      }
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      for (let key of keys) {
        await caches.delete(key);
      }
    }
    window.location.reload(true);
  } catch (err) {
    console.error("Error updating:", err);
    Swal.fire('Error', 'No se pudo actualizar. Intenta de nuevo.', 'error');
  }
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

  // Polling para verificar actualizaciones cada 5 minutos
  checkForUpdates(); // Verificar inmediatamente al montar
  updateCheckInterval = setInterval(checkForUpdates, 5 * 60 * 1000);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
  }
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
  if (path === '/usuarios') return 'Gestión de Usuarios';
  if (path === '/llamar') return 'Solicitar Intervención';
  if (path === '/intervenciones') return 'Intervenciones';
  if (path === '/codigos')   return 'Códigos de Defectos y Paradas';
  if (path === '/sintomas')  return 'Síntomas de Tejeduría';
  if (path === '/login') return 'Ingreso al Sistema';
  return 'CMMS STC';
});

const userRoleLabelClass = computed(() => {
  if (userRole.value === 'admin') return 'bg-amber-500/20 text-amber-500 border-amber-500/30';
  if (userRole.value === 'jefe_sector') return 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30';
  return 'bg-blue-500/20 text-blue-500 border-blue-500/30';
});
</script>

<template>
  <div v-if="!isAuthReady" class="fixed inset-0 flex items-center justify-center bg-white z-9999">
    <img 
      src="/LogoSantana.jpg" 
      alt="Santana" 
      class="max-w-100 w-4/5 h-auto animate-pulse-soft"
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
    <nav v-if="user" class="bg-white text-gray-900 shadow-md border-b border-gray-100 sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-4 h-16 flex justify-between items-center">
        <!-- Logo y Nombre -->
        <div class="flex items-center space-x-3 shrink-0 overflow-hidden">
          <div class="bg-white p-0.5 rounded-xs border border-gray-200 overflow-hidden flex items-center justify-center shrink-0">
            <img src="/LogoSantana.jpg" class="h-8 w-auto object-contain" alt="Logo" />
          </div>
          <!-- Título Global (Se oculta en vistas que usan el Portal Mobile) -->
          <span 
            v-if="!['/maquinas', '/historico', '/usuarios', '/jefe'].includes(router.currentRoute.value.path)" 
            class="font-bold tracking-tight"
            :class="router.currentRoute.value.path === '/llamar'
              ? 'text-xl uppercase'
              : 'text-lg truncate max-w-37.5 sm:max-w-none'"
          >
            {{ pageTitle }}
          </span>
          
          <!-- Portal para Contenido Extra (Título + Botones rápidos) -->
          <div id="navbar-header-portal" class="flex items-center space-x-2 overflow-hidden"></div>
          
          <!-- Portal Mobile (NUEVO/RESTURADO) -->
          <div id="navbar-mobile-portal" class="lg:hidden flex items-center gap-1.5 overflow-hidden"></div>
        </div>

        <!-- Portales para acciones (Solo Desktop) -->
        <div id="navbar-actions" class="hidden lg:flex flex-1 mx-6 items-center justify-center"></div>

        <!-- Botón Hamburguesa -->
        <button 
          @click="isMenuOpen = !isMenuOpen"
          class="p-2 rounded-xs bg-gray-50 hover:bg-gray-100 text-gray-700 transition-all focus:outline-none ring-1 ring-gray-200 shrink-0"
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
        <div 
          v-if="isMenuOpen" 
          @click.self="closeMenu"
          class="bg-white border-t border-gray-100 shadow-2xl overflow-hidden"
        >
          <div class="px-3 pt-2 pb-6 space-y-2">
            <router-link 
              to="/" 
              @click="closeMenu"
              class="flex items-center px-4 py-4 rounded-xs text-lg font-bold transition-all hover:bg-gray-200 active:bg-gray-300"
              active-class="bg-blue-600 text-white shadow-lg shadow-blue-900/20"
            >
              <Wrench class="w-6 h-6 mr-4" />
              Mecánico (Carga Novedad)
            </router-link>
            
            <router-link 
              v-if="canAccessJefePanel(userRole)"
              to="/jefe" 
              @click="closeMenu"
              class="flex items-center px-4 py-4 rounded-xs text-lg font-bold transition-all hover:bg-gray-200 active:bg-gray-300"
              active-class="bg-blue-600 text-white shadow-lg shadow-blue-900/20"
            >
              <ShieldCheck class="w-6 h-6 mr-4" />
              Jefe de Mantenimiento
            </router-link>

            <router-link 
              v-if="canDespacharIntervencion(userRole)"
              to="/llamar" 
              @click="closeMenu"
              class="flex items-center px-4 py-4 rounded-xs text-lg font-bold transition-all hover:bg-gray-200 active:bg-gray-300"
              active-class="bg-orange-600 text-white shadow-lg shadow-orange-900/20"
            >
              <BellRing class="w-6 h-6 mr-4" />
              Solicitar Intervención
            </router-link>

            <router-link 
              to="/intervenciones" 
              @click="closeMenu"
              class="flex items-center px-4 py-4 rounded-xs text-lg font-bold transition-all hover:bg-gray-200 active:bg-gray-300"
              active-class="bg-orange-600 text-white shadow-lg shadow-orange-900/20"
            >
              <ClipboardList class="w-6 h-6 mr-4" />
              Intervenciones
            </router-link>

            <router-link 
              to="/historico" 
              @click="closeMenu"
              class="flex items-center px-4 py-4 rounded-xs text-lg font-bold transition-all hover:bg-gray-200 active:bg-gray-300"
              active-class="bg-blue-600 text-white shadow-lg shadow-blue-900/20"
            >
              <History class="w-6 h-6 mr-4" />
              Historial de Novedades
            </router-link>

            <router-link 
              to="/maquinas" 
              @click="closeMenu"
              class="flex items-center px-4 py-4 rounded-2xl text-lg font-bold transition-all hover:bg-gray-200 active:bg-gray-300"
              active-class="bg-indigo-600 text-white shadow-lg shadow-indigo-900/20"
            >
              <Settings2 class="w-6 h-6 mr-4" />
              Gestión de Máquinas
            </router-link>

            <router-link 
              v-if="userRole === 'admin'"
              to="/usuarios" 
              @click="closeMenu"
              class="flex items-center px-4 py-4 rounded-2xl text-lg font-bold transition-all hover:bg-gray-200 active:bg-gray-300"
              active-class="bg-amber-600 text-white shadow-lg shadow-amber-900/20"
            >
              <Users class="w-6 h-6 mr-4" />
              Gestión de Usuarios
            </router-link>

            <router-link 
              v-if="userRole === 'admin'"
              to="/traducciones" 
              @click="closeMenu"
              class="flex items-center px-4 py-4 rounded-2xl text-lg font-bold transition-all hover:bg-gray-200 active:bg-gray-300"
              active-class="bg-violet-600 text-white shadow-lg shadow-violet-900/20"
            >
              <Languages class="w-6 h-6 mr-4" />
              Traducciones de catálogo
            </router-link>

            <router-link 
              v-if="userRole === 'admin'"
              to="/codigos" 
              @click="closeMenu"
              class="flex items-center px-4 py-4 rounded-2xl text-lg font-bold transition-all hover:bg-gray-200 active:bg-gray-300"
              active-class="bg-indigo-600 text-white shadow-lg shadow-indigo-900/20"
            >
              <ListFilter class="w-6 h-6 mr-4" />
              Códigos y Tipos de Falla
            </router-link>

            <router-link 
              v-if="userRole === 'admin'"
              to="/sintomas" 
              @click="closeMenu"
              class="flex items-center px-4 py-4 rounded-2xl text-lg font-bold transition-all hover:bg-gray-200 active:bg-gray-300"
              active-class="bg-teal-600 text-white shadow-lg shadow-teal-900/20"
            >
              <Stethoscope class="w-6 h-6 mr-4" />
              Síntomas de Tejeduría
            </router-link>

            <div class="h-px bg-gray-100 my-4 mx-4"></div>
            
            <div class="px-4 py-2 flex flex-col space-y-2">
               <div class="flex items-center text-xs text-gray-500 uppercase tracking-widest font-bold">
                 <User class="w-4 h-4 mr-2" />
                 {{ user.isAnonymous ? 'Usuario Invitado' : user.email }}
               </div>
               <div v-if="userRole" class="flex items-center">
                 <span 
                     :class="userRoleLabelClass"
                   class="px-3 py-1 rounded-lg text-xs font-black tracking-tighter border"
                 >
                   Rol: {{ userRole }}
                 </span>
               </div>
            </div>

            <button 
              @click="handleLogout"
              class="w-full flex items-center px-4 py-4 rounded-xs text-xl font-bold text-red-600 transition-all hover:bg-red-100 active:bg-red-200 mt-2"
            >
              <LogOut class="w-6 h-6 mr-4" />
              Cerrar Sesión
            </button>
          </div>
        </div>
      </transition>
    </nav>

    <!-- Vistas dinámicas -->
    <main :class="{'blur-[2px] pointer-events-none transition-all duration-300': isMenuOpen}" class="pt-0">
      <router-view></router-view>
    </main>
  </div>
</template>
