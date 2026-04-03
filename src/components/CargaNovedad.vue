<script setup>
import { ref, onMounted, computed, watch, nextTick } from 'vue';
import { collection, addDoc, getDocs, query, where, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { mantenimientoService } from '../services/mantenimientoService';
import { catalogoService } from '../services/catalogoService';
import { userProfile, userRole } from '../services/authService';
import { DEFAULT_SECTOR, normalizeSectorValue, sanitizeSectorList } from '../constants/organization';
import catalogDataR60 from '../data/catalogo_full_r60.json';
import { UploadCloud, CheckCircle, Wrench, Zap, Info, Camera, Trash2, Grid2x2, X, BookOpen, AlertTriangle, History, ArrowLeftRight, NotebookPen, Package, ChevronLeft, Loader2 } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import Swal from 'sweetalert2';

import { compressImage, formatSize } from '../utils/imageCompressor';
import CameraCapture from './CameraCapture.vue';
import { getMotivos } from '../constants/motivos';

const maquinas = ref([]);
const router = useRouter();
const tipoSeleccionado = ref('');
const gpSeleccionado = ref('');
const maquinaSeleccionadaId = ref('');
const tipoProblema = ref('Mecánico'); // Mecánico or Eléctrico

// Catálogo de Puestos de Control (Cascada)
const catalogoCompleto = ref([]);
const seccionSeleccionada = ref('');
const grupoSeleccionado = ref('');
const denominacionSeleccionada = ref(null); // Objeto completo del punto seleccionado

const isCritico = ref(false);
const motivoLlamado = ref('VERIFICACIÓN');

// Visor de procedimiento
const showProcedimientoViewer = ref(false);
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

// Bottom Sheet — Acciones Contextuales
const bottomSheetMode = ref(null); // null | 'historial' | 'derivar' | 'notaTurno'
const historialMaquina = ref([]);
const cargandoHistorial = ref(false);
const notaTurno = ref('');
const enviandoNota = ref(false);

const sectoresUsuario = computed(() => {
  if (!userProfile.value) return [DEFAULT_SECTOR];
  return sanitizeSectorList(userProfile.value.sectoresAsignados, userProfile.value.sectorDefault);
});

const sectorPrincipalUsuario = computed(() => sectoresUsuario.value[0] || DEFAULT_SECTOR);

// Cargar lista de máquinas desde Firestore al montar
onMounted(() => {
  // 1. Cargar máquinas inmediatamente
  cargarMaquinas().then(() => restoreNovedadState());

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

const esTipoTelar = computed(() => tipoSeleccionado.value === 'TELAR');

const formatGrpTear = (grpTear) => {
  const raw = String(grpTear || '').trim();
  if (!raw) return '';
  const ultimosDos = raw.slice(-2);
  const parsed = Number.parseInt(ultimosDos, 10);
  return Number.isNaN(parsed) ? ultimosDos : String(parsed);
};

const formatGCmest = (gCmest) => {
  const raw = String(gCmest || '').trim();
  if (!raw) return '';
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? raw : String(parsed);
};

const gruposTelarDisponibles = computed(() => {
  const grupos = maquinasPorSector.value
    .filter((m) => String(m.tipo || '').toUpperCase() === 'TELAR')
    .map((m) => String(m.grp_tear || '').trim())
    .filter(Boolean);

  return [...new Set(grupos)]
    .sort((a, b) => Number(formatGrpTear(a)) - Number(formatGrpTear(b)))
    .map((raw) => ({ raw, label: formatGrpTear(raw) }));
});

const formatNombreDescriptivo = (nombre_maquina, maquina, sector, tipo) => {
  const id = String(maquina);
  if (String(tipo || '').toUpperCase() === 'TELAR') {
    const numeroPuesto = Number.parseInt(id.slice(-2), 10);
    return `Toyota ${Number.isNaN(numeroPuesto) ? id : numeroPuesto}`;
  }

  const num = sector === 'HILANDERIA'
    ? parseInt(id.slice(-2), 10)
    : parseInt(id.slice(-3), 10);
  return `${nombre_maquina} ${num}`;
};

const maquinasFiltradas = computed(() => {
  return maquinasPorSector.value
    .filter(m => m.tipo.toUpperCase() === tipoSeleccionado.value)
    .filter((m) => {
      if (!esTipoTelar.value || !gpSeleccionado.value) return true;
      return String(m.grp_tear || '').trim() === gpSeleccionado.value;
    })
    .map(m => ({
      ...m,
      nombreDescriptivo: formatNombreDescriptivo(m.nombre_maquina, m.maquina, m.sector, m.tipo)
    }))
    .sort((a, b) => a.local_fisico - b.local_fisico);
});

// Reset machine selection and catalog when type or machine changes
watch(tipoSeleccionado, () => {
  gpSeleccionado.value = '';
  maquinaSeleccionadaId.value = '';
  resetCatalogo();
  motivoLlamado.value = motivosDisponibles.value[0];
});

watch(tipoProblema, () => {
  motivoLlamado.value = motivosDisponibles.value[0];
});

watch(gpSeleccionado, () => {
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

const motivosDisponibles = computed(() => {
  return getMotivos(tipoSeleccionado.value, tipoProblema.value);
});

const gmSeleccionado = computed(() => {
  if (!esTipoTelar.value) return '';
  return formatGCmest(detallesMaquina.value?.g_cmest);
});

// Determina la clave de catálogo según el tipo/modelo de la máquina
const getCatalogKey = (maquina) => {
  if (!maquina) return null;
  if (maquina.tipo === 'OPEN END' || maquina.modelo === 'R-60') return { field: 'modelo', value: 'R-60' };
  if (maquina.tipo === 'TELAR') return { field: 'tipo', value: 'TELAR' };
  if (maquina.tipo === 'INDIGO' || maquina.modelo === 'BENNINGER') return { field: 'modelo', value: 'BENNINGER' };
  return null;
};

// Cargar catálogo según el tipo/modelo de máquina seleccionada
watch(detallesMaquina, async (newVal) => {
  const key = getCatalogKey(newVal);
  if (!key) { resetCatalogo(); return; }
  try {
    if (key.field === 'tipo') {
      catalogoCompleto.value = await catalogoService.obtenerPuntosPorTipo(key.value);
    } else {
      catalogoCompleto.value = await catalogoService.obtenerPuntosPorModelo(key.value);
    }
    // Si no hay resultados en el campo 'tipo', intentar fallback por 'modelo' con el nombre de display
    if (catalogoCompleto.value.length === 0 && key.field === 'tipo') {
      catalogoCompleto.value = await catalogoService.obtenerPuntosPorModelo('TOYOTA');
    }
  } catch (err) {
    console.error('Error cargando catálogo', err);
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

// Devuelve el número corto que usa el personal en la práctica.
// Para BENNINGER todos los grupos son "25XXX" → mostramos solo "XXX".
// Para otros modelos, detecta si todos los grupos del catálogo comparten
// un prefijo numérico común y lo quita en la visualización.
const grupoPrefix = computed(() => {
  const grupos = gruposDisponibles.value;
  if (grupos.length < 2) return '';
  const first = String(grupos[0]);
  let prefix = '';
  for (let i = 1; i <= first.length; i++) {
    const candidate = first.slice(0, i);
    // Si ya no es prefijo común, cortar
    if (!grupos.every(g => String(g).startsWith(candidate))) break;
    // Solo guardar el candidato si queda sufijo de al menos 3 dígitos en todos los grupos
    // Ej: grupos 25400,25410 → "25" deja "400","410" (3 díg) ✓ | "254" deja "00","10" (2 díg) → no guardar
    if (grupos.every(g => String(g).length - i >= 3)) {
      prefix = candidate;
    }
  }
  return prefix.length >= 2 ? prefix : '';
});

const formatGrupo = (g) => {
  const p = grupoPrefix.value;
  return p && String(g).startsWith(p) ? String(g).slice(p.length) : String(g);
};


const denominacionesDisponibles = computed(() => {
    if (!grupoSeleccionado.value) return [];
    const items = catalogoCompleto.value.filter(c =>
        c.seccion === seccionSeleccionada.value &&
        c.grupo === grupoSeleccionado.value
    );
    const seen = new Set();
    return items.filter(c => {
        const sub = (c.subGrupo || '').trim().replace(/^-$/, '');
        const key = `${c.denominacion}||${sub}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
});

// Al cambiar una jerarquía superior, resetear las inferiores
watch(seccionSeleccionada, () => { grupoSeleccionado.value = ''; denominacionSeleccionada.value = null; });
watch(grupoSeleccionado, () => { denominacionSeleccionada.value = null; });
watch(denominacionSeleccionada, () => { showProcedimientoViewer.value = false; });

const NOVEDAD_IMG_KEY = 'cmms_novedad_img';
const IMG_DB = 'cmms_img_backup';
const IMG_STORE = 'imgs';

const openImgDB = () => new Promise((resolve, reject) => {
  const r = indexedDB.open(IMG_DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(IMG_STORE);
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

const saveImageToDB = async (key, blob) => {
  try {
    const idb = await openImgDB();
    const tx = idb.transaction(IMG_STORE, 'readwrite');
    tx.objectStore(IMG_STORE).put({ blob, ts: Date.now() }, key);
    idb.close();
  } catch { /* ignore */ }
};

const loadImageFromDB = async (key) => {
  try {
    const idb = await openImgDB();
    return new Promise(resolve => {
      const req = idb.transaction(IMG_STORE, 'readonly').objectStore(IMG_STORE).get(key);
      req.onsuccess = () => {
        idb.close();
        const d = req.result;
        if (d && Date.now() - d.ts < 10 * 60 * 1000) resolve(d.blob);
        else resolve(null);
      };
      req.onerror = () => { idb.close(); resolve(null); };
    });
  } catch { return null; }
};

const clearImageFromDB = async (key) => {
  try {
    const idb = await openImgDB();
    idb.transaction(IMG_STORE, 'readwrite').objectStore(IMG_STORE).delete(key);
    idb.close();
  } catch { /* ignore */ }
};

const saveNovedadState = () => {
  try {
    sessionStorage.setItem('cmms_novedad_draft', JSON.stringify({
      tipoSeleccionado: tipoSeleccionado.value,
      gpSeleccionado: gpSeleccionado.value,
      maquinaSeleccionadaId: maquinaSeleccionadaId.value,
      tipoProblema: tipoProblema.value,
      isCritico: isCritico.value,
      observaciones: observaciones.value,
      ts: Date.now(),
    }));
  } catch { /* ignore */ }
};

const restoreNovedadState = async () => {
  try {
    const raw = sessionStorage.getItem('cmms_novedad_draft');
    if (!raw) return;
    const s = JSON.parse(raw);
    if (Date.now() - s.ts > 10 * 60 * 1000) { sessionStorage.removeItem('cmms_novedad_draft'); return; }
    if (s.tipoSeleccionado) tipoSeleccionado.value = s.tipoSeleccionado;
    await nextTick();
    if (s.gpSeleccionado) gpSeleccionado.value = s.gpSeleccionado;
    await nextTick();
    if (s.maquinaSeleccionadaId) maquinaSeleccionadaId.value = s.maquinaSeleccionadaId;
    if (s.tipoProblema) tipoProblema.value = s.tipoProblema;
    if (s.isCritico) isCritico.value = s.isCritico;
    if (s.observaciones) observaciones.value = s.observaciones;
    sessionStorage.removeItem('cmms_novedad_draft');
    // Restaurar imagen desde IndexedDB
    const savedImg = await loadImageFromDB(NOVEDAD_IMG_KEY);
    if (savedImg) {
      imagenFile.value = savedImg;
      imagenPreview.value = URL.createObjectURL(savedImg);
      clearImageFromDB(NOVEDAD_IMG_KEY);
    }
  } catch { /* ignore */ }
};

const showCamera = ref(false);

const openCamera = () => {
  saveNovedadState();
  if (imagenPreview.value?.startsWith('blob:')) URL.revokeObjectURL(imagenPreview.value);
  showCamera.value = true;
};

const onCameraCapture = async (blob) => {
  showCamera.value = false;
  sessionStorage.removeItem('cmms_novedad_draft');
  isCompressing.value = true;
  try {
    const needsCompress = blob.size > 200 * 1024;
    const final = needsCompress
      ? await compressImage(blob, { maxWidth: 800, quality: 0.65 })
      : blob;
    imagenFile.value = final;
    imagenOriginalSize.value = blob.size;
    imagenPreview.value = URL.createObjectURL(final);
    saveImageToDB(NOVEDAD_IMG_KEY, final);
  } catch {
    imagenFile.value = blob;
    imagenPreview.value = URL.createObjectURL(blob);
    saveImageToDB(NOVEDAD_IMG_KEY, blob);
  } finally {
    isCompressing.value = false;
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
    clearImageFromDB(NOVEDAD_IMG_KEY);
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
  bottomSheetMode.value = null;
};

const abrirHistorial = async () => {
  bottomSheetMode.value = 'historial';
  cargandoHistorial.value = true;
  historialMaquina.value = [];
  try {
    const q = query(
      collection(db, 'novedades'),
      where('maquinaId', '==', maquinaSeleccionadaId.value),
      orderBy('createdAt', 'desc'),
      limit(5)
    );
    const snap = await getDocs(q);
    historialMaquina.value = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('Error cargando historial', e);
  } finally {
    cargandoHistorial.value = false;
  }
};

const abrirDerivar = () => {
  bottomSheetMode.value = 'derivar';
};

const confirmarDerivar = (nuevoTipo) => {
  if (nuevoTipo === tipoProblema.value) return;
  tipoProblema.value = nuevoTipo;
  if (observaciones.value.trim()) {
    observaciones.value = `[Derivado a ${nuevoTipo}] ${observaciones.value}`;
  }
  bottomSheetMode.value = null;
  menuAccionesAbierto.value = false;
};

const enviarNotaTurno = async () => {
  if (!notaTurno.value.trim()) return;
  enviandoNota.value = true;
  try {
    const maq = detallesMaquina.value;
    await addDoc(collection(db, 'notas_turno'), {
      maquinaId: maquinaSeleccionadaId.value,
      nombreMaquina: maq ? `${maq.nombre_maquina} ${maq.maquina}` : maquinaSeleccionadaId.value,
      sector: maq?.sector || sectorPrincipalUsuario.value,
      nota: notaTurno.value.trim(),
      creadoPorNombre: userProfile.value?.displayName || 'Anónimo',
      creadoPorEmail: userProfile.value?.email || null,
      createdAt: serverTimestamp(),
      leida: false,
    });
    notaTurno.value = '';
    bottomSheetMode.value = null;
    menuAccionesAbierto.value = false;
    successMessage.value = 'Nota enviada al próximo turno.';
    setTimeout(() => { successMessage.value = ''; }, 3000);
  } catch (e) {
    console.error('Error guardando nota turno', e);
  } finally {
    enviandoNota.value = false;
  }
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
          <div :class="esTipoTelar ? 'flex-[0.8]' : 'flex-[1]'">
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

          <!-- Selector de Gp (solo TELAR) -->
          <div v-if="esTipoTelar" class="flex-[0.5]">
            <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest mb-1">Gp</label>
            <select
              v-model="gpSeleccionado"
              :disabled="gruposTelarDisponibles.length === 0"
              class="w-full bg-transparent border-0 p-0 text-gray-900 text-base font-bold focus:ring-0 focus:outline-none disabled:opacity-40"
            >
              <option value="" disabled>Gp...</option>
              <option v-for="g in gruposTelarDisponibles" :key="g.raw" :value="g.raw">
                {{ g.label }}
              </option>
            </select>
          </div>

          <!-- Selector de ID Máquina -->
          <div :class="esTipoTelar ? 'flex-[1.1]' : 'flex-[1.2]'">
            <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest mb-1">ID Máquina</label>
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

          <!-- GM (solo TELAR, solo lectura) -->
          <div v-if="esTipoTelar" class="flex-[0.45]">
            <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest mb-1">GM</label>
            <div class="text-gray-900 text-base font-bold py-1.5 leading-none">
              {{ gmSeleccionado || '—' }}
            </div>
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
                <option v-for="g in gruposDisponibles" :key="g" :value="g">{{ formatGrupo(g) }}</option>
              </select>
            </div>
          </div>

          <!-- Selección de SubGrupo / Denominación -->
          <div v-if="grupoSeleccionado" class="px-4 py-3 border-b border-gray-50 animate-in slide-in-from-top-2">
             <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest mb-1">3. Punto / Parte específica</label>
             <select v-model="denominacionSeleccionada" class="w-full bg-transparent border-0 p-0 text-gray-900 text-base font-bold focus:ring-0 focus:outline-none">
               <option :value="null">Seleccionar Denominación...</option>
               <option v-for="d in denominacionesDisponibles" :key="d.id" :value="d">
                 {{ d.denominacion }} {{ d.subGrupo !== '-' ? '['+d.subGrupo+']' : '' }}
               </option>
             </select>

             <!-- Info + botón tras seleccionar denominación -->
             <div v-if="denominacionSeleccionada" class="mt-2.5 flex items-center gap-2">
               <!-- Tiempo estimado -->
               <div v-if="denominacionSeleccionada.tiempo" class="flex items-center gap-1.5 flex-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                 <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14" stroke-linecap="round" stroke-linejoin="round"/></svg>
                 <span class="text-[11px] font-black text-amber-700 tracking-wide">{{ denominacionSeleccionada.tiempo }}</span>
               </div>
               <!-- Badge nro artículo -->
               <div v-if="denominacionSeleccionada.numeroArticulo && denominacionSeleccionada.numeroArticulo !== '-'" class="bg-indigo-600 text-white text-[9px] font-black px-2 py-1 rounded shrink-0">
                 Art: {{ denominacionSeleccionada.numeroArticulo }}
               </div>
               <!-- Botón Ver Procedimiento -->
               <button
                 type="button"
                 @click="denominacionSeleccionada?.procedimiento?.length > 0 && (showProcedimientoViewer = true)"
                 :disabled="!denominacionSeleccionada?.procedimiento?.length"
                 :title="denominacionSeleccionada?.procedimiento?.length ? 'Ver procedimiento (' + denominacionSeleccionada.procedimiento.length + ' pasos)' : 'Sin procedimiento cargado'"
                 class="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition active:scale-[0.97]"
                 :class="denominacionSeleccionada?.procedimiento?.length
                   ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                   : 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'"
               >
                 <BookOpen class="w-3.5 h-3.5" />
                 <span>Procedimiento</span>
                 <span v-if="denominacionSeleccionada?.procedimiento?.length" class="bg-indigo-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
                   {{ denominacionSeleccionada.procedimiento.length }}
                 </span>
               </button>
             </div>
          </div>
        </div>

        <!-- Motivo del Llamado -->
        <div class="px-4 py-3 border-b border-gray-50">
           <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest mb-1">Motivo</label>
           <select 
             v-model="motivoLlamado" 
             class="w-full bg-transparent border-0 p-0 text-gray-900 text-base font-bold focus:ring-0 focus:outline-none">
             <option v-for="opt in motivosDisponibles" :key="opt" :value="opt">
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
        <div class="fixed bottom-14 left-0 right-0 z-[95] px-2 pb-2 sm:px-3">
          <div
            class="max-w-sm mx-auto bg-white border border-gray-200 shadow-[0_-10px_35px_rgba(15,23,42,0.14)] overflow-hidden transition-all duration-200"
            :class="menuAccionesAbierto ? 'rounded-[1.75rem]' : 'rounded-[1.4rem]'"
          >
            <div
              v-if="menuAccionesAbierto"
              class="px-3 pt-3 pb-2 border-b border-gray-100 animate-in slide-in-from-bottom-4 duration-200"
            >
              <div class="w-12 h-1.5 rounded-full bg-gray-300 mx-auto mb-3"></div>
              <!-- Header dinámico -->
              <div class="flex items-center justify-between mb-3 px-1">
                <div class="flex items-center gap-2">
                  <button v-if="bottomSheetMode" type="button" @click="bottomSheetMode = null"
                    class="w-7 h-7 rounded-full border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-500 transition hover:bg-gray-100">
                    <ChevronLeft class="w-4 h-4" />
                  </button>
                  <p class="text-sm font-black text-gray-700 tracking-wide">
                    {{ bottomSheetMode === 'historial' ? 'Historial Máquina'
                      : bottomSheetMode === 'derivar' ? 'Derivar Tipo'
                      : bottomSheetMode === 'notaTurno' ? 'Nota p/ Turno Siguiente'
                      : 'Acciones' }}
                  </p>
                </div>
                <button type="button" @click="cerrarMenuAcciones"
                  class="w-8 h-8 rounded-full border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-500 flex items-center justify-center transition"
                  aria-label="Cerrar menu">
                  <X class="w-4 h-4" />
                </button>
              </div>

              <!-- Modo: 4 botones principales -->
              <div v-if="!bottomSheetMode" class="grid grid-cols-2 gap-2">
                <!-- Historial Máquina -->
                <button type="button" :disabled="!maquinaSeleccionadaId" @click="abrirHistorial"
                  class="h-20 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                  :class="maquinaSeleccionadaId ? 'border-gray-200 bg-gray-50 hover:bg-blue-50 hover:border-blue-200' : 'border-gray-100 bg-gray-50/50 opacity-40 cursor-not-allowed'">
                  <span class="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-blue-600">
                    <History class="w-4 h-4" />
                  </span>
                  <span class="text-[10px] font-bold text-gray-600 leading-tight text-center px-1">Historial Máquina</span>
                </button>
                <!-- Derivar Tipo -->
                <button type="button" :disabled="!maquinaSeleccionadaId" @click="abrirDerivar"
                  class="h-20 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                  :class="maquinaSeleccionadaId ? 'border-gray-200 bg-gray-50 hover:bg-amber-50 hover:border-amber-200' : 'border-gray-100 bg-gray-50/50 opacity-40 cursor-not-allowed'">
                  <span class="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-amber-500">
                    <ArrowLeftRight class="w-4 h-4" />
                  </span>
                  <span class="text-[10px] font-bold text-gray-600 leading-tight text-center px-1">Derivar Tipo</span>
                </button>
                <!-- Nota Turno -->
                <button type="button" :disabled="!maquinaSeleccionadaId" @click="bottomSheetMode = 'notaTurno'; notaTurno = ''"
                  class="h-20 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                  :class="maquinaSeleccionadaId ? 'border-gray-200 bg-gray-50 hover:bg-violet-50 hover:border-violet-200' : 'border-gray-100 bg-gray-50/50 opacity-40 cursor-not-allowed'">
                  <span class="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-violet-600">
                    <NotebookPen class="w-4 h-4" />
                  </span>
                  <span class="text-[10px] font-bold text-gray-600 leading-tight text-center px-1">Nota Turno</span>
                </button>
                <!-- Pedir Pieza (placeholder) -->
                <button type="button" disabled title="Próximamente"
                  class="h-20 rounded-2xl border border-gray-100 bg-gray-50/50 opacity-40 cursor-not-allowed flex flex-col items-center justify-center gap-1">
                  <span class="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-gray-400">
                    <Package class="w-4 h-4" />
                  </span>
                  <span class="text-[10px] font-bold text-gray-500 leading-tight text-center px-1">Pedir Pieza</span>
                  <span class="text-[8px] text-gray-400 font-medium -mt-0.5">Próximamente</span>
                </button>
              </div>

              <!-- Modo: historial -->
              <div v-else-if="bottomSheetMode === 'historial'" class="space-y-2">
                <div v-if="cargandoHistorial" class="flex justify-center py-4">
                  <Loader2 class="w-5 h-5 text-blue-500 animate-spin" />
                </div>
                <p v-else-if="historialMaquina.length === 0" class="text-center py-4 text-gray-400 text-xs font-medium">
                  Sin reportes anteriores para esta máquina.
                </p>
                <div v-else v-for="h in historialMaquina" :key="h.id"
                  class="flex items-start gap-2 p-2.5 rounded-xl bg-gray-50 border border-gray-100">
                  <span class="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                    :class="h.tipoProblema === 'Mecánico' ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'">
                    <Wrench v-if="h.tipoProblema === 'Mecánico'" class="w-2.5 h-2.5" />
                    <Zap v-else class="w-2.5 h-2.5" />
                  </span>
                  <div class="flex-1 min-w-0">
                    <p class="text-[11px] font-bold text-gray-700 truncate">{{ h.motivo }}</p>
                    <p class="text-[10px] text-gray-400 truncate">{{ h.observaciones }}</p>
                    <p class="text-[9px] text-gray-300 font-medium mt-0.5">
                      {{ h.createdAt?.toDate ? h.createdAt.toDate().toLocaleDateString('es-AR') : '—' }}
                      · <span :class="h.estado === 'resuelto' ? 'text-green-500' : 'text-orange-400'">{{ h.estado }}</span>
                    </p>
                  </div>
                </div>
              </div>

              <!-- Modo: derivar -->
              <div v-else-if="bottomSheetMode === 'derivar'" class="space-y-3">
                <p class="text-xs text-gray-500 px-1">
                  Tipo actual: <strong>{{ tipoProblema }}</strong>. Seleccioná el tipo al que querés derivar el reporte.
                </p>
                <div class="grid grid-cols-2 gap-2">
                  <button type="button" @click="confirmarDerivar('Mecánico')" :disabled="tipoProblema === 'Mecánico'"
                    class="h-16 rounded-2xl border flex flex-col items-center justify-center gap-1 transition-all active:scale-[0.98]"
                    :class="tipoProblema === 'Mecánico' ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-200 cursor-default' : 'border-gray-200 bg-gray-50 hover:bg-blue-50 hover:border-blue-200'">
                    <Wrench class="w-5 h-5" :class="tipoProblema === 'Mecánico' ? 'text-blue-600' : 'text-gray-500'" />
                    <span class="text-[10px] font-bold" :class="tipoProblema === 'Mecánico' ? 'text-blue-700' : 'text-gray-600'">Mecánico {{ tipoProblema === 'Mecánico' ? '✓' : '' }}</span>
                  </button>
                  <button type="button" @click="confirmarDerivar('Eléctrico')" :disabled="tipoProblema === 'Eléctrico'"
                    class="h-16 rounded-2xl border flex flex-col items-center justify-center gap-1 transition-all active:scale-[0.98]"
                    :class="tipoProblema === 'Eléctrico' ? 'border-amber-300 bg-amber-50 ring-2 ring-amber-200 cursor-default' : 'border-gray-200 bg-gray-50 hover:bg-amber-50 hover:border-amber-200'">
                    <Zap class="w-5 h-5" :class="tipoProblema === 'Eléctrico' ? 'text-amber-500' : 'text-gray-500'" />
                    <span class="text-[10px] font-bold" :class="tipoProblema === 'Eléctrico' ? 'text-amber-700' : 'text-gray-600'">Eléctrico {{ tipoProblema === 'Eléctrico' ? '✓' : '' }}</span>
                  </button>
                </div>
              </div>

              <!-- Modo: nota turno -->
              <div v-else-if="bottomSheetMode === 'notaTurno'" class="space-y-2">
                <textarea v-model="notaTurno" rows="3" placeholder="Ej: La máquina quedó con vibración en el motor izquierdo, revisar al inicio del turno..."
                  class="w-full bg-gray-50 border border-gray-200 text-gray-900 text-xs rounded-xl focus:ring-blue-500 focus:border-blue-500 p-2.5 resize-none"
                ></textarea>
                <button type="button" :disabled="!notaTurno.trim() || enviandoNota" @click="enviarNotaTurno"
                  class="w-full h-10 rounded-xl text-sm font-bold transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  :class="notaTurno.trim() && !enviandoNota ? 'bg-violet-600 text-white hover:bg-violet-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'">
                  <Loader2 v-if="enviandoNota" class="w-4 h-4 animate-spin" />
                  <NotebookPen v-else class="w-4 h-4" />
                  {{ enviandoNota ? 'Enviando...' : 'Enviar Nota' }}
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

            <button type="button" @click="openCamera" class="p-3 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-100 transition-all active:scale-90 relative shadow-sm group">
              <Camera class="w-6 h-6" :class="imagenPreview ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'" />
              <div v-if="imagenPreview" class="absolute -top-1 -right-1 w-3 h-3 bg-blue-600 rounded-full border-2 border-white ring-2 ring-blue-600/20"></div>
            </button>

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

    <!-- Modal Visualizador de Procedimiento -->
    <Teleport to="body">
      <div
        v-if="showProcedimientoViewer"
        class="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-gray-900/60 backdrop-blur-sm"
        @click.self="showProcedimientoViewer = false"
      >
        <div class="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[95dvh] sm:max-h-[85vh] flex flex-col">
          <div class="p-4 border-b border-gray-100 flex justify-between items-start shrink-0">
            <div class="flex-1 pr-2">
              <p class="text-[10px] font-extrabold text-indigo-500 tracking-widest mb-0.5">PROCEDIMIENTO</p>
              <h3 class="text-sm font-black text-gray-800 leading-tight">{{ denominacionSeleccionada?.denominacion }}</h3>
              <p class="text-xs text-gray-400 font-medium mt-0.5">{{ denominacionSeleccionada?.seccion }} · Grupo {{ denominacionSeleccionada?.grupo }}</p>
            </div>
            <button @click="showProcedimientoViewer = false" class="p-1.5 hover:bg-gray-100 rounded-lg transition shrink-0">
              <X class="w-5 h-5 text-gray-400" />
            </button>
          </div>
          <div class="overflow-y-auto flex-1 p-4 space-y-4">
            <div v-for="(paso, i) in denominacionSeleccionada.procedimiento" :key="i" class="space-y-2">
              <div class="flex gap-3">
                <div class="flex-none w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-black flex items-center justify-center shrink-0 mt-0.5">{{ i + 1 }}</div>
                <p class="text-sm text-gray-800 font-medium leading-relaxed pt-0.5">{{ paso.texto }}</p>
              </div>
              <div v-if="paso.imagenUrl" class="ml-9 rounded-lg overflow-hidden border border-gray-200">
                <img :src="paso.imagenUrl" class="w-full max-h-64 object-contain bg-gray-900" />
              </div>
            </div>
          </div>
          <div class="px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-gray-100 shrink-0">
            <button @click="showProcedimientoViewer = false" type="button" class="w-full py-3 bg-gray-900 text-white rounded-xl font-bold text-sm hover:bg-gray-800 transition">
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>

  <!-- Cámara nativa -->
  <CameraCapture v-if="showCamera" @capture="onCameraCapture" @cancel="showCamera = false" />
</template>

