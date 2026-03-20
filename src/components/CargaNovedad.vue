<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { mantenimientoService } from '../services/mantenimientoService';
import { catalogoService } from '../services/catalogoService';
import catalogDataR60 from '../data/catalogo_full_r60.json';
import { UploadCloud, CheckCircle, Settings, Wrench, Zap, Info, Camera } from 'lucide-vue-next';
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
const motivoLlamado = ref('VERIFICACIÓN');
const observaciones = ref('');
const imagenFile = ref(null);
const imagenOriginalSize = ref(null);
const imagenPreview = ref(null);
const isSubmitting = ref(false);
const uploadProgress = ref(0);
const successMessage = ref('');
const maquinasError = ref(false);
const isCompressing = ref(false);

// Cargar lista de máquinas desde Firestore al montar
onMounted(() => {
  // 1. Cargar máquinas inmediatamente
  cargarMaquinas();

  // 2. Inicializar catálogo en segundo plano (si es necesario)
  inicializarCatalogo();
});

const cargarMaquinas = async () => {
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
};

const inicializarCatalogo = async () => {
  try {
    await catalogoService.inicializarSiVacio(catalogDataR60);
  } catch (error) {
    console.error("Error al inicializar catálogo", error);
  }
};

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
      motivo: motivoLlamado.value,
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
    motivoLlamado.value = 'VERIFICACIÓN';
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
  <div class="bg-transparent pb-24">
    <!-- Header -->
    <!-- El header ahora se maneja globalmente en App.vue -->


    <!-- Teleport para la cabecera (Mecánica / Eléctrica) -->
    <Teleport to="#navbar-header-portal">
      <div class="flex items-center justify-center gap-1 bg-gray-50 p-0.5 rounded-[2px] border border-gray-200 w-28 sm:w-44">
        <label class="flex-1 flex justify-center py-1.5 rounded-[2px] cursor-pointer transition-all items-center"
               :class="tipoProblema === 'Mecánico' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'">
           <input type="radio" v-model="tipoProblema" value="Mecánico" class="hidden">
           <Wrench class="w-3.5 h-3.5" />
        </label>
        <label class="flex-1 flex justify-center py-1.5 rounded-[2px] cursor-pointer transition-all items-center"
               :class="tipoProblema === 'Eléctrico' ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'">
           <input type="radio" v-model="tipoProblema" value="Eléctrico" class="hidden">
           <Zap class="w-3.5 h-3.5" />
        </label>
      </div>
    </Teleport>

    <main class="max-w-sm mx-auto pt-2">
      <!-- Success/Error Message (Mantenerlos flotantes o arriba) -->
      <div v-if="successMessage" class="mx-2 mb-2 bg-green-50 border border-green-100 text-green-800 p-3 rounded-xl flex items-center shadow-sm">
        <CheckCircle class="w-5 h-5 mr-2 text-green-600" />
        <span class="font-semibold text-sm">{{ successMessage }}</span>
      </div>

      <div v-if="maquinasError" class="mx-2 mb-2 bg-red-50 border border-red-100 text-red-800 p-3 rounded-xl flex items-center shadow-sm">
        <span class="font-semibold text-sm">⚠️ Error al conectar con la base de datos.</span>
      </div>

      <form @submit.prevent="onSubmit" class="bg-white border-y border-gray-100">

        <!-- Selección de Máquina (Grupo Plano) -->
        <div class="px-4 py-3 border-b border-gray-50 flex gap-4">
          <!-- Selector de Tipo -->
          <div class="flex-[0.8]">
            <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest mb-1">Tipo</label>
            <select 
              v-model="tipoSeleccionado" 
              class="w-full bg-transparent border-0 p-0 text-gray-900 text-base font-bold focus:ring-0 focus:outline-none">
              <option v-for="tipo in ['APERTURA', 'CARDA', 'MANUAR', 'OPEN END', 'FILTRO']" :key="tipo" :value="tipo">
                {{ tipo }}
              </option>
            </select>
          </div>

          <!-- Selector de ID/Puesto -->
          <div class="flex-[1.2]">
            <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest mb-1">ID Máquina / Puesto</label>
            <select 
              v-model="maquinaSeleccionadaId" 
              class="w-full bg-transparent border-0 p-0 text-gray-900 text-base font-bold focus:ring-0 focus:outline-none"
              style="min-width: 0;">
              <option value="" disabled>Seleccionar...</option>
              <option v-for="m in maquinasFiltradas" :key="m.id" :value="m.id">
                {{ m.nombreDescriptivo }} {{ m.lado !== 'U' ? '(' + m.lado + ')' : '' }}
              </option>
            </select>
          </div>
        </div>

        <!-- SECCIÓN DE CATÁLOGO (Grupo Plano) -->
        <div v-if="catalogoCompleto.length > 0" class="bg-gray-50/30 animate-in fade-in duration-300">
          <div class="px-4 py-3 border-b border-gray-50 flex gap-4">
            <!-- Selección de Sección -->
            <div class="flex-[1.4]">
              <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest mb-1">1. Sección</label>
              <select v-model="seccionSeleccionada" class="w-full bg-transparent border-0 p-0 text-gray-900 text-base font-bold focus:ring-0 focus:outline-none">
                <option value="">Seleccionar...</option>
                <option v-for="s in seccionesDisponibles" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>

            <!-- Selección de Grupo -->
            <div class="flex-[0.6]">
              <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest mb-1" :class="{'opacity-50': !seccionSeleccionada}">2. Grupo</label>
              <select v-model="grupoSeleccionado" :disabled="!seccionSeleccionada" class="w-full bg-transparent border-0 p-0 text-gray-900 text-base font-bold focus:ring-0 focus:outline-none disabled:opacity-30">
                <option value="">...</option>
                <option v-for="g in gruposDisponibles" :key="g" :value="g">{{ g }}</option>
              </select>
            </div>
          </div>

          <!-- Selección de SubGrupo / Denominación -->
          <div v-if="grupoSeleccionado" class="px-4 py-3 border-b border-gray-50 animate-in slide-in-from-top-2">
             <div class="flex justify-between items-center mb-1">
                <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest">3. Punto / Parte específica</label>
                <div v-if="denominacionSeleccionada" class="flex gap-1">
                   <div v-if="denominacionSeleccionada.numeroArticulo && denominacionSeleccionada.numeroArticulo !== '-'" class="bg-indigo-600 text-white text-[9px] font-black px-2 py-0.5 rounded shadow-sm">
                      Art: {{ denominacionSeleccionada.numeroArticulo }}
                   </div>
                </div>
             </div>
             <select v-model="denominacionSeleccionada" class="w-full bg-transparent border-0 p-0 text-gray-900 text-base font-bold focus:ring-0 focus:outline-none">
               <option :value="null">Seleccionar Denominación...</option>
               <option v-for="d in denominacionesDisponibles" :key="d.id" :value="d">
                 {{ d.denominacion }} {{ d.subGrupo !== '-' ? '['+d.subGrupo+']' : '' }}
               </option>
             </select>
          </div>
        </div>

        <!-- Motivo del Llamado -->
        <div class="px-4 py-3 border-b border-gray-50">
           <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest mb-1">Motivo</label>
           <select 
             v-model="motivoLlamado" 
             class="w-full bg-transparent border-0 p-0 text-gray-900 text-base font-bold focus:ring-0 focus:outline-none">
             <option v-for="opt in ['VERIFICACIÓN', 'LIMPIEZA', 'AJUSTE', 'LUBRICACIÓN', 'CAMBIO']" :key="opt" :value="opt">
               {{ opt }}
             </option>
           </select>
        </div>

        <div class="px-4 py-3 border-b border-gray-50">
          <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest mb-1">Observaciones</label>
          <textarea 
            v-model="observaciones" 
            rows="2" 
            placeholder="Describa el problema..."
            class="w-full bg-white border border-gray-200 text-gray-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 block p-2.5 shadow-sm min-h-[60px]"></textarea>
        </div>

        <!-- Previsualización Condicional (Encima de la barra inferior) -->
        <div v-if="imagenPreview" class="fixed bottom-20 left-4 right-4 z-40 animate-in slide-in-from-bottom-4 duration-300">
           <div class="bg-white p-2 rounded-xl shadow-2xl border border-gray-100 flex items-center gap-3">
              <div class="relative w-16 h-16 rounded-lg overflow-hidden shrink-0 border border-gray-200">
                <img :src="imagenPreview" class="w-full h-full object-cover" />
                <div v-if="isCompressing" class="absolute inset-0 bg-white/80 flex items-center justify-center">
                  <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                </div>
              </div>
              <div class="flex-1 overflow-hidden">
                <p class="text-[10px] font-extrabold text-gray-400 tracking-widest mb-0.5">Imagen seleccionada</p>
                <p class="text-xs font-black text-green-600 truncate">{{ formatSize(imagenFile?.size) }}</p>
              </div>
              <button type="button" @click="imagenPreview=null; imagenFile=null" class="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition active:scale-95">
                <Settings class="w-5 h-5 rotate-45" />
              </button>
           </div>
        </div>

        <!-- Acciones Fijas (Bottom Bar Compacta e Integrada) -->
        <div class="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-3 z-30 shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
          <div class="max-w-sm mx-auto flex items-center gap-3">
            
            <!-- Criticidad (Toggle Discreto) -->
            <label class="flex items-center gap-2 cursor-pointer group shrink-0">
              <div class="relative flex items-center w-10 h-6">
                <input type="checkbox" v-model="isCritico" class="sr-only peer">
                <div class="w-full h-full bg-gray-100 rounded-full peer peer-checked:bg-red-500 transition-colors duration-300 border border-gray-200 peer-checked:border-red-600"></div>
                <div class="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform duration-300 peer-checked:translate-x-4 shadow-sm"></div>
              </div>
              <span class="text-[10px] font-black transition-colors" :class="isCritico ? 'text-red-600' : 'text-gray-400 group-hover:text-gray-600'">Crítico</span>
            </label>

            <label class="p-3 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-100 transition-all active:scale-90 relative shadow-sm group">
              <Camera class="w-6 h-6" :class="imagenPreview ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'" />
              <div v-if="imagenPreview" class="absolute -top-1 -right-1 w-3 h-3 bg-blue-600 rounded-full border-2 border-white ring-2 ring-blue-600/20"></div>
              <input type="file" accept="image/*" capture="environment" class="hidden" @change="onFileChange" />
            </label>

            <!-- Boton Enviar -->
            <button 
              type="submit" 
              :disabled="isSubmitting"
              class="flex-1 text-white bg-blue-600 hover:bg-blue-700 h-12 rounded-xl text-base font-bold shadow-lg shadow-blue-600/10 active:scale-[0.98] transition-all disabled:opacity-50 relative overflow-hidden flex items-center justify-center">
              <div v-if="isSubmitting" class="absolute inset-x-0 bottom-0 h-1 bg-blue-800/50 transition-all duration-300" :style="{ width: uploadProgress + '%' }"></div>
              <span class="tracking-wide">
                {{ isSubmitting ? `... ${uploadProgress}%` : 'Enviar' }}
              </span>
            </button>
          </div>
        </div>

      </form>
    </main>
  </div>
</template>

