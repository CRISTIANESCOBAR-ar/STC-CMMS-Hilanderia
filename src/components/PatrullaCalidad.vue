<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getAuth } from 'firebase/auth';
import { userProfile, userRole } from '../services/authService';
import { getTurnoActual, getTurnoLabel } from '../constants/organization';
import { cargarPatrullaActiva } from '../services/patrullaService';
import { ArrowLeft, ScanLine, Eye, ClipboardCheck, AlertTriangle as AlertIcon, Lock, CheckCircle2, Circle, Loader2, Gauge, RotateCcw } from 'lucide-vue-next';
import { reabrirRonda } from '../services/patrullaService';
import RegistroRoturas from './RegistroRoturas.vue';
import RegistroParoDefecto from './RegistroParoDefecto.vue';
import PruebaTramaNegra from './PruebaTramaNegra.vue';
import SeguimientoRoturas from './SeguimientoRoturas.vue';


const router = useRouter();
const route = useRoute();

const turnoActual = ref(getTurnoActual());
const subVista = computed(() => route.params.sub || null);
const patrullaData = ref(null);
const cargandoPatrulla = ref(true);

// Definición de las 7 rondas
const RONDAS = [
  { key: 'ronda_1', num: 1, tipo: 'roturas',       sub: 'roturas',   label: 'Roturas',           desc: 'Rot. Urdido y Rot. Trama', icon: ScanLine,       color: 'blue' },
  { key: 'ronda_2', num: 2, tipo: 'paro_defecto',   sub: 'paro2',     label: 'Paros / Defectos',  desc: 'Recorrida de observación',  icon: AlertIcon,      color: 'orange' },
  { key: 'ronda_3', num: 3, tipo: 'trama_negra',    sub: 'trama',     label: 'Trama Negra',       desc: 'Inspección trama blanca',   icon: Eye,            color: 'amber' },
  { key: 'ronda_4', num: 4, tipo: 'paro_defecto',   sub: 'paro4',     label: 'Paros / Defectos',  desc: 'Recorrida de observación',  icon: AlertIcon,      color: 'orange' },
  { key: 'ronda_5', num: 5, tipo: 'paro_defecto',   sub: 'paro5',     label: 'Paros / Defectos',  desc: 'Recorrida de observación',  icon: AlertIcon,      color: 'orange' },
  { key: 'ronda_6', num: 6, tipo: 'roturas',        sub: 'roturas6',  label: 'Roturas',           desc: 'Rot. Urdido y Rot. Trama', icon: ScanLine,       color: 'blue' },
  { key: 'ronda_7', num: 7, tipo: 'evaluacion',     sub: 'seguimiento', label: 'Evaluación',      desc: 'Mejoró / Empeoró / Igual', icon: ClipboardCheck, color: 'emerald' },
];

// Estado de cada ronda
function estadoRonda(rondaDef) {
  const r = patrullaData.value?.rondas?.[rondaDef.key];
  if (r?.completada) return 'completada';
  if (r?.datos || r?.horaInicio) return 'en_curso';
  return 'pendiente';
}

// ¿Está desbloqueada? Ronda 1 siempre. Las demás requieren que la anterior esté completada.
// Ronda 7 requiere ronda_1 Y ronda_6 completadas.
function estaDesbloqueada(rondaDef, idx) {
  if (idx === 0) return true;
  if (rondaDef.key === 'ronda_7') {
    return estadoRonda(RONDAS[0]) === 'completada' && estadoRonda(RONDAS[5]) === 'completada';
  }
  return estadoRonda(RONDAS[idx - 1]) === 'completada';
}

const rondasConEstado = computed(() =>
  RONDAS.map((r, i) => ({
    ...r,
    estado: estadoRonda(r),
    desbloqueada: estaDesbloqueada(r, i),
  }))
);

const rondaActiva = computed(() => RONDAS.find(r => r.sub === subVista.value));

// ── Reapertura de rondas ────────────────────────────────────────
const rondaAReabrir = ref(null);
const reabriendo = ref(false);

function solicitarReapertura(ronda, event) {
  event.stopPropagation();
  rondaAReabrir.value = ronda;
}

function cancelarReapertura() {
  rondaAReabrir.value = null;
}

async function confirmarReapertura() {
  if (!rondaAReabrir.value || !patrullaData.value?.id) return;
  reabriendo.value = true;
  try {
    await reabrirRonda(patrullaData.value.id, rondaAReabrir.value.key);
    await cargarPatrulla();
  } catch (e) {
    console.error('Error al reabrir ronda:', e);
  } finally {
    reabriendo.value = false;
    rondaAReabrir.value = null;
  }
}

function irARonda(ronda) {
  if (!ronda.desbloqueada) return;
  router.push('/patrulla/' + ronda.sub);
}

async function onRondaCompletada() {
  await cargarPatrulla();
  router.push('/patrulla');
}

async function cargarPatrulla() {
  try {
    const uid = getAuth().currentUser?.uid;
    if (uid) {
      const activa = await cargarPatrullaActiva(uid);
      if (activa) patrullaData.value = activa;
    }
  } catch (e) {
    console.error('Error cargando patrulla:', e);
  }
}

onMounted(async () => {
  await cargarPatrulla();
  cargandoPatrulla.value = false;
});
</script>

<template>
  <div class="h-[calc(100vh-110px)] bg-gray-50 flex flex-col overflow-hidden">
    <!-- Header compacto (fuera del scroll) -->
    <div class="shrink-0 max-w-lg mx-auto w-full px-4 pt-3 pb-2 bg-gray-50">
      <div class="flex items-center gap-3 px-1">
        <button @click="subVista ? router.push('/patrulla') : router.back()" class="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-all">
          <ArrowLeft class="w-5 h-5 text-gray-600" />
        </button>
        <span class="text-[11px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded">{{ getTurnoLabel(turnoActual) }}</span>
        <span class="text-xs text-gray-500 font-bold truncate">{{ userProfile?.nombre || 'Inspector' }}</span>
        <span v-if="rondaActiva" class="ml-auto text-[10px] font-black text-gray-400 uppercase">R{{ rondaActiva.num }}</span>
      </div>
    </div>

    <main class="flex-1 max-w-lg mx-auto w-full px-3 pb-4 flex flex-col space-y-3 overflow-y-auto">

      <!-- ═══ HUB: Timeline de 7 rondas ═══ -->
      <template v-if="!subVista">
        <div v-if="cargandoPatrulla" class="flex items-center justify-center py-16">
          <Loader2 class="w-6 h-6 text-indigo-400 animate-spin" />
        </div>

        <template v-else>
          <!-- Card Eficiencia para supervisores -->
          <div v-if="['supervisor','supervisor_mecanico','admin'].includes(userRole)"
               @click="router.push('/eficiencia')"
               class="flex items-center gap-3 bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl px-4 py-3 cursor-pointer active:scale-[0.99] transition-all shadow-sm mb-3">
            <div class="w-9 h-9 rounded-full bg-violet-100 flex items-center justify-center">
              <Gauge class="w-5 h-5 text-violet-600" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-black text-violet-800">Registro de Eficiencia</p>
              <p class="text-[10px] text-violet-500 font-medium">3 mediciones por turno</p>
            </div>
          </div>

          <div class="space-y-0 relative">
            <!-- Línea vertical conectora -->
            <div class="absolute left-[19px] top-6 bottom-6 w-0.5 bg-gray-200 z-0"></div>

            <div v-for="(ronda, idx) in rondasConEstado" :key="ronda.key"
                 @click="irARonda(ronda)"
                 class="relative z-10 flex items-start gap-3 py-2.5 transition-all"
                 :class="ronda.desbloqueada ? 'cursor-pointer active:scale-[0.99]' : 'opacity-50 cursor-not-allowed'"
            >
              <!-- Icono de estado (círculo) -->
              <div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2 text-sm font-black"
                   :class="ronda.estado === 'completada'
                     ? 'bg-emerald-100 border-emerald-400 text-emerald-600'
                     : ronda.estado === 'en_curso'
                       ? 'bg-blue-100 border-blue-400 text-blue-600 animate-pulse'
                       : ronda.desbloqueada
                         ? 'bg-white border-gray-300 text-gray-500'
                         : 'bg-gray-100 border-gray-200 text-gray-300'
                   ">
                <CheckCircle2 v-if="ronda.estado === 'completada'" class="w-5 h-5" />
                <Loader2 v-else-if="ronda.estado === 'en_curso'" class="w-4 h-4 animate-spin" />
                <Lock v-else-if="!ronda.desbloqueada" class="w-4 h-4" />
                <span v-else>{{ ronda.num }}</span>
              </div>

              <!-- Contenido -->
              <div class="flex-1 min-w-0 bg-white rounded-xl border px-3 py-2.5 shadow-sm"
                   :class="ronda.estado === 'completada'
                     ? 'border-emerald-200'
                     : ronda.estado === 'en_curso'
                       ? 'border-blue-200'
                       : ronda.desbloqueada
                         ? 'border-gray-200 hover:border-indigo-200'
                         : 'border-gray-100'
                   ">
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <p class="text-sm font-black"
                       :class="ronda.desbloqueada ? 'text-gray-800' : 'text-gray-400'">
                      {{ ronda.label }}
                    </p>
                    <p class="text-[10px] font-medium mt-0.5"
                       :class="ronda.desbloqueada ? 'text-gray-500' : 'text-gray-300'">
                      {{ ronda.desc }}
                    </p>
                  </div>
                  <div class="shrink-0 flex items-center gap-1.5">
                    <button
                      v-if="ronda.estado === 'completada' && ['supervisor','supervisor_mecanico','admin'].includes(userRole)"
                      @click.stop="solicitarReapertura(ronda, $event)"
                      class="p-1 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-all"
                      title="Reabrir ronda"
                    >
                      <RotateCcw class="w-3.5 h-3.5" />
                    </button>
                    <span v-if="ronda.estado === 'completada'" class="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      ✓ Hecha
                    </span>
                    <span v-else-if="ronda.estado === 'en_curso'" class="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      En curso
                    </span>
                    <component v-else-if="ronda.desbloqueada" :is="ronda.icon" class="w-4 h-4 text-gray-300" />
                  </div>
                </div>
                <!-- Hora de completado -->
                <p v-if="ronda.estado === 'completada' && patrullaData?.rondas?.[ronda.key]?.hora"
                   class="text-[9px] text-gray-400 font-medium mt-1">
                  {{ new Date(patrullaData.rondas[ronda.key].hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) }}
                </p>
              </div>
            </div>
          </div>
        </template>
      </template>

      <!-- ═══ SUB-VISTAS ═══ -->

      <!-- Ronda 1: Roturas -->
      <template v-else-if="subVista === 'roturas'">
        <RegistroRoturas ronda-inicial="ronda_1" @completada="onRondaCompletada" />
      </template>

      <!-- Ronda 2: Paro/Defecto -->
      <template v-else-if="subVista === 'paro2'">
        <RegistroParoDefecto ronda-key="ronda_2" ronda-label="Ronda 2 — Paros / Defectos" @completada="onRondaCompletada" />
      </template>

      <!-- Ronda 3: Trama Negra -->
      <template v-else-if="subVista === 'trama'">
        <PruebaTramaNegra @completada="onRondaCompletada" />
      </template>

      <!-- Ronda 4: Paro/Defecto -->
      <template v-else-if="subVista === 'paro4'">
        <RegistroParoDefecto ronda-key="ronda_4" ronda-label="Ronda 4 — Paros / Defectos" @completada="onRondaCompletada" />
      </template>

      <!-- Ronda 5: Paro/Defecto -->
      <template v-else-if="subVista === 'paro5'">
        <RegistroParoDefecto ronda-key="ronda_5" ronda-label="Ronda 5 — Paros / Defectos" @completada="onRondaCompletada" />
      </template>

      <!-- Ronda 6: Roturas (misma vista, distinta ronda seleccionada) -->
      <template v-else-if="subVista === 'roturas6'">
        <RegistroRoturas ronda-inicial="ronda_6" @completada="onRondaCompletada" />
      </template>

      <!-- Ronda 7: Seguimiento/Evaluación -->
      <template v-else-if="subVista === 'seguimiento'">
        <SeguimientoRoturas @completada="onRondaCompletada" />
      </template>


    </main>

    <!-- Modal confirmación reapertura -->
    <Teleport to="body">
      <div v-if="rondaAReabrir" class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm p-4">
        <div class="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5 space-y-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <RotateCcw class="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p class="text-sm font-black text-gray-800">Reabrir Ronda {{ rondaAReabrir.num }}</p>
              <p class="text-[11px] text-gray-500">{{ rondaAReabrir.label }}</p>
            </div>
          </div>
          <p class="text-xs text-gray-600">Se quitará el estado <span class="font-bold text-emerald-600">Hecha</span> y la ronda volverá a estar disponible para completar. Los datos cargados se conservan.</p>
          <div class="flex gap-2">
            <button @click="cancelarReapertura" class="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all">Cancelar</button>
            <button @click="confirmarReapertura" :disabled="reabriendo" class="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-black transition-all disabled:opacity-50 flex items-center justify-center gap-1.5">
              <Loader2 v-if="reabriendo" class="w-4 h-4 animate-spin" />
              <span>{{ reabriendo ? 'Reabriendo...' : 'Sí, reabrir' }}</span>
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
