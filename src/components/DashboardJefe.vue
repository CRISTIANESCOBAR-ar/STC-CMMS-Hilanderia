<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { mantenimientoService } from '../services/mantenimientoService';
import { aiService } from '../services/aiService';
import { notificationService } from '../services/notificationService';
import { auth } from '../firebase/config';
import { onAuthStateChanged } from 'firebase/auth';
import { Clock, AlertTriangle, CheckCircle, Image as ImageIcon, CheckSquare, Wrench, Zap, Filter, Sparkles, Copy, ChevronUp, ChevronDown } from 'lucide-vue-next';
import Swal from 'sweetalert2';

// Hora del build incrustada por Vite (definida en `vite.config.js` como __BUILD_TIME__)
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

const novedades = ref([]);
const filtroTipo = ref('Todos'); // 'Todos', 'Mecánico', 'Eléctrico'
let unsubscribe = null;
const modalAprobacion = ref(false);
const novedadActual = ref(null);
const feedback = ref('');
const isLoading = ref(true);
const errorCarga = ref(false);

const iaSummary = ref('');
const iaSummaryRaw = ref('');
const isIaLoading = ref(true);
const iaError = ref(false);
const iaFromCache = ref(false);
const iaCollapsed = ref(false);

let authUnsubscribe = null;
let timeoutId = null;

const cargarDatos = () => {
  isLoading.value = true;
  errorCarga.value = false;

  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }

  // Mismo patrón que HistoricoNovedades
  timeoutId = setTimeout(() => {
    if (isLoading.value) {
      console.warn('Timeout alcanzado.');
      errorCarga.value = true;
      isLoading.value = false;
    }
  }, 10000);

  unsubscribe = mantenimientoService.obtenerNovedadesPendientes(
    (data) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      try {
        const nuevasCriticas = data.filter(n => n.critico && n.estado === 'pendiente');
        const antiguasCriticas = novedades.value.filter(n => n.critico && n.estado === 'pendiente');
        
        // Evitamos usar Notification API cruda en mobile si causa problemas
        if (nuevasCriticas.length > antiguasCriticas.length) {
          const nueva = nuevasCriticas[0];
          // Solo mostrar alerta usando SweetAlert para evitar fallos de Notification API en mobile
          if (nuevasCriticas.length > 0 && typeof window !== 'undefined' && window.innerWidth > 1024) {
             // Opcional: solo en pantallas grandes
          }
        }
      } catch (e) {
        console.error('Error procesando notificaciones locales:', e);
      }
      
      novedades.value = data;
      isLoading.value = false;
    },
    (err) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      console.error("Error en suscripción de Firestore:", err);
      errorCarga.value = true;
      isLoading.value = false;
    }
  );
};

onMounted(() => {
  // Cargamos los datos directamente. Al estar protegida por el router y tener el delay 
  // en el router guard, el usuario y su rol ya deberían estar listos.
  cargarDatos();
  cargarAnalisisIA();

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
    const response = await aiService.generarResumenDiario(forceRegenerate);
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

const novedadesFiltradas = computed(() => {
  if (filtroTipo.value === 'Todos') return novedades.value;
  return novedades.value.filter(n => (n.tipoProblema || 'Mecánico') === filtroTipo.value);
});

const mecanicasCount = computed(() => novedades.value.filter(n => (n.tipoProblema || 'Mecánico') === 'Mecánico').length);
const electricasCount = computed(() => novedades.value.filter(n => n.tipoProblema === 'Eléctrico').length);
</script>

<template>
  <div class="min-h-screen bg-gray-100 pb-10">
    <!-- Alerta Crítica Flotante (Opcional, ahora que el header es global) -->
    <div v-if="novedades.some(n => n.critico && n.estado === 'pendiente')" 
      class="bg-red-600 text-white text-[10px] font-black py-1 px-4 text-center uppercase tracking-widest sticky top-16 z-40 shadow-md">
      ¡HAY FALLAS CRÍTICAS PENDIENTES!
    </div>


    <!-- Portal para Navbar (Mobile) -->
    <Teleport to="#navbar-mobile-portal">
      <div v-if="!isLoading && novedades.length > 0" class="flex items-center gap-2">
        <h1 class="text-xs font-black text-white uppercase tracking-tighter shrink-0">Panel</h1>
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
      
      <!-- Estado de Carga -->
      <div v-if="isLoading" class="text-center py-20 flex flex-col items-center">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <p class="text-gray-500 font-medium mb-4">Cargando novedades...</p>
        <div class="space-y-2">
          <button @click="cargarDatos" class="text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 hover:bg-blue-100 transition-all">
            FORZAR REINTENTO
          </button>
          <p class="text-[8px] text-gray-300 font-bold uppercase tracking-widest">Build: {{ BUILD_TIME }}</p>
        </div>
      </div>

      <!-- Error de Carga -->
      <div v-else-if="errorCarga" class="text-center py-20">
        <AlertTriangle class="w-16 h-16 text-red-500 mx-auto mb-4" />
        <h2 class="text-2xl font-bold text-gray-800">Error al cargar datos</h2>
        <p class="text-gray-500 mb-6">Verifica tu conexión o permisos del sistema.</p>
        <button 
          @click="cargarDatos" 
          class="bg-blue-600 text-white px-6 py-2 rounded-xl font-bold shadow-md hover:bg-blue-700 transition">
          REINTENTAR
        </button>
      </div>

      <!-- Panel de Inteligencia Artificial -->
      <div v-if="!isLoading && !errorCarga" class="mb-8 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-3xl p-4 md:p-6 lg:mx-8 border border-indigo-100 shadow-sm relative overflow-hidden">
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
               <ChevronUp v-if="!iaCollapsed" class="w-4 h-4 md:w-5 md:h-5 stroke-[3]" />
               <ChevronDown v-else class="w-4 h-4 md:w-5 md:h-5 stroke-[3]" />
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

      <!-- Título y Filtros SIEMPRE VISIBLES si hay datos cargados (incluso si los filtrados dan 0) -->
      <div v-if="!isLoading && !errorCarga && novedades.length > 0" class="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div class="flex items-center gap-3">
           <h2 class="text-2xl font-black text-gray-800 uppercase tracking-tight hidden lg:block">Panel de Control</h2>
        </div>
        
        <div class="flex items-center self-start md:self-auto bg-white rounded-xl shadow-sm border border-gray-200 p-1">
           <button @click="filtroTipo = 'Todos'" :class="filtroTipo === 'Todos' ? 'bg-gray-800 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'" class="px-4 py-1.5 rounded-lg text-xs font-bold uppercase transition flex items-center">
              <Filter class="w-3.5 h-3.5 mr-1" /> Todos
           </button>
           <button @click="filtroTipo = 'Mecánico'" :class="filtroTipo === 'Mecánico' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'" class="px-4 py-1.5 rounded-lg text-xs font-bold uppercase transition flex items-center">
              <Wrench class="w-3.5 h-3.5 mr-1" /> Mec. ({{mecanicasCount}})
           </button>
           <button @click="filtroTipo = 'Eléctrico'" :class="filtroTipo === 'Eléctrico' ? 'bg-amber-500 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'" class="px-4 py-1.5 rounded-lg text-xs font-bold uppercase transition flex items-center">
              <Zap class="w-3.5 h-3.5 mr-1" /> Eléc. ({{electricasCount}})
           </button>
        </div>
      </div>

      <!-- Sin Novedades en el filtro actual -->
      <div v-if="!isLoading && !errorCarga && novedadesFiltradas.length === 0" class="text-center py-20">
        <CheckCircle class="w-16 h-16 text-green-400 mx-auto mb-4" />
        <h2 class="text-2xl font-bold text-gray-600">¡Todo en orden!</h2>
        <p class="text-gray-500">No hay novedades pendientes para la vista seleccionada.</p>
      </div>

      <!-- Listado con Novedades -->
      <div v-if="!isLoading && !errorCarga && novedadesFiltradas.length > 0">
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
                  <p class="text-base font-bold opacity-80 uppercase tracking-widest mt-1">{{ novedad.tipoMaquina }} (Lado {{ novedad.lado }})</p>
                </div>
                <span class="text-sm font-black px-3 py-1.5 rounded-lg bg-black/10 uppercase">{{ novedad.estado }}</span>
              </div>
              
              <p class="text-lg font-bold my-5 p-4 bg-black/5 rounded-2xl border border-black/5 leading-snug">
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
                GESTIONAR
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
            <label class="block text-base font-bold text-gray-700 mb-2 uppercase tracking-tight">Instrucciones / Feedback (Opcional)</label>
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
              EN PROCESO
            </button>
            <button 
              @click="aprobarNovedad('resuelto')"
              class="py-4 px-4 bg-green-500 hover:bg-green-600 text-white font-black text-lg rounded-2xl transition shadow-md active:scale-95">
              RESUELTO
            </button>
          </div>
          <button @click="cerrarModal" class="w-full mt-4 py-4 text-gray-500 hover:bg-gray-100 font-bold text-lg rounded-2xl transition">
            CANCELAR
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
