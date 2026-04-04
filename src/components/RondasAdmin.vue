<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userRole } from '../services/authService';
import { normalizeSectorValue } from '../constants/organization';
import {
  cargarTodasRutasPatrulla,
  guardarRutaPatrulla,
  eliminarRutaPatrulla,
} from '../services/patrullaService';
import { Loader2, Plus, Trash2, Save, Lock, Star, ChevronUp, ChevronDown, X } from 'lucide-vue-next';

// ── Tipos ────────────────────────────────────────────────────────
const TIPOS_POR_SECTOR = {
  TEJEDURIA:  ['TELAR'],
  HILANDERIA: ['CARDA', 'OPEN-END', 'PASADOR', 'APERTURA'],
};

const TIPO_RUTA_OPTIONS = [
  { value: 'roturas',    label: 'Roturas' },
  { value: 'eficiencia', label: 'Eficiencia' },
  { value: 'ambos',      label: 'Ambos' },
];

// ── Estado global ─────────────────────────────────────────────────
const rutas       = ref([]);
const todasMaquinas = ref([]); // todas las máquinas cargadas de Firestore
const cargando    = ref(true);
const guardando   = ref(false);
const mensajeToast = ref(null);
let _toastTimer = null;

// ── Estado del editor ─────────────────────────────────────────────
const editandoId  = ref(null); // null = nueva ruta
const modoEditor  = ref(false); // true = mostrar editor

const formBase = () => ({
  nombre:     '',
  tipo:       'roturas',
  sector:     'TEJEDURIA',
  activa:     true,
  esDefault:  false,
  obligatoria: false,
  orden:      10,
  maquinas:   [], // [{ maquinaId: string, orden: number }]
});
const form = ref(formBase());

// ── Computed ──────────────────────────────────────────────────────
const maquinasFiltradas = computed(() => {
  const sector = normalizeSectorValue(form.value.sector);
  const tiposValidos = TIPOS_POR_SECTOR[sector] || [];
  return todasMaquinas.value.filter(m => {
    const tipoM = String(m.tipo || '').toUpperCase();
    const sectorM = normalizeSectorValue(m.sector || '');
    return tiposValidos.includes(tipoM) && sectorM === sector && m.activo !== false;
  }).sort((a, b) => {
    const na = parseInt(String(a.maquina || '').slice(-2), 10);
    const nb = parseInt(String(b.maquina || '').slice(-2), 10);
    return (isNaN(na) ? 999 : na) - (isNaN(nb) ? 999 : nb);
  });
});

// IDs de máquinas ya asignadas a la ruta en edición
const idsEnRuta = computed(() => new Set(form.value.maquinas.map(m => m.maquinaId)));

// Lista de máquinas en la ruta, ordenadas por el campo orden
const maquinasEnRuta = computed(() => {
  return [...form.value.maquinas]
    .sort((a, b) => a.orden - b.orden)
    .map(m => ({
      ...m,
      datos: todasMaquinas.value.find(t => t.id === m.maquinaId) || { maquina: m.maquinaId },
    }));
});

// Máquinas del sector que NO están en la ruta
const maquinasDisponibles = computed(() =>
  maquinasFiltradas.value.filter(m => !idsEnRuta.value.has(m.id))
);

// ── Helpers ────────────────────────────────────────────────────────
function toast(texto, tipo = 'success') {
  clearTimeout(_toastTimer);
  mensajeToast.value = { texto, tipo };
  _toastTimer = setTimeout(() => { mensajeToast.value = null; }, 3000);
}

function tipoLabel(tipo) {
  return TIPO_RUTA_OPTIONS.find(o => o.value === tipo)?.label || tipo;
}

function maquinaLabel(m) {
  if (!m) return '—';
  const id = String(m.maquina || m.id || '');
  const n = parseInt(id.slice(-3), 10);
  return isNaN(n) ? id : `T${String(n).padStart(3, '0')}`;
}

// ── Ciclo de vida ─────────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([cargarRutas(), cargarMaquinas()]);
  cargando.value = false;
});

async function cargarRutas() {
  rutas.value = await cargarTodasRutasPatrulla();
}

async function cargarMaquinas() {
  const snap = await getDocs(collection(db, 'maquinas'));
  todasMaquinas.value = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Editor ────────────────────────────────────────────────────────
function nuevaRuta() {
  editandoId.value = null;
  form.value = formBase();
  modoEditor.value = true;
}

function editarRuta(ruta) {
  editandoId.value = ruta.id;
  form.value = {
    nombre:     ruta.nombre || '',
    tipo:       ruta.tipo || 'roturas',
    sector:     ruta.sector || 'TEJEDURIA',
    activa:     ruta.activa !== false,
    esDefault:  !!ruta.esDefault,
    obligatoria: !!ruta.obligatoria,
    orden:      ruta.orden ?? 10,
    maquinas:   (ruta.maquinas || []).map((m, i) => ({ maquinaId: m.maquinaId, orden: m.orden ?? i + 1 })),
  };
  modoEditor.value = true;
  // Scroll al editor en mobile
  setTimeout(() => {
    document.getElementById('editor-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

function cerrarEditor() {
  modoEditor.value = false;
  editandoId.value = null;
  form.value = formBase();
}

async function guardarRuta() {
  if (!form.value.nombre.trim()) {
    toast('El nombre es obligatorio', 'error'); return;
  }
  // Si se marca obligatoria, desactivar obligatoria en otras del mismo tipo+sector
  guardando.value = true;
  try {
    const data = {
      nombre:     form.value.nombre.trim(),
      tipo:       form.value.tipo,
      sector:     form.value.sector,
      activa:     form.value.activa,
      esDefault:  form.value.esDefault,
      obligatoria: form.value.obligatoria,
      orden:      Number(form.value.orden) || 10,
      maquinas:   form.value.maquinas.map((m, i) => ({ maquinaId: m.maquinaId, orden: i + 1 })),
    };

    const id = await guardarRutaPatrulla(editandoId.value, data);

    // Si se marcó obligatoria, quitar obligatoria del resto del mismo tipo+sector
    if (data.obligatoria) {
      const otrasObligatorias = rutas.value.filter(r =>
        r.id !== id &&
        r.tipo === data.tipo &&
        r.sector === data.sector &&
        r.obligatoria
      );
      await Promise.all(otrasObligatorias.map(r =>
        guardarRutaPatrulla(r.id, { obligatoria: false })
      ));
    }

    await cargarRutas();
    editandoId.value = id;
    toast('Ruta guardada correctamente');
  } catch (e) {
    console.error(e);
    toast('Error al guardar', 'error');
  } finally {
    guardando.value = false;
  }
}

async function confirmarEliminar() {
  if (!editandoId.value) return;
  const ruta = rutas.value.find(r => r.id === editandoId.value);
  if (!confirm(`¿Eliminar la ruta "${ruta?.nombre || editandoId.value}"? Esta acción no se puede deshacer.`)) return;
  guardando.value = true;
  try {
    await eliminarRutaPatrulla(editandoId.value);
    cerrarEditor();
    await cargarRutas();
    toast('Ruta eliminada');
  } catch (e) {
    toast('Error al eliminar', 'error');
  } finally {
    guardando.value = false;
  }
}

// ── Gestión de máquinas en la ruta ───────────────────────────────
function agregarMaquina(maquina) {
  const maxOrden = form.value.maquinas.reduce((max, m) => Math.max(max, m.orden), 0);
  form.value.maquinas.push({ maquinaId: maquina.id, orden: maxOrden + 1 });
}

function quitarMaquina(maquinaId) {
  form.value.maquinas = form.value.maquinas.filter(m => m.maquinaId !== maquinaId);
  // Renumerar
  form.value.maquinas.forEach((m, i) => { m.orden = i + 1; });
}

function moverArriba(index) {
  const sorted = [...form.value.maquinas].sort((a, b) => a.orden - b.orden);
  if (index <= 0) return;
  [sorted[index - 1].orden, sorted[index].orden] = [sorted[index].orden, sorted[index - 1].orden];
  form.value.maquinas = sorted;
}

function moverAbajo(index) {
  const sorted = [...form.value.maquinas].sort((a, b) => a.orden - b.orden);
  if (index >= sorted.length - 1) return;
  [sorted[index].orden, sorted[index + 1].orden] = [sorted[index + 1].orden, sorted[index].orden];
  form.value.maquinas = sorted;
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6 space-y-6">

    <!-- Toast -->
    <Transition name="fade">
      <div v-if="mensajeToast"
        :class="['fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium',
          mensajeToast.tipo === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white']">
        {{ mensajeToast.texto }}
      </div>
    </Transition>

    <!-- Acceso denegado -->
    <div v-if="userRole !== 'admin'"
      class="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center text-amber-700 text-sm">
      Solo administradores pueden gestionar las Rutas de Patrulla.
    </div>

    <template v-else>
      <!-- Header -->
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold text-gray-800">Rutas de Patrulla</h2>
        <button @click="nuevaRuta"
          class="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
          <Plus :size="16" />
          Nueva
        </button>
      </div>

      <!-- Loading -->
      <div v-if="cargando" class="flex justify-center py-12">
        <Loader2 :size="28" class="animate-spin text-blue-500" />
      </div>

      <template v-else>
        <!-- Lista de rutas -->
        <div v-if="!modoEditor || rutas.length > 0" :class="modoEditor ? 'hidden md:block' : ''">
          <div v-if="rutas.length === 0"
            class="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-10 text-center text-gray-400 text-sm">
            No hay rutas definidas. Crea la primera con el botón "Nueva".
          </div>
          <div v-else class="space-y-2">
            <button v-for="ruta in rutas" :key="ruta.id"
              @click="editarRuta(ruta)"
              :class="['w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border transition-all',
                editandoId === ruta.id
                  ? 'border-blue-400 bg-blue-50 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-gray-50']">
              <!-- Badges -->
              <div class="flex gap-1.5 shrink-0">
                <span v-if="ruta.obligatoria"
                  class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 text-xs font-semibold">
                  <Lock :size="10" /> Obligatoria
                </span>
                <span v-else-if="ruta.esDefault"
                  class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 text-xs font-semibold">
                  <Star :size="10" /> Default
                </span>
                <span v-if="!ruta.activa"
                  class="px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 text-xs font-medium">
                  Inactiva
                </span>
              </div>
              <!-- Info -->
              <div class="flex-1 min-w-0">
                <div class="font-medium text-gray-800 text-sm truncate">{{ ruta.nombre }}</div>
                <div class="text-xs text-gray-400 mt-0.5">
                  {{ ruta.sector }} · {{ tipoLabel(ruta.tipo) }} · {{ ruta.maquinas?.length || 0 }} máq.
                </div>
              </div>
              <ChevronDown :size="16" class="text-gray-300 shrink-0" />
            </button>
          </div>
        </div>

        <!-- Editor -->
        <div v-if="modoEditor" id="editor-panel"
          class="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <!-- Header del editor -->
          <div class="flex items-center justify-between px-5 py-4 bg-gray-50 border-b border-gray-100">
            <h3 class="font-semibold text-gray-700 text-sm">
              {{ editandoId ? 'Editar ruta' : 'Nueva ruta' }}
            </h3>
            <button @click="cerrarEditor" class="text-gray-400 hover:text-gray-600 transition-colors">
              <X :size="18" />
            </button>
          </div>

          <div class="p-5 space-y-5">
            <!-- Nombre -->
            <div>
              <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Nombre de la ruta
              </label>
              <input v-model="form.nombre" type="text" placeholder="Ej: Ruta Completa, Ruta Parcial A..."
                class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>

            <!-- Tipo + Sector -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Tipo</label>
                <select v-model="form.tipo"
                  class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300">
                  <option v-for="o in TIPO_RUTA_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Sector</label>
                <select v-model="form.sector"
                  class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300">
                  <option v-for="sec in Object.keys(TIPOS_POR_SECTOR)" :key="sec" :value="sec">{{ sec }}</option>
                </select>
              </div>
            </div>

            <!-- Orden -->
            <div class="w-32">
              <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Posición en selector</label>
              <input v-model.number="form.orden" type="number" min="1" max="99"
                class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>

            <!-- Flags -->
            <div class="space-y-2">
              <label class="flex items-center gap-3 cursor-pointer select-none">
                <div class="relative">
                  <input type="checkbox" v-model="form.activa" class="sr-only peer" />
                  <div class="w-10 h-5 bg-gray-200 peer-checked:bg-blue-500 rounded-full transition-colors"></div>
                  <div class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5"></div>
                </div>
                <span class="text-sm text-gray-700">Activa (visible para inspectores)</span>
              </label>

              <label class="flex items-center gap-3 cursor-pointer select-none">
                <div class="relative">
                  <input type="checkbox" v-model="form.esDefault" class="sr-only peer" />
                  <div class="w-10 h-5 bg-gray-200 peer-checked:bg-amber-400 rounded-full transition-colors"></div>
                  <div class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5"></div>
                </div>
                <span class="text-sm text-gray-700">Pre-seleccionada por defecto <span class="text-gray-400">(el inspector puede cambiarla)</span></span>
              </label>

              <label class="flex items-center gap-3 cursor-pointer select-none">
                <div class="relative">
                  <input type="checkbox" v-model="form.obligatoria" class="sr-only peer" />
                  <div class="w-10 h-5 bg-gray-200 peer-checked:bg-red-500 rounded-full transition-colors"></div>
                  <div class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5"></div>
                </div>
                <span class="text-sm text-gray-700">Obligatoria <span class="text-gray-400">(el inspector no puede cambiarla)</span></span>
              </label>
              <p v-if="form.obligatoria" class="text-xs text-red-600 pl-14">
                Al guardar, cualquier otra ruta obligatoria del mismo tipo/sector perderá ese flag.
              </p>
            </div>

            <!-- Máquinas en la ruta -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Secuencia de máquinas ({{ maquinasEnRuta.length }})
                </label>
              </div>

              <!-- Lista de máquinas asignadas -->
              <div v-if="maquinasEnRuta.length === 0"
                class="text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl px-4 py-3 text-center">
                Sin máquinas. Agrega desde la lista de abajo.
              </div>
              <div v-else class="space-y-1 mb-3">
                <div v-for="(m, idx) in maquinasEnRuta" :key="m.maquinaId"
                  class="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                  <span class="text-xs font-mono text-gray-400 w-5 text-right shrink-0">{{ idx + 1 }}</span>
                  <span class="flex-1 text-sm font-medium text-gray-700">
                    {{ m.datos?.maquina || m.maquinaId }}
                    <span v-if="m.datos?.grp_tear" class="text-xs text-gray-400 ml-1">(GP{{ m.datos.grp_tear }})</span>
                  </span>
                  <div class="flex items-center gap-1 shrink-0">
                    <button @click="moverArriba(idx)"
                      :disabled="idx === 0"
                      class="p-1 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                      <ChevronUp :size="14" />
                    </button>
                    <button @click="moverAbajo(idx)"
                      :disabled="idx === maquinasEnRuta.length - 1"
                      class="p-1 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                      <ChevronDown :size="14" />
                    </button>
                    <button @click="quitarMaquina(m.maquinaId)"
                      class="p-1 rounded-lg hover:bg-red-100 text-red-500 transition-colors">
                      <X :size="14" />
                    </button>
                  </div>
                </div>
              </div>

              <!-- Máquinas disponibles para agregar -->
              <div>
                <div class="text-xs text-gray-400 mb-2 mt-3">
                  Disponibles para agregar ({{ maquinasDisponibles.length }}):
                </div>
                <div v-if="maquinasDisponibles.length === 0"
                  class="text-xs text-gray-400 italic">
                  {{ maquinasFiltradas.length === 0 ? 'No hay máquinas para el sector/tipo seleccionado.' : 'Todas las máquinas ya están en la ruta.' }}
                </div>
                <div v-else class="flex flex-wrap gap-2">
                  <button v-for="maq in maquinasDisponibles" :key="maq.id"
                    @click="agregarMaquina(maq)"
                    class="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-xs font-medium transition-colors">
                    <Plus :size="12" />
                    {{ maq.maquina || maq.id }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Acciones -->
            <div class="flex items-center justify-between pt-3 border-t border-gray-100 gap-3">
              <button v-if="editandoId" @click="confirmarEliminar"
                :disabled="guardando"
                class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-red-600 hover:bg-red-50 border border-red-200 text-sm font-medium transition-colors disabled:opacity-50">
                <Trash2 :size="15" />
                Eliminar
              </button>
              <div class="flex-1" />
              <button @click="guardarRuta"
                :disabled="guardando"
                class="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2 rounded-xl transition-colors disabled:opacity-50">
                <Loader2 v-if="guardando" :size="15" class="animate-spin" />
                <Save v-else :size="15" />
                Guardar
              </button>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
