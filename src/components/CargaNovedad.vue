<script setup>
import { ref, onMounted, computed } from 'vue';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { mantenimientoService } from '../services/mantenimientoService';
import { UploadCloud, CheckCircle } from 'lucide-vue-next';

const maquinas = ref([]);
const maquinaSeleccionada = ref('');
const isCritico = ref(false);
const observaciones = ref('');
const imagenFile = ref(null);
const imagenPreview = ref(null);
const isSubmitting = ref(false);
const successMessage = ref('');

// Fetch list of machines from Firestore on mount
onMounted(async () => {
  try {
    const querySnapshot = await getDocs(collection(db, 'maquinas'));
    const lista = [];
    querySnapshot.forEach((doc) => {
      lista.push({ id: doc.id, ...doc.data() });
    });
    // Ordenar por número de máquina
    maquinas.value = lista.sort((a,b) => a.maquina - b.maquina);
  } catch (error) {
    console.error("Error al cargar máquinas", error);
  }
});

// Computed param for automatically showing the selected machine's details
const detallesMaquina = computed(() => {
  if (!maquinaSeleccionada.value) return null;
  return maquinas.value.find(m => m.id === maquinaSeleccionada.value);
});

const onFileChange = (e) => {
  const file = e.target.files[0];
  if (file) {
    imagenFile.value = file;
    // Crear preview
    const reader = new FileReader();
    reader.onload = e => imagenPreview.value = e.target.result;
    reader.readAsDataURL(file);
  }
};

const onSubmit = async () => {
  if (!maquinaSeleccionada.value) {
    alert("Por favor seleccione una máquina");
    return;
  }
  if (!observaciones.value) {
    alert("Por favor ingrese las observaciones de la falla");
    return;
  }

  isSubmitting.value = true;
  successMessage.value = '';

  try {
    const datosNovedad = {
      maquinaId: detallesMaquina.value.id,
      numeroMaquina: detallesMaquina.value.maquina,
      tipoMaquina: detallesMaquina.value.tipo,
      lado: detallesMaquina.value.lado,
      critico: isCritico.value,
      observaciones: observaciones.value
    };

    await mantenimientoService.crearNovedad(datosNovedad, imagenFile.value);
    
    // Reset form on success
    successMessage.value = "Novedad reportada correctamente.";
    maquinaSeleccionada.value = '';
    isCritico.value = false;
    observaciones.value = '';
    imagenFile.value = null;
    imagenPreview.value = null;

    // Ocultar mensaje luego de unos segundos
    setTimeout(() => { successMessage.value = ''; }, 4000);

  } catch (error) {
    console.error(error);
    alert("Error al guardar la novedad");
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <div class="min-h-screen bg-gray-50 pb-10">
    <!-- Header -->
    <header class="bg-blue-600 text-white p-5 shadow-md rounded-b-2xl mb-6 sticky top-0 z-10">
      <h1 class="text-2xl font-bold tracking-tight">Reportar Falla</h1>
      <p class="text-blue-100 text-sm mt-1">Perfil Mecánico</p>
    </header>

    <main class="px-4 max-w-md mx-auto space-y-6">
      <!-- Success Message -->
      <div v-if="successMessage" class="bg-green-100 border border-green-200 text-green-800 p-4 rounded-xl flex items-center shadow-sm">
        <CheckCircle class="w-6 h-6 mr-3 text-green-600" />
        <span class="font-medium">{{ successMessage }}</span>
      </div>

      <form @submit.prevent="onSubmit" class="space-y-6 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        
        <!-- Seleccion Maquina -->
        <div class="space-y-2">
          <label class="block text-sm font-semibold text-gray-700">Seleccionar Máquina</label>
          <select 
            v-model="maquinaSeleccionada" 
            class="w-full bg-gray-50 border border-gray-300 text-gray-900 text-lg rounded-xl focus:ring-blue-500 focus:border-blue-500 block p-3.5 transition-colors">
            <option value="" disabled>Seleccione...</option>
            <option v-for="m in maquinas" :key="m.id" :value="m.id">
              {{ m.maquina }} ({{ m.lado }})
            </option>
          </select>
        </div>

        <!-- Info Automática Máquina -->
        <div v-if="detallesMaquina" class="bg-blue-50 text-blue-900 p-4 rounded-xl border border-blue-100 flex justify-between items-center text-sm font-medium">
          <div>
            <span class="block text-xs text-blue-600/80 uppercase tracking-wide">Tipo</span>
            <span>{{ detallesMaquina.tipo }}</span>
          </div>
          <div class="text-right">
            <span class="block text-xs text-blue-600/80 uppercase tracking-wide">Lado / Físico</span>
            <span>Lado {{ detallesMaquina.lado }} (Local {{ detallesMaquina.local_fisico }})</span>
          </div>
        </div>

        <!-- Observaciones -->
        <div class="space-y-2">
          <label class="block text-sm font-semibold text-gray-700">Observaciones del Problema</label>
          <textarea 
            v-model="observaciones" 
            rows="3" 
            placeholder="Describa el problema..."
            class="w-full bg-gray-50 border border-gray-300 text-gray-900 text-lg rounded-xl focus:ring-blue-500 focus:border-blue-500 block p-3.5 transition-colors"></textarea>
        </div>

        <!-- Subida de Imagen -->
        <div class="space-y-2">
           <label class="block text-sm font-semibold text-gray-700">Foto de Evidencia (Opcional)</label>
           <!-- Capture from camera if on mobile -->
           <label class="flex flex-col items-center justify-center w-full h-28 border-2 border-gray-300 border-dashed rounded-xl cursor-pointer bg-gray-50 hover:bg-gray-100 transition relative overflow-hidden">
             
             <!-- Preview image if exists -->
             <img v-if="imagenPreview" :src="imagenPreview" class="absolute inset-0 w-full h-full object-cover opacity-60" />

             <div class="flex flex-col items-center justify-center pt-5 pb-6 relative z-10" :class="{'opacity-0': imagenPreview}">
               <UploadCloud class="w-8 h-8 text-gray-400 mb-2" />
               <p class="text-sm text-gray-500 font-medium">Toque para Tomar Foto</p>
             </div>
             <input type="file" accept="image/*" capture="environment" class="hidden" @change="onFileChange" />
           </label>
           
           <div v-if="imagenPreview" class="flex justify-between items-center px-1">
             <span class="text-xs text-gray-500 truncate mr-2">{{ imagenFile?.name }}</span>
             <button type="button" @click="imagenPreview=null; imagenFile=null" class="text-xs text-red-500 font-medium bg-red-50 px-2 py-1 rounded">Quitar</button>
           </div>
        </div>

        <!-- Criticidad (Resaltado Rojo) -->
        <label class="flex items-center p-4 border border-red-200 bg-red-50 rounded-xl cursor-pointer hover:bg-red-100 transition shadow-sm">
          <div class="flex-1">
            <span class="block font-bold text-red-700 text-lg">Reporte Crítico</span>
            <span class="text-sm text-red-600/80">Marcar si la máquina está parada</span>
          </div>
          <!-- Toggle CSS Nativo -->
          <div class="relative">
            <input type="checkbox" v-model="isCritico" class="sr-only peer">
            <div class="w-14 h-8 bg-red-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-7 after:w-7 after:transition-all peer-checked:bg-red-600 shadow-inner"></div>
          </div>
        </label>

        <!-- Boton Guardar -->
        <button 
          type="submit" 
          :disabled="isSubmitting"
          class="w-full text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 font-medium rounded-xl text-lg px-5 py-4 text-center disabled:opacity-60 transition shadow-md active:scale-95 duration-150 flex justify-center items-center">
          
          <svg v-if="isSubmitting" class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>

          {{ isSubmitting ? 'Enviando Reporte...' : 'Enviar Reporte' }}
        </button>

      </form>
    </main>
  </div>
</template>
