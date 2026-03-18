<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { mantenimientoService } from '../services/mantenimientoService';
import { UploadCloud, CheckCircle, Settings } from 'lucide-vue-next';
import Swal from 'sweetalert2';

import { compressImage, formatSize } from '../utils/imageCompressor';

const maquinas = ref([]);
const tipoSeleccionado = ref('CARDA'); // Default
const maquinaSeleccionadaId = ref('');
const isCritico = ref(false);
const observaciones = ref('');
const imagenFile = ref(null);
const imagenOriginalSize = ref(null);
const imagenPreview = ref(null);
const isSubmitting = ref(false);
const uploadProgress = ref(0);
const successMessage = ref('');
const maquinasError = ref(false);
const isCompressing = ref(false);

// Fetch list of machines from Firestore on mount
onMounted(async () => {
  try {
    const querySnapshot = await getDocs(collection(db, 'maquinas'));
    const lista = [];
    querySnapshot.forEach((doc) => {
      lista.push({ id: doc.id, ...doc.data() });
    });
    maquinas.value = lista;
    maquinasError.value = false;
  } catch (error) {
    console.error("Error al cargar máquinas", error);
    maquinasError.value = true;
  }
});

// Filtrar máquinas por tipo y darles nombre descriptivo
const maquinasFiltradas = computed(() => {
  return maquinas.value
    .filter(m => m.tipo.toUpperCase() === tipoSeleccionado.value)
    .map(m => ({
      ...m,
      nombreDescriptivo: `${m.tipo} ${m.local_fisico}`
    }))
    .sort((a, b) => a.local_fisico - b.local_fisico);
});

// Reset machine selection when type changes
watch(tipoSeleccionado, () => {
  maquinaSeleccionadaId.value = '';
});

const detallesMaquina = computed(() => {
  if (!maquinaSeleccionadaId.value) return null;
  return maquinas.value.find(m => m.id === maquinaSeleccionadaId.value);
});

const onFileChange = async (e) => {
  const file = e.target.files[0];
  if (file) {
    try {
      isCompressing.value = true;
      imagenOriginalSize.value = file.size;
      
      // Limpiar preview anterior si existe para liberar RAM
      if (imagenPreview.value && imagenPreview.value.startsWith('blob:')) {
        URL.revokeObjectURL(imagenPreview.value);
      }

      // Comprimir imagen antes de procesarla
      const compressed = await compressImage(file, { maxWidth: 1024, quality: 0.7 });
      
      imagenFile.value = compressed;
      
      // Crear preview eficiente (ObjectURL en lugar de DataURL Base64)
      imagenPreview.value = URL.createObjectURL(compressed);
      
    } catch (err) {
      console.error("Error comprimiendo imagen:", err);
      imagenFile.value = file;
      imagenPreview.value = URL.createObjectURL(file);
    } finally {
      isCompressing.value = false;
    }
  }
};

const onSubmit = async () => {
  if (!maquinaSeleccionadaId.value) {
    Swal.fire({ icon: 'warning', title: 'Falta seleccionar', text: 'Por favor seleccione una máquina.', confirmButtonColor: '#2563eb' });
    return;
  }
  if (!observaciones.value) {
    Swal.fire({ icon: 'warning', title: 'Falta descripción', text: 'Por favor ingrese las observaciones de la falla.', confirmButtonColor: '#2563eb' });
    return;
  }

  isSubmitting.value = true;
  uploadProgress.value = 0;
  successMessage.value = '';

  try {
    const datosNovedad = {
      maquinaId: detallesMaquina.value.id,
      numeroMaquina: detallesMaquina.value.maquina,
      tipoMaquina: detallesMaquina.value.tipo,
      local_fisico: detallesMaquina.value.local_fisico,
      lado: detallesMaquina.value.lado,
      critico: isCritico.value,
      observaciones: observaciones.value
    };

    // Pasamos el callback de progreso al servicio
    await mantenimientoService.crearNovedad(datosNovedad, imagenFile.value, (prog) => {
      uploadProgress.value = prog;
    });
    
    uploadProgress.value = 100;
    successMessage.value = "Novedad reportada correctamente.";
    
    // Limpiar imagen y liberar memoria
    if (imagenPreview.value && imagenPreview.value.startsWith('blob:')) {
      URL.revokeObjectURL(imagenPreview.value);
    }
    
    maquinaSeleccionadaId.value = '';
    isCritico.value = false;
    observaciones.value = '';
    imagenFile.value = null;
    imagenPreview.value = null;

    setTimeout(() => { successMessage.value = ''; }, 4000);

  } catch (error) {
    console.error("Error detallado en onSubmit:", error);
    Swal.fire({ icon: 'error', title: 'Error al guardar', text: error.message || 'Error desconocido' });
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <div class="min-h-screen bg-transparent pb-32">
    <!-- Header -->
    <!-- El header ahora se maneja globalmente en App.vue -->


    <main class="px-2 max-w-sm mx-auto space-y-3 pt-2">
      <!-- Success Message -->
      <div v-if="successMessage" class="bg-green-100 border border-green-200 text-green-800 p-4 rounded-xl flex items-center shadow-sm">
        <CheckCircle class="w-6 h-6 mr-3 text-green-600" />
        <span class="font-medium">{{ successMessage }}</span>
      </div>

      <!-- Error de Carga -->
      <div v-if="maquinasError" class="bg-red-100 border border-red-200 text-red-800 p-4 rounded-xl flex items-center shadow-sm">
        <span class="font-medium">⚠️ Error al conectar con la base de datos. Verifica los permisos de Firestore.</span>
      </div>

      <form @submit.prevent="onSubmit" class="space-y-4">
        
        <!-- Selección de Máquina (En una sola fila para mobile) -->
        <div class="flex gap-2">
          <!-- Selector de Tipo -->
          <div class="flex-1 space-y-1 bg-white p-2 rounded-xl border border-gray-100 shadow-sm">
            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-tight pl-1">Tipo</label>
            <select 
              v-model="tipoSeleccionado" 
              class="w-full bg-gray-50 border border-gray-300 text-gray-900 text-xs font-bold rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-1.5 transition-colors">
              <option v-for="tipo in ['APERTURA', 'CARDA', 'MANUAR', 'OPEN END', 'FILTRO']" :key="tipo" :value="tipo">
                {{ tipo }}
              </option>
            </select>
          </div>

          <!-- Selector de ID/Puesto -->
          <div class="flex-[1.8] space-y-1 bg-white p-2 rounded-xl border border-gray-100 shadow-sm">
            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-tight pl-1">ID Máquina / Puesto</label>
            <select 
              v-model="maquinaSeleccionadaId" 
              class="w-full bg-gray-50 border border-gray-300 text-gray-900 text-xs font-bold rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-1.5 transition-colors">
              <option value="" disabled>ID / Puesto...</option>
              <option v-for="m in maquinasFiltradas" :key="m.id" :value="m.id">
                {{ m.nombreDescriptivo }} {{ m.lado !== 'U' ? '(' + m.lado + ')' : '' }}
              </option>
            </select>
          </div>
        </div>

        <!-- Info Automática Máquina -->
        <div v-if="detallesMaquina" class="bg-blue-50 text-blue-900 p-2 rounded-xl border border-blue-100 flex justify-between items-center text-[10px] font-medium animate-in fade-in slide-in-from-top-2">
          <div>
            <span class="block text-xs text-blue-600/80 uppercase tracking-wide">ID Interno</span>
            <span>{{ detallesMaquina.maquina }}</span>
          </div>
          <div class="text-right">
            <span class="block text-xs text-blue-600/80 uppercase tracking-wide">Lado / Físico</span>
            <span>Local {{ detallesMaquina.local_fisico }}</span>
          </div>
        </div>

        <!-- Observaciones -->
        <div class="space-y-2">
          <label class="block text-sm font-semibold text-gray-700">Observaciones del Problema</label>
          <textarea 
            v-model="observaciones" 
            rows="2" 
            placeholder="¿Qué está pasando?"
            class="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-xl focus:ring-blue-500 focus:border-blue-500 block p-2.5 shadow-sm"></textarea>
        </div>

        <!-- Subida de Imagen -->
        <div class="space-y-1">
           <label class="block text-[10px] font-bold text-gray-500 uppercase pl-1">Foto de Evidencia (Opcional)</label>
           <label class="flex flex-col items-center justify-center w-full h-24 border-2 border-gray-300 border-dashed rounded-xl cursor-pointer bg-white hover:bg-gray-50 transition relative overflow-hidden">
             
             <!-- Overlay de carga/compresión -->
             <div v-if="isCompressing" class="absolute inset-0 bg-white/80 z-20 flex flex-col items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
                <p class="text-xs font-bold text-blue-600">Optimizando Foto...</p>
             </div>

             <img v-if="imagenPreview" :src="imagenPreview" class="absolute inset-0 w-full h-full object-cover opacity-60" />
              <div class="flex flex-col items-center justify-center pt-2 pb-2 relative z-10" :class="{'opacity-0': imagenPreview}">
                <UploadCloud class="w-8 h-8 text-gray-400 mb-1" />
                <p class="text-xs text-gray-500 font-bold uppercase">Capturar</p>
                <p class="text-[8px] text-gray-400 mt-0.5">Automático</p>
              </div>
             <input type="file" accept="image/*" capture="environment" class="hidden" @change="onFileChange" />
           </label>
           
           <div v-if="imagenPreview" class="bg-gray-100 p-3 rounded-xl space-y-2 shadow-inner border border-gray-200">
             <div class="flex justify-between items-center">
                <div class="flex flex-col">
                  <span class="text-[10px] text-gray-500 font-bold uppercase tracking-tighter">Tamaño Optimizado</span>
                  <span class="text-xs font-bold text-green-600">{{ formatSize(imagenFile?.size) }}</span>
                </div>
                <div class="flex flex-col text-right">
                  <span class="text-[10px] text-gray-500 font-bold uppercase tracking-tighter text-right">Original</span>
                  <span class="text-xs text-gray-400 line-through">{{ formatSize(imagenOriginalSize) }}</span>
                </div>
             </div>
             <button type="button" @click="imagenPreview=null; imagenFile=null" class="w-full py-1 text-xs text-red-600 font-bold bg-white border border-red-100 rounded-lg shadow-sm">QUITAR FOTO</button>
           </div>
        </div>

        <!-- Acciones Fijas (Bottom Bar) -->
        <div class="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-gray-200 p-3 z-30 shadow-[0_-4px_15px_rgba(0,0,0,0.05)]">
          <div class="max-w-sm mx-auto flex items-center gap-3">
            
            <!-- Criticidad (Compacta) -->
            <label class="flex items-center space-x-2 bg-red-50 p-2 rounded-xl border border-red-100 cursor-pointer h-12 shrink-0">
              <span class="text-[10px] font-black text-red-700 leading-none">CRÍTICO</span>
              <div class="relative">
                <input type="checkbox" v-model="isCritico" class="sr-only peer">
                <div class="w-10 h-6 bg-gray-300 rounded-full peer peer-checked:bg-red-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
              </div>
            </label>

            <!-- Boton Enviar -->
            <button 
              type="submit" 
              :disabled="isSubmitting"
              class="flex-1 text-white bg-blue-600 hover:bg-blue-700 h-12 rounded-xl text-sm font-black shadow-lg shadow-blue-900/40 active:scale-95 transition-all disabled:opacity-50 relative overflow-hidden uppercase flex items-center justify-center">
              <div v-if="isSubmitting" class="absolute inset-x-0 bottom-0 h-1 bg-blue-800/50" :style="{ width: uploadProgress + '%' }"></div>
              <span>
                {{ isSubmitting ? `${uploadProgress}%` : 'ENVIAR REPORTE' }}
              </span>
            </button>
          </div>
        </div>

      </form>
    </main>
  </div>
</template>

