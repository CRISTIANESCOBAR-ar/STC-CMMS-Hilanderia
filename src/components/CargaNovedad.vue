<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { mantenimientoService } from '../services/mantenimientoService';
import { catalogoService } from '../services/catalogoService';
import { userProfile } from '../services/authService';
import { DEFAULT_SECTOR, normalizeSectorValue, sanitizeSectorList } from '../constants/organization';
import catalogDataR60 from '../data/catalogo_full_r60.json';
import { UploadCloud, CheckCircle, Wrench, Zap, Info, Camera, Trash2, Grid2x2, X } from 'lucide-vue-next';
import Swal from 'sweetalert2';

import { compressImage, formatSize } from '../utils/imageCompressor';

const maquinas = ref([]);
const tipoSeleccionado = ref('');
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
const menuAccionesAbierto = ref(false);

const accionesRapidas = [
  { id: 'accion-1', nombre: 'Opcion 1' },
  { id: 'accion-2', nombre: 'Opcion 2' },
  { id: 'accion-3', nombre: 'Opcion 3' },
  { id: 'accion-4', nombre: 'Opcion 4' },
  { id: 'accion-5', nombre: 'Opcion 5' },
  { id: 'accion-6', nombre: 'Opcion 6' },
  { id: 'accion-7', nombre: 'Opcion 7' },
  { id: 'accion-8', nombre: 'Opcion 8' }
];

const sectoresUsuario = computed(() => {
  if (!userProfile.value) return [DEFAULT_SECTOR];
  return sanitizeSectorList(userProfile.value.sectoresAsignados, userProfile.value.sectorDefault);
});

const sectorPrincipalUsuario = computed(() => sectoresUsuario.value[0] || DEFAULT_SECTOR);

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
      const data = doc.data();
      lista.push({
        id: doc.id,
        ...data,
        sector: normalizeSectorValue(data.sector || DEFAULT_SECTOR)
      });
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
const maquinasPorSector = computed(() => {
  return maquinas.value.filter((m) => sectoresUsuario.value.includes(normalizeSectorValue(m.sector || DEFAULT_SECTOR)));
});

const tiposDisponibles = computed(() => {
  const tipos = maquinasPorSector.value.map((m) => String(m.tipo || '').toUpperCase()).filter(Boolean);
  return [...new Set(tipos)].sort();
});

const formatNombreDescriptivo = (nombre_maquina, maquina, sector) => {
  const id = String(maquina);
  const num = sector === 'HILANDERIA'
    ? parseInt(id.slice(-2), 10)
    : parseInt(id.slice(-3), 10);
  return `${nombre_maquina} ${num}`;
};

const maquinasFiltradas = computed(() => {
  return maquinasPorSector.value
    .filter(m => m.tipo.toUpperCase() === tipoSeleccionado.value)
    .map(m => ({
      ...m,
      nombreDescriptivo: formatNombreDescriptivo(m.nombre_maquina, m.maquina, m.sector)
    }))
    .sort((a, b) => a.local_fisico - b.local_fisico);
});

// Reset machine selection and catalog when type or machine changes
watch(tipoSeleccionado, () => {
  maquinaSeleccionadaId.value = '';
  resetCatalogo();
});

watch(tiposDisponibles, (newTipos) => {
  if (!newTipos.includes(tipoSeleccionado.value)) {
    tipoSeleccionado.value = newTipos[0] || '';
  }
}, { immediate: true });

const detallesMaquina = computed(() => {
  if (!maquinaSeleccionadaId.value) return null;
  return maquinasPorSector.value.find(m => m.id === maquinaSeleccionadaId.value);
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
    const sectorNovedad = normalizeSectorValue(detallesMaquina.value.sector || sectorPrincipalUsuario.value);

    const datosNovedad = {
      maquinaId: detallesMaquina.value.id,
      numeroMaquina: detallesMaquina.value.maquina,
      tipoMaquina: detallesMaquina.value.tipo,
      modeloMaquina: detallesMaquina.value.modelo || '',
      sector: sectorNovedad,
      planta: detallesMaquina.value.planta || null,
      area: detallesMaquina.value.area || null,
      jefeDestinoSector: detallesMaquina.value.jefeDestinoSector || sectorNovedad,
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

const toggleMenuAcciones = () => {
  menuAccionesAbierto.value = !menuAccionesAbierto.value;
};

const cerrarMenuAcciones = () => {
  menuAccionesAbierto.value = false;
};

const seleccionarAccionRapida = (accion) => {
  console.log('Accion rapida seleccionada:', accion.id);
  menuAccionesAbierto.value = false;
};
</script>

<template>
  <div class="bg-transparent pb-24">
    <!-- Header -->
    <!-- El header ahora se maneja globalmente en App.vue -->


    <!-- Teleport para la cabecera (Mecánica / Eléctrica) -->
    <Teleport to="#navbar-header-portal">
      <div class="flex items-center justify-center gap-1 bg-gray-50 p-0.5 rounded-xs border border-gray-200 w-28 sm:w-44">
        <label class="flex-1 flex justify-center py-1.5 rounded-xs cursor-pointer transition-all items-center"
               :class="tipoProblema === 'Mecánico' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'">
           <input type="radio" v-model="tipoProblema" value="Mecánico" class="hidden">
           <Wrench class="w-3.5 h-3.5" />
        </label>
        <label class="flex-1 flex justify-center py-1.5 rounded-xs cursor-pointer transition-all items-center"
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
              :disabled="tiposDisponibles.length === 0"
              class="w-full bg-transparent border-0 p-0 text-gray-900 text-base font-bold focus:ring-0 focus:outline-none">
              <option v-if="tiposDisponibles.length === 0" value="" disabled>Sin tipos</option>
              <option v-for="tipo in tiposDisponibles" :key="tipo" :value="tipo">
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
            class="w-full bg-white border border-gray-200 text-gray-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 block p-2.5 shadow-sm min-h-15"></textarea>
        </div>

        <div v-if="imagenPreview" class="px-4 py-4 mb-16 animate-in fade-in duration-300">
           <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
              <div class="relative w-full h-56 sm:h-64 bg-gray-900 flex items-center justify-center">
                <img :src="imagenPreview" class="w-full h-full object-contain" />
                <div v-if="isCompressing" class="absolute inset-0 bg-white/80 flex items-center justify-center">
                  <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              </div>
              <div class="p-3 bg-gray-50 flex items-center justify-between border-t border-gray-100">
                <div>
                  <p class="text-[10px] font-extrabold text-gray-400 tracking-widest mb-0.5">IMAGEN ADJUNTA</p>
                  <p class="text-xs font-black text-green-600">{{ formatSize(imagenFile?.size) }}</p>
                </div>
                <button type="button" @click="imagenPreview=null; imagenFile=null" class="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition active:scale-95 font-bold text-xs" title="Eliminar imagen">
                  <Trash2 class="w-4 h-4" />
                  Quitar
                </button>
              </div>
           </div>
        </div>

        <div
          v-if="menuAccionesAbierto"
          class="fixed inset-0 z-30 bg-slate-900/12"
          @click="cerrarMenuAcciones"
        ></div>

        <!-- Acciones Fijas (Bottom Bar Compacta e Integrada) -->
        <div class="fixed bottom-0 left-0 right-0 z-40 px-2 pb-2 sm:px-3">
          <div
            class="max-w-sm mx-auto bg-white border border-gray-200 shadow-[0_-10px_35px_rgba(15,23,42,0.14)] overflow-hidden transition-all duration-200"
            :class="menuAccionesAbierto ? 'rounded-[1.75rem]' : 'rounded-[1.4rem]'"
          >
            <div
              v-if="menuAccionesAbierto"
              class="px-3 pt-3 pb-2 border-b border-gray-100 animate-in slide-in-from-bottom-4 duration-200"
            >
              <div class="w-12 h-1.5 rounded-full bg-gray-300 mx-auto mb-3"></div>
              <div class="flex items-center justify-between mb-3 px-1">
                <p class="text-sm font-black text-gray-700 tracking-wide">Acciones rapidas</p>
                <button
                  type="button"
                  class="w-8 h-8 rounded-full border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-500 flex items-center justify-center transition"
                  @click="cerrarMenuAcciones"
                  aria-label="Cerrar menu"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>
              <div class="grid grid-cols-4 gap-2">
                <button
                  v-for="accion in accionesRapidas"
                  :key="accion.id"
                  type="button"
                  class="h-20 rounded-2xl border border-gray-200 bg-gray-50 hover:bg-blue-50 hover:border-blue-200 active:scale-[0.98] transition-all flex flex-col items-center justify-center gap-1"
                  @click="seleccionarAccionRapida(accion)"
                >
                  <span class="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-blue-600 font-black text-xs">
                    {{ accion.id.split('-')[1] }}
                  </span>
                  <span class="text-[11px] font-bold text-gray-600 leading-tight">{{ accion.nombre }}</span>
                </button>
              </div>
            </div>

            <div class="p-3">
              <div class="flex items-center gap-3">
            
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

            <button
              type="button"
              class="h-12 px-3 rounded-xl border shadow-sm transition-all active:scale-95 flex items-center justify-center gap-2"
              :class="menuAccionesAbierto ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'"
              @click="toggleMenuAcciones"
              aria-label="Abrir menu de acciones"
            >
              <Grid2x2 class="w-5 h-5" />
              <span class="text-xs font-black tracking-wide">Menu</span>
            </button>

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
          </div>
        </div>

      </form>
    </main>
  </div>
</template>

