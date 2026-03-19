<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { mantenimientoService } from '../services/mantenimientoService';
import { catalogoService } from '../services/catalogoService';
import catalogDataR60 from '../data/catalogo_full_r60.json';
import { UploadCloud, CheckCircle, Settings, Wrench, Zap, Info } from 'lucide-vue-next';
import Swal from 'sweetalert2';

import { compressImage, formatSize } from '../utils/imageCompressor';

const maquinas = ref([]);
const tipoSeleccionado = ref('CARDA'); // Default
const maquinaSeleccionadaId = ref('');
const tipoProblema = ref('Mecánico'); // Mecánico or Eléctrico

// Catálogo de Puestos de Control (Cascada)
const catalogoCompleto = ref([]);
const seccionSeleccionada = ref('');
const grupoSeleccionado = ref('');
const denominacionSeleccionada = ref(null); // Objeto completo del punto seleccionado

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
    // 1. Inicializar catálogo si está vacío (una sola vez)
    await catalogoService.inicializarSiVacio(catalogDataR60);

    // 2. Cargar máquinas
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

// Reset machine selection and catalog when type or machine changes
watch(tipoSeleccionado, () => {
  maquinaSeleccionadaId.value = '';
  resetCatalogo();
});

const detallesMaquina = computed(() => {
  if (!maquinaSeleccionadaId.value) return null;
  return maquinas.value.find(m => m.id === maquinaSeleccionadaId.value);
});

// Cargar catálogo si el modelo es R-60
watch(detallesMaquina, async (newVal) => {
    if (newVal && newVal.modelo === 'R-60') {
        try {
            catalogoCompleto.value = await catalogoService.obtenerPuntosPorModelo('R-60');
        } catch (err) {
            console.error("Error cargando catálogo", err);
        }
    } else {
        resetCatalogo();
    }
});

const resetCatalogo = () => {
    catalogoCompleto.value = [];
    seccionSeleccionada.value = '';
    grupoSeleccionado.value = '';
    denominacionSeleccionada.value = null;
};

// Lógica de cascada
const seccionesDisponibles = computed(() => {
    const sets = new Set(catalogoCompleto.value.map(c => c.seccion));
    return [...sets].sort();
});

const gruposDisponibles = computed(() => {
    if (!seccionSeleccionada.value) return [];
    const filtrados = catalogoCompleto.value.filter(c => c.seccion === seccionSeleccionada.value);
    const sets = new Set(filtrados.map(c => c.grupo));
    return [...sets].sort();
});


const denominacionesDisponibles = computed(() => {
    if (!grupoSeleccionado.value) return [];
    return catalogoCompleto.value.filter(c => 
        c.seccion === seccionSeleccionada.value && 
        c.grupo === grupoSeleccionado.value
    );
});

// Al cambiar una jerarquía superior, resetear las inferiores
watch(seccionSeleccionada, () => { grupoSeleccionado.value = ''; denominacionSeleccionada.value = null; });
watch(grupoSeleccionado, () => { denominacionSeleccionada.value = null; });

const onFileChange = async (e) => {
  const file = e.target.files[0];
  if (file) {
    try {
      isCompressing.value = true;
      imagenOriginalSize.value = file.size;
      
      if (imagenPreview.value && imagenPreview.value.startsWith('blob:')) {
        URL.revokeObjectURL(imagenPreview.value);
      }

      const compressed = await compressImage(file, { maxWidth: 1024, quality: 0.7 });
      imagenFile.value = compressed;
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
      modeloMaquina: detallesMaquina.value.modelo || '',
      local_fisico: detallesMaquina.value.local_fisico,
      lado: detallesMaquina.value.lado,
      critico: isCritico.value,
      observaciones: observaciones.value,
      tipoProblema: tipoProblema.value,
      // Datos del catálogo si existen
      seccion: seccionSeleccionada.value || null,
      grupo: grupoSeleccionado.value || null,
      subGrupo: denominacionSeleccionada.value?.subGrupo || null,
      denominacion: denominacionSeleccionada.value?.denominacion || null,
      numeroArticulo: denominacionSeleccionada.value?.numeroArticulo || null,
      numeroCatalogo: denominacionSeleccionada.value?.numeroCatalogo || null
    };

    await mantenimientoService.crearNovedad(datosNovedad, imagenFile.value, (prog) => {
      uploadProgress.value = prog;
    });
    
    uploadProgress.value = 100;
    successMessage.value = "Novedad reportada correctamente.";
    
    if (imagenPreview.value && imagenPreview.value.startsWith('blob:')) {
      URL.revokeObjectURL(imagenPreview.value);
    }
    
    maquinaSeleccionadaId.value = '';
    isCritico.value = false;
    observaciones.value = '';
    imagenFile.value = null;
    imagenPreview.value = null;
    resetCatalogo();

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


    <!-- Teleport para la cabecera (Mecánica / Eléctrica) -->
    <Teleport to="#navbar-header-portal">
      <div class="flex items-center justify-center gap-1 bg-gray-900 p-0.5 rounded-lg border border-gray-700 w-28 sm:w-44">
        <label class="flex-1 flex justify-center py-1.5 rounded-md cursor-pointer transition-all items-center"
               :class="tipoProblema === 'Mecánico' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'">
           <input type="radio" v-model="tipoProblema" value="Mecánico" class="hidden">
           <Wrench class="w-3.5 h-3.5" />
        </label>
        <label class="flex-1 flex justify-center py-1.5 rounded-md cursor-pointer transition-all items-center"
               :class="tipoProblema === 'Eléctrico' ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-400 hover:text-white'">
           <input type="radio" v-model="tipoProblema" value="Eléctrico" class="hidden">
           <Zap class="w-3.5 h-3.5" />
        </label>
      </div>
    </Teleport>

    <main class="px-2 max-w-sm mx-auto space-y-2 pt-1">
      <!-- Success Message -->
      <div v-if="successMessage" class="bg-green-100 border border-green-200 text-green-800 p-3 rounded-lg flex items-center shadow-sm">
        <CheckCircle class="w-5 h-5 mr-2 text-green-600" />
        <span class="font-medium text-sm">{{ successMessage }}</span>
      </div>

      <!-- Error de Carga -->
      <div v-if="maquinasError" class="bg-red-100 border border-red-200 text-red-800 p-3 rounded-lg flex items-center shadow-sm">
        <span class="font-medium text-sm">⚠️ Error al conectar con la base de datos.</span>
      </div>

      <form @submit.prevent="onSubmit" class="space-y-3">

        <!-- Selección de Máquina (En una sola fila para mobile) -->
        <div class="flex gap-1.5">
          <!-- Selector de Tipo -->
          <div class="flex-[0.8] space-y-0.5 bg-white p-1.5 rounded-lg border border-gray-100 shadow-sm">
            <label class="block text-[9px] font-bold text-gray-500 uppercase tracking-tight px-1 cursor-default">Tipo</label>
            <select 
              v-model="tipoSeleccionado" 
              class="w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm font-bold rounded-md focus:ring-blue-500 focus:border-blue-500 block p-1.5 transition-colors">
              <option v-for="tipo in ['APERTURA', 'CARDA', 'MANUAR', 'OPEN END', 'FILTRO']" :key="tipo" :value="tipo">
                {{ tipo }}
              </option>
            </select>
          </div>

          <!-- Selector de ID/Puesto -->
          <div class="flex-[1.2] space-y-0.5 bg-white p-1.5 rounded-lg border border-gray-100 shadow-sm">
            <label class="block text-[9px] font-bold text-gray-500 uppercase tracking-tight px-1 cursor-default">ID Máquina / Puesto</label>
            <select 
              v-model="maquinaSeleccionadaId" 
              class="w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm font-bold rounded-md focus:ring-blue-500 focus:border-blue-500 block p-1.5 transition-colors"
              style="min-width: 0;">
              <option value="" disabled>Seleccionar...</option>
              <option v-for="m in maquinasFiltradas" :key="m.id" :value="m.id">
                {{ m.nombreDescriptivo }} {{ m.lado !== 'U' ? '(' + m.lado + ')' : '' }}
              </option>
            </select>
          </div>
        </div>

        <!-- SECCIÓN DE CATÁLOGO (Solo si hay datos cargados para el modelo) -->
        <div v-if="catalogoCompleto.length > 0" class="space-y-2 bg-gray-50/50 p-2 rounded-lg border border-gray-200 shadow-inner animate-in zoom-in-95 duration-300">
          <div class="flex items-center gap-1.5 px-1 mb-0.5">
            <Settings class="w-3.5 h-3.5 text-gray-400" />
            <span class="text-[10px] font-black text-gray-500 uppercase tracking-wider">Detalle del Punto de Control</span>
          </div>

          <div class="flex gap-1.5">
            <!-- Selección de Sección -->
            <div class="flex-1 space-y-0.5">
              <label class="block text-[9px] font-bold text-gray-400 uppercase tracking-tight px-1 cursor-default">1. Sección</label>
              <select v-model="seccionSeleccionada" class="w-full bg-white border border-gray-200 text-gray-900 text-sm font-bold rounded-md focus:ring-blue-500 focus:border-blue-500 block p-1.5 transition-all shadow-sm">
                <option value="">Seleccionar...</option>
                <option v-for="s in seccionesDisponibles" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>

            <!-- Selección de Grupo -->
            <div class="flex-1 space-y-0.5">
              <label class="block text-[9px] font-bold text-gray-400 uppercase tracking-tight px-1 cursor-default" :class="{'opacity-50': !seccionSeleccionada}">2. Grupo</label>
              <select v-model="grupoSeleccionado" :disabled="!seccionSeleccionada" class="w-full bg-white border border-gray-200 text-gray-900 text-sm font-bold rounded-md focus:ring-blue-500 focus:border-blue-500 block p-1.5 transition-all shadow-sm disabled:bg-gray-100 disabled:opacity-70">
                <option value="">Seleccionar...</option>
                <option v-for="g in gruposDisponibles" :key="g" :value="g">Grupo {{ g }}</option>
              </select>
            </div>
          </div>

          <!-- Selección de SubGrupo / Denominación -->
          <div v-if="grupoSeleccionado" class="space-y-0.5 animate-in slide-in-from-left-2 mt-1">
             <div class="flex justify-between items-center px-1">
                <label class="block text-[9px] font-bold text-gray-400 uppercase tracking-tight">3. Punto / Parte Específica</label>
                <div v-if="denominacionSeleccionada" class="flex gap-1 animate-in fade-in">
                   <div v-if="denominacionSeleccionada.numeroArticulo && denominacionSeleccionada.numeroArticulo !== '-'" class="bg-indigo-600 text-white text-[9px] font-black uppercase px-1.5 py-0.5 rounded shadow-sm leading-none">
                      ART: {{ denominacionSeleccionada.numeroArticulo }}
                   </div>
                   <div class="bg-indigo-100 text-indigo-700 text-[9px] font-black uppercase px-1.5 py-0.5 rounded border border-indigo-200 shadow-sm leading-none">
                      CAT: {{ denominacionSeleccionada.numeroCatalogo !== '-' ? denominacionSeleccionada.numeroCatalogo : 'N/A' }}
                   </div>
                </div>
             </div>
             
             <!-- Selector y Botón de INFO en misma fila si está seleccionado -->
             <div class="flex items-center gap-1.5">
                <div class="flex-1">
                   <select v-model="denominacionSeleccionada" class="w-full bg-white border border-gray-200 text-gray-900 text-sm font-bold rounded-md focus:ring-blue-500 focus:border-blue-500 block p-1.5 transition-all shadow-sm">
                     <option :value="null">Seleccionar Denominación...</option>
                     <option v-for="d in denominacionesDisponibles" :key="d.id" :value="d">
                       {{ d.denominacion }} {{ d.subGrupo !== '-' ? '['+d.subGrupo+']' : '' }}
                     </option>
                   </select>
                </div>
             </div>
          </div>
        </div>

        <!-- Observaciones -->
        <div class="space-y-1 mt-1">
          <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-tight px-1">Observaciones</label>
          <textarea 
            v-model="observaciones" 
            rows="2" 
            placeholder="Describa el problema..."
            class="w-full bg-white border border-gray-200 text-gray-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 block p-2.5 shadow-sm min-h-[60px]"></textarea>
        </div>

        <!-- Subida de Imagen -->
        <div class="space-y-1">
           <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-tight px-1">Foto (Opcional)</label>
           <label class="flex flex-col items-center justify-center w-full h-20 border-2 border-gray-200 border-dashed rounded-lg cursor-pointer bg-white hover:bg-gray-50 transition relative overflow-hidden mt-0.5">
             
             <!-- Overlay de carga/compresión -->
             <div v-if="isCompressing" class="absolute inset-0 bg-white/90 z-20 flex flex-col items-center justify-center">
                <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mb-1"></div>
                <p class="text-[10px] font-bold text-blue-600 uppercase">Optimizando...</p>
             </div>

             <img v-if="imagenPreview" :src="imagenPreview" class="absolute inset-0 w-full h-full object-cover opacity-50" />
              <div class="flex flex-col items-center justify-center relative z-10" :class="{'opacity-0': imagenPreview}">
                <UploadCloud class="w-6 h-6 text-gray-400 mb-1 drop-shadow-sm" />
                <p class="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Capturar Foto</p>
              </div>
             <input type="file" accept="image/*" capture="environment" class="hidden" @change="onFileChange" />
           </label>
           
           <div v-if="imagenPreview" class="bg-gray-50 p-2 rounded-lg space-y-1 shadow-inner border border-gray-200 mt-1">
             <div class="flex justify-between items-center px-1">
                <div class="flex items-center gap-1.5">
                  <span class="text-[9px] text-gray-500 font-bold uppercase tracking-wide">Tamaño:</span>
                  <span class="text-[10px] font-black text-green-600">{{ formatSize(imagenFile?.size) }}</span>
                </div>
                <button type="button" @click="imagenPreview=null; imagenFile=null" class="text-[10px] text-red-600 font-bold px-2 py-1 bg-white border border-red-200 hover:bg-red-50 rounded-md shadow-sm transition">X QUITAR</button>
             </div>
           </div>
        </div>

        <!-- Acciones Fijas (Bottom Bar) -->
        <div class="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-2.5 z-30 shadow-[0_-4px_25px_rgba(0,0,0,0.04)]">
          <div class="max-w-sm mx-auto flex items-center gap-2">
            
            <!-- Criticidad (Compacta pero legible) -->
            <label class="flex flex-col justify-center items-center bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg border border-red-100 cursor-pointer h-12 shrink-0 transition-colors">
              <span class="text-[10px] font-black text-red-700 tracking-wider mb-0.5 mt-0.5">CRÍTICO</span>
              <div class="relative flex items-center w-9 h-5 mb-0.5">
                <input type="checkbox" v-model="isCritico" class="sr-only peer">
                <div class="w-full h-full bg-gray-300 rounded-full peer peer-checked:bg-red-600 transition-colors duration-300"></div>
                <div class="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform duration-300 peer-checked:translate-x-4 shadow-sm"></div>
              </div>
            </label>

            <!-- Boton Enviar -->
            <button 
              type="submit" 
              :disabled="isSubmitting"
              class="flex-1 text-white bg-blue-600 hover:bg-blue-700 h-12 rounded-lg text-sm font-black shadow-md shadow-blue-600/20 active:scale-[0.98] transition-all disabled:opacity-50 relative overflow-hidden uppercase flex items-center justify-center">
              <div v-if="isSubmitting" class="absolute inset-x-0 bottom-0 h-1 bg-blue-800/50 transition-all duration-300" :style="{ width: uploadProgress + '%' }"></div>
              <span class="tracking-wide">
                {{ isSubmitting ? `ENVIANDO... ${uploadProgress}%` : 'ENVIAR REPORTE' }}
              </span>
            </button>
          </div>
        </div>

      </form>
    </main>
  </div>
</template>

