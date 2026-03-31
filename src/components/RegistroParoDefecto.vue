<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { getAuth } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userProfile } from '../services/authService';
import { normalizeSectorValue, DEFAULT_SECTOR, ESTADOS_TELAR } from '../constants/organization';
import { cargarPatrullaActiva, crearPatrulla, guardarRondaParoDefecto, guardarRondaParcialGenerico } from '../services/patrullaService';
import Swal from 'sweetalert2';
import { Check, Loader2, ChevronDown, ChevronUp, CloudUpload, AlertTriangle, X } from 'lucide-vue-next';

const props = defineProps({
  rondaKey: { type: String, required: true },  // 'ronda_2' | 'ronda_4' | 'ronda_5'
  rondaLabel: { type: String, default: '' },
});

const emit = defineEmits(['completada']);

// ── Estado ───────────────────────────────────────────────────────
const telares = ref([]);
const registros = ref({});   // { maq_id: { estado: 'trabajando'|..., observacion:'', hora: null } }
const patrullaId = ref(null);
const patrullaData = ref(null);
const cargando = ref(true);
const guardando = ref(false);
const grupoSeleccionado = ref('');
const telarExpandido = ref(null);

// Auto-guardado
const autoSaveStatus = ref('idle');
let _autoSaveTimer = null;
let _autoSaveStatusTimer = null;

// ── Computed ─────────────────────────────────────────────────────
const sectoresUsuario = computed(() =>
  Array.isArray(userProfile.value?.sectoresAsignados)
    ? userProfile.value.sectoresAsignados
    : [normalizeSectorValue(userProfile.value?.sectorDefault || DEFAULT_SECTOR)]
);

const telaresOrdenados = computed(() => {
  let list = telares.value;
  if (grupoSeleccionado.value) {
    list = list.filter(t => String(t.grp_tear || '').trim() === grupoSeleccionado.value);
  }
  return list.sort((a, b) => (a.orden_patrulla || 999) - (b.orden_patrulla || 999));
});

const gruposDisponibles = computed(() => {
  const gs = telares.value.map(t => String(t.grp_tear || '').trim()).filter(Boolean);
  return [...new Set(gs)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
});

const resumen = computed(() => {
  let revisados = 0, paros = 0, trabajando = 0;
  for (const t of telaresOrdenados.value) {
    const r = registros.value[t.id];
    if (!r?.estado) continue;
    revisados++;
    if (r.estado === 'trabajando') trabajando++;
    else paros++;
  }
  return { revisados, paros, trabajando, total: telaresOrdenados.value.length };
});

const tieneRegistros = computed(() =>
  Object.values(registros.value).some(r => r.estado)
);

const rondaCompletada = computed(() =>
  patrullaData.value?.rondas?.[props.rondaKey]?.completada === true
);

// ── Funciones ────────────────────────────────────────────────────
function nombreCorto(t) {
  const raw = String(t.maquina || t.id || '');
  const nums = raw.replace(/[^0-9]/g, '');
  const last3 = nums.slice(-3);
  const n = parseInt(last3, 10);
  return `Toyota ${isNaN(n) ? raw : n}`;
}

function estadoInfo(id) {
  return ESTADOS_TELAR.find(e => e.id === id) || { label: id, icon: '?', color: 'gray' };
}

function seleccionarEstado(telarId, estadoId) {
  if (rondaCompletada.value) return;
  if (!registros.value[telarId]) return;
  registros.value[telarId].estado = estadoId;
  if (!registros.value[telarId].hora) {
    registros.value[telarId].hora = new Date().toISOString();
  }
  // Colapsar si es "trabajando" (no necesita detalle)
  if (estadoId === 'trabajando') {
    telarExpandido.value = null;
  }
  programarAutoSave();
}

function toggleExpand(telarId) {
  telarExpandido.value = telarExpandido.value === telarId ? null : telarId;
}

function cargarDatosRonda(patrulla) {
  const rondaData = patrulla.rondas?.[props.rondaKey]?.datos;
  if (!rondaData) return;
  for (const [maqId, vals] of Object.entries(rondaData)) {
    if (registros.value[maqId]) {
      registros.value[maqId].estado = vals.estado || '';
      registros.value[maqId].observacion = vals.observacion || '';
      registros.value[maqId].hora = vals.hora || null;
    }
  }
}

// ── Auto-guardado ───────────────────────────────────────────────
function programarAutoSave() {
  if (!patrullaId.value) return;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => ejecutarAutoSave(), 3000);
}

async function ejecutarAutoSave() {
  if (!patrullaId.value || !tieneRegistros.value || rondaCompletada.value) return;
  autoSaveStatus.value = 'saving';
  try {
    const datos = buildDatos();
    if (!Object.keys(datos).length) { autoSaveStatus.value = 'idle'; return; }
    await guardarRondaParcialGenerico(patrullaId.value, props.rondaKey, 'paro_defecto', datos);
    autoSaveStatus.value = 'saved';
    clearTimeout(_autoSaveStatusTimer);
    _autoSaveStatusTimer = setTimeout(() => { autoSaveStatus.value = 'idle'; }, 4000);
  } catch (e) {
    console.error('Auto-save paro/defecto error:', e);
    autoSaveStatus.value = 'error';
    clearTimeout(_autoSaveStatusTimer);
    _autoSaveStatusTimer = setTimeout(() => { autoSaveStatus.value = 'idle'; }, 5000);
  }
}

function buildDatos() {
  const datos = {};
  for (const [maqId, vals] of Object.entries(registros.value)) {
    if (vals.estado) {
      datos[maqId] = {
        estado: vals.estado,
        observacion: vals.observacion || '',
        hora: vals.hora || new Date().toISOString(),
      };
    }
  }
  return datos;
}

async function completarRonda() {
  if (!patrullaId.value || !tieneRegistros.value) return;
  guardando.value = true;
  try {
    const datos = buildDatos();
    await guardarRondaParoDefecto(patrullaId.value, props.rondaKey, datos);
    if (!patrullaData.value.rondas) patrullaData.value.rondas = {};
    patrullaData.value.rondas[props.rondaKey] = { tipo: 'paro_defecto', completada: true, datos };
    Swal.fire({ icon: 'success', title: 'Ronda completada', timer: 1500, showConfirmButton: false });
    emit('completada');
  } catch (e) {
    console.error('Error completando ronda:', e);
    Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo completar la ronda.' });
  } finally {
    guardando.value = false;
  }
}

// ── Carga ────────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const snap = await getDocs(collection(db, 'maquinas'));
    const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    telares.value = todas.filter(m =>
      String(m.tipo || '').toUpperCase() === 'TELAR' &&
      (m.activo ?? true) &&
      sectoresUsuario.value.includes(normalizeSectorValue(m.sector || DEFAULT_SECTOR))
    );

    // Inicializar registros vacíos
    const regs = {};
    for (const t of telares.value) {
      regs[t.id] = { estado: '', observacion: '', hora: null };
    }
    registros.value = regs;

    // Buscar o crear patrulla activa
    const uid = getAuth().currentUser?.uid;
    if (uid) {
      const activa = await cargarPatrullaActiva(uid);
      if (activa) {
        patrullaId.value = activa.id;
        patrullaData.value = activa;
        cargarDatosRonda(activa);
      } else {
        const nueva = await crearPatrulla({
          inspectorUid: uid,
          inspectorNombre: userProfile.value?.nombre || 'Inspector',
          sector: sectoresUsuario.value[0] || DEFAULT_SECTOR,
        });
        patrullaId.value = nueva.id;
        patrullaData.value = { id: nueva.id, rondas: {} };
      }
    }
  } catch (e) {
    console.error('Error cargando paro/defecto:', e);
  } finally {
    cargando.value = false;
  }
});
</script>

<template>
  <div class="space-y-3">
    <!-- Cargando -->
    <div v-if="cargando" class="flex items-center justify-center py-16">
      <Loader2 class="w-6 h-6 text-indigo-400 animate-spin" />
    </div>

    <template v-else>
      <!-- Resumen + Filtro (sticky) -->
      <div class="sticky top-0 z-30 bg-gray-50 -mx-3 px-3 pb-2 pt-1 space-y-2">
        <!-- Badge resumen -->
        <div class="flex items-center gap-2 text-[10px] font-bold">
          <span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">✓ {{ resumen.trabajando }}</span>
          <span class="bg-red-100 text-red-700 px-2 py-0.5 rounded-full">⚠ {{ resumen.paros }} paros</span>
          <span class="text-gray-400">{{ resumen.revisados }}/{{ resumen.total }} revisados</span>
          <template v-if="rondaCompletada">
            <span class="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full ml-auto">✓ Completada</span>
          </template>
        </div>

        <!-- Filtro grupo -->
        <div v-if="gruposDisponibles.length > 1" class="relative inline-block">
          <select v-model="grupoSeleccionado"
                  class="appearance-none bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-bold text-gray-700 pr-7 focus:outline-none focus:ring-2 focus:ring-indigo-200">
            <option value="">Todos los grupos</option>
            <option v-for="g in gruposDisponibles" :key="g" :value="g">Grupo {{ parseInt(g, 10) || g }}</option>
          </select>
          <ChevronDown class="w-3 h-3 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        <!-- Headers -->
        <div class="grid grid-cols-[60px_1fr] gap-2 px-1 text-[9px] font-black text-gray-400 uppercase tracking-wider border-b border-gray-200 pb-1">
          <span>Telar</span>
          <span>Estado</span>
        </div>
      </div>

      <!-- Lista de telares -->
      <div v-for="t in telaresOrdenados" :key="t.id" class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <!-- Fila principal -->
        <div class="flex items-center gap-2 px-2 py-2">
          <!-- Nombre telar -->
          <div class="w-14 shrink-0">
            <p class="text-[11px] font-black text-gray-800">{{ nombreCorto(t) }}</p>
          </div>

          <!-- Chips de estado (scroll horizontal) -->
          <div class="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
            <button
              v-for="est in ESTADOS_TELAR"
              :key="est.id"
              @click="seleccionarEstado(t.id, est.id)"
              :disabled="rondaCompletada"
              class="shrink-0 text-[9px] font-bold px-2 py-1 rounded-full border transition-all active:scale-95 whitespace-nowrap"
              :class="registros[t.id]?.estado === est.id
                ? est.color === 'emerald' ? 'bg-emerald-600 text-white border-emerald-600'
                : est.color === 'red' ? 'bg-red-600 text-white border-red-600'
                : est.color === 'amber' ? 'bg-amber-500 text-white border-amber-500'
                : est.color === 'blue' ? 'bg-blue-600 text-white border-blue-600'
                : est.color === 'purple' ? 'bg-purple-600 text-white border-purple-600'
                : est.color === 'rose' ? 'bg-rose-600 text-white border-rose-600'
                : est.color === 'cyan' ? 'bg-cyan-600 text-white border-cyan-600'
                : 'bg-gray-600 text-white border-gray-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              "
            >
              {{ est.icon }} {{ est.id === 'trabajando' ? '✓' : est.label }}
            </button>
          </div>

          <!-- Expand para observación -->
          <button
            v-if="registros[t.id]?.estado && registros[t.id].estado !== 'trabajando'"
            @click="toggleExpand(t.id)"
            class="p-1 rounded hover:bg-gray-100"
          >
            <ChevronUp v-if="telarExpandido === t.id" class="w-3.5 h-3.5 text-gray-400" />
            <ChevronDown v-else class="w-3.5 h-3.5 text-gray-400" />
          </button>
        </div>

        <!-- Detalle expandido: observación -->
        <div v-if="telarExpandido === t.id && registros[t.id]?.estado !== 'trabajando'" class="px-3 pb-2 border-t border-gray-100">
          <input
            type="text"
            v-model="registros[t.id].observacion"
            @blur="programarAutoSave()"
            placeholder="Observación (opcional)"
            :disabled="rondaCompletada"
            class="w-full mt-1.5 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
          />
        </div>
      </div>

      <!-- Indicador auto-guardado -->
      <div v-if="autoSaveStatus !== 'idle'" class="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-all"
           :class="{
             'text-blue-500 bg-blue-50': autoSaveStatus === 'saving',
             'text-emerald-600 bg-emerald-50': autoSaveStatus === 'saved',
             'text-red-500 bg-red-50': autoSaveStatus === 'error',
           }">
        <Loader2 v-if="autoSaveStatus === 'saving'" class="w-3 h-3 animate-spin" />
        <CloudUpload v-else-if="autoSaveStatus === 'saved'" class="w-3 h-3" />
        <AlertTriangle v-else-if="autoSaveStatus === 'error'" class="w-3 h-3" />
        {{ autoSaveStatus === 'saving' ? 'Guardando borrador…' : autoSaveStatus === 'saved' ? 'Borrador guardado ✓' : 'Error al guardar' }}
      </div>

      <!-- Botón completar -->
      <button
        v-if="!rondaCompletada"
        @click="completarRonda"
        :disabled="guardando || !tieneRegistros"
        class="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-black text-white transition-all shadow-md active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
        :class="guardando ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'"
      >
        <Loader2 v-if="guardando" class="w-4 h-4 animate-spin" />
        <Check v-else class="w-4 h-4" />
        {{ guardando ? 'Guardando…' : 'Completar Ronda' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
