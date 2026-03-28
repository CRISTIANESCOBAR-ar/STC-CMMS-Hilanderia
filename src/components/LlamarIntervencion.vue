<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import { intervencionService } from '../services/intervencionService';
import { userProfile } from '../services/authService';
import { DEFAULT_SECTOR, normalizeSectorValue, sanitizeSectorList } from '../constants/organization';
import { Camera, Trash2, BellRing, Wrench, Zap, ShieldAlert } from 'lucide-vue-next';
import Swal from 'sweetalert2';
import { compressImage, formatSize } from '../utils/imageCompressor';

// ── Tipos de intervención (extensible) ────────────────────────────────────────
const TIPOS_INTERVENCION = [
  { id: 'MECANICO',   label: 'Mecánico',   ic: Wrench, activeBg: 'bg-blue-600 border-blue-600 shadow-blue-500/25',   activeText: 'text-white' },
  { id: 'ELECTRICO',  label: 'Eléctrico',  ic: Zap,    activeBg: 'bg-amber-500 border-amber-500 shadow-amber-500/25', activeText: 'text-white' },
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

// ── Motivos de parada ────────────────────────────────────────────────────────────────
const todosMotivos         = ref([]);
const motivoSeleccionado   = ref(null);
const tipoFallaSeleccionada = ref(null); // tipoDeFalla activo (pill)
const verTodos             = ref(false);
const ITEMS_VISIBLES       = 6;
const router = useRouter();
// ── Sectores del usuario ──────────────────────────────────────────────────────
const sectoresUsuario = computed(() => {
  if (!userProfile.value) return [DEFAULT_SECTOR];
  return sanitizeSectorList(userProfile.value.sectoresAsignados, userProfile.value.sectorDefault);
});
const sectorPrincipalUsuario = computed(() => sectoresUsuario.value[0] || DEFAULT_SECTOR);

// ── Carga de máquinas ─────────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const [snapMaq, snapMot] = await Promise.all([
      getDocs(collection(db, 'maquinas')),
      getDocs(query(collection(db, 'codigos_paradas'), where('activo', '==', true))),
    ]);
    maquinas.value = snapMaq.docs.map(d => ({
      id: d.id, ...d.data(),
      sector: normalizeSectorValue(d.data().sector || DEFAULT_SECTOR)
    }));
    todosMotivos.value = snapMot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.codigo - b.codigo);
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

watch(tipoSeleccionado, () => { gpSeleccionado.value = ''; maquinaSeleccionadaId.value = ''; });
watch(gpSeleccionado,   () => { maquinaSeleccionadaId.value = ''; });
watch(tipoIntervencion, () => {
  motivoSeleccionado.value    = null;
  tipoFallaSeleccionada.value = null;
  verTodos.value              = false;
});
watch(tiposDisponibles, (tipos) => {
  if (!tipos.includes(tipoSeleccionado.value)) tipoSeleccionado.value = tipos[0] || '';
}, { immediate: true });

// Motivos del grupo según tipo de intervención (MECANICO=2, ELECTRICO=4)
const motivosFiltrados = computed(() => {
  const grupoTarget = tipoIntervencion.value === 'MECANICO' ? 2 : 4;
  return todosMotivos.value.filter(m => m.grupo === grupoTarget);
});

// Tipos de falla disponibles (solo los que tienen códigos)
const motivosTipos = computed(() => {
  const tipos = [...new Set(
    motivosFiltrados.value.map(m => m.tipoDeFalla).filter(Boolean)
  )].sort();
  return tipos;
});

// Lista final: destacados primero, luego el resto (orden por codigo)
const motivosParaListbox = computed(() => {
  let lista = motivosFiltrados.value;
  if (tipoFallaSeleccionada.value) {
    lista = lista.filter(m => m.tipoDeFalla === tipoFallaSeleccionada.value);
  }
  const destacados = lista.filter(m => m.destacado).sort((a, b) => (a.codigo ?? 0) - (b.codigo ?? 0));
  const resto      = lista.filter(m => !m.destacado).sort((a, b) => (a.codigo ?? 0) - (b.codigo ?? 0));
  return [...destacados, ...resto];
});

// Por defecto solo los destacados; si no hay ninguno muestra los primeros 6
const motivosVisibles = computed(() => {
  const destacados = motivosParaListbox.value.filter(m => m.destacado);
  if (!verTodos.value) {
    return destacados.length ? destacados : motivosParaListbox.value.slice(0, ITEMS_VISIBLES);
  }
  return motivosParaListbox.value;
});

// ── Imagen ────────────────────────────────────────────────────────────────────
const onFileChange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  isCompressing.value = true;
  if (imagenPreview.value?.startsWith('blob:')) URL.revokeObjectURL(imagenPreview.value);
  try {
    const compressed = await compressImage(file, { maxWidth: 1024, quality: 0.7 });
    imagenFile.value = compressed;
    imagenOriginalSize.value = file.size;
    imagenPreview.value = URL.createObjectURL(compressed);
  } catch {
    imagenFile.value = file;
    imagenPreview.value = URL.createObjectURL(file);
  } finally { isCompressing.value = false; }
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
      maquinaId:        m.id,
      numeroMaquina:    m.maquina,
      tipoMaquina:      m.tipo,
      modeloMaquina:    m.modelo || '',
      sector:           sectorNovedad,
      local_fisico:     m.local_fisico,
      lado:             m.lado,
      tipoIntervencion: tipoIntervencion.value,
      motivoCodigo:     motivoSeleccionado.value?.codigo || null,
      motivoDescripcion: motivoSeleccionado.value?.motivo_es || null,
      critico:          critico.value,
      observaciones:    observaciones.value,
    };

    await intervencionService.crearIntervencion(datos, imagenFile.value, (p) => { uploadProgress.value = p; });

    if (imagenPreview.value?.startsWith('blob:')) URL.revokeObjectURL(imagenPreview.value);
    maquinaSeleccionadaId.value = '';
    critico.value = false;
    observaciones.value = '';
    motivoSeleccionado.value = null;
    imagenFile.value = null;
    imagenPreview.value = null;

    Swal.fire({
      toast: true,
      position: 'top',
      icon: 'success',
      title: '¡Solicitud enviada!',
      text: 'El equipo de mantenimiento fue notificado.',
      showConfirmButton: false,
      timer: 3500,
      timerProgressBar: true,
      iconColor: '#ea580c',
    });
    router.push('/intervenciones');
  } catch (error) {
    Swal.fire({ icon: 'error', title: 'Error al registrar', text: error.message || 'Error desconocido' });
  } finally { isSubmitting.value = false; }
};
</script>

<template>
  <div class="bg-transparent pb-28">

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
          <div class="flex gap-2">
            <button
              v-for="tipo in TIPOS_INTERVENCION"
              :key="tipo.id"
              type="button"
              @click="tipoIntervencion = tipo.id"
              class="flex-1 flex flex-col items-center gap-2 py-3.5 rounded-xl border-2 transition-all active:scale-[0.97] shadow-sm"
              :class="tipoIntervencion === tipo.id
                ? tipo.activeBg + ' shadow-lg'
                : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'"
            >
              <component :is="tipo.ic" class="w-5 h-5" :class="tipoIntervencion === tipo.id ? 'text-white' : 'text-gray-400'" />
              <span class="text-xs font-black tracking-wide" :class="tipoIntervencion === tipo.id ? 'text-white' : 'text-gray-500'">
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

        <!-- ── Motivo de parada ───────────────────────────────────────────── -->
        <div v-if="maquinaSeleccionadaId && motivosFiltrados.length" class="px-4 pt-3 pb-3 border-b border-gray-100 animate-in fade-in duration-200">

          <!-- Header -->
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <span class="w-5 h-5 rounded-full bg-orange-100 text-orange-600 text-[10px] font-black flex items-center justify-center shrink-0">3</span>
              <label class="text-[10px] font-extrabold text-gray-400 tracking-widest">MOTIVO DE PARADA</label>
            </div>
            <button v-if="motivoSeleccionado" type="button"
              @click="motivoSeleccionado = null"
              class="text-[10px] font-bold text-gray-400 hover:text-red-500 transition">
              ✕ Limpiar
            </button>
          </div>

          <!-- Tipo de falla: pills -->
          <div v-if="motivosTipos.length" class="flex flex-wrap gap-1.5 mb-3">
            <button
              v-for="t in motivosTipos"
              :key="t"
              type="button"
              @click="tipoFallaSeleccionada = tipoFallaSeleccionada === t ? null : t; verTodos = false; motivoSeleccionado = null"
              class="px-3.5 py-1.5 rounded-full text-xs font-black border-2 transition-all active:scale-95"
              :class="tipoFallaSeleccionada === t
                ? (tipoIntervencion === 'MECANICO' ? 'bg-blue-600 border-blue-600 text-white shadow-sm shadow-blue-600/30' : 'bg-amber-500 border-amber-500 text-white shadow-sm shadow-amber-500/30')
                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'"
            >
              {{ t }}
            </button>
            <button
              v-if="tipoFallaSeleccionada"
              type="button"
              @click="tipoFallaSeleccionada = null; verTodos = false"
              class="px-2.5 py-1.5 text-[11px] font-bold text-gray-400 hover:text-gray-600 transition border border-dashed border-gray-200 rounded-full"
            >✕ Todos</button>
          </div>

          <!-- Listbox de motivos -->
          <div class="rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <button
              v-for="(m, idx) in motivosVisibles"
              :key="m.codigo"
              type="button"
              @click="motivoSeleccionado = motivoSeleccionado?.codigo === m.codigo ? null : m"
              class="w-full flex items-center gap-3 px-3 py-3.5 text-left transition-all active:scale-[0.99] relative"
              :class="[
                motivoSeleccionado?.codigo === m.codigo
                  ? (tipoIntervencion === 'MECANICO' ? 'bg-blue-600 text-white' : 'bg-amber-500 text-white')
                  : 'bg-white hover:bg-gray-50 text-gray-700',
                idx < motivosVisibles.length - 1 ? 'border-b border-gray-100' : ''
              ]"
            >
              <!-- Barra lateral de color (solo cuando no está seleccionado) -->
              <span
                v-if="motivoSeleccionado?.codigo !== m.codigo"
                class="absolute left-0 top-2 bottom-2 w-1 rounded-r-full"
                :class="m.destacado
                  ? (tipoIntervencion === 'MECANICO' ? 'bg-blue-400' : 'bg-amber-400')
                  : 'bg-transparent'"
              ></span>

              <!-- Código badge -->
              <span class="text-[10px] font-black px-1.5 py-0.5 rounded shrink-0"
                :class="motivoSeleccionado?.codigo === m.codigo
                  ? 'bg-white/20 text-white'
                  : 'bg-gray-100 text-gray-500'"
              >{{ m.codigo }}</span>

              <!-- Texto principal + subtexto técnico -->
              <span class="flex-1 leading-tight min-w-0">
                <span class="text-sm font-bold block truncate">{{ m.alias || m.motivo_es }}</span>
                <span v-if="m.alias"
                  class="text-[10px] block mt-0.5 truncate"
                  :class="motivoSeleccionado?.codigo === m.codigo ? 'text-white/60' : 'text-gray-400'"
                >{{ m.motivo_es }}</span>
              </span>

              <!-- Estrella si destacado (sin seleccionar) -->
              <span v-if="m.destacado && motivoSeleccionado?.codigo !== m.codigo"
                class="text-amber-400 text-xs shrink-0">★</span>

              <!-- Check si seleccionado -->
              <span v-if="motivoSeleccionado?.codigo === m.codigo"
                class="w-5 h-5 rounded-full bg-white/25 flex items-center justify-center text-white text-xs font-black shrink-0">✓</span>
            </button>

            <!-- Ver todos / Ver menos -->
            <button
              v-if="motivosParaListbox.length > ITEMS_VISIBLES"
              type="button"
              @click="verTodos = !verTodos"
              class="w-full py-2.5 text-center text-xs font-bold bg-gray-50 border-t border-gray-100 transition-colors hover:bg-gray-100"
              :class="verTodos ? 'text-gray-500' : 'text-orange-600'"
            >
              {{ verTodos ? '↑ Ver menos' : `↓ Ver todos los motivos (${motivosParaListbox.length})` }}
            </button>
          </div>
        </div>

        <!-- ── Defecto de Calidad ────────────────────────────────────────────── -->
        <div v-if="maquinaSeleccionadaId" class="px-4 py-3 border-b border-gray-100 animate-in fade-in duration-200">
          <div class="flex items-center gap-2 mb-2">
            <span class="w-5 h-5 rounded-full bg-red-100 text-red-600 text-[10px] font-black flex items-center justify-center shrink-0">4</span>
            <p class="text-[10px] font-extrabold text-gray-400 tracking-widest">ATENCIÓN DE CALIDAD</p>
          </div>
          <button
            type="button"
            @click="Swal.fire({ icon: 'info', title: 'Módulo en desarrollo', text: 'El módulo de Defectos de Calidad estará disponible próximamente.', confirmButtonColor: '#dc2626' })"
            class="w-full flex items-center justify-center gap-2.5 py-4 bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white font-black text-sm tracking-widest rounded-xl shadow-md shadow-red-600/30 transition-all"
          >
            <ShieldAlert class="w-5 h-5 shrink-0" />
            DETENER POR DEFECTO DE CALIDAD
          </button>
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
    <div class="fixed bottom-0 left-0 right-0 z-40 px-2 pb-2">
      <div class="max-w-sm mx-auto bg-white border border-gray-200 rounded-[1.4rem] shadow-[0_-10px_35px_rgba(15,23,42,0.14)] p-3">
        <div class="flex items-center gap-3">

          <!-- Criticidad -->
          <label class="flex items-center gap-2 cursor-pointer group shrink-0">
            <div class="relative flex items-center w-10 h-6">
              <input type="checkbox" v-model="critico" class="sr-only peer">
              <div class="w-full h-full bg-gray-100 rounded-full peer peer-checked:bg-red-500 transition-colors border border-gray-200 peer-checked:border-red-600"></div>
              <div class="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
            </div>
            <span class="text-[10px] font-black transition-colors" :class="critico ? 'text-red-600' : 'text-gray-400 group-hover:text-gray-600'">Crítico</span>
          </label>

          <!-- Cámara -->
          <label class="p-3 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-100 transition active:scale-90 relative shadow-sm group">
            <Camera class="w-6 h-6" :class="imagenPreview ? 'text-orange-500' : 'text-gray-400 group-hover:text-gray-600'" />
            <div v-if="imagenPreview" class="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full border-2 border-white ring-2 ring-orange-500/20"></div>
            <input type="file" accept="image/*" capture="environment" class="hidden" @change="onFileChange" />
          </label>

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
</template>
