<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { mantenimientoService } from '../services/mantenimientoService';
import { notificationService } from '../services/notificationService';
import { auth } from '../firebase/config';
import { onAuthStateChanged } from 'firebase/auth';
import { Clock, AlertTriangle, CheckCircle, Image as ImageIcon, CheckSquare } from 'lucide-vue-next';
import Swal from 'sweetalert2';

const novedades = ref([]);
let unsubscribe = null;
const modalAprobacion = ref(false);
const novedadActual = ref(null);
const feedback = ref('');
const isLoading = ref(true);
const errorCarga = ref(false);

let authUnsubscribe = null;
let timeoutId = null;
let reintentos = 0;
const MAX_REINTENTOS = 2;

const cargarDatos = () => {
  isLoading.value = true;
  errorCarga.value = false;
  reintentos = 0;
  _cargarDatos();
};

const _cargarDatos = () => {
  // Limpiar suscripción anterior y timeout
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }

  // Timeout aumentado a 20 segundos para mobile y conexiones más lentas
  timeoutId = setTimeout(() => {
    if (isLoading.value && !novedades.value.length) {
      console.warn('Timeout alcanzado (20s), no se recibieron datos de Firestore.');
      
      // Reintentar automáticamente hasta MAX_REINTENTOS
      if (reintentos < MAX_REINTENTOS) {
        reintentos++;
        console.log(`Reintentando... (${reintentos}/${MAX_REINTENTOS})`);
        setTimeout(_cargarDatos, 2000); // Esperar 2 segundos antes de reintentar
      } else {
        errorCarga.value = true;
        isLoading.value = false;
      }
    }
  }, 20000);

  unsubscribe = mantenimientoService.obtenerNovedadesPendientes(
    (data) => {
      // Limpiar timeout solo si este callback es válido
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      // Reset reintentos si cargó correctamente
      reintentos = 0;
      
      const nuevasCriticas = data.filter(n => n.critico && n.estado === 'pendiente');
      const antiguasCriticas = novedades.value.filter(n => n.critico && n.estado === 'pendiente');
      
      if (nuevasCriticas.length > antiguasCriticas.length) {
        const nueva = nuevasCriticas[0];
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('¡ALERTA CRÍTICA!', {
            body: `Máquina ${nueva.numeroMaquina}: ${nueva.observaciones}`,
            icon: '/icons/icon-192x192.png'
          });
        }
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
      
      // Reintentar automáticamente hasta MAX_REINTENTOS
      if (reintentos < MAX_REINTENTOS) {
        reintentos++;
        console.log(`Reintentando por error... (${reintentos}/${MAX_REINTENTOS})`);
        setTimeout(_cargarDatos, 2000); // Esperar 2 segundos antes de reintentar
      } else {
        errorCarga.value = true;
        isLoading.value = false;
      }
    }
  );
};

onMounted(() => {
  // Cargamos los datos directamente. Al estar protegida por el router y tener el delay 
  // en el router guard, el usuario y su rol ya deberían estar listos.
  cargarDatos();

  // Registrar servicios de notificación si hay usuario
  if (auth.currentUser) {
    notificationService.solicitarPermisosYRegistrarToken(auth.currentUser.uid)
      .then(() => notificationService.escucharMensajesEnPrimerPlano())
      .catch(err => console.warn('FCM no disponible:', err));
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
        <span class="bg-blue-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-md shrink-0">
          {{ novedades.length }}
        </span>
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
          <p class="text-[8px] text-gray-300 font-bold uppercase tracking-widest">Build: 18/03 11:15</p>
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

      <!-- Sin Novedades -->
      <div v-else-if="novedades.length === 0" class="text-center py-20">
        <CheckCircle class="w-16 h-16 text-green-400 mx-auto mb-4" />
        <h2 class="text-2xl font-bold text-gray-600">¡Todo en orden!</h2>
        <p class="text-gray-500">No hay novedades mecánicas pendientes.</p>
      </div>

      <!-- Listado con Novedades -->
      <div v-else>
        <!-- Título solo Desktop -->
        <div class="hidden lg:flex items-center justify-between mb-6">
          <h2 class="text-2xl font-black text-gray-800 uppercase tracking-tight">Novedades de Mecánicos</h2>
          <span class="bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg">
            {{ novedades.length }} PENDIENTES
          </span>
        </div>

        <!-- Grid de Novedades -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div 
          v-for="novedad in novedades" 
          :key="novedad.id" 
          class="rounded-2xl border p-5 shadow-md flex flex-col justify-between transition-transform transform hover:-translate-y-1"
          :class="getCardColorClass(novedad)">
          
          <div>
            <div class="flex justify-between items-start mb-3">
              <div>
                <h3 class="text-xl font-extrabold flex items-center">
                  <AlertTriangle v-if="novedad.critico" class="w-5 h-5 mr-2" />
                  ID: {{ novedad.numeroMaquina }}
                </h3>
                <p class="text-sm font-medium opacity-80 uppercase tracking-widest mt-1">{{ novedad.tipoMaquina }} (Lado {{ novedad.lado }})</p>
              </div>
              <span class="text-xs font-bold px-2 py-1 rounded bg-black/10 uppercase">{{ novedad.estado }}</span>
            </div>
            
            <p class="text-base font-medium my-4 p-3 bg-black/5 rounded-xl border border-black/5">
              "{{ novedad.observaciones }}"
            </p>

            <a v-if="novedad.fotoUrl" :href="novedad.fotoUrl" target="_blank" class="inline-flex items-center text-sm font-semibold underline underline-offset-4 mb-4 hover:opacity-70 transition">
              <ImageIcon class="w-4 h-4 mr-1" /> Ver Foto Evidencia
            </a>
          </div>

          <div class="mt-4 flex flex-col gap-3">
            <span class="text-xs font-medium flex items-center opacity-70">
              <Clock class="w-3 h-3 mr-1" /> {{ formatDate(novedad.createdAt) }}
            </span>
            <button 
              @click="abrirModal(novedad)"
              class="w-full bg-black/10 hover:bg-black/20 text-current font-bold py-3 rounded-xl transition border border-black/10 flex items-center justify-center">
              <CheckSquare class="w-5 h-5 mr-2" />
              GESTIONAR
            </button>
          </div>
        </div>
      </div>
    </div>
  </main>

    <!-- Modal de Gestión -->
    <div v-if="modalAprobacion" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div class="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200">
        <h3 class="text-2xl font-bold text-gray-900 mb-2">Gestionar Novedad</h3>
        <p class="text-gray-500 mb-6">Máquina: <span class="font-bold border-b-2 border-orange-400">{{ novedadActual.numeroMaquina }}</span></p>
        
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">Instrucciones / Feedback (Opcional)</label>
            <textarea 
              v-model="feedback" 
              rows="3" 
              class="w-full bg-gray-50 border border-gray-300 text-gray-900 text-base rounded-xl focus:ring-blue-500 focus:border-blue-500 block p-3 transition" 
              placeholder="Ej: Repuestos en pañol, proceder con reparación..."></textarea>
          </div>

          <div class="grid grid-cols-2 gap-3 pt-4">
            <button 
              @click="aprobarNovedad('en proceso')"
              class="py-3 px-4 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-bold rounded-xl transition shadow-sm">
              En Proceso
            </button>
            <button 
              @click="aprobarNovedad('resuelto')"
              class="py-3 px-4 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl transition shadow-sm">
              Resuelto
            </button>
          </div>
          <button @click="cerrarModal" class="w-full mt-2 py-3 text-gray-500 hover:text-gray-700 font-medium transition">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
