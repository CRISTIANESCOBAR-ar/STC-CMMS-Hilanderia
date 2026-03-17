<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { mantenimientoService } from '../services/mantenimientoService';
import { Clock, AlertTriangle, CheckCircle, Image as ImageIcon, CheckSquare } from 'lucide-vue-next';

const novedades = ref([]);
let unsubscribe = null;
const modalAprobacion = ref(false);
const novedadActual = ref(null);
const feedback = ref('');

onMounted(() => {
  // Suscripción en tiempo real a las novedades pendientes (estado != resuelto)
  unsubscribe = mantenimientoService.obtenerNovedadesPendientes((data) => {
    novedades.value = data;
  });
});

onUnmounted(() => {
  if (unsubscribe) unsubscribe();
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
  } catch (error) {
    alert("Error al actualizar la novedad");
  }
};
</script>

<template>
  <div class="min-h-screen bg-gray-100 pb-10">
    <!-- Header -->
    <header class="bg-gray-900 text-white p-5 shadow-lg mb-6 sticky top-0 z-10 flex justify-between items-center">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Panel de Control</h1>
        <p class="text-gray-300 text-sm mt-1">Jefatura de Mantenimiento</p>
      </div>
      <div class="bg-red-600 px-3 py-1 rounded-full text-sm font-bold animate-pulse" v-if="novedades.some(n => n.critico && n.estado === 'pendiente')">
        ¡ALERTA CRÍTICA!
      </div>
    </header>

    <main class="px-4 max-w-5xl mx-auto">
      
      <div v-if="novedades.length === 0" class="text-center py-20">
        <CheckCircle class="w-16 h-16 text-green-400 mx-auto mb-4" />
        <h2 class="text-2xl font-bold text-gray-600">¡Todo en orden!</h2>
        <p class="text-gray-500">No hay novedades mecánicas pendientes.</p>
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
