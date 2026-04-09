<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { userProfile, userRole } from '../services/authService';
import { getTurnoActual, getTurnoLabel } from '../constants/organization';
import { cargarPatrullasPorFechaTurno } from '../services/patrullaService';
import {
  ArrowLeft, ChevronLeft, ChevronRight, ScanLine, Eye,
  ClipboardCheck, AlertTriangle as AlertIcon, Lock,
  CheckCircle2, Loader2, UserCheck, RefreshCw, Users
} from 'lucide-vue-next';

const router = useRouter();

// ── Helpers de navegación de turnos ──────────────────────────────
const TURNO_ORD = { A: 0, B: 1, C: 2 };

function turnoAnterior(fecha, turno) {
  if (turno === 'B') return { fecha, turno: 'A' };
  if (turno === 'C') return { fecha, turno: 'B' };
  // A → día anterior Turno C
  const d = new Date(fecha + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return { fecha: d.toISOString().slice(0, 10), turno: 'C' };
}

function turnoSiguiente(fecha, turno) {
  if (turno === 'A') return { fecha, turno: 'B' };
  if (turno === 'B') return { fecha, turno: 'C' };
  // C → día siguiente Turno A
  const d = new Date(fecha + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return { fecha: d.toISOString().slice(0, 10), turno: 'A' };
}

function esFuturo(fecha, turno) {
  const ahora = new Date();
  const hoy = ahora.toISOString().slice(0, 10);
  const tHoy = getTurnoActual(ahora);
  if (fecha > hoy) return true;
  if (fecha === hoy && TURNO_ORD[turno] > TURNO_ORD[tHoy]) return true;
  return false;
}

function formatFecha(fechaStr) {
  if (!fechaStr) return '';
  const [y, m, d] = fechaStr.split('-');
  return `${d}/${m}/${y}`;
}

function horaRonda(isoStr) {
  if (!isoStr) return null;
  return new Date(isoStr).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

// ── Estado ────────────────────────────────────────────────────────
const _now = new Date();
const fechaVer = ref(_now.toISOString().slice(0, 10));
const turnoVer = ref(getTurnoActual(_now));
const patrullas = ref([]);
const patrullaIdx = ref(0);
const cargando = ref(true);

const patrullaData = computed(() => patrullas.value[patrullaIdx.value] ?? null);

const esSlotActual = computed(() => {
  const hoy = new Date().toISOString().slice(0, 10);
  return fechaVer.value === hoy && turnoVer.value === getTurnoActual();
});

const puedeNavSig = computed(() => {
  const { fecha, turno } = turnoSiguiente(fechaVer.value, turnoVer.value);
  return !esFuturo(fecha, turno);
});

// ── Rondas ────────────────────────────────────────────────────────
const RONDAS = [
  { key: 'ronda_1', num: 1, label: 'Roturas',          desc: 'Rot. Urdido y Rot. Trama', icon: ScanLine,       sub: 'roturas'     },
  { key: 'ronda_2', num: 2, label: 'Paros / Defectos', desc: 'Recorrida de observación',  icon: AlertIcon,      sub: 'paro2'       },
  { key: 'ronda_3', num: 3, label: 'Trama Negra',      desc: 'Inspección trama blanca',   icon: Eye,            sub: 'trama'       },
  { key: 'ronda_4', num: 4, label: 'Paros / Defectos', desc: 'Recorrida de observación',  icon: AlertIcon,      sub: 'paro4'       },
  { key: 'ronda_5', num: 5, label: 'Paros / Defectos', desc: 'Recorrida de observación',  icon: AlertIcon,      sub: 'paro5'       },
  { key: 'ronda_6', num: 6, label: 'Roturas',          desc: 'Rot. Urdido y Rot. Trama',  icon: ScanLine,       sub: 'roturas6'    },
  { key: 'ronda_7', num: 7, label: 'Evaluación',       desc: 'Mejoró / Empeoró / Igual',  icon: ClipboardCheck, sub: 'seguimiento' },
];

function estadoRonda(key) {
  const r = patrullaData.value?.rondas?.[key];
  if (r?.completada) return 'completada';
  if (r?.datos || r?.horaInicio) return 'en_curso';
  return 'pendiente';
}

function estaDesbloqueada(idx) {
  if (idx === 0) return true;
  if (RONDAS[idx].key === 'ronda_7') {
    return estadoRonda('ronda_1') === 'completada' && estadoRonda('ronda_6') === 'completada';
  }
  return estadoRonda(RONDAS[idx - 1].key) === 'completada';
}

const rondasConEstado = computed(() =>
  RONDAS.map((r, i) => ({
    ...r,
    estado: estadoRonda(r.key),
    desbloqueada: estaDesbloqueada(i),
    hora: patrullaData.value?.rondas?.[r.key]?.hora || null,
    cubiertoPor: patrullaData.value?.rondas?.[r.key]?.cubiertoNombre || null,
  }))
);

const rondasCompletadas = computed(() =>
  rondasConEstado.value.filter(r => r.estado === 'completada').length
);

// ── Carga ──────────────────────────────────────────────────────────
async function cargar() {
  cargando.value = true;
  try {
    const lista = await cargarPatrullasPorFechaTurno(fechaVer.value, turnoVer.value);
    // Ordenar: más reciente primero (por createdAt o id)
    lista.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    patrullas.value = lista;
    patrullaIdx.value = 0;
  } catch (e) {
    console.error('Error cargando patrullas:', e);
    patrullas.value = [];
  } finally {
    cargando.value = false;
  }
}

function navAnterior() {
  const { fecha, turno } = turnoAnterior(fechaVer.value, turnoVer.value);
  fechaVer.value = fecha;
  turnoVer.value = turno;
}

function navSiguiente() {
  if (!puedeNavSig.value) return;
  const { fecha, turno } = turnoSiguiente(fechaVer.value, turnoVer.value);
  fechaVer.value = fecha;
  turnoVer.value = turno;
}

// Navegar al detalle de una ronda en modo observador (solo turno actual)
function irARonda(ronda) {
  if (!esSlotActual.value) return; // En históricos no hay navegación a sub-vistas
  if (ronda.estado === 'pendiente') return;
  router.push('/patrulla/' + ronda.sub);
}

function cubrirInspector() {
  // Redirige a PatrullaCalidad donde existe el modo cobertura completo
  router.push('/patrulla');
}

watch([fechaVer, turnoVer], cargar);
onMounted(cargar);
</script>

<template>
  <div class="h-[calc(100vh-110px)] bg-gray-50 flex flex-col overflow-hidden">

    <!-- Header fijo -->
    <div class="shrink-0 max-w-lg mx-auto w-full px-4 pt-3 pb-2 bg-gray-50">
      <div class="flex items-center gap-2 px-1">
        <button @click="router.back()" class="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-all shrink-0">
          <ArrowLeft class="w-5 h-5 text-gray-600" />
        </button>
        <span class="text-sm font-black text-gray-700 flex-1 truncate">Patrulla de Calidad</span>
        <button @click="cargar" class="p-1.5 rounded-lg text-gray-400 hover:bg-gray-200 transition-all" title="Actualizar">
          <RefreshCw class="w-4 h-4" :class="cargando ? 'animate-spin' : ''" />
        </button>
      </div>

      <!-- Navegación de turno -->
      <div class="flex items-center gap-2 mt-2">
        <button @click="navAnterior"
                class="p-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-all active:scale-95 shrink-0">
          <ChevronLeft class="w-4 h-4" />
        </button>

        <div class="flex-1 flex items-center justify-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
          <span class="text-[11px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
            {{ getTurnoLabel(turnoVer) }}
          </span>
          <span class="text-xs font-bold text-gray-600">{{ formatFecha(fechaVer) }}</span>
          <span v-if="esSlotActual" class="text-[9px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-200">
            ACTUAL
          </span>
        </div>

        <button @click="navSiguiente"
                :disabled="!puedeNavSig"
                class="p-1.5 rounded-lg border transition-all active:scale-95 shrink-0"
                :class="puedeNavSig
                  ? 'bg-white border-gray-200 text-gray-500 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600'
                  : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'">
          <ChevronRight class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Body desplazable -->
    <main class="flex-1 max-w-lg mx-auto w-full px-3 pb-4 flex flex-col space-y-3 overflow-y-auto">

      <!-- Cargando -->
      <div v-if="cargando" class="flex items-center justify-center py-16">
        <Loader2 class="w-6 h-6 text-indigo-400 animate-spin" />
      </div>

      <template v-else>

        <!-- Sin patrulla -->
        <div v-if="!patrullaData" class="flex flex-col items-center justify-center py-12 text-center gap-3">
          <div class="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
            <Users class="w-6 h-6 text-gray-400" />
          </div>
          <div>
            <p class="text-sm font-black text-gray-600">Sin patrulla registrada</p>
            <p class="text-xs text-gray-400 mt-0.5">
              {{ getTurnoLabel(turnoVer) }} · {{ formatFecha(fechaVer) }}
            </p>
          </div>
          <button v-if="esSlotActual"
                  @click="cubrirInspector"
                  class="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-black shadow-sm shadow-amber-200 active:scale-95 transition-all">
            <UserCheck class="w-4 h-4" />
            Iniciar patrulla (cobertura)
          </button>
        </div>

        <template v-else>

          <!-- Selector si hay múltiples patrullas en el turno -->
          <div v-if="patrullas.length > 1" class="bg-white border border-gray-200 rounded-xl p-2">
            <div class="flex gap-1.5 flex-wrap">
              <button
                v-for="(p, idx) in patrullas" :key="p.id"
                @click="patrullaIdx = idx"
                class="px-3 py-1.5 rounded-lg text-xs font-black transition-all"
                :class="patrullaIdx === idx
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'"
              >
                {{ p.inspectorNombre || p.inspectorEmail || 'Inspector ' + (idx + 1) }}
              </button>
            </div>
          </div>

          <!-- Card inspector + progreso -->
          <div class="bg-white border rounded-xl px-4 py-3 shadow-sm"
               :class="esSlotActual ? 'border-indigo-100' : 'border-gray-200'">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <p class="text-xs font-black text-gray-800 truncate">
                  {{ patrullaData.inspectorNombre || patrullaData.inspectorEmail || 'Inspector' }}
                </p>
                <p class="text-[10px] text-gray-400 font-medium mt-0.5">
                  {{ patrullaData.sector || '—' }}
                  <span v-if="patrullaData.estado === 'en_curso'" class="text-emerald-500 font-black ml-1">· En curso</span>
                  <span v-else-if="patrullaData.estado === 'finalizada'" class="text-gray-400 font-bold ml-1">· Finalizada</span>
                </p>
              </div>
              <div class="shrink-0 text-right">
                <p class="text-lg font-black" :class="rondasCompletadas === 7 ? 'text-emerald-600' : 'text-indigo-600'">
                  {{ rondasCompletadas }}<span class="text-gray-300 font-bold text-sm">/7</span>
                </p>
                <p class="text-[9px] font-bold text-gray-400 uppercase tracking-wider">rondas</p>
              </div>
            </div>

            <!-- Barra de progreso -->
            <div class="mt-2.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all duration-500"
                   :class="rondasCompletadas === 7 ? 'bg-emerald-400' : 'bg-indigo-400'"
                   :style="{ width: (rondasCompletadas / 7 * 100) + '%' }">
              </div>
            </div>
          </div>

          <!-- Timeline de rondas -->
          <div class="space-y-0 relative">
            <!-- Línea vertical conectora -->
            <div class="absolute left-[19px] top-6 bottom-6 w-0.5 bg-gray-200 z-0"></div>

            <div v-for="(ronda, idx) in rondasConEstado" :key="ronda.key"
                 class="relative z-10 flex items-start gap-3 py-2 transition-all"
                 :class="esSlotActual && ronda.estado !== 'pendiente'
                   ? 'cursor-pointer active:scale-[0.99]'
                   : !esSlotActual && ronda.estado !== 'pendiente'
                     ? 'opacity-90'
                     : 'opacity-50 cursor-default'"
                 @click="irARonda(ronda)"
            >
              <!-- Círculo estado -->
              <div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2 text-sm font-black"
                   :class="ronda.estado === 'completada'
                     ? 'bg-emerald-100 border-emerald-400 text-emerald-600'
                     : ronda.estado === 'en_curso'
                       ? 'bg-blue-100 border-blue-400 text-blue-600 animate-pulse'
                       : ronda.desbloqueada
                         ? 'bg-white border-gray-300 text-gray-500'
                         : 'bg-gray-100 border-gray-200 text-gray-300'">
                <CheckCircle2 v-if="ronda.estado === 'completada'" class="w-5 h-5" />
                <Loader2 v-else-if="ronda.estado === 'en_curso'" class="w-4 h-4 animate-spin" />
                <Lock v-else-if="!ronda.desbloqueada" class="w-4 h-4" />
                <span v-else>{{ ronda.num }}</span>
              </div>

              <!-- Card ronda -->
              <div class="flex-1 min-w-0 bg-white rounded-xl border px-3 py-2.5 shadow-sm"
                   :class="ronda.estado === 'completada'
                     ? 'border-emerald-200'
                     : ronda.estado === 'en_curso'
                       ? 'border-blue-200'
                       : ronda.desbloqueada
                         ? 'border-gray-200'
                         : 'border-gray-100'">
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <p class="text-base font-black"
                       :class="ronda.desbloqueada ? 'text-gray-800' : 'text-gray-400'">
                      {{ ronda.label }}
                    </p>
                    <p class="text-xs font-medium mt-0.5"
                       :class="ronda.desbloqueada ? 'text-gray-500' : 'text-gray-300'">
                      {{ ronda.desc }}
                    </p>
                  </div>
                  <div class="shrink-0 flex flex-col items-end gap-0.5">
                    <span v-if="ronda.estado === 'completada'"
                          class="text-xs font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      ✓ Hecha
                    </span>
                    <span v-else-if="ronda.estado === 'en_curso'"
                          class="text-xs font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      En curso
                    </span>
                    <component v-else-if="ronda.desbloqueada" :is="ronda.icon" class="w-4 h-4 text-gray-300" />
                  </div>
                </div>

                <!-- Hora de completado + badge Cubrió -->
                <div v-if="ronda.hora" class="flex items-center gap-2 mt-1 flex-wrap">
                  <span class="text-xs text-gray-400 font-medium">{{ horaRonda(ronda.hora) }}</span>
                  <span v-if="ronda.cubiertoPor"
                        class="text-[10px] font-black bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">
                    👤 Cubrió: {{ ronda.cubiertoPor }}
                  </span>
                </div>

                <!-- Hint de click para turno actual -->
                <p v-if="esSlotActual && ronda.estado !== 'pendiente' && ronda.desbloqueada"
                   class="text-[11px] text-indigo-400 font-bold mt-1">
                  Toca para ver detalle →
                </p>
              </div>
            </div>
          </div>

          <!-- Botón Cubrir Inspector (solo turno actual) -->
          <div v-if="esSlotActual" class="pt-2 pb-1">
            <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
              <p class="text-[10px] font-black text-amber-700 uppercase tracking-wide flex items-center gap-1.5">
                <UserCheck class="w-3.5 h-3.5" />
                Modo Cobertura
              </p>
              <p class="text-[10px] text-amber-600">
                Activá la cobertura para completar rondas en nombre del inspector. Quedará registrado en el historial quién cubrió.
              </p>
              <button @click="cubrirInspector"
                      class="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black text-white bg-amber-500 hover:bg-amber-600 shadow-sm shadow-amber-200 active:scale-[0.98] transition-all">
                <UserCheck class="w-4 h-4" />
                Cubrir Inspector
              </button>
            </div>
          </div>

        </template>
      </template>
    </main>
  </div>
</template>
