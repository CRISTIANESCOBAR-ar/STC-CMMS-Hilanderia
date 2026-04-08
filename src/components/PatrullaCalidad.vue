<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getAuth } from 'firebase/auth';
import { userProfile, userRole } from '../services/authService';
import { getTurnoActual, getTurnoLabel } from '../constants/organization';
import { cargarPatrullaActiva, cargarPatrullasTurnoActual, cargarPatrullaPorId, reabrirRonda, autoCompletarRondaEvaluacion } from '../services/patrullaService';
import { ArrowLeft, ScanLine, Eye, ClipboardCheck, AlertTriangle as AlertIcon, Lock, CheckCircle2, Circle, Loader2, Gauge, RotateCcw, History, Scissors, UserCheck, EyeOff, ChevronDown, ChevronUp } from 'lucide-vue-next';
import RegistroRoturas from './RegistroRoturas.vue';
import RegistroMuestrasAnudados from './RegistroMuestrasAnudados.vue';
import RegistroParoDefecto from './RegistroParoDefecto.vue';
import PruebaTramaNegra from './PruebaTramaNegra.vue';
import SeguimientoRoturas from './SeguimientoRoturas.vue';


const router = useRouter();
const route = useRoute();

const turnoActual = ref(getTurnoActual());
const subVista = computed(() => route.params.sub || null);
const patrullaData = ref(null);
const cargandoPatrulla = ref(true);
const headerColapsado = ref(true); // colapsado por defecto al entrar a una ronda

// Auto-colapsar cuando se entra a una sub-vista
watch(subVista, (val) => { if (val) headerColapsado.value = true; }, { immediate: true });

// ── Roles que pueden VER patrullas de otros inspectores (solo lectura) ──
const ROLES_OBSERVADOR = ['supervisor', 'supervisor_mecanico', 'supervisor_electrico', 'jefe_sector', 'jefe_electricos', 'jefe_produccion', 'gerente_produccion', 'admin'];

// ── Solo lectura / cobertura ─────────────────────────────────────
const cubriendo = ref(false);
const todasPatrullas = ref([]);           // patrullas activas del turno
const patrullaExternaId = ref(null);      // ID de la patrulla vista (no propia)

const esInspectorPropio = computed(() => {
  if (!patrullaData.value) return false;
  const uid = patrullaData.value.inspectorUid;
  const miUid = userProfile.value?.uid || null;
  // Si la patrulla pertenece al usuario actual o el usuario es inspector
  return uid === miUid || (userRole.value === 'inspector' && patrullaExternaId.value === null);
});

const puedeEditar = computed(() => {
  if (esInspectorPropio.value) return true;
  if (cubriendo.value) return true;
  // Admin siempre puede editar (incluso en modo Vista Previa donde userRole puede ser distinto)
  if (userProfile.value?.role === 'admin') return true;
  return false;
});

const esObservador = computed(() =>
  ROLES_OBSERVADOR.includes(userRole.value) && !esInspectorPropio.value
);

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
  await autoEvaluarR7();
  router.push('/patrulla');
}

// ── Auto-completado R7 ──────────────────────────────────────────
// Tolerancia igual que SeguimientoRoturas.vue
const _TOLS_ABS = 0.5, _TOLS_PCT = 20;
function _evalCambio(r1, r6) {
  if (r1 == null || r6 == null || isNaN(r1) || isNaN(r6)) return null;
  const diff = r6 - r1, abs = Math.abs(diff);
  if (abs <= _TOLS_ABS) return 'igual';
  if (r1 === 0) return diff > 0 ? 'peor' : 'mejor';
  const pct = (abs / Math.abs(r1)) * 100;
  if (pct <= _TOLS_PCT) return diff > 0 ? 'leve' : 'mejor';
  return diff < 0 ? 'mejor' : 'peor';
}

async function autoEvaluarR7() {
  if (!patrullaData.value?.id) return;
  const rondas = patrullaData.value.rondas || {};
  if (!rondas.ronda_1?.completada || !rondas.ronda_6?.completada) return;
  if (rondas.ronda_7?.completada) return; // ya guardada

  const d1 = rondas.ronda_1.datos || {};
  const d6 = rondas.ronda_6.datos || {};
  let mejoras = 0, empeoramientos = 0, leves = 0, iguales = 0;
  const allIds = new Set([...Object.keys(d1), ...Object.keys(d6)]);
  for (const id of allIds) {
    for (const [v1, v6] of [
      [d1[id]?.roU, d6[id]?.roU],
      [d1[id]?.roT, d6[id]?.roT],
    ]) {
      const e = _evalCambio(
        v1 != null ? parseFloat(v1) : null,
        v6 != null ? parseFloat(v6) : null,
      );
      if (e === 'mejor') mejoras++;
      else if (e === 'peor') empeoramientos++;
      else if (e === 'leve') leves++;
      else if (e === 'igual') iguales++;
    }
  }

  try {
    await autoCompletarRondaEvaluacion(patrullaData.value.id, { mejoras, empeoramientos, leves, iguales });
    await cargarPatrulla(); // refrescar hub para mostrar R7 completada
  } catch (e) {
    console.error('Error auto-completando R7:', e);
  }
}

async function cargarPatrulla() {
  try {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return;

    if (userRole.value === 'inspector' || !ROLES_OBSERVADOR.includes(userRole.value)) {
      // Inspector: carga su propia patrulla
      const activa = await cargarPatrullaActiva(uid);
      if (activa) {
        patrullaData.value = activa;
        patrullaExternaId.value = null;
      }
    } else {
      // Observador autorizado: carga todas las patrullas del turno
      const todas = await cargarPatrullasTurnoActual();
      todasPatrullas.value = todas;
      if (todas.length === 1) {
        patrullaData.value = todas[0];
        patrullaExternaId.value = todas[0].id;
      } else if (todas.length > 1) {
        // Por defecto muestra la primera; el usuario puede cambiar desde el selector
        patrullaData.value = todas[0];
        patrullaExternaId.value = todas[0].id;
      }
    }
  } catch (e) {
    console.error('Error cargando patrulla:', e);
  }
}

async function seleccionarPatrulla(id) {
  patrullaExternaId.value = id;
  cubriendo.value = false;
  const p = todasPatrullas.value.find(p => p.id === id);
  if (p) {
    patrullaData.value = p;
  } else {
    const loaded = await cargarPatrullaPorId(id);
    if (loaded) patrullaData.value = loaded;
  }
}

onMounted(async () => {
  await cargarPatrulla();
  cargandoPatrulla.value = false;
  // Si al cargar ya están R1 y R6 completadas y R7 no, auto-completar
  await autoEvaluarR7();
});
</script>

<template>
  <div class="h-[calc(100vh-110px)] bg-gray-50 flex flex-col overflow-hidden">
    <!-- Header compacto (fuera del scroll) -->
    <div class="shrink-0 max-w-lg mx-auto w-full px-4 pt-3 pb-2 bg-gray-50">
      <div class="flex items-center gap-2 px-1">
        <button @click="subVista ? router.push('/patrulla') : router.back()" class="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-all shrink-0">
          <ArrowLeft class="w-5 h-5 text-gray-600" />
        </button>
        <span class="text-[11px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded shrink-0">{{ getTurnoLabel(turnoActual) }}</span>
        <span class="text-xs text-gray-500 font-bold truncate min-w-0">{{ userProfile?.nombre || 'Inspector' }}</span>
        <span v-if="rondaActiva" class="shrink-0 text-[10px] font-black text-gray-400 uppercase">R{{ rondaActiva.num }}</span>
        <!-- Botón colapsar/expandir (solo en sub-vistas con contexto de observador) -->
        <button
          v-if="esObservador && patrullaData && subVista"
          @click="headerColapsado = !headerColapsado"
          class="ml-auto shrink-0 flex items-center gap-1 pl-2.5 pr-2 py-1.5 rounded-lg font-black text-[10px] transition-all active:scale-95 shadow-sm"
          :class="headerColapsado
            ? 'bg-violet-600 text-white hover:bg-violet-700'
            : 'bg-violet-100 text-violet-700 border border-violet-300 hover:bg-violet-200'"
          :title="headerColapsado ? 'Ver opciones' : 'Ocultar opciones'"
        >
          <span v-if="!headerColapsado">Ocultar</span>
          <span v-else class="flex items-center gap-1">
            <component :is="cubriendo ? UserCheck : EyeOff" class="w-3 h-3" />
            <span>{{ cubriendo ? 'Cobertura' : 'Obs.' }}</span>
          </span>
          <ChevronUp v-if="!headerColapsado" class="w-3.5 h-3.5" />
          <ChevronDown v-else class="w-3.5 h-3.5" />
        </button>
        <!-- Rótulo sin sub-vista -->
        <span v-else-if="!subVista" class="ml-auto text-[10px] font-black text-gray-400"></span>
      </div>
    </div>

<!-- Banner solo lectura / cobertura (para observadores) -->
      <transition
        enter-active-class="transition-all duration-300 ease-out"
        enter-from-class="opacity-0 -translate-y-2 max-h-0"
        enter-to-class="opacity-100 translate-y-0 max-h-40"
        leave-active-class="transition-all duration-200 ease-in"
        leave-from-class="opacity-100 translate-y-0 max-h-40"
        leave-to-class="opacity-0 -translate-y-2 max-h-0"
      >
        <div v-if="esObservador && patrullaData && !headerColapsado" class="shrink-0 max-w-lg mx-auto w-full px-4 pt-0 pb-1 overflow-hidden">
          <div class="rounded-xl border px-3 py-2 flex items-center justify-between gap-2"
               :class="cubriendo ? 'bg-amber-50 border-amber-300' : 'bg-blue-50 border-blue-200'">
            <div class="flex items-center gap-2 min-w-0">
              <component :is="cubriendo ? UserCheck : EyeOff" class="w-4 h-4 shrink-0" :class="cubriendo ? 'text-amber-600' : 'text-blue-500'" />
              <div class="min-w-0">
                <p class="text-[10px] font-black uppercase tracking-wider" :class="cubriendo ? 'text-amber-700' : 'text-blue-600'">
                  {{ cubriendo ? 'Modo cobertura — Puedes editar' : 'Solo lectura' }}
                </p>
                <p v-if="patrullaData.inspectorNombre" class="text-[10px] text-gray-500 font-medium truncate">
                  Patrulla de {{ patrullaData.inspectorNombre }}
                </p>
              </div>
            </div>
            <button
              @click="cubriendo = !cubriendo"
              class="shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all active:scale-95"
              :class="cubriendo ? 'bg-amber-100 border-amber-300 text-amber-700 hover:bg-amber-200' : 'bg-white border-blue-200 text-blue-600 hover:bg-blue-100'"
            >
              {{ cubriendo ? 'Cancelar cobertura' : 'Cubrir Inspector' }}
            </button>
          </div>
          <!-- Selector de patrulla si hay varias -->
          <div v-if="todasPatrullas.length > 1" class="mt-1">
            <select
              :value="patrullaExternaId"
              @change="seleccionarPatrulla($event.target.value)"
              class="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option v-for="p in todasPatrullas" :key="p.id" :value="p.id">
                {{ p.inspectorNombre || p.inspectorEmail || p.id }} — {{ p.turno }}
              </option>
            </select>
          </div>
        </div>
      </transition>

      <!-- Barra compacta modo cobertura (cuando header colapsado) - ya no necesaria, la info está en el botón -->

      <main class="flex-1 max-w-lg mx-auto w-full px-3 pb-4 flex flex-col space-y-3 overflow-y-auto">

      <!-- ═══ HUB: Timeline de 7 rondas ═══ -->
      <template v-if="!subVista">
        <div v-if="cargandoPatrulla" class="flex items-center justify-center py-16">
          <Loader2 class="w-6 h-6 text-indigo-400 animate-spin" />
        </div>

        <template v-else>
          <!-- Muestras de Anudados -->
          <div @click="router.push('/patrulla/anudados')"
               class="flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 cursor-pointer active:scale-[0.99] transition-all shadow-sm mb-1">
            <div class="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
              <Scissors class="w-4 h-4 text-rose-600" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-black text-rose-700">Muestras de Anudados</p>
              <p class="text-[10px] text-rose-400 font-medium">Registro diario de control</p>
            </div>
            <span class="text-[10px] text-rose-300 font-bold">→</span>
          </div>

          <!-- Historial de patrullas -->
          <div @click="router.push('/patrulla-historial')"
               class="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 cursor-pointer active:scale-[0.99] transition-all shadow-sm mb-1">
            <div class="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
              <History class="w-4 h-4 text-gray-500" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-black text-gray-700">Ver historial</p>
              <p class="text-[10px] text-gray-400 font-medium">Patrullas anteriores</p>
            </div>
            <span class="text-[10px] text-gray-400 font-bold">→</span>
          </div>

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
        <RegistroRoturas ronda-inicial="ronda_1" :solo-lectura="!puedeEditar" :patrulla-id-externo="patrullaExternaId"
          :cobertura-uid="cubriendo ? (userProfile?.uid || null) : null"
          :cobertura-nombre="cubriendo ? (userProfile?.nombre || null) : null"
          @completada="onRondaCompletada" />
      </template>

      <!-- Ronda 2: Paro/Defecto -->
      <template v-else-if="subVista === 'paro2'">
        <RegistroParoDefecto ronda-key="ronda_2" ronda-label="Ronda 2 — Paros / Defectos" :solo-lectura="!puedeEditar" :patrulla-id-externo="patrullaExternaId"
          :cobertura-uid="cubriendo ? (userProfile?.uid || null) : null"
          :cobertura-nombre="cubriendo ? (userProfile?.nombre || null) : null"
          @completada="onRondaCompletada" />
      </template>

      <!-- Ronda 3: Trama Negra -->
      <template v-else-if="subVista === 'trama'">
        <PruebaTramaNegra :solo-lectura="!puedeEditar" :patrulla-id-externo="patrullaExternaId"
          :cobertura-uid="cubriendo ? (userProfile?.uid || null) : null"
          :cobertura-nombre="cubriendo ? (userProfile?.nombre || null) : null"
          @completada="onRondaCompletada" />
      </template>

      <!-- Ronda 4: Paro/Defecto -->
      <template v-else-if="subVista === 'paro4'">
        <RegistroParoDefecto ronda-key="ronda_4" ronda-label="Ronda 4 — Paros / Defectos" :solo-lectura="!puedeEditar" :patrulla-id-externo="patrullaExternaId"
          :cobertura-uid="cubriendo ? (userProfile?.uid || null) : null"
          :cobertura-nombre="cubriendo ? (userProfile?.nombre || null) : null"
          @completada="onRondaCompletada" />
      </template>

      <!-- Ronda 5: Paro/Defecto -->
      <template v-else-if="subVista === 'paro5'">
        <RegistroParoDefecto ronda-key="ronda_5" ronda-label="Ronda 5 — Paros / Defectos" :solo-lectura="!puedeEditar" :patrulla-id-externo="patrullaExternaId"
          :cobertura-uid="cubriendo ? (userProfile?.uid || null) : null"
          :cobertura-nombre="cubriendo ? (userProfile?.nombre || null) : null"
          @completada="onRondaCompletada" />
      </template>

      <!-- Ronda 6: Roturas (misma vista, distinta ronda seleccionada) -->
      <template v-else-if="subVista === 'roturas6'">
        <RegistroRoturas ronda-inicial="ronda_6" :solo-lectura="!puedeEditar" :patrulla-id-externo="patrullaExternaId"
          :cobertura-uid="cubriendo ? (userProfile?.uid || null) : null"
          :cobertura-nombre="cubriendo ? (userProfile?.nombre || null) : null"
          @completada="onRondaCompletada" />
      </template>

      <!-- Ronda 7: Seguimiento/Evaluación -->
      <template v-else-if="subVista === 'seguimiento'">
        <SeguimientoRoturas :patrulla-id-externo="patrullaExternaId" @completada="onRondaCompletada" />
      </template>

      <!-- Muestras de Anudados -->
      <template v-else-if="subVista === 'anudados'">
        <RegistroMuestrasAnudados />
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
