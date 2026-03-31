<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { getAuth } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userProfile } from '../services/authService';
import { normalizeSectorValue, DEFAULT_SECTOR, getTurnoActual, getTurnoLabel } from '../constants/organization';
import { cargarPatrullaActiva, crearPatrulla, guardarRondaEficiencia, guardarRondaParcialEficiencia } from '../services/patrullaService';
import { Loader2, ChevronDown, CloudUpload, BarChart3, Check, ArrowLeft } from 'lucide-vue-next';

const router = useRouter();
const turnoActual = ref(getTurnoActual());

const emit = defineEmits(['completada']);

// ── Estado ───────────────────────────────────────────────────────
const telares = ref([]);
const registros = ref({});        // { maq_id: { eficiencia: '', hora: null } }
const patrullaId = ref(null);
const patrullaData = ref(null);
const rondaSeleccionada = ref('ronda_e1');
const cargando = ref(true);
const guardando = ref(false);
const grupoSeleccionado = ref('');
const mensajeToast = ref(null);
const vistaResumen = ref(false);
let _toastTimer = null;

// Auto-guardado
const autoSaveStatus = ref('idle');
let _autoSaveTimer = null;
let _autoSaveStatusTimer = null;

const RONDAS_EF = [
  { key: 'ronda_e1', label: 'E1', desc: 'Inicio turno' },
  { key: 'ronda_e2', label: 'E2', desc: 'Mitad turno' },
  { key: 'ronda_e3', label: 'E3', desc: 'Fin turno' },
];

// ── Computed ─────────────────────────────────────────────────────
const sectoresUsuario = computed(() =>
  Array.isArray(userProfile.value?.sectoresAsignados)
    ? userProfile.value.sectoresAsignados
    : [normalizeSectorValue(userProfile.value?.sectorDefault || DEFAULT_SECTOR)]
);

const telaresOrdenados = computed(() => {
  let list = [...telares.value];
  if (grupoSeleccionado.value) {
    list = list.filter(t => String(t.grp_tear || '').trim() === grupoSeleccionado.value);
  }
  return list.sort((a, b) => (a.orden_patrulla || 999) - (b.orden_patrulla || 999));
});

const gruposDisponibles = computed(() => {
  const gs = telares.value.map(t => String(t.grp_tear || '').trim()).filter(Boolean);
  return [...new Set(gs)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
});

const tieneRegistros = computed(() =>
  Object.values(registros.value).some(r => r.eficiencia !== '')
);

const rondaCompletada = computed(() =>
  patrullaData.value?.rondas?.[rondaSeleccionada.value]?.completada === true
);

const registrados = computed(() => {
  let count = 0;
  for (const t of telaresOrdenados.value) {
    const val = registros.value[t.id]?.eficiencia;
    if (val !== '' && val != null) count++;
  }
  return count;
});

const rondasConEstado = computed(() =>
  RONDAS_EF.map(rd => ({
    ...rd,
    completada: patrullaData.value?.rondas?.[rd.key]?.completada === true,
    enCurso: !!patrullaData.value?.rondas?.[rd.key]?.datos && !patrullaData.value?.rondas?.[rd.key]?.completada,
  }))
);

// ── Helpers de color ─────────────────────────────────────────────
function efColor(val) {
  const num = parseFloat(val);
  if (isNaN(num) || val === '' || val == null) return 'text-gray-400';
  if (num >= 85) return 'text-emerald-600';
  if (num >= 70) return 'text-amber-600';
  return 'text-red-600';
}

function efBg(val) {
  const num = parseFloat(val);
  if (isNaN(num) || val === '' || val == null) return '';
  if (num >= 85) return 'bg-emerald-50 border-emerald-200';
  if (num >= 70) return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}

function efDot(val) {
  const num = parseFloat(val);
  if (isNaN(num) || val === '' || val == null) return 'bg-gray-200';
  if (num >= 85) return 'bg-emerald-400';
  if (num >= 70) return 'bg-amber-400';
  return 'bg-red-400';
}

function nombreCorto(t) {
  const id = String(t.maquina || '');
  const n = parseInt(id.slice(-2), 10);
  return `T${isNaN(n) ? id : n}`;
}

function grupoLabel(t) {
  const g = String(t.grp_tear || '').trim();
  if (!g) return '';
  const last = parseInt(g.slice(-1), 10);
  return `GP${isNaN(last) ? g : last}`;
}

function formatGrupo(grp) {
  const n = parseInt(grp, 10);
  return isNaN(n) ? grp : String(n);
}

function displayDecimal(val) {
  if (val === '' || val == null) return '';
  return String(val).replace('.', ',');
}

// ── Datos de ronda (para resumen) ────────────────────────────────
function getDatosRonda(rondaKey) {
  const isActive = rondaKey === rondaSeleccionada.value && !rondaCompletada.value;
  if (isActive) {
    const datos = {};
    for (const [maqId, vals] of Object.entries(registros.value)) {
      const ef = parseFloat(vals.eficiencia);
      if (!isNaN(ef)) datos[maqId] = { eficiencia: ef };
    }
    return datos;
  }
  return patrullaData.value?.rondas?.[rondaKey]?.datos || {};
}

const resumenGrupos = computed(() => {
  const result = [];
  for (const grp of gruposDisponibles.value) {
    const telaresGrp = telares.value.filter(t => String(t.grp_tear || '').trim() === grp);
    const row = { grupo: grp, telares: telaresGrp.length };
    let totalSum = 0, totalCount = 0;
    for (const rd of RONDAS_EF) {
      const datos = getDatosRonda(rd.key);
      let sum = 0, count = 0;
      for (const t of telaresGrp) {
        const val = parseFloat(datos[t.id]?.eficiencia);
        if (!isNaN(val)) { sum += val; count++; }
      }
      row[rd.key] = count > 0 ? (sum / count).toFixed(1) : null;
      totalSum += sum;
      totalCount += count;
    }
    row.promedio = totalCount > 0 ? (totalSum / totalCount).toFixed(1) : null;
    result.push(row);
  }
  return result;
});

const promedioGeneral = computed(() => {
  const datos = getDatosRonda(rondaSeleccionada.value);
  let sum = 0, count = 0;
  for (const v of Object.values(datos)) {
    const num = parseFloat(v.eficiencia);
    if (!isNaN(num)) { sum += num; count++; }
  }
  return count > 0 ? (sum / count).toFixed(1) : '—';
});

// ── Lifecycle ────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const snap = await getDocs(collection(db, 'maquinas'));
    const list = [];
    snap.forEach(d => {
      const data = { id: d.id, ...d.data() };
      if (data.activo !== false && String(data.tipo || '').toUpperCase() === 'TELAR' &&
          sectoresUsuario.value.includes(normalizeSectorValue(data.sector || DEFAULT_SECTOR))) {
        list.push(data);
      }
    });
    telares.value = list;

    const regs = {};
    for (const t of list) regs[t.id] = { eficiencia: '', hora: null };
    registros.value = regs;

    const uid = getAuth().currentUser?.uid;
    if (uid) {
      let activa = await cargarPatrullaActiva(uid);
      if (!activa) {
        activa = await crearPatrulla({
          inspectorUid: uid,
          inspectorNombre: userProfile.value?.nombre || '',
          sector: sectoresUsuario.value[0] || DEFAULT_SECTOR,
        });
      }
      patrullaId.value = activa.id;
      patrullaData.value = activa;
      for (const rd of RONDAS_EF) {
        if (!activa.rondas?.[rd.key]?.completada) {
          rondaSeleccionada.value = rd.key;
          break;
        }
      }
      cargarDatosRonda();
    }
  } catch (e) {
    console.error('Error init RegistroEficiencia:', e);
  } finally {
    cargando.value = false;
  }
});

watch(rondaSeleccionada, () => cargarDatosRonda());

function cargarDatosRonda() {
  const ronda = patrullaData.value?.rondas?.[rondaSeleccionada.value];
  const datos = ronda?.datos || {};
  for (const t of telares.value) {
    if (datos[t.id]) {
      registros.value[t.id] = {
        eficiencia: datos[t.id].eficiencia ?? '',
        hora: datos[t.id].hora || null,
      };
    } else {
      registros.value[t.id] = { eficiencia: '', hora: null };
    }
  }
}

// ── Guardar ronda ────────────────────────────────────────────────
async function guardarRonda() {
  if (!patrullaId.value || guardando.value) return;
  guardando.value = true;
  try {
    const datos = {};
    for (const [maqId, vals] of Object.entries(registros.value)) {
      const ef = parseFloat(vals.eficiencia);
      if (!isNaN(ef)) {
        datos[maqId] = {
          eficiencia: ef,
          hora: vals.hora || new Date().toISOString(),
        };
      }
    }
    if (Object.keys(datos).length === 0) {
      mostrarToast('error', 'No hay datos para guardar');
      guardando.value = false;
      return;
    }
    await guardarRondaEficiencia(patrullaId.value, rondaSeleccionada.value, datos);
    if (!patrullaData.value.rondas) patrullaData.value.rondas = {};
    patrullaData.value.rondas[rondaSeleccionada.value] = {
      tipo: 'eficiencia', completada: true, hora: new Date().toISOString(), datos,
    };
    mostrarToast('success', 'Ronda guardada ✓');
    emit('completada');
  } catch (e) {
    console.error('Error guardando eficiencia:', e);
    mostrarToast('error', 'No se pudo guardar');
  } finally {
    guardando.value = false;
  }
}

// ── Auto-guardado parcial ────────────────────────────────────────
function programarAutoSave() {
  if (!patrullaId.value) return;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => ejecutarAutoSave(), 3000);
}

async function ejecutarAutoSave() {
  if (!patrullaId.value || !tieneRegistros.value || rondaCompletada.value) return;
  autoSaveStatus.value = 'saving';
  try {
    const datos = {};
    for (const [maqId, vals] of Object.entries(registros.value)) {
      const ef = parseFloat(vals.eficiencia);
      if (!isNaN(ef)) {
        datos[maqId] = { eficiencia: ef, hora: vals.hora || new Date().toISOString() };
      }
    }
    if (Object.keys(datos).length === 0) { autoSaveStatus.value = 'idle'; return; }
    await guardarRondaParcialEficiencia(patrullaId.value, rondaSeleccionada.value, datos);
    autoSaveStatus.value = 'saved';
    clearTimeout(_autoSaveStatusTimer);
    _autoSaveStatusTimer = setTimeout(() => { autoSaveStatus.value = 'idle'; }, 4000);
  } catch (e) {
    console.error('Auto-save eficiencia error:', e);
    autoSaveStatus.value = 'error';
    clearTimeout(_autoSaveStatusTimer);
    _autoSaveStatusTimer = setTimeout(() => { autoSaveStatus.value = 'idle'; }, 5000);
  }
}

function registrarHora(maqId) {
  if (registros.value[maqId] && !registros.value[maqId].hora) {
    registros.value[maqId].hora = new Date().toISOString();
  }
}

function onInputEficiencia(maqId, event) {
  let val = event.target.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const parts = val.split('.');
  if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
  // Limitar a 1 decimal
  if (parts.length === 2 && parts[1].length > 1) {
    val = parts[0] + '.' + parts[1].slice(0, 1);
  }
  registros.value[maqId].eficiencia = val;
  event.target.value = val.replace('.', ',');
  registrarHora(maqId);

  // Auto-avance al siguiente telar
  const num = parseFloat(val);
  const tieneDecimal = val.includes('.') && parts[1]?.length === 1;
  if ((!isNaN(num) && num === 100) || tieneDecimal) {
    programarAutoSave();
    const lista = telaresOrdenados.value;
    const idx = lista.findIndex(t => t.id === maqId);
    if (idx >= 0 && idx < lista.length - 1) {
      const nextId = lista[idx + 1].id;
      nextTick(() => {
        const el = event.target.closest('.space-y-0\\.5')
          ?.querySelectorAll('input[inputmode="decimal"]')?.[idx + 1];
        if (el) { el.focus(); el.select(); }
      });
    }
  }
}

function mostrarToast(tipo, texto) {
  clearTimeout(_toastTimer);
  mensajeToast.value = { tipo, texto };
  _toastTimer = setTimeout(() => { mensajeToast.value = null; }, 3000);
}
</script>

<template>
  <div class="h-[calc(100vh-110px)] bg-gray-50 flex flex-col overflow-hidden">
    <!-- ═══ Toast ═══ -->
    <Transition name="toast">
      <div v-if="mensajeToast"
           class="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-sm font-bold"
           :class="mensajeToast.tipo === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'">
        {{ mensajeToast.texto }}
      </div>
    </Transition>

    <!-- ═══ PAGE HEADER ═══ -->
    <div class="shrink-0 max-w-lg mx-auto w-full px-4 pt-3 pb-2 bg-gray-50">
      <div class="flex items-center gap-3 px-1">
        <button @click="router.back()" class="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-all">
          <ArrowLeft class="w-5 h-5 text-gray-600" />
        </button>
        <span class="text-sm font-black text-gray-800">Registro de Eficiencia</span>
        <span class="text-[11px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded ml-auto">{{ getTurnoLabel(turnoActual) }}</span>
      </div>
    </div>

    <main class="flex-1 max-w-lg mx-auto w-full px-3 pb-4 overflow-y-auto">

    <!-- ═══ STICKY HEADER ═══ -->
    <div class="sticky top-0 z-30 bg-gray-50 pb-0.5">
      <div class="bg-white p-3 rounded-xl shadow-sm border border-gray-100 space-y-2">
        <!-- Ronda selector -->
        <div class="flex items-center gap-1.5">
          <button v-for="rd in rondasConEstado" :key="rd.key"
                  @click="rondaSeleccionada = rd.key"
                  class="flex-1 py-2 rounded-lg text-xs font-black transition-all border text-center"
                  :class="rondaSeleccionada === rd.key
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : rd.completada
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : rd.enCurso
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-gray-50 text-gray-500 border-gray-200'">
            <span>{{ rd.label }}</span>
            <Check v-if="rd.completada && rondaSeleccionada !== rd.key" class="w-3 h-3 inline ml-0.5" />
          </button>
          <!-- Toggle resumen -->
          <button @click="vistaResumen = !vistaResumen"
                  class="p-2 rounded-lg border transition-all"
                  :class="vistaResumen ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-gray-50 text-gray-400 border-gray-200'">
            <BarChart3 class="w-4 h-4" />
          </button>
        </div>

        <!-- Grupo filter + stats -->
        <div class="flex items-center gap-2">
          <div v-if="gruposDisponibles.length > 1" class="relative">
            <select v-model="grupoSeleccionado"
                    class="appearance-none bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-bold text-gray-700 pr-7 focus:outline-none focus:ring-2 focus:ring-gray-300">
              <option value="">Todos</option>
              <option v-for="g in gruposDisponibles" :key="g" :value="g">Grupo {{ formatGrupo(g) }}</option>
            </select>
            <ChevronDown class="w-3.5 h-3.5 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <div class="flex-1 flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[9px] font-bold text-gray-400">
            <span>{{ registrados }}/{{ telaresOrdenados.length }} registrados</span>
            <span>·</span>
            <span>Prom: <span :class="efColor(promedioGeneral)" class="font-black">{{ promedioGeneral }}%</span></span>
          </div>
          <!-- Auto-save indicator -->
          <div v-if="autoSaveStatus === 'saving'" class="flex items-center gap-1 text-[9px] text-blue-500 font-bold">
            <Loader2 class="w-3 h-3 animate-spin" /> Guardando…
          </div>
          <div v-else-if="autoSaveStatus === 'saved'" class="text-[9px] text-emerald-500 font-bold">✓ Guardado</div>
          <div v-else-if="autoSaveStatus === 'error'" class="text-[9px] text-red-500 font-bold">Error</div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="cargando" class="flex items-center justify-center py-12">
      <Loader2 class="w-6 h-6 text-indigo-400 animate-spin" />
    </div>

    <!-- ═══ RESUMEN TABLE ═══ -->
    <template v-else-if="vistaResumen">
      <div class="mt-2 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div class="px-3 py-2 bg-indigo-50 border-b border-indigo-100">
          <p class="text-xs font-black text-indigo-700">Resumen Eficiencia por Grupo</p>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="border-b border-gray-100">
                <th class="text-left px-3 py-2 font-black text-gray-500">Grupo</th>
                <th v-for="rd in RONDAS_EF" :key="rd.key" class="text-center px-2 py-2 font-black text-gray-500">{{ rd.label }}</th>
                <th class="text-center px-2 py-2 font-black text-gray-500">Prom</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in resumenGrupos" :key="row.grupo" class="border-b border-gray-50 last:border-0">
                <td class="px-3 py-2 font-bold text-gray-700">GP{{ formatGrupo(row.grupo) }} <span class="text-gray-400 font-normal text-[10px]">({{ row.telares }})</span></td>
                <td v-for="rd in RONDAS_EF" :key="rd.key" class="text-center px-2 py-2 font-bold" :class="efColor(row[rd.key])">
                  {{ row[rd.key] ? row[rd.key] + '%' : '—' }}
                </td>
                <td class="text-center px-2 py-2 font-black" :class="efColor(row.promedio)">
                  {{ row.promedio ? row.promedio + '%' : '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- ═══ TELAR LIST ═══ -->
    <template v-else>
      <div class="space-y-0.5 mt-1.5">
        <div v-for="t in telaresOrdenados" :key="t.id"
             class="flex items-center gap-2 bg-white rounded-lg border px-2.5 py-1.5 transition-all"
             :class="efBg(registros[t.id]?.eficiencia) || 'border-gray-100'">
          <!-- Dot + name -->
          <div class="w-1.5 h-1.5 rounded-full shrink-0" :class="efDot(registros[t.id]?.eficiencia)"></div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="text-xs font-black text-gray-700">{{ nombreCorto(t) }}</span>
              <span class="text-[9px] text-gray-400 font-bold">{{ grupoLabel(t) }}</span>
            </div>
          </div>
          <!-- Input -->
          <div class="w-20 shrink-0">
            <input type="text" inputmode="decimal"
                   :value="displayDecimal(registros[t.id]?.eficiencia)"
                   @input="onInputEficiencia(t.id, $event)"
                   @blur="programarAutoSave()"
                   :disabled="rondaCompletada"
                   placeholder="—"
                   class="w-full text-center text-sm font-black rounded-lg border py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50 disabled:bg-gray-50"
                   :class="registros[t.id]?.eficiencia !== '' ? efColor(registros[t.id]?.eficiencia) + ' bg-white border-gray-200' : 'text-gray-400 bg-white border-gray-200'" />
          </div>
          <span class="text-[9px] text-gray-400 font-bold w-4 shrink-0">%</span>
        </div>
      </div>

      <!-- GUARDAR BUTTON -->
      <div v-if="!rondaCompletada" class="sticky bottom-0 py-3 bg-gray-50 mt-3">
        <button @click="guardarRonda"
                :disabled="guardando || !tieneRegistros"
                class="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm transition-all shadow-md disabled:opacity-40"
                :class="tieneRegistros ? 'bg-indigo-600 text-white active:bg-indigo-700' : 'bg-gray-200 text-gray-400'">
          <Loader2 v-if="guardando" class="w-4 h-4 animate-spin" />
          <CloudUpload v-else class="w-4 h-4" />
          <span>Guardar {{ RONDAS_EF.find(r => r.key === rondaSeleccionada)?.label }}</span>
        </button>
      </div>

      <!-- Completada badge -->
      <div v-else class="text-center py-4">
        <div class="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-black text-emerald-700">
          <Check class="w-4 h-4" />
          Ronda completada
        </div>
      </div>
    </template>

    </main>
  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, -10px); }
</style>
