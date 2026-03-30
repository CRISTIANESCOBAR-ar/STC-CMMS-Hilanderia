<script setup>
import { ref, onMounted, computed, watch, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import { intervencionService } from '../services/intervencionService';
import { userProfile, userRole } from '../services/authService';
import { DEFAULT_SECTOR, normalizeSectorValue, sanitizeSectorList } from '../constants/organization';
import { Camera, Trash2, BellRing, Wrench, Zap, ShieldAlert, CirclePlay, AlertTriangle, OctagonX, Share2 } from 'lucide-vue-next';
import Swal from 'sweetalert2';
import { compressImage, formatSize } from '../utils/imageCompressor';
import CameraCapture from './CameraCapture.vue';

// ── Tipos de intervención (extensible) ────────────────────────────────────────
const TIPOS_INTERVENCION = [
  { id: 'MECANICO',  label: 'Mecánico',  ic: Wrench,      activeBg: 'bg-blue-600 border-blue-600 shadow-blue-500/25',   activeText: 'text-white' },
  { id: 'ELECTRICO', label: 'Eléctrico', ic: Zap,         activeBg: 'bg-amber-500 border-amber-500 shadow-amber-500/25', activeText: 'text-white' },
  { id: 'CALIDAD',   label: 'Calidad',   ic: ShieldAlert, activeBg: 'bg-red-600 border-red-600 shadow-red-500/25',       activeText: 'text-white' },
];

// ── Máquinas ──────────────────────────────────────────────────────────────────
const maquinas       = ref([]);
const tipoSeleccionado      = ref('');
const gpSeleccionado         = ref('');
const maquinaSeleccionadaId  = ref('');
const maquinasError          = ref(false);

// ── Formulario ────────────────────────────────────────────────────────────────
const tipoIntervencion       = ref('MECANICO');
const critico                = ref(false);
const observaciones          = ref('');
const imagenFile             = ref(null);
const imagenPreview          = ref(null);
const imagenOriginalSize     = ref(null);
const isSubmitting           = ref(false);
const uploadProgress         = ref(0);
const isCompressing          = ref(false);
const isPreloading           = ref(false);
const showCamera             = ref(false);

// ── Estado de la máquina ─────────────────────────────────────────────────────
const ESTADOS_MAQUINA = [
  { id: 'EN_MARCHA',    label: 'En marcha',    ic: CirclePlay,    activeBg: 'bg-green-50 border-green-400',  iconColor: 'text-green-600',  textColor: 'text-green-700'  },
  { id: 'CON_PROBLEMA', label: 'Con problema', ic: AlertTriangle, activeBg: 'bg-amber-50 border-amber-400',  iconColor: 'text-amber-600',  textColor: 'text-amber-700'  },
  { id: 'PARADA',       label: 'Parada',       ic: OctagonX,      activeBg: 'bg-red-50 border-red-400',      iconColor: 'text-red-600',    textColor: 'text-red-700'    },
];
const estadoMaquina  = ref('CON_PROBLEMA');
const criticoForzado = computed(() => estadoMaquina.value === 'PARADA');

// ── Síntomas de tejeduría ─────────────────────────────────────────────────────
const todosSintomas       = ref([]);
const sintomaSeleccionado = ref(null);

const DERIVA_COLOR = {
  MECANICO:  { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'Mecánico'  },
  ELECTRICO: { bg: 'bg-amber-100',  text: 'text-amber-700',  label: 'Eléctrico' },
  AMBOS:     { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Ambos'     },
  TEJEDOR:   { bg: 'bg-green-100',  text: 'text-green-700',  label: 'Tejedor'   },
  CALIDAD:   { bg: 'bg-red-100',    text: 'text-red-700',    label: 'Calidad'   },
};

const router = useRouter();
const route = useRoute();
// ── Sectores del usuario ──────────────────────────────────────────────────────
const sectoresUsuario = computed(() => {
  if (!userProfile.value) return [DEFAULT_SECTOR];
  return sanitizeSectorList(userProfile.value.sectoresAsignados, userProfile.value.sectorDefault);
});
const sectorPrincipalUsuario = computed(() => sectoresUsuario.value[0] || DEFAULT_SECTOR);

// ── Carga de máquinas ─────────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const [snapMaq, snapSint] = await Promise.all([
      getDocs(collection(db, 'maquinas')),
      getDocs(query(collection(db, 'sintomas_tejeduria'), where('activo', '==', true))),
    ]);
    maquinas.value = snapMaq.docs.map(d => ({
      id: d.id, ...d.data(),
      sector: normalizeSectorValue(d.data().sector || DEFAULT_SECTOR)
    }));
    todosSintomas.value = snapSint.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99));

    // Default TELAR para inspector
    if (!route.query.maqId && userRole.value === 'inspector') {
      tipoSeleccionado.value = 'TELAR';
    }

    // Precarga desde query params (patrulla u otros orígenes)
    const q = route.query;
    if (q.maqId) {
      isPreloading.value = true;
      await nextTick();
      if (q.tipo) tipoSeleccionado.value = q.tipo;
      await nextTick();
      if (q.grp) gpSeleccionado.value = q.grp;
      await nextTick();
      maquinaSeleccionadaId.value = q.maqId;
      if (q.obs) observaciones.value = q.obs;
      // Precargar síntoma por nombre (ej: "Corte de trama" desde Roturas)
      if (q.sintomaName) {
        await nextTick();
        const match = todosSintomas.value.find(
          s => s.nombre?.toLowerCase() === q.sintomaName.toLowerCase()
        );
        if (match) sintomaSeleccionado.value = match;
      }
      await nextTick();
      isPreloading.value = false;
    } else {
      // Restaurar formulario si el SO mató la pestaña al abrir cámara
      await restoreFormState();
    }
  } catch { maquinasError.value = true; }
});

// ── Filtrado de máquinas (igual que CargaNovedad) ─────────────────────────────
const maquinasPorSector = computed(() =>
  maquinas.value.filter(m => sectoresUsuario.value.includes(normalizeSectorValue(m.sector || DEFAULT_SECTOR)))
);

const tiposDisponibles = computed(() => {
  const tipos = maquinasPorSector.value.map(m => String(m.tipo || '').toUpperCase()).filter(Boolean);
  return [...new Set(tipos)].sort();
});

const esTipoTelar = computed(() => tipoSeleccionado.value === 'TELAR');

const formatGrpTear = (raw) => {
  const r = String(raw || '').trim();
  if (!r) return '';
  const n = parseInt(r.slice(-2), 10);
  return isNaN(n) ? r.slice(-2) : String(n);
};

const formatGCmest = (raw) => {
  const r = String(raw || '').trim();
  if (!r) return '';
  const n = parseInt(r, 10);
  return isNaN(n) ? r : String(n);
};

const gruposTelarDisponibles = computed(() => {
  const grupos = maquinasPorSector.value
    .filter(m => String(m.tipo || '').toUpperCase() === 'TELAR')
    .map(m => String(m.grp_tear || '').trim()).filter(Boolean);
  return [...new Set(grupos)]
    .sort((a, b) => Number(formatGrpTear(a)) - Number(formatGrpTear(b)))
    .map(raw => ({ raw, label: formatGrpTear(raw) }));
});

const formatNombreDescriptivo = (nombre, maquina, sector, tipo) => {
  const id = String(maquina);
  if (String(tipo || '').toUpperCase() === 'TELAR') {
    const n = parseInt(id.slice(-2), 10);
    return `Toyota ${isNaN(n) ? id : n}`;
  }
  const num = sector === 'HILANDERIA' ? parseInt(id.slice(-2), 10) : parseInt(id.slice(-3), 10);
  return `${nombre} ${num}`;
};

const maquinasFiltradas = computed(() =>
  maquinasPorSector.value
    .filter(m => m.tipo?.toUpperCase() === tipoSeleccionado.value)
    .filter(m => !esTipoTelar.value || !gpSeleccionado.value || String(m.grp_tear || '').trim() === gpSeleccionado.value)
    .map(m => ({ ...m, nombreDescriptivo: formatNombreDescriptivo(m.nombre_maquina, m.maquina, m.sector, m.tipo) }))
    .sort((a, b) => a.local_fisico - b.local_fisico)
);

const detallesMaquina = computed(() =>
  maquinaSeleccionadaId.value
    ? maquinasPorSector.value.find(m => m.id === maquinaSeleccionadaId.value)
    : null
);

const gmSeleccionado = computed(() => esTipoTelar.value ? formatGCmest(detallesMaquina.value?.g_cmest) : '');

watch(tipoSeleccionado, () => { if (!isPreloading.value) { gpSeleccionado.value = ''; maquinaSeleccionadaId.value = ''; } });
watch(gpSeleccionado,   () => { if (!isPreloading.value) { maquinaSeleccionadaId.value = ''; } });
// PARADA => crítico forzado
watch(estadoMaquina, (estado) => {
  if (estado === 'PARADA') critico.value = true;
});

// Si el usuario cambia el tipo manualmente, limpiar el síntoma solo si no es compatible
watch(tipoIntervencion, (nuevoTipo) => {
  const d = sintomaSeleccionado.value?.derivaA;
  if (d && d !== 'AMBOS' && d !== nuevoTipo) sintomaSeleccionado.value = null;
});
watch(tiposDisponibles, (tipos) => {
  if (!tipos.includes(tipoSeleccionado.value)) tipoSeleccionado.value = tipos[0] || '';
}, { immediate: true });

// Binding para el <select> de síntomas
const sintomaIdSel = computed({
  get: () => sintomaSeleccionado.value?.id ?? '',
  set: (id) => {
    sintomaSeleccionado.value = todosSintomas.value.find(s => s.id === id) ?? null;
  },
});

// Auto-setear tipo de intervención desde derivaA del síntoma
watch(sintomaSeleccionado, (s) => {
  if (!s) return;
  if (s.derivaA === 'MECANICO')  tipoIntervencion.value = 'MECANICO';
  if (s.derivaA === 'ELECTRICO') tipoIntervencion.value = 'ELECTRICO';
  if (s.derivaA === 'CALIDAD')   tipoIntervencion.value = 'CALIDAD';
});

// ── Imagen ────────────────────────────────────────────────────────────────────
const FORM_STATE_KEY = 'cmms_intervencion_draft';
const IMG_DB = 'cmms_img_backup';
const IMG_STORE = 'imgs';

// ── IndexedDB helpers para respaldar la foto ──
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

const saveFormState = () => {
  try {
    const state = {
      tipoIntervencion: tipoIntervencion.value,
      tipoSeleccionado: tipoSeleccionado.value,
      gpSeleccionado: gpSeleccionado.value,
      maquinaSeleccionadaId: maquinaSeleccionadaId.value,
      estadoMaquina: estadoMaquina.value,
      critico: critico.value,
      observaciones: observaciones.value,
      sintomaId: sintomaSeleccionado.value?.id || null,
      ts: Date.now(),
    };
    sessionStorage.setItem(FORM_STATE_KEY, JSON.stringify(state));
  } catch { /* quota exceeded, ignore */ }
};

const restoreFormState = async () => {
  try {
    const raw = sessionStorage.getItem(FORM_STATE_KEY);
    if (!raw) return false;
    const state = JSON.parse(raw);
    // Solo restaurar si tiene menos de 10 min (la cámara no debería tardar más)
    if (Date.now() - state.ts > 10 * 60 * 1000) {
      sessionStorage.removeItem(FORM_STATE_KEY);
      return false;
    }
    isPreloading.value = true;
    if (state.tipoIntervencion) tipoIntervencion.value = state.tipoIntervencion;
    if (state.tipoSeleccionado) tipoSeleccionado.value = state.tipoSeleccionado;
    await nextTick();
    if (state.gpSeleccionado) gpSeleccionado.value = state.gpSeleccionado;
    await nextTick();
    if (state.maquinaSeleccionadaId) maquinaSeleccionadaId.value = state.maquinaSeleccionadaId;
    if (state.estadoMaquina) estadoMaquina.value = state.estadoMaquina;
    if (state.critico) critico.value = state.critico;
    if (state.observaciones) observaciones.value = state.observaciones;
    if (state.sintomaId) {
      await nextTick();
      sintomaSeleccionado.value = todosSintomas.value.find(s => s.id === state.sintomaId) || null;
    }
    isPreloading.value = false;
    sessionStorage.removeItem(FORM_STATE_KEY);
    // Restaurar imagen desde IndexedDB si sobrevivió
    const savedImg = await loadImageFromDB(FORM_STATE_KEY);
    if (savedImg) {
      imagenFile.value = savedImg;
      imagenPreview.value = URL.createObjectURL(savedImg);
      clearImageFromDB(FORM_STATE_KEY);
    }
    return true;
  } catch {
    return false;
  }
};

const openCamera = () => {
  saveFormState();
  if (imagenPreview.value?.startsWith('blob:')) URL.revokeObjectURL(imagenPreview.value);
  showCamera.value = true;
};

const onCameraCapture = async (blob) => {
  showCamera.value = false;
  sessionStorage.removeItem(FORM_STATE_KEY);
  isCompressing.value = true;
  try {
    // Si viene de galería (File grande) comprimir; si viene de getUserMedia ya es pequeño
    const needsCompress = blob.size > 200 * 1024;
    const final = needsCompress
      ? await compressImage(blob, { maxWidth: 800, quality: 0.65 })
      : blob;
    imagenFile.value = final;
    imagenOriginalSize.value = blob.size;
    imagenPreview.value = URL.createObjectURL(final);
    saveImageToDB(FORM_STATE_KEY, final);
  } catch {
    imagenFile.value = blob;
    imagenPreview.value = URL.createObjectURL(blob);
    saveImageToDB(FORM_STATE_KEY, blob);
  } finally {
    isCompressing.value = false;
  }
};

// ── Compartir por WhatsApp ────────────────────────────────────────────────────
const buildShareText = (d) => {
  const prioridad = d.critico ? '🔴 URGENTE' : d.estado === 'Con problema' ? '🟡 MEDIA' : '⚪ NORMAL';
  let msg = `⚙️ *SOLICITUD DE INTERVENCIÓN*\n\n`;
  msg += `🏭 *${d.nombre}*`;
  if (d.grupo) msg += ` · GP ${d.grupo}`;
  if (d.gm) msg += ` · GM ${d.gm}`;
  msg += `\n📍 ${d.sector}\n`;
  msg += `🔧 Tipo: *${d.tipo}*\n`;
  msg += `${prioridad} · ${d.estado}\n`;
  if (d.sintoma) msg += `🩺 Síntoma: *${d.sintoma}*\n`;
  if (d.obs) msg += `💬 *${d.obs}*\n`;
  msg += `\n📱 _Enviado desde CMMS STC_`;
  return msg;
};

const compartirWhatsApp = async (data, imageFile) => {
  const text = buildShareText(data);

  // Intentar Web Share API con imagen
  if (imageFile && navigator.canShare) {
    try {
      const sharePayload = {
        text,
        files: [new File([imageFile], 'intervencion.jpg', { type: imageFile.type || 'image/jpeg' })],
      };
      if (navigator.canShare(sharePayload)) {
        await navigator.share(sharePayload);
        return;
      }
    } catch (e) {
      if (e.name === 'AbortError') return; // Usuario canceló
    }
  }

  // Intentar Web Share API solo texto
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }

  // Fallback: abrir WhatsApp con texto
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
};

// ── Submit ────────────────────────────────────────────────────────────────────
const onSubmit = async () => {
  if (!maquinaSeleccionadaId.value) {
    Swal.fire({ icon: 'warning', title: 'Falta seleccionar', text: 'Seleccione una máquina.', confirmButtonColor: '#ea580c' });
    return;
  }
  isSubmitting.value = true;
  uploadProgress.value = 0;
  try {
    const m = detallesMaquina.value;
    const sectorNovedad = normalizeSectorValue(m.sector || sectorPrincipalUsuario.value);

    const datos = {
      maquinaId:            m.id,
      numeroMaquina:        m.maquina,
      tipoMaquina:          m.tipo,
      modeloMaquina:        m.modelo || '',
      sector:               sectorNovedad,
      local_fisico:         m.local_fisico,
      grupoTelar:           esTipoTelar.value ? formatGrpTear(m.grp_tear) : null,
      gmTelar:              esTipoTelar.value ? gmSeleccionado.value : null,
      nombreMaquinaDisplay: formatNombreDescriptivo(m.nombre_maquina, m.maquina, m.sector, m.tipo),
      lado:                 m.lado,
      tipoIntervencion: tipoIntervencion.value,
      sintomaId:         sintomaSeleccionado.value?.id || null,
      sintomaNombre:     sintomaSeleccionado.value?.nombre || null,
      derivaA:           sintomaSeleccionado.value?.derivaA || null,
      motivoCodigo:      null,   // el mecánico lo asocia al cerrar
      motivoDescripcion: sintomaSeleccionado.value?.nombre || null,
      estadoMaquina:    estadoMaquina.value,
      critico:          critico.value,
      observaciones:    observaciones.value,
    };

    await intervencionService.crearIntervencion(datos, imagenFile.value, (p) => { uploadProgress.value = p; });

    // Capturar datos para compartir ANTES de limpiar el form
    const shareData = {
      nombre: datos.nombreMaquinaDisplay,
      sector: datos.sector,
      tipo: datos.tipoIntervencion,
      estado: datos.estadoMaquina === 'PARADA' ? 'PARADA' : datos.estadoMaquina === 'CON_PROBLEMA' ? 'Con problema' : 'En marcha',
      critico: datos.critico,
      sintoma: datos.sintomaNombre,
      obs: datos.observaciones,
      grupo: datos.grupoTelar,
      gm: datos.gmTelar,
    };
    const shareImageFile = imagenFile.value;

    if (imagenPreview.value?.startsWith('blob:')) URL.revokeObjectURL(imagenPreview.value);
    maquinaSeleccionadaId.value = '';
    critico.value = false;
    observaciones.value = '';
    sintomaSeleccionado.value = null;
    estadoMaquina.value = 'CON_PROBLEMA';
    imagenFile.value = null;
    imagenPreview.value = null;
    clearImageFromDB(FORM_STATE_KEY);

    // Mostrar diálogo de compartir
    const { isConfirmed } = await Swal.fire({
      icon: 'success',
      title: '¡Solicitud enviada!',
      html: '<p class="text-sm text-gray-500">¿Compartir por WhatsApp?</p>',
      showCancelButton: true,
      confirmButtonText: '📲 Compartir',
      cancelButtonText: 'No, gracias',
      confirmButtonColor: '#25D366',
      cancelButtonColor: '#9ca3af',
      allowOutsideClick: true,
    });

    if (isConfirmed) {
      await compartirWhatsApp(shareData, shareImageFile);
    }

    // Si viene de roturas, volver automáticamente
    if (route.query.origen === 'roturas') {
      router.push('/patrulla/roturas');
    }
  } catch (error) {
    Swal.fire({ icon: 'error', title: 'Error al registrar', text: error.message || 'Error desconocido' });
  } finally { isSubmitting.value = false; }
};
</script>

<template>
  <div class="bg-transparent pb-40">

    <!-- Botón volver a Roturas (solo si viene de ahí) -->
    <div v-if="route.query.origen === 'roturas'" class="max-w-sm mx-auto px-4 pt-2">
      <button type="button" @click="router.push('/patrulla/roturas')"
        class="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 active:scale-95 transition">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
        Volver a Control de Roturas
      </button>
    </div>

    <main class="max-w-sm mx-auto pt-2">

      <div v-if="maquinasError" class="mx-2 mb-2 bg-red-50 border border-red-100 text-red-800 p-3 rounded-xl flex items-center shadow-sm">
        <span class="font-semibold text-sm">⚠️ Error al conectar con la base de datos.</span>
      </div>

      <form id="intervencion-form" @submit.prevent="onSubmit" class="bg-white border-y border-gray-100">

        <!-- ── Tipo de Intervención ──────────────────────────────────────────── -->
        <div class="px-4 pt-4 pb-3 border-b border-gray-100">
          <div class="flex items-center gap-2 mb-3">
            <span class="w-5 h-5 rounded-full bg-orange-100 text-orange-600 text-[10px] font-black flex items-center justify-center shrink-0">1</span>
            <label class="text-[10px] font-extrabold text-gray-400 tracking-widest">TIPO DE INTERVENCIÓN</label>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="tipo in TIPOS_INTERVENCION"
              :key="tipo.id"
              type="button"
              @click="tipoIntervencion = tipo.id"
              class="flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl border-2 transition-all active:scale-[0.97] shadow-sm"
              :class="tipoIntervencion === tipo.id
                ? tipo.activeBg + ' shadow-lg'
                : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'"
            >
              <component :is="tipo.ic" class="w-5 h-5" :class="tipoIntervencion === tipo.id ? 'text-white' : 'text-gray-400'" />
              <span class="text-[11px] font-black tracking-wide" :class="tipoIntervencion === tipo.id ? 'text-white' : 'text-gray-500'">
                {{ tipo.label }}
              </span>
            </button>
          </div>
        </div>

        <!-- ── Selección de Máquina ──────────────────────────────────────────── -->
        <div class="px-4 py-3 border-b border-gray-100">
          <div class="flex items-center gap-2 mb-3">
            <span class="w-5 h-5 rounded-full bg-orange-100 text-orange-600 text-[10px] font-black flex items-center justify-center shrink-0">2</span>
            <label class="text-[10px] font-extrabold text-gray-400 tracking-widest">SELECCIÓN DE MÁQUINA</label>
          </div>
          <div class="flex gap-2">
            <!-- Tipo -->
            <div :class="esTipoTelar ? 'flex-[0.8]' : 'flex-[1]'">
              <label class="block text-[9px] font-extrabold text-gray-400 tracking-widest mb-1">TIPO</label>
              <div class="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
                <select v-model="tipoSeleccionado" :disabled="tiposDisponibles.length === 0"
                  class="w-full bg-transparent border-0 p-0 text-gray-900 text-sm font-bold focus:ring-0 focus:outline-none">
                  <option v-if="tiposDisponibles.length === 0" value="" disabled>—</option>
                  <option v-for="t in tiposDisponibles" :key="t" :value="t">{{ t }}</option>
                </select>
              </div>
            </div>

            <!-- Gp (solo TELAR) -->
            <div v-if="esTipoTelar" class="flex-[0.5]">
              <label class="block text-[9px] font-extrabold text-gray-400 tracking-widest mb-1">GRUPO</label>
              <div class="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5" :class="!gruposTelarDisponibles.length ? 'opacity-40' : ''">
                <select v-model="gpSeleccionado" :disabled="!gruposTelarDisponibles.length"
                  class="w-full bg-transparent border-0 p-0 text-gray-900 text-sm font-bold focus:ring-0 focus:outline-none">
                  <option value="" disabled>—</option>
                  <option v-for="g in gruposTelarDisponibles" :key="g.raw" :value="g.raw">{{ g.label }}</option>
                </select>
              </div>
            </div>

            <!-- ID Máquina -->
            <div :class="esTipoTelar ? 'flex-[1.1]' : 'flex-[1.2]'">
              <label class="block text-[9px] font-extrabold text-gray-400 tracking-widest mb-1">MÁQUINA</label>
              <div class="border rounded-lg px-2.5 py-1.5 transition-colors"
                :class="maquinaSeleccionadaId
                  ? 'bg-orange-50 border-orange-300'
                  : 'bg-gray-50 border-gray-200'"
              >
                <select v-model="maquinaSeleccionadaId"
                  class="w-full bg-transparent border-0 p-0 text-sm font-bold focus:ring-0 focus:outline-none"
                  :class="maquinaSeleccionadaId ? 'text-orange-700' : 'text-gray-400'"
                  style="min-width:0">
                  <option value="" disabled>Seleccionar…</option>
                  <option v-for="m in maquinasFiltradas" :key="m.id" :value="m.id">
                    {{ m.nombreDescriptivo }}{{ m.lado !== 'U' ? ' (' + m.lado + ')' : '' }}
                  </option>
                </select>
              </div>
            </div>

            <!-- GM (solo TELAR) -->
            <div v-if="esTipoTelar" class="flex-[0.45]">
              <label class="block text-[9px] font-extrabold text-gray-400 tracking-widest mb-1">GM</label>
              <div class="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
                <span class="text-sm font-bold text-gray-700">{{ gmSeleccionado || '—' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ── ¿Qué está pasando? (Síntoma) ──────────────────────────────── -->
        <div v-if="maquinaSeleccionadaId" class="px-4 pt-3 pb-3 border-b border-gray-100 animate-in fade-in duration-200">

          <!-- Header -->
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <span class="w-5 h-5 rounded-full bg-orange-100 text-orange-600 text-[10px] font-black flex items-center justify-center shrink-0">3</span>
              <label class="text-[10px] font-extrabold text-gray-400 tracking-widest">¿QUÉ ESTÁ PASANDO?</label>
            </div>
            <button v-if="sintomaSeleccionado" type="button"
              @click="sintomaSeleccionado = null"
              class="text-[10px] font-bold text-gray-400 hover:text-red-500 transition">
              ✕ Limpiar
            </button>
          </div>

          <!-- Select de síntomas -->
          <div class="border rounded-lg px-2.5 py-1.5 transition-colors"
            :class="sintomaSeleccionado ? 'bg-orange-50 border-orange-300' : 'bg-gray-50 border-gray-200'"
          >
            <select
              v-model="sintomaIdSel"
              class="w-full bg-transparent border-0 p-0 text-sm font-bold focus:ring-0 focus:outline-none"
              :class="sintomaSeleccionado ? 'text-orange-700' : 'text-gray-400'"
            >
              <option value="" disabled>Seleccionar síntoma…</option>
              <option v-for="s in todosSintomas" :key="s.id" :value="s.id">
                {{ s.destacado ? '★ ' : '' }}{{ s.nombre }}
              </option>
            </select>
          </div>

          <!-- Badge: derivación automática -->
          <div v-if="sintomaSeleccionado" class="mt-2 flex flex-wrap items-center gap-2">
            <span class="text-[9px] font-extrabold text-gray-400 tracking-widest">SE NOTIFICA A:</span>
            <span class="text-[11px] font-black px-2.5 py-0.5 rounded-full"
              :class="[DERIVA_COLOR[sintomaSeleccionado.derivaA]?.bg, DERIVA_COLOR[sintomaSeleccionado.derivaA]?.text]">
              {{ DERIVA_COLOR[sintomaSeleccionado.derivaA]?.label }}
            </span>
            <span v-if="sintomaSeleccionado.derivaA === 'TEJEDOR'"
              class="text-[10px] text-green-700 font-bold">— Resolución por tejedor / atador</span>
          </div>

          <!-- Selector de tipo si derivaA === AMBOS -->
          <div v-if="sintomaSeleccionado?.derivaA === 'AMBOS'" class="mt-2 flex gap-2">
            <button
              v-for="tipo in TIPOS_INTERVENCION.filter(t => t.id !== 'CALIDAD')"
              :key="tipo.id"
              type="button"
              @click="tipoIntervencion = tipo.id"
              class="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border-2 text-xs font-black transition-all active:scale-95"
              :class="tipoIntervencion === tipo.id
                ? tipo.activeBg + ' text-white shadow-sm'
                : 'bg-white border-gray-200 text-gray-500'"
            >
              <component :is="tipo.ic" class="w-4 h-4" />
              {{ tipo.label }}
            </button>
          </div>
        </div>

        <!-- ── Estado de la máquina ──────────────────────────────────────────── -->
        <div v-if="maquinaSeleccionadaId" class="px-4 pt-3 pb-3 border-b border-gray-100 animate-in fade-in duration-200">
          <div class="flex items-center gap-2 mb-2">
            <span class="w-5 h-5 rounded-full bg-orange-100 text-orange-600 text-[10px] font-black flex items-center justify-center shrink-0">4</span>
            <label class="text-[10px] font-extrabold text-gray-400 tracking-widest">ESTADO DE LA MÁQUINA</label>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="e in ESTADOS_MAQUINA" :key="e.id"
              type="button"
              @click="estadoMaquina = e.id"
              class="flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl border-2 transition-all active:scale-[0.97]"
              :class="estadoMaquina === e.id ? e.activeBg : 'bg-white border-gray-200'"
            >
              <component :is="e.ic" class="w-4 h-4"
                :class="estadoMaquina === e.id ? e.iconColor : 'text-gray-300'" />
              <span class="text-[10px] font-black leading-tight text-center"
                :class="estadoMaquina === e.id ? e.textColor : 'text-gray-400'">
                {{ e.label }}
              </span>
            </button>
          </div>
          <p v-if="estadoMaquina === 'PARADA'" class="mt-2 text-[10px] font-bold text-red-600 flex items-center gap-1">
            <OctagonX class="w-3 h-3 shrink-0" /> Se marcará como Crítico automáticamente
          </p>
        </div>

        <!-- ── Observaciones ──────────────────────────────────────────────────── -->
        <div class="px-4 py-3 border-b border-gray-50">
          <div class="flex items-center gap-2 mb-2">
            <span class="w-5 h-5 rounded-full bg-orange-100 text-orange-600 text-[10px] font-black flex items-center justify-center shrink-0">5</span>
            <label class="text-[10px] font-extrabold text-gray-400 tracking-widest">OBSERVACIONES</label>
          </div>
          <textarea
            v-model="observaciones"
            rows="2"
            placeholder="Describe el problema observado... (opcional)"
            class="w-full bg-white border border-gray-200 text-gray-900 text-sm rounded-md focus:ring-orange-400 focus:border-orange-400 block p-2.5 shadow-sm min-h-15 resize-none outline-none"
          ></textarea>
        </div>

        <!-- ── Preview imagen ─────────────────────────────────────────────────── -->
        <div v-if="imagenPreview" class="px-4 py-4 mb-4 animate-in fade-in duration-300">
          <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
            <div class="relative w-full h-48 bg-gray-900 flex items-center justify-center">
              <img :src="imagenPreview" class="w-full h-full object-contain" />
              <div v-if="isCompressing" class="absolute inset-0 bg-white/80 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
              </div>
            </div>
            <div class="p-3 bg-gray-50 flex items-center justify-between border-t border-gray-100">
              <div>
                <p class="text-[10px] font-extrabold text-gray-400 tracking-widest mb-0.5">IMAGEN ADJUNTA</p>
                <p class="text-xs font-black text-green-600">{{ formatSize(imagenFile?.size) }}</p>
              </div>
              <button type="button" @click="imagenPreview = null; imagenFile = null"
                class="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition font-bold text-xs">
                <Trash2 class="w-4 h-4" /> Quitar
              </button>
            </div>
          </div>
        </div>

      </form>
    </main>

    <!-- ── Barra inferior fija ──────────────────────────────────────────────── -->
    <div class="fixed bottom-14 left-0 right-0 z-[95] px-2 pb-2">
      <div class="max-w-sm mx-auto bg-white border border-gray-200 rounded-[1.4rem] shadow-[0_-10px_35px_rgba(15,23,42,0.14)] p-3">
        <div class="flex items-center gap-3">

          <!-- Criticidad -->
          <label class="flex items-center gap-2 shrink-0"
            :class="criticoForzado ? 'cursor-not-allowed' : 'cursor-pointer group'"
          >
            <div class="relative flex items-center w-10 h-6">
              <input type="checkbox" v-model="critico" :disabled="criticoForzado" class="sr-only peer">
              <div class="w-full h-full rounded-full transition-colors border"
                :class="criticoForzado ? 'bg-red-500 border-red-600' : 'bg-gray-100 border-gray-200 peer-checked:bg-red-500 peer-checked:border-red-600'"></div>
              <div class="absolute top-1 bg-white w-4 h-4 rounded-full shadow-sm transition-transform"
                :class="(critico || criticoForzado) ? 'left-1 translate-x-4' : 'left-1'"></div>
            </div>
            <span class="text-[10px] font-black transition-colors"
              :class="criticoForzado ? 'text-red-600' : (critico ? 'text-red-600' : 'text-gray-400 group-hover:text-gray-600')">
              {{ criticoForzado ? '¡Parada!' : 'Crítico' }}
            </span>
          </label>

          <!-- Cámara / Galería -->
          <button type="button" @click="openCamera" class="p-3 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-100 transition active:scale-90 relative shadow-sm group">
            <Camera class="w-6 h-6" :class="imagenPreview ? 'text-orange-500' : 'text-gray-400 group-hover:text-gray-600'" />
            <div v-if="imagenPreview" class="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full border-2 border-white ring-2 ring-orange-500/20"></div>
          </button>

          <!-- Botón principal: Solicitar -->
          <button
            type="submit"
            form="intervencion-form"
            :disabled="isSubmitting"
            class="flex-1 flex items-center justify-center gap-2 h-12 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-base font-bold shadow-lg shadow-orange-600/20 active:scale-[0.98] transition-all disabled:opacity-50 relative overflow-hidden"
          >
            <div v-if="isSubmitting"
              class="absolute inset-x-0 bottom-0 h-1 bg-orange-900/40 transition-all duration-300"
              :style="{ width: uploadProgress + '%' }">
            </div>
            <BellRing class="w-5 h-5" />
            <span class="tracking-wide">
              {{ isSubmitting ? `... ${uploadProgress}%` : 'Solicitar' }}
            </span>
          </button>

        </div>
      </div>
    </div>

  </div>

  <!-- Cámara nativa -->
  <CameraCapture v-if="showCamera" @capture="onCameraCapture" @cancel="showCamera = false" />
</template>
