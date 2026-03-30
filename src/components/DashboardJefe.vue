<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { aiService } from '../services/aiService';
import { notificationService } from '../services/notificationService';
import { userProfile, userRole, previewSector } from '../services/authService';
import { db, auth } from '../firebase/config';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Clock, AlertTriangle, CheckCircle, Image as ImageIcon, CheckSquare, Wrench, Zap, Filter, Sparkles, Copy, ChevronUp, ChevronDown, TrendingUp, RefreshCw, Calendar } from 'lucide-vue-next';
import Swal from 'sweetalert2';
import { DEFAULT_SECTOR, SECTOR_OPTIONS, normalizeSectorValue, sanitizeSectorList, isJefeRole, ROLE_SECTOR_DEFAULT } from '../constants/organization';
import { Building2 } from 'lucide-vue-next';

// Hora del build incrustada por Vite (definida en `vite.config.js` como __BUILD_TIME__)
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

const novedades = ref([]);
const filtroTipo = ref('Todos'); // 'Todos', 'Mecánico', 'Eléctrico'
const filtroSector = ref('Todos');
let unsubscribe = null;
const modalAprobacion = ref(false);
const novedadActual = ref(null);
const feedback = ref('');
const isLoading = ref(true);
const errorCarga = ref(false);

// Usa userRole (cambia en Vista Previa) en lugar de perfil.role
const sectoresVisibles = computed(() => {
  const perfil = userProfile.value;
  if (!perfil) return [DEFAULT_SECTOR];
  const activeRole = userRole.value || perfil.role;

  // Solo admin activo (no en preview) tiene acceso global
  if (activeRole === 'admin' && perfil.alcance === 'global') return null;

  // En Vista Previa como otro rol, usar sector seleccionado en la barra
  if (perfil.role === 'admin' && activeRole !== 'admin') {
    return previewSector.value ? [previewSector.value] : SECTOR_OPTIONS;
  }

  if (isJefeRole(activeRole)) {
    const sectoresJefe = perfil.jefeDeSectores?.length ? perfil.jefeDeSectores : perfil.sectoresAsignados;
    return sanitizeSectorList(sectoresJefe, perfil.sectorDefault);
  }

  return sanitizeSectorList(perfil.sectoresAsignados, perfil.sectorDefault);
});

// Opciones de sector para el dropdown
const opcionesSectorFiltro = computed(() => {
  if (!sectoresVisibles.value) return SECTOR_OPTIONS;
  return sectoresVisibles.value;
});

const mostrarFiltroSector = computed(() => {
  return opcionesSectorFiltro.value.length > 1;
});

const iaSummary = ref('');
const iaSummaryRaw = ref('');
const isIaLoading = ref(true);
const iaError = ref(false);
const iaFromCache = ref(false);
const iaCollapsed = ref(false);

// --- Resumen Ejecutivo Semanal ---
const execSummary = ref('');
const execSummaryRaw = ref('');
const isExecLoading = ref(false);
const execError = ref(false);
const execFromCache = ref(false);
const execCollapsed = ref(false);
const execPeriodo = ref(7);

let authUnsubscribe = null;
let timeoutId = null;

const cargarDatos = async () => {
  isLoading.value = true;
  errorCarga.value = false;

  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  // No need for unsubscribe here as getDocs is a one-time fetch

  timeoutId = setTimeout(() => {
    if (isLoading.value && novedades.value.length === 0) {
      errorCarga.value = true;
      isLoading.value = false;
    }
  }, 10000);

  try {
    const q = query(
      collection(db, 'novedades'),
      where('estado', 'in', ['pendiente', 'en proceso'])
    );
    const snapshot = await getDocs(q);
    clearTimeout(timeoutId);

    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Ordenar por fecha descendente
    const ordenadas = data.sort((a, b) => {
      const getTime = (val) => {
        if (!val) return 0;
        if (typeof val.toMillis === 'function') return val.toMillis();
        return new Date(val).getTime() || 0;
      };
      return getTime(b.createdAt) - getTime(a.createdAt);
    });

    if (sectoresVisibles.value === null) {
      novedades.value = ordenadas;
    } else {
      novedades.value = ordenadas.filter((n) => sectoresVisibles.value.includes(normalizeSectorValue(n.sector || DEFAULT_SECTOR)));
    }

    isLoading.value = false;
    errorCarga.value = false;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("Error cargando novedades:", err);
    if (novedades.value.length === 0) {
      errorCarga.value = true;
    }
    isLoading.value = false;
  }
};

onMounted(() => {
  // Cargamos los datos directamente. Al estar protegida por el router y tener el delay 
  // en el router guard, el usuario y su rol ya deberían estar listos.
  cargarDatos();
  cargarAnalisisIA();
  cargarResumenEjecutivo();

  // Registrar servicios de notificación si hay usuario
  if (auth.currentUser) {
    notificationService.solicitarPermisosYRegistrarToken(auth.currentUser.uid)
      .then(() => notificationService.escucharMensajesEnPrimerPlano())
      .catch(err => console.warn('FCM no disponible:', err));
  } else {
    // Si el usuario aún no está listo (race conditions), nos suscribimos al estado de auth
    authUnsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        notificationService.solicitarPermisosYRegistrarToken(user.uid)
          .then(() => notificationService.escucharMensajesEnPrimerPlano())
          .catch(err => console.warn('FCM no disponible:', err));
        // Una vez registrado, nos desuscribimos
        if (authUnsubscribe) {
          authUnsubscribe();
          authUnsubscribe = null;
        }
      }
    });
  }
});

onUnmounted(() => {
  // Limpieza completa de recursos
  if (unsubscribe && typeof unsubscribe === 'function') {
    unsubscribe();
    unsubscribe = null;
  }
  if (authUnsubscribe && typeof authUnsubscribe === 'function') {
    authUnsubscribe();
    authUnsubscribe = null;
  }
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
});

const getCardColorClass = (novedad) => {
  if (novedad.critico && novedad.estado === 'pendiente') {
    return 'bg-red-500 text-white border-red-600 shadow-red-200';
  } else if (novedad.estado === 'en proceso') {
    return 'bg-yellow-400 text-yellow-900 border-yellow-500 shadow-yellow-200';
  } else if (novedad.estado === 'resuelto') {
    return 'bg-green-200 text-green-900 border-green-300 shadow-green-100'; // Though they shouldn't appear by default due to query, just in case
  } else {
    // Pendiente NO critico
    return 'bg-white text-gray-800 border-gray-200 shadow-gray-100';
  }
};

const formatDate = (timestamp) => {
  if (!timestamp) return 'Justo ahora...';
  const date = timestamp.toDate();
  return date.toLocaleString();
};

const abrirModal = (novedad) => {
  novedadActual.value = novedad;
  feedback.value = '';
  modalAprobacion.value = true;
};

const cerrarModal = () => {
  modalAprobacion.value = false;
  novedadActual.value = null;
};

const aprobarNovedad = async (estado) => {
  if (!novedadActual.value) return;
  try {
    await mantenimientoService.aprobarNovedad(novedadActual.value.id, estado, feedback.value);
    cerrarModal();
    Swal.fire({ icon: 'success', title: '¡Estado actualizado!', timer: 1800, showConfirmButton: false, toast: true, position: 'top-end' });
  } catch (error) {
    Swal.fire({ icon: 'error', title: 'Error al actualizar', text: 'No se pudo cambiar el estado de la novedad.' });
  }
};

const cargarAnalisisIA = async (forceRegenerate = false) => {
  isIaLoading.value = true;
  iaError.value = false;
  try {
    const response = await aiService.generarResumenDiario(forceRegenerate, null, sectoresVisibles.value);
    iaSummaryRaw.value = response.text;
    iaSummary.value = formatMarkdown(response.text);
    iaFromCache.value = response.fromCache;
  } catch (error) {
    console.error("No se pudo cargar análisis de IA", error);
    iaError.value = true;
  } finally {
    isIaLoading.value = false;
  }
};

const cargarResumenEjecutivo = async (forceRegenerate = false) => {
  isExecLoading.value = true;
  execError.value = false;
  try {
    const response = await aiService.generarResumenEjecutivo(forceRegenerate, execPeriodo.value, sectoresVisibles.value);
    execSummaryRaw.value = response.text;
    execSummary.value = formatMarkdown(response.text);
    execFromCache.value = response.fromCache;
  } catch (error) {
    console.error("No se pudo cargar resumen ejecutivo", error);
    execError.value = true;
  } finally {
    isExecLoading.value = false;
  }
};

const copiarWhatsAppExec = () => {
  if (!execSummaryRaw.value) return;
  navigator.clipboard.writeText(execSummaryRaw.value).then(() => {
    Swal.fire({ icon: 'success', title: '¡Copiado!', text: 'El informe semanal está listo para pegar en WhatsApp.', timer: 2000, showConfirmButton: false, toast: true, position: 'top-end' });
  }).catch(err => {
    console.error('Error copiando:', err);
    Swal.fire({ icon: 'error', title: 'Oops...', text: 'No se pudo copiar al portapapeles.' });
  });
};

const copiarWhatsApp = () => {
  if (!iaSummaryRaw.value) return;
  navigator.clipboard.writeText(iaSummaryRaw.value).then(() => {
    Swal.fire({ icon: 'success', title: '¡Copiado!', text: 'El reporte está listo para pegar en WhatsApp.', timer: 2000, showConfirmButton: false, toast: true, position: 'top-end' });
  }).catch(err => {
    console.error('Error copiando:', err);
    Swal.fire({ icon: 'error', title: 'Oops...', text: 'No se pudo copiar al portapapeles.' });
  });
};

const formatMarkdown = (text) => {
  if (!text) return '';
  // Convertimos el formato WhatsApp (*negrita* y _cursiva_) a HTML para pintarlo en la web
  return text
    .replace(/\*(.*?)\*/g, '<b>$1</b>')
    .replace(/_(.*?)_/g, '<i>$1</i>')
    .replace(/\n/g, '<br/>');
};

// Novedades filtradas por sector primero, luego por tipo
const novedadesPorSector = computed(() => {
  if (filtroSector.value === 'Todos') return novedades.value;
  return novedades.value.filter(n => normalizeSectorValue(n.sector || DEFAULT_SECTOR) === filtroSector.value);
});

const novedadesFiltradas = computed(() => {
  const base = novedadesPorSector.value;
  if (filtroTipo.value === 'Todos') return base;
  return base.filter(n => (n.tipoProblema || 'Mecánico') === filtroTipo.value);
});

const mecanicasCount = computed(() => novedadesPorSector.value.filter(n => (n.tipoProblema || 'Mecánico') === 'Mecánico').length);
const electricasCount = computed(() => novedadesPorSector.value.filter(n => n.tipoProblema === 'Eléctrico').length);
</script>

<template>
  <div class="min-h-screen bg-gray-100 pb-10">
    <!-- Alerta Crítica Flotante (Opcional, ahora que el header es global) -->
    <div v-if="novedades.some(n => n.critico && n.estado === 'pendiente')" 
      class="bg-red-600 text-white text-[10px] font-black py-1 px-4 text-center tracking-widest sticky top-16 z-40 shadow-md">
      ¡Hay fallas críticas pendientes!
    </div>


    <!-- Portal para Navbar (Mobile) -->
    <Teleport to="#navbar-mobile-portal">
      <div v-if="novedades.length > 0" class="flex items-center gap-2">
        <h1 class="text-xs font-black text-white tracking-tighter shrink-0">Panel</h1>
        <div class="flex items-center gap-1">
          <span v-if="mecanicasCount > 0" class="bg-blue-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-md shrink-0 border border-blue-400">
             <Wrench class="w-2.5 h-2.5 inline mr-0.5" />{{ mecanicasCount }}
          </span>
          <span v-if="electricasCount > 0" class="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-md shrink-0 border border-amber-300">
             <Zap class="w-2.5 h-2.5 inline mr-0.5" />{{ electricasCount }}
          </span>
        </div>
      </div>
    </Teleport>

    <main class="px-4 max-w-5xl mx-auto pt-4 lg:pt-8">
      
      <!-- Estado de Carga (Solo si no hay datos) -->
      <div v-if="isLoading && novedades.length === 0" class="text-center py-20 flex flex-col items-center animate-in fade-in duration-500">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <p class="text-gray-500 font-medium mb-4">Cargando novedades...</p>
        <div class="space-y-2">
          <button @click="cargarDatos" class="text-[10px] font-black tracking-widest text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 hover:bg-blue-100 transition-all">
            Forzar reintento
          </button>
          <p class="text-[8px] text-gray-300 font-bold tracking-widest">Build: {{ BUILD_TIME }}</p>
        </div>
      </div>

      <!-- Error de Carga (Solo si no hay datos y falló) -->
      <div v-else-if="errorCarga && novedades.length === 0" class="text-center py-20 animate-in zoom-in duration-300">
        <AlertTriangle class="w-16 h-16 text-red-500 mx-auto mb-4" />
        <h2 class="text-2xl font-bold text-gray-800 tracking-tight">Error de conexión</h2>
        <p class="text-gray-500 mb-6 font-medium">No se pudieron obtener datos. Verifica tu red.</p>
        <button 
          @click="cargarDatos" 
          class="bg-blue-600 text-white px-8 py-3 rounded-2xl font-black shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all uppercase tracking-widest text-sm">
          Reintentar Ahora
        </button>
      </div>

      <!-- Panel de Inteligencia Artificial -->
      <div v-if="novedades.length > 0 && !errorCarga" class="mb-8 bg-linear-to-r from-indigo-50 to-purple-50 rounded-3xl p-4 md:p-6 lg:mx-8 border border-indigo-100 shadow-sm relative overflow-hidden">
         <div class="absolute top-0 right-0 p-4 opacity-10">
            <Sparkles class="w-24 h-24 text-indigo-600" />
         </div>
         
         <div class="flex items-center justify-between mb-2 z-10 relative border-b border-indigo-100/50 pb-2">
           <!-- Titulo -->
           <h3 class="flex items-center text-lg md:text-xl font-black text-indigo-900 truncate pr-2" @click="iaCollapsed = !iaCollapsed">
             <Sparkles class="w-5 h-5 md:w-6 md:h-6 mr-1.5 md:mr-2 text-indigo-600 shrink-0" /> 
             <span class="truncate cursor-pointer select-none hover:opacity-80 transition-opacity">Análisis IA (Ayer)</span>
           </h3>
           
           <!-- Acciones -->
           <div class="flex items-center gap-1.5 shrink-0">
             <div v-if="!isIaLoading && iaSummary" class="flex items-center gap-1.5">
               <button @click="copiarWhatsApp" title="Copiar para WhatsApp" class="bg-green-500 text-white font-black px-2 md:px-3 py-1 md:py-1.5 rounded-lg md:rounded-full hover:bg-green-600 transition shadow-md border border-green-600 flex items-center shrink-0">
                 <Copy class="w-4 h-4 md:w-3.5 md:h-3.5 md:mr-1" />
                 <span class="hidden md:inline text-[10px] uppercase tracking-wider">WhatsApp</span>
               </button>
               
               <template v-if="iaFromCache">
                 <button @click="cargarAnalisisIA(true)" title="Regenerar Análisis" class="bg-white border border-indigo-200 text-indigo-600 font-black px-2 md:px-3 py-1 md:py-1.5 rounded-lg md:rounded-full hover:bg-indigo-50 transition shadow-sm shrink-0 flex items-center">
                   <Sparkles class="w-4 h-4 md:w-3.5 md:h-3.5 md:mr-1" />
                   <span class="hidden md:inline text-[10px] uppercase tracking-wider">Regenerar</span>
                 </button>
               </template>
             </div>
             
             <!-- Separador Vertical -->
             <div class="w-px h-5 bg-indigo-200 mx-0.5 md:mx-1"></div>
             
             <!-- Colapsar -->
             <button 
               @click="iaCollapsed = !iaCollapsed" 
               class="bg-indigo-100 text-indigo-700 hover:bg-indigo-200 p-1 md:p-1.5 rounded-lg transition-colors shadow-sm shrink-0 border border-indigo-200"
               title="Expandir/Contraer"
             >
               <ChevronUp v-if="!iaCollapsed" class="w-4 h-4 md:w-5 md:h-5 stroke-3" />
               <ChevronDown v-else class="w-4 h-4 md:w-5 md:h-5 stroke-3" />
             </button>
           </div>
         </div>

         <div v-show="!iaCollapsed" class="overflow-hidden transition-all duration-300">
           <div v-if="isIaLoading" class="flex flex-col items-center justify-center py-4 z-10 relative">
             <div class="animate-pulse flex gap-2 w-full max-w-sm">
                <div class="h-2 bg-indigo-200 rounded w-full"></div>
                <div class="h-2 bg-indigo-200 rounded w-1/2"></div>
             </div>
             <p class="text-xs text-indigo-600 font-bold mt-2 uppercase tracking-wide">Generando Resumen...</p>
           </div>
           
           <div v-else-if="iaError" class="text-indigo-800 text-sm font-semibold z-10 relative">
             No se pudo generar el resumen automáticamente hoy.
             <button @click="cargarAnalisisIA" class="underline ml-2">Reintentar</button>
           </div>

           <div v-else class="text-indigo-950 text-base md:text-lg leading-relaxed z-10 relative font-medium space-y-2 p-3 bg-white/70 rounded-2xl border border-white max-w-none" v-html="iaSummary">
           </div>
         </div>
      </div>

      <!-- Panel Resumen Ejecutivo Semanal -->
      <div v-if="!errorCarga" class="mb-8 bg-linear-to-r from-emerald-50 to-teal-50 rounded-3xl p-4 md:p-6 lg:mx-8 border border-emerald-100 shadow-sm relative overflow-hidden">
         <div class="absolute top-0 right-0 p-4 opacity-10">
            <TrendingUp class="w-24 h-24 text-emerald-600" />
         </div>
         
         <div class="flex items-center justify-between mb-2 z-10 relative border-b border-emerald-100/50 pb-2">
           <h3 class="flex items-center text-lg md:text-xl font-black text-emerald-900 truncate pr-2" @click="execCollapsed = !execCollapsed">
             <TrendingUp class="w-5 h-5 md:w-6 md:h-6 mr-1.5 md:mr-2 text-emerald-600 shrink-0" /> 
             <span class="truncate cursor-pointer select-none hover:opacity-80 transition-opacity">Informe Ejecutivo</span>
             <span class="ml-2 text-xs font-bold bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full shrink-0">{{ execPeriodo }}d</span>
           </h3>
           
           <div class="flex items-center gap-1.5 shrink-0">
             <!-- Selector de período -->
             <div v-if="!isExecLoading" class="flex items-center bg-white rounded-lg border border-emerald-200 shadow-sm overflow-hidden">
               <button v-for="p in [7, 15, 30]" :key="p" 
                 @click="execPeriodo = p; cargarResumenEjecutivo(true)"
                 :class="execPeriodo === p ? 'bg-emerald-600 text-white' : 'text-emerald-700 hover:bg-emerald-50'"
                 class="px-2 py-1 text-[10px] font-black transition">
                 {{ p }}d
               </button>
             </div>
             
             <div v-if="!isExecLoading && execSummary" class="flex items-center gap-1.5">
               <button @click="copiarWhatsAppExec" title="Copiar para WhatsApp" class="bg-green-500 text-white font-black px-2 md:px-3 py-1 md:py-1.5 rounded-lg md:rounded-full hover:bg-green-600 transition shadow-md border border-green-600 flex items-center shrink-0">
                 <Copy class="w-4 h-4 md:w-3.5 md:h-3.5 md:mr-1" />
                 <span class="hidden md:inline text-[10px] uppercase tracking-wider">WhatsApp</span>
               </button>
               
               <template v-if="execFromCache">
                 <button @click="cargarResumenEjecutivo(true)" title="Regenerar Informe" class="bg-white border border-emerald-200 text-emerald-600 font-black px-2 md:px-3 py-1 md:py-1.5 rounded-lg md:rounded-full hover:bg-emerald-50 transition shadow-sm shrink-0 flex items-center">
                   <RefreshCw class="w-4 h-4 md:w-3.5 md:h-3.5 md:mr-1" />
                   <span class="hidden md:inline text-[10px] uppercase tracking-wider">Regenerar</span>
                 </button>
               </template>
             </div>
             
             <div class="w-px h-5 bg-emerald-200 mx-0.5 md:mx-1"></div>
             
             <button 
               @click="execCollapsed = !execCollapsed" 
               class="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 p-1 md:p-1.5 rounded-lg transition-colors shadow-sm shrink-0 border border-emerald-200"
               title="Expandir/Contraer"
             >
               <ChevronUp v-if="!execCollapsed" class="w-4 h-4 md:w-5 md:h-5 stroke-3" />
               <ChevronDown v-else class="w-4 h-4 md:w-5 md:h-5 stroke-3" />
             </button>
           </div>
         </div>

         <div v-show="!execCollapsed" class="overflow-hidden transition-all duration-300">
           <div v-if="isExecLoading" class="flex flex-col items-center justify-center py-6 z-10 relative">
             <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600 mb-3"></div>
             <p class="text-xs text-emerald-600 font-bold uppercase tracking-wide">Analizando últimos {{ execPeriodo }} días...</p>
             <p class="text-[10px] text-emerald-400 mt-1">Novedades + Intervenciones</p>
           </div>
           
           <div v-else-if="execError" class="text-emerald-800 text-sm font-semibold z-10 relative py-3">
             No se pudo generar el informe ejecutivo.
             <button @click="cargarResumenEjecutivo()" class="underline ml-2">Reintentar</button>
           </div>

           <div v-else-if="execSummary" class="text-emerald-950 text-base md:text-lg leading-relaxed z-10 relative font-medium space-y-2 p-3 bg-white/70 rounded-2xl border border-white max-w-none" v-html="execSummary">
           </div>
           
           <div v-else class="text-emerald-700 text-sm py-3 z-10 relative">
             <button @click="cargarResumenEjecutivo()" class="bg-emerald-600 text-white font-black px-4 py-2 rounded-xl hover:bg-emerald-700 transition shadow-md flex items-center mx-auto">
               <TrendingUp class="w-4 h-4 mr-2" /> Generar Informe Ejecutivo
             </button>
           </div>
         </div>
      </div>

      <!-- Título y Filtros SIEMPRE VISIBLES si hay datos cargados (incluso si los filtrados dan 0) -->
      <div v-if="!errorCarga && novedades.length > 0" class="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-3">
        <div class="flex items-center gap-3">
           <h2 class="text-2xl font-black text-gray-800 tracking-tight hidden lg:block">Panel de control</h2>
        </div>
        
        <div class="flex flex-wrap items-center gap-2 self-start md:self-auto">
           <!-- Filtro por Sector -->
           <div v-if="mostrarFiltroSector" class="flex items-center bg-white rounded-xl shadow-sm border border-gray-200 p-1">
             <button @click="filtroSector = 'Todos'" :class="filtroSector === 'Todos' ? 'bg-emerald-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'" class="px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center">
                <Building2 class="w-3.5 h-3.5 mr-1" /> Todos
             </button>
             <button v-for="s in opcionesSectorFiltro" :key="s" @click="filtroSector = s" :class="filtroSector === s ? 'bg-emerald-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'" class="px-3 py-1.5 rounded-lg text-[10px] font-bold transition uppercase tracking-wider">
                {{ s === 'HILANDERIA' ? 'Hil.' : 'Tej.' }}
             </button>
           </div>

           <!-- Filtro por Tipo -->
           <div class="flex items-center bg-white rounded-xl shadow-sm border border-gray-200 p-1">
             <button @click="filtroTipo = 'Todos'" :class="filtroTipo === 'Todos' ? 'bg-gray-800 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'" class="px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center">
                <Filter class="w-3.5 h-3.5 mr-1" /> Todos
             </button>
             <button @click="filtroTipo = 'Mecánico'" :class="filtroTipo === 'Mecánico' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'" class="px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center">
                <Wrench class="w-3.5 h-3.5 mr-1" /> Mec. ({{mecanicasCount}})
             </button>
             <button @click="filtroTipo = 'Eléctrico'" :class="filtroTipo === 'Eléctrico' ? 'bg-amber-500 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'" class="px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center">
                <Zap class="w-3.5 h-3.5 mr-1" /> Eléc. ({{electricasCount}})
             </button>
           </div>
        </div>
      </div>

      <!-- Sin Novedades en el filtro actual -->
      <div v-if="!isLoading && !errorCarga && novedadesFiltradas.length === 0 && novedades.length > 0" class="text-center py-20">
        <CheckCircle class="w-16 h-16 text-green-400 mx-auto mb-4" />
        <h2 class="text-2xl font-bold text-gray-600">¡Todo en orden!</h2>
        <p class="text-gray-500">No hay novedades pendientes para la vista seleccionada.</p>
      </div>

      <!-- Listado con Novedades -->
      <div v-if="!errorCarga && novedadesFiltradas.length > 0">
        <!-- Grid de Novedades -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div 
            v-for="novedad in novedadesFiltradas" 
            :key="novedad.id" 
            class="rounded-3xl border p-6 shadow-md flex flex-col justify-between transition-transform transform hover:-translate-y-1 relative"
            :class="getCardColorClass(novedad)">
            
            <!-- Badge Tipo Problema -->
            <div class="absolute -top-3 -right-3 flex">
               <span v-if="(novedad.tipoProblema || 'Mecánico') === 'Mecánico'" class="bg-blue-600 text-white p-2 rounded-full shadow-lg border-2 border-white" title="Falla Mecánica">
                  <Wrench class="w-5 h-5" />
               </span>
               <span v-else class="bg-amber-500 text-white p-2 rounded-full shadow-lg border-2 border-white" title="Falla Eléctrica">
                  <Zap class="w-5 h-5" />
               </span>
            </div>

            <div>
              <div class="flex justify-between items-start mb-4 pr-8">
                <div>
                    <h3 class="text-3xl font-black flex items-center">
                      <AlertTriangle v-if="novedad.critico" class="w-6 h-6 mr-2" />
                      ID: {{ novedad.numeroMaquina }}
                    </h3>
                    <div class="flex items-center gap-2 mt-1">
                      <p class="text-base font-bold opacity-80 tracking-widest">{{ novedad.tipoMaquina }} (Lado {{ novedad.lado }})</p>
                      <span v-if="novedad.motivo" class="text-[10px] font-black bg-white/20 px-2 py-0.5 rounded border border-white/20 uppercase tracking-widest">{{ novedad.motivo }}</span>
                    </div>
                  </div>
                  <span class="text-sm font-black px-3 py-1.5 rounded-lg bg-black/10">{{ novedad.estado }}</span>
              </div>
              
              <div v-if="novedad.seccion || novedad.denominacion" class="bg-black/5 border border-black/10 p-3 rounded-xl mb-4">
                 <span class="block text-xs font-black tracking-widest leading-none mb-1 opacity-60">PUNTO DE CONTROL AFECTADO</span>
                 <div class="flex flex-col gap-1">
                   <span class="text-sm font-bold opacity-90">{{ novedad.denominacion || novedad.seccion }} <span v-if="novedad.grupo" class="opacity-60 font-medium">({{ novedad.grupo }})</span></span>
                   <div v-if="novedad.numeroArticulo && novedad.numeroArticulo !== '-'" class="flex gap-2 mt-1">
                     <span class="bg-indigo-600 text-white text-[10px] font-black px-2 py-0.5 rounded shadow-sm">Art: {{ novedad.numeroArticulo }}</span>
                     <span v-if="novedad.numeroCatalogo && novedad.numeroCatalogo !== '-'" class="bg-white text-indigo-800 text-[10px] font-black px-2 py-0.5 rounded border border-indigo-200 shadow-sm">Cat: {{ novedad.numeroCatalogo }}</span>
                   </div>
                 </div>
              </div>

              <p class="text-lg font-bold mb-5 p-4 bg-black/5 rounded-2xl border border-black/5 leading-snug">
                "{{ novedad.observaciones }}"
              </p>

              <a v-if="novedad.fotoUrl" :href="novedad.fotoUrl" target="_blank" class="inline-flex items-center text-base font-black underline underline-offset-4 mb-4 hover:opacity-70 transition p-2 bg-black/5 rounded-xl">
                <ImageIcon class="w-5 h-5 mr-2" /> Ver Foto Evidencia
              </a>
            </div>

            <div class="mt-4 flex flex-col gap-4">
              <span class="text-sm font-bold flex items-center opacity-70">
                <Clock class="w-4 h-4 mr-1.5" /> {{ formatDate(novedad.createdAt) }}
              </span>
              <button 
                @click="abrirModal(novedad)"
                class="w-full bg-black/10 hover:bg-black/20 text-current font-black text-lg py-4 rounded-xl transition border border-black/10 flex items-center justify-center active:scale-95 shadow-sm">
                <CheckSquare class="w-6 h-6 mr-2" />
                Gestionar
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Modal de Gestión -->
    <div v-if="modalAprobacion" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div class="bg-white rounded-3xl p-8 w-full max-w-lg shadow-2xl animate-in fade-in zoom-in duration-200">
        <h3 class="text-3xl font-black text-gray-900 mb-2">Gestionar Novedad</h3>
        <p class="text-xl text-gray-500 mb-6">Máquina: <span class="font-black border-b-4 border-orange-400 text-gray-800">{{ novedadActual.numeroMaquina }}</span></p>
        
        <div class="space-y-6">
          <div>
            <label class="block text-base font-bold text-gray-700 mb-2 tracking-tight">Instrucciones / feedback (Opcional)</label>
            <textarea 
              v-model="feedback" 
              rows="4" 
              class="w-full bg-gray-50 border border-gray-300 text-gray-900 text-lg rounded-2xl focus:ring-blue-500 focus:border-blue-500 block p-4 transition shadow-inner" 
              placeholder="Ej: Repuestos en pañol, proceder con reparación..."></textarea>
          </div>

          <div class="grid grid-cols-2 gap-4 pt-4">
            <button 
              @click="aprobarNovedad('en proceso')"
              class="py-4 px-4 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-black text-lg rounded-2xl transition shadow-md active:scale-95">
              En proceso
            </button>
            <button 
              @click="aprobarNovedad('resuelto')"
              class="py-4 px-4 bg-green-500 hover:bg-green-600 text-white font-black text-lg rounded-2xl transition shadow-md active:scale-95">
              Resuelto
            </button>
          </div>
          <button @click="cerrarModal" class="w-full mt-4 py-4 text-gray-500 hover:bg-gray-100 font-bold text-lg rounded-2xl transition">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
