<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { authService, userRole, userProfile, previewSector } from './services/authService';
import { Menu, X, LogOut, User, Wrench, ShieldCheck, History, Settings2, Users, Languages, BellRing, ClipboardList, ListFilter, Stethoscope, Eye, EyeOff, ScanSearch, AlertTriangle, ScanLine, ClipboardCheck, Route, FileText, Scissors, Gauge, BookMarked } from 'lucide-vue-next';
import { ROLE_LABEL, ROLE_OPTIONS, SECTOR_OPTIONS, isJefeRole, getQuickActions } from './constants/organization';
import { canAccessViewForUser, getDefaultRouteForUser } from './services/profileService';
import Swal from 'sweetalert2';

// Wrapper compatible con el template: respeta overrides por usuario
const canAccessView = (role, slug) => canAccessViewForUser(role, slug, userProfile.value?.vistasPersonalizadas);

const router = useRouter();
const isAuthReady = ref(false);
const user = ref(null);
const isMenuOpen = ref(false);
const hasUpdate = ref(false);
let updateCheckInterval = null;

// ── Vista Previa de Rol (solo admin) ──
const realAdminRole = ref(null);
const isPreviewMode = computed(() => realAdminRole.value !== null);
const pendingPreviewRole = ref('');
const pendingPreviewSector = ref(SECTOR_OPTIONS[0]);

const startPreview = () => {
  const role = pendingPreviewRole.value;
  const sector = pendingPreviewSector.value;
  if (!role || role === 'admin') return;
  if (!realAdminRole.value) realAdminRole.value = userRole.value;
  userRole.value = role;
  previewSector.value = sector || SECTOR_OPTIONS[0];
  closeMenu();
  router.push(getDefaultRouteForUser(role, userProfile.value?.vistasPersonalizadas));
};

const applyPreview = () => {
  const newRole = pendingPreviewRole.value;
  const newSector = pendingPreviewSector.value;
  if (!newRole || newRole === 'admin') return exitPreview();
  const roleChanged = userRole.value !== newRole;
  userRole.value = newRole;
  previewSector.value = newSector || SECTOR_OPTIONS[0];
  if (roleChanged) router.push(getDefaultRouteForUser(newRole, userProfile.value?.vistasPersonalizadas));
};

const exitPreview = () => {
  if (realAdminRole.value) {
    userRole.value = realAdminRole.value;
    realAdminRole.value = null;
    previewSector.value = null;
    pendingPreviewRole.value = '';
    pendingPreviewSector.value = SECTOR_OPTIONS[0];
    router.push('/');
  }
};

const closeMenu = () => {
  isMenuOpen.value = false;
};

let _updateDialogOpen = false; // evita múltiples Swal simultáneos

// Función para verificar actualizaciones del Service Worker
const checkForUpdates = async () => {
  if (_updateDialogOpen) return;
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (let reg of regs) {
        if (reg.waiting && navigator.serviceWorker.controller) {
          hasUpdate.value = true;
          _updateDialogOpen = true;
          // Parar el polling mientras el diálogo está visible
          clearInterval(updateCheckInterval);
          updateCheckInterval = null;

          Swal.fire({
            icon: 'info',
            title: 'Nueva versión disponible',
            text: 'Se ha detectado una actualización de la aplicación.',
            toast: true,
            position: 'top-end',
            showConfirmButton: true,
            showDenyButton: true,
            timer: undefined,
            confirmButtonText: 'Actualizar',
            denyButtonText: 'Ahora no',
            confirmButtonColor: '#16a34a'
          }).then((result) => {
            _updateDialogOpen = false;
            if (result.isConfirmed) {
              limpiarCacheYActualizar();
            } else {
              // Reiniciar polling en 10 minutos
              hasUpdate.value = false;
              updateCheckInterval = setInterval(checkForUpdates, 10 * 60 * 1000);
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
      const regs = await navigator.serviceWorker.getRegistrations();
      for (let reg of regs) {
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      for (let key of keys) {
        await caches.delete(key);
      }
    }
    await new Promise(r => setTimeout(r, 300));
    window.location.reload();
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
  if (path === '/catalogo')  return 'Explorador de Catálogo';
  if (path === '/sintomas')  return 'Síntomas de Tejeduría';
  if (path === '/rondas')    return 'Rutas de Ronda';
  if (path === '/login') return 'Ingreso al Sistema';
  if (path === '/patrulla') return 'Patrulla de Calidad';
  if (path === '/patrulla-seguimiento') return 'Patrulla (Vista)';
  if (path.startsWith('/patrulla/roturas')) return 'R1 — ROTURAS';
  if (path.startsWith('/patrulla/paro2')) return 'R2 — PAROS / DEFECTOS';
  if (path.startsWith('/patrulla/trama')) return 'R3 — TRAMA NEGRA';
  if (path.startsWith('/patrulla/paro4')) return 'R4 — PAROS / DEFECTOS';
  if (path.startsWith('/patrulla/paro5')) return 'R5 — PAROS / DEFECTOS';
  if (path.startsWith('/patrulla/roturas6')) return 'R6 — ROTURAS';
  if (path.startsWith('/patrulla/seguimiento')) return 'R7 — EVALUACIÓN';
  if (path === '/calidad') return 'CALIDAD DE SALA';
  if (path === '/eficiencia') return 'Registro de Eficiencia';
  if (path === '/shiftreport') return 'Shift Report';
  if (path === '/paros-anudado') return 'Paros / Anudados';
  if (path === '/operarios') return 'Operarios Tejeduría';
  return 'CMMS STC';
});

const showNavTitle = computed(() => {
  const p = router.currentRoute.value.path;
  if (p.startsWith('/patrulla') || p === '/patrulla-seguimiento') return false;
  return !['/maquinas', '/historico', '/usuarios', '/jefe'].includes(p)
    && !/^\/intervenciones\/.+/.test(p);
});

const userRoleLabelClass = computed(() => {
  if (userRole.value === 'admin') return 'bg-amber-500/20 text-amber-500 border-amber-500/30';
  if (isJefeRole(userRole.value) || userRole.value === 'gerente_produccion') return 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30';
  if (userRole.value?.startsWith('supervisor')) return 'bg-violet-500/20 text-violet-500 border-violet-500/30';
  return 'bg-blue-500/20 text-blue-500 border-blue-500/30';
});

// ── Tab Bar (Quick Actions globales) ────────────────────────
const tabIconMap = {
  AlertTriangle, BellRing, ScanSearch, Eye, ClipboardList,
  History, ShieldCheck, Settings2, Users, Stethoscope,
  ScanLine, ClipboardCheck, Route, Gauge, FileText,
};

const tabActions = computed(() => {
  const actions = getQuickActions(userRole.value);
  // Filtrar 'stay' actions (reportar falla = ruta /)
  return actions.map(a => ({
    ...a,
    resolvedRoute: a.route || '/',
  }));
});

const currentPath = computed(() => router.currentRoute.value.path);

const showTabBar = computed(() => {
  const p = currentPath.value;
  return user.value && p !== '/login' && tabActions.value.length > 0;
});

const navigateTab = (action) => {
  const target = action.route || '/';
  if (currentPath.value !== target) router.push(target);
  closeMenu();
};
</script>

<template>
  <div v-if="!isAuthReady" class="fixed inset-0 flex items-center justify-center bg-white z-[9999]">
    <img 
      src="/LogoSantana.jpg" 
      alt="Santana" 
      class="max-w-[100px] w-4/5 h-auto animate-pulse-soft"
    />
  </div>
  
  <div v-else class="h-screen flex flex-row bg-gray-50 overflow-hidden font-sans w-full">
    
    <!-- SIDEBAR DESKTOP (App Shell) -->
    <aside v-if="user" class="hidden lg:flex flex-none w-[72px] flex-col items-center bg-white border-r border-gray-200 py-4 shadow-sm select-none z-50">
      
      <!-- Logo Superior -->
      <div class="w-12 h-12 flex items-center justify-center mb-4 border border-gray-100 rounded-xl shadow-sm overflow-hidden shrink-0">
        <img src="/LogoSantana.jpg" class="h-8 w-auto object-contain" alt="Logo" />
      </div>

      <div class="w-8 h-px bg-gray-200 mb-3 shrink-0"></div>

      <!-- Iconos de Navegación -->
      <nav class="flex flex-col items-center gap-2 w-full px-2 overflow-y-auto min-h-0 flex-1 hide-scrollbar">
        
        <router-link
          v-if="canAccessView(userRole, 'shiftreport')"
          to="/shiftreport"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/shiftreport' ? 'bg-cyan-100 text-cyan-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <FileText class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Shift Report</span>
        </router-link>
        
        <router-link
          v-if="canAccessView(userRole, 'carga_novedad')"
          to="/"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/' ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <Wrench class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Reportar Falla</span>
        </router-link>

        <router-link
          v-if="canAccessView(userRole, 'jefe')"
          to="/jefe"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/jefe' ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <ShieldCheck class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Panel de Control</span>
        </router-link>

        <router-link
          v-if="canAccessView(userRole, 'llamar')"
          to="/llamar"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/llamar' ? 'bg-orange-100 text-orange-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <BellRing class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Solicitar Intervención</span>
        </router-link>

        <router-link
          v-if="canAccessView(userRole, 'patrulla')"
          to="/patrulla"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/patrulla' ? 'bg-cyan-100 text-cyan-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <ScanSearch class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Patrulla de Calidad</span>
        </router-link>

        <router-link
          v-if="canAccessView(userRole, 'patrulla_seguimiento')"
          to="/patrulla-seguimiento"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/patrulla-seguimiento' ? 'bg-cyan-100 text-cyan-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <Eye class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Patrulla (Vista)</span>
        </router-link>

        <router-link
          v-if="canAccessView(userRole, 'eficiencia')"
          to="/eficiencia"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/eficiencia' ? 'bg-violet-100 text-violet-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <Gauge class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Registro de Eficiencia</span>
        </router-link>

        <router-link
          v-if="canAccessView(userRole, 'intervenciones')"
          to="/intervenciones"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/intervenciones' ? 'bg-orange-100 text-orange-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <ClipboardList class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Intervenciones</span>
        </router-link>

        <router-link
          v-if="canAccessView(userRole, 'historico')"
          to="/historico"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/historico' ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <History class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Historial de Novedades</span>
        </router-link>

        <router-link
          v-if="canAccessView(userRole, 'maquinas')"
          to="/maquinas"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/maquinas' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <Settings2 class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Gestión de Máquinas</span>
        </router-link>

        <router-link
          v-if="canAccessView(userRole, 'usuarios')"
          to="/usuarios"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/usuarios' ? 'bg-amber-100 text-amber-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <Users class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Gestión de Usuarios</span>
        </router-link>
        
        <router-link
          v-if="canAccessView(userRole, 'traducciones')"
          to="/traducciones"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/traducciones' ? 'bg-violet-100 text-violet-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <Languages class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Traducciones</span>
        </router-link>

        <router-link
          v-if="canAccessView(userRole, 'codigos')"
          to="/codigos"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/codigos' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <ListFilter class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Códigos y Falla</span>
        </router-link>

        <router-link
          v-if="canAccessView(userRole, 'catalogo')"
          to="/catalogo"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/catalogo' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <BookMarked class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Catálogo Máquinas</span>
        </router-link>

        <router-link
          v-if="canAccessView(userRole, 'sintomas')"
          to="/sintomas"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/sintomas' ? 'bg-teal-100 text-teal-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <Stethoscope class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Síntomas</span>
        </router-link>

        <router-link
          v-if="canAccessView(userRole, 'rondas')"
          to="/rondas"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/rondas' ? 'bg-violet-100 text-violet-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <Route class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Rutas de Ronda</span>
        </router-link>

        <router-link
          v-if="canAccessView(userRole, 'operarios')"
          to="/operarios"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/operarios' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <Users class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Operarios Tejeduría</span>
        </router-link>

        <router-link
          v-if="canAccessView(userRole, 'paros-anudado')"
          to="/paros-anudado"
          class="group relative w-full flex items-center justify-center h-12 rounded-xl transition-all"
          :class="$route.path === '/paros-anudado' ? 'bg-orange-100 text-orange-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'"
        >
          <Scissors class="w-5 h-5" />
          <span class="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50">Paros / Anudados</span>
        </router-link>
      </nav>

      <div class="w-8 h-px bg-gray-200 mt-2 mb-3 shrink-0"></div>

      <!-- Simulador de Rol (Desktop) -->
      <div v-if="!isPreviewMode && (realAdminRole || userRole) === 'admin'" class="w-full px-2 mb-3 relative group">
        <button class="w-full flex justify-center items-center h-10 rounded-xl bg-orange-50 text-orange-500 hover:bg-orange-100 transition-all border border-orange-200/50">
          <Eye class="w-4 h-4" />
        </button>
        <div class="pointer-events-none absolute left-full ml-3 bottom-0 rounded-lg bg-white border border-gray-200 shadow-xl p-3 opacity-0 group-hover:opacity-100 transition-opacity z-50 flex flex-col gap-2 w-48 pointer-events-auto hover:pointer-events-auto">
          <p class="text-[10px] font-black text-orange-500 uppercase tracking-widest flex items-center gap-1">
            <Eye class="w-3 h-3" /> Vista Previa
          </p>
          <select
            v-model="pendingPreviewRole"
            class="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-orange-500/20 cursor-pointer"
          >
            <option value="" disabled>Rol...</option>
            <option v-for="r in ROLE_OPTIONS.filter(r => r.value !== 'admin')" :key="r.value" :value="r.value">{{ r.label }}</option>
          </select>
          <select
            v-model="pendingPreviewSector"
            class="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-orange-500/20 cursor-pointer"
          >
            <option v-for="s in SECTOR_OPTIONS" :key="s" :value="s">{{ s }}</option>
          </select>
          <button
            :disabled="!pendingPreviewRole"
            @click="startPreview"
            class="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all"
            :class="pendingPreviewRole ? 'bg-orange-500 text-white hover:bg-orange-600 active:scale-95' : 'bg-gray-100 text-gray-400 cursor-not-allowed'"
          >
            Simular
          </button>
        </div>
      </div>

      <!-- User & Logout -->
      <div class="w-full px-2 flex flex-col items-center gap-2 relative shrink-0">
        <div class="group/user w-full relative">
          <button class="w-full flex justify-center items-center h-10 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 transition-all border border-gray-200/50">
            <User class="w-4 h-4" />
          </button>
          <div class="pointer-events-none absolute left-full ml-3 bottom-0 whitespace-nowrap rounded-lg bg-gray-800 text-white shadow-lg p-3 text-xs opacity-0 group-hover/user:opacity-100 transition-opacity z-50 flex flex-col gap-1">
            <span class="font-bold text-gray-400 uppercase tracking-widest text-[10px]">Usuario</span>
            <span class="text-sm font-black">{{ user ? (user.isAnonymous ? 'Invitado' : user.email) : '' }}</span>
            <div v-if="userRole" class="mt-1">
              <span :class="userRoleLabelClass" class="px-2 py-0.5 rounded-md border text-[10px] uppercase font-bold bg-transparent">
                {{ ROLE_LABEL[userRole] || userRole }}
              </span>
            </div>
          </div>
        </div>

        <div class="group/logout w-full relative pb-2">
          <button 
            @click="handleLogout"
            class="w-full flex items-center justify-center h-10 rounded-xl text-red-500 bg-red-50 hover:bg-red-100 transition-all border border-red-100"
          >
            <LogOut class="w-4 h-4" />
          </button>
          <span class="pointer-events-none absolute left-full ml-3 bottom-2 whitespace-nowrap rounded-lg bg-red-600 text-white shadow-lg px-2.5 py-1.5 text-xs font-bold opacity-0 group-hover/logout:opacity-100 transition-opacity z-50">Cerrar Sesión</span>
        </div>
      </div>

    </aside>

    <!-- MAIN CONTENT COLUMN -->
    <div class="flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative">
      
      <!-- Overlay de cierre Móvil -->
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
          class="fixed inset-0 bg-black/40 backdrop-blur-sm z-[45] lg:hidden"
        ></div>
      </transition>

      <!-- Barra de Navegación Móvil / Tablet (Oculta en Desktop) -->
      <nav v-if="user" class="lg:hidden bg-white text-gray-900 shadow-sm border-b border-gray-100 shrink-0 z-50 relative">
        <div class="px-4 h-[54px] flex justify-between items-center">
          <div class="flex items-center space-x-3 flex-1 min-w-0 overflow-hidden">
            <div class="bg-white p-px rounded-xs border border-gray-200 overflow-hidden flex items-center justify-center shrink-0">
              <img src="/LogoSantana.jpg" class="h-6 w-auto object-contain" alt="Logo" />
            </div>
            <span 
              v-if="showNavTitle" 
              class="font-bold tracking-tight text-lg"
            >
              {{ pageTitle }}
            </span>
            <div id="navbar-header-portal" class="flex items-center space-x-2 overflow-hidden"></div>
            <div id="navbar-mobile-portal" class="flex items-center gap-1.5 overflow-hidden"></div>
          </div>
          <button 
            @click="isMenuOpen = !isMenuOpen"
            class="p-1.5 rounded-xs bg-gray-50 hover:bg-gray-100 text-gray-700 transition-all focus:outline-none ring-1 ring-gray-200 shrink-0 ml-2"
          >
            <Menu v-if="!isMenuOpen" class="w-5 h-5" />
            <X v-else class="w-5 h-5" />
          </button>
        </div>

        <!-- Menú Desplegable Móvil -->
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
            class="absolute top-[54px] left-0 right-0 bg-white border-b border-gray-100 shadow-2xl overflow-y-auto max-h-[calc(100vh-54px)] z-[60]"
          >
            <div class="px-3 py-4 space-y-1.5" :class="showTabBar ? 'pb-24' : 'pb-6'">
              <router-link v-if="canAccessView(userRole, 'shiftreport')" to="/shiftreport" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-cyan-50 text-cyan-700">
                <FileText class="w-5 h-5 mr-3 opacity-70" /> Shift Report
              </router-link>
              <router-link v-if="canAccessView(userRole, 'carga_novedad')" to="/" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-blue-50 text-blue-700">
                <Wrench class="w-5 h-5 mr-3 opacity-70" /> Reportar Falla
              </router-link>
              <router-link v-if="canAccessView(userRole, 'jefe')" to="/jefe" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-blue-50 text-blue-700">
                <ShieldCheck class="w-5 h-5 mr-3 opacity-70" /> Panel de Control
              </router-link>
              <router-link v-if="canAccessView(userRole, 'llamar')" to="/llamar" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-orange-50 text-orange-700">
                <BellRing class="w-5 h-5 mr-3 opacity-70" /> Solicitar Intervención
              </router-link>
              <router-link v-if="canAccessView(userRole, 'patrulla')" to="/patrulla" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-cyan-50 text-cyan-700">
                <ScanSearch class="w-5 h-5 mr-3 opacity-70" /> Patrulla de Calidad
              </router-link>
              <router-link v-if="canAccessView(userRole, 'patrulla_seguimiento')" to="/patrulla-seguimiento" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-cyan-50 text-cyan-700">
                <Eye class="w-5 h-5 mr-3 opacity-70" /> Patrulla (Vista)
              </router-link>
              <router-link v-if="canAccessView(userRole, 'eficiencia')" to="/eficiencia" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-violet-50 text-violet-700">
                <Gauge class="w-5 h-5 mr-3 opacity-70" /> Registro de Eficiencia
              </router-link>
              <router-link v-if="canAccessView(userRole, 'intervenciones')" to="/intervenciones" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-orange-50 text-orange-700">
                <ClipboardList class="w-5 h-5 mr-3 opacity-70" /> Intervenciones
              </router-link>
              <router-link v-if="canAccessView(userRole, 'historico')" to="/historico" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-blue-50 text-blue-700">
                <History class="w-5 h-5 mr-3 opacity-70" /> Historial de Novedades
              </router-link>
              <router-link v-if="canAccessView(userRole, 'maquinas')" to="/maquinas" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-indigo-50 text-indigo-700">
                <Settings2 class="w-5 h-5 mr-3 opacity-70" /> Gestión de Máquinas
              </router-link>
              <router-link v-if="canAccessView(userRole, 'usuarios')" to="/usuarios" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-amber-50 text-amber-700">
                <Users class="w-5 h-5 mr-3 opacity-70" /> Gestión de Usuarios
              </router-link>
              <router-link v-if="canAccessView(userRole, 'traducciones')" to="/traducciones" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-violet-50 text-violet-700">
                <Languages class="w-5 h-5 mr-3 opacity-70" /> Traducciones de catálogo
              </router-link>
              <router-link v-if="canAccessView(userRole, 'codigos')" to="/codigos" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-indigo-50 text-indigo-700">
                <ListFilter class="w-5 h-5 mr-3 opacity-70" /> Códigos y Tipos de Falla
              </router-link>
              <router-link v-if="canAccessView(userRole, 'catalogo')" to="/catalogo" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-indigo-50 text-indigo-700">
                <BookMarked class="w-5 h-5 mr-3 opacity-70" /> Catálogo de Máquinas
              </router-link>
              <router-link v-if="canAccessView(userRole, 'sintomas')" to="/sintomas" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-teal-50 text-teal-700">
                <Stethoscope class="w-5 h-5 mr-3 opacity-70" /> Síntomas de Tejeduría
              </router-link>
              <router-link v-if="canAccessView(userRole, 'rondas')" to="/rondas" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-violet-50 text-violet-700">
                <Route class="w-5 h-5 mr-3 opacity-70" /> Rutas de Ronda
              </router-link>
              <router-link v-if="canAccessView(userRole, 'operarios')" to="/operarios" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-indigo-50 text-indigo-700">
                <Users class="w-5 h-5 mr-3 opacity-70" /> Operarios Tejeduría
              </router-link>
              <router-link v-if="canAccessView(userRole, 'paros-anudado')" to="/paros-anudado" @click="closeMenu" class="flex items-center px-4 py-3 rounded-xl text-[15px] font-bold transition-all hover:bg-gray-50" active-class="bg-orange-50 text-orange-700">
                <Scissors class="w-5 h-5 mr-3 opacity-70" /> Paros / Anudados
              </router-link>

              <div class="h-px bg-gray-100 my-2 mx-2"></div>
              
              <div class="px-2 py-2 flex flex-col space-y-1">
                 <div class="flex items-center text-xs text-gray-500 uppercase tracking-widest font-bold">
                   <User class="w-4 h-4 mr-2" />
                   {{ user ? (user.isAnonymous ? 'Usuario Invitado' : user.email) : '' }}
                 </div>
                 <div v-if="userRole" class="flex items-center mt-1">
                   <span :class="userRoleLabelClass" class="px-2 py-0.5 rounded text-[10px] font-black tracking-tighter border">
                     {{ ROLE_LABEL[userRole] || userRole }}
                   </span>
                 </div>
              </div>

              <button 
                @click="handleLogout"
                class="w-full flex items-center px-4 py-3 rounded-xl text-[15px] font-bold text-red-600 transition-all hover:bg-red-50 mt-1"
              >
                <LogOut class="w-5 h-5 mr-3" /> Cerrar Sesión
              </button>

              <div v-if="!isPreviewMode && (realAdminRole || userRole) === 'admin'" class="mt-3 px-2">
                <div class="border border-orange-200 rounded-xl p-3 bg-orange-50/50">
                  <p class="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                    <Eye class="w-3 h-3" /> Vista Previa
                  </p>
                  <div class="flex gap-2 mb-2">
                    <select v-model="pendingPreviewRole" class="flex-1 bg-white border border-orange-200 rounded-lg px-2 py-1.5 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-orange-500/20">
                      <option value="" disabled>Rol...</option>
                      <option v-for="r in ROLE_OPTIONS.filter(r => r.value !== 'admin')" :key="r.value" :value="r.value">{{ r.label }}</option>
                    </select>
                    <select v-model="pendingPreviewSector" class="bg-white border border-orange-200 rounded-lg px-2 py-1.5 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-orange-500/20">
                      <option v-for="s in SECTOR_OPTIONS" :key="s" :value="s">{{ s }}</option>
                    </select>
                  </div>
                  <button :disabled="!pendingPreviewRole" @click="startPreview" class="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all" :class="pendingPreviewRole ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-400'">
                    Simular
                  </button>
                </div>
              </div>
            </div>
          </div>
        </transition>
      </nav>

      <!-- Router View Workspace -->
      <main class="flex-1 overflow-y-auto relative w-full h-full min-h-0 bg-transparent pb-0" :style="showTabBar ? (isPreviewMode ? 'padding-bottom: 96px' : 'padding-bottom: 56px') : (isPreviewMode ? 'padding-bottom: 40px' : '')">
        <router-view></router-view>
      </main>

      <!-- 📱 Tab Bar global Mobile -->
      <div v-if="showTabBar" class="lg:hidden fixed inset-x-0 z-[90] bg-white border-t border-gray-200 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]" :style="isPreviewMode ? 'bottom: 40px' : 'bottom: 0'">
        <div class="max-w-lg mx-auto flex items-center justify-around px-1 py-1">
          <button
            v-for="tab in tabActions"
            :key="tab.id"
            @click="navigateTab(tab)"
            class="flex flex-col items-center justify-center flex-1 py-1.5 rounded-lg transition-colors min-w-0"
            :class="currentPath === (tab.route || '/') ? 'text-blue-600' : 'text-gray-400 active:text-gray-600'"
          >
            <component :is="tabIconMap[tab.icon]" v-if="tabIconMap[tab.icon]" class="w-5 h-5" />
            <span class="text-[9px] font-bold mt-0.5 truncate max-w-full px-1">{{ tab.label }}</span>
          </button>
        </div>
      </div>
      
      <!-- 👁 Barra Vista Previa (admin only) -->
      <div v-if="isPreviewMode" class="fixed bottom-0 inset-x-0 z-[99] bg-orange-500 text-white px-3 py-1.5 shadow-lg shadow-orange-900/30">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <Eye class="w-3.5 h-3.5 shrink-0 animate-pulse" />
            <span class="text-[10px] font-black tracking-wide truncate">PREVIA</span>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <select v-model="pendingPreviewRole" class="bg-orange-600 text-white text-[10px] font-bold rounded px-1 py-1 border border-orange-400 outline-none cursor-pointer max-w-[110px]">
              <option v-for="r in ROLE_OPTIONS.filter(r => r.value !== 'admin')" :key="r.value" :value="r.value">{{ r.label }}</option>
            </select>
            <select v-model="pendingPreviewSector" class="bg-orange-600 text-white text-[10px] font-bold rounded px-1 py-1 border border-orange-400 outline-none cursor-pointer">
              <option v-for="s in SECTOR_OPTIONS" :key="s" :value="s">{{ s }}</option>
            </select>
            <button @click="applyPreview" class="px-2 py-1 bg-orange-700 text-white rounded text-[10px] font-black hover:bg-orange-800 transition-all active:scale-95 border border-orange-400">
              Aplicar
            </button>
            <button @click="exitPreview" class="flex items-center gap-1 px-2 py-1 bg-white text-orange-600 rounded text-[10px] font-black hover:bg-orange-50 transition-all active:scale-95">
              <EyeOff class="w-3 h-3" />
              Salir
            </button>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
