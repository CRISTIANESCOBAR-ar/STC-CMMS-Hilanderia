<script setup>
import { ref, computed, onMounted } from 'vue';
import { getAuth } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userProfile } from '../services/authService';
import { normalizeSectorValue, DEFAULT_SECTOR, getTurnoLabel } from '../constants/organization';
import { loadPatrullaConfig, cargarPatrullaActiva, cargarPatrullaPorId } from '../services/patrullaService';
import { Loader2, TrendingDown, TrendingUp, Minus, Share2, AlertTriangle, ChevronDown } from 'lucide-vue-next';

// ── Estado ───────────────────────────────────────────────────────
const props = defineProps({
  patrullaIdExterno: { type: String, default: null },
});

const telares = ref([]);
const config = ref({ umbralRoturaU: 2, umbralRoturaT: 3 });
const patrullaData = ref(null);
const cargando = ref(true);
const grupoSeleccionado = ref('');
const modoDemo = ref(false);

// Datos de ejemplo para vista previa
const DEMO_DATA = [
  { telar: { id: 'd1', nombre: 'Toyota 1', local_fisico: 1 },  r1U: 1, r1T: 3.5, r6U: 0.8, r6T: 5,    evalU: null, evalT: null },
  { telar: { id: 'd2', nombre: 'Toyota 2', local_fisico: 2 },  r1U: 2, r1T: 6,   r6U: 1.5, r6T: 4,    evalU: null, evalT: null },
  { telar: { id: 'd6', nombre: 'Toyota 6', local_fisico: 6 },  r1U: 1, r1T: 9,   r6U: 1.2, r6T: 3,    evalU: null, evalT: null },
  { telar: { id: 'd12', nombre: 'Toyota 12', local_fisico: 12 }, r1U: 0, r1T: 7,   r6U: 0.3, r6T: 7.3,  evalU: null, evalT: null },
  { telar: { id: 'd16', nombre: 'Toyota 16', local_fisico: 16 }, r1U: 1, r1T: 7,   r6U: 1,   r6T: 2,    evalU: null, evalT: null },
  { telar: { id: 'd22', nombre: 'Toyota 22', local_fisico: 22 }, r1U: 0, r1T: 7,   r6U: 0,   r6T: 8,    evalU: null, evalT: null },
  { telar: { id: 'd33', nombre: 'Toyota 33', local_fisico: 33 }, r1U: 1, r1T: 5,   r6U: 0.5, r6T: 5.2,  evalU: null, evalT: null },
  { telar: { id: 'd41', nombre: 'Toyota 41', local_fisico: 41 }, r1U: 0, r1T: 6,   r6U: 0,   r6T: 10,   evalU: null, evalT: null },
  { telar: { id: 'd48', nombre: 'Toyota 48', local_fisico: 48 }, r1U: 1, r1T: 5,   r6U: 2,   r6T: 1,    evalU: null, evalT: null },
  { telar: { id: 'd68', nombre: 'Toyota 68', local_fisico: 68 }, r1U: 0, r1T: 10,  r6U: 0,   r6T: 4,    evalU: null, evalT: null },
];
// Pre-calcular evaluaciones del demo
for (const d of DEMO_DATA) { d.evalU = evaluarCambio(d.r1U, d.r6U); d.evalT = evaluarCambio(d.r1T, d.r6T); }

// ── Tolerancia inteligente ───────────────────────────────────────
// Se considera "igual" si AMBAS condiciones se cumplen:
//   1. Diferencia absoluta ≤ TOLERANCIA_ABS (ej: 0.5)
//   2. O el valor base es 0 (no tiene sentido calcular % sobre 0)
// Se considera "peor" si:
//   - Diferencia absoluta > TOLERANCIA_ABS Y cambio porcentual > TOLERANCIA_PCT
// Zona gris (abs > 0.5 pero % ≤ 20%): se marca como "leve"
const TOLERANCIA_ABS = 0.5;
const TOLERANCIA_PCT = 20; // %

// ── Computed ─────────────────────────────────────────────────────
const sectoresUsuario = computed(() =>
  Array.isArray(userProfile.value?.sectoresAsignados)
    ? userProfile.value.sectoresAsignados
    : [normalizeSectorValue(userProfile.value?.sectorDefault || DEFAULT_SECTOR)]
);

const gruposDisponibles = computed(() => {
  const gs = telares.value.map(t => String(t.grp_tear || '').trim()).filter(Boolean);
  return [...new Set(gs)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
});

const puedeComparar = computed(() => {
  const rondas = patrullaData.value?.rondas;
  return rondas?.ronda_1?.completada && rondas?.ronda_6?.completada;
});

const estadoRondas = computed(() => {
  const rondas = patrullaData.value?.rondas || {};
  return {
    r1: rondas.ronda_1?.completada ? 'completada' : 'pendiente',
    r6: rondas.ronda_6?.completada ? 'completada' : 'pendiente',
    r1Hora: rondas.ronda_1?.hora ? new Date(rondas.ronda_1.hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : null,
    r6Hora: rondas.ronda_6?.hora ? new Date(rondas.ronda_6.hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : null,
  };
});

const comparacion = computed(() => {
  if (modoDemo.value) return DEMO_DATA;
  if (!puedeComparar.value) return [];
  const d1 = patrullaData.value.rondas.ronda_1.datos || {};
  const d6 = patrullaData.value.rondas.ronda_6.datos || {};
  const allIds = new Set([...Object.keys(d1), ...Object.keys(d6)]);
  const result = [];

  for (const maqId of allIds) {
    const t = telares.value.find(t => t.id === maqId);
    if (!t) continue;

    // Filtro por grupo
    if (grupoSeleccionado.value && String(t.grp_tear || '').trim() !== grupoSeleccionado.value) continue;

    const r1U = d1[maqId]?.roU != null ? parseFloat(d1[maqId].roU) : null;
    const r1T = d1[maqId]?.roT != null ? parseFloat(d1[maqId].roT) : null;
    const r6U = d6[maqId]?.roU != null ? parseFloat(d6[maqId].roU) : null;
    const r6T = d6[maqId]?.roT != null ? parseFloat(d6[maqId].roT) : null;

    if (r1U == null && r1T == null && r6U == null && r6T == null) continue;

    const evalU = evaluarCambio(r1U, r6U);
    const evalT = evaluarCambio(r1T, r6T);
    result.push({ telar: t, r1U, r1T, r6U, r6T, evalU, evalT });
  }

  return result.sort((a, b) => (a.telar.orden_patrulla || 999) - (b.telar.orden_patrulla || 999));
});

const resumen = computed(() => {
  let mejoras = 0, empeoramientos = 0, leves = 0, iguales = 0, sinDatos = 0;
  for (const item of comparacion.value) {
    for (const e of [item.evalU, item.evalT]) {
      if (e === 'mejor') mejoras++;
      else if (e === 'peor') empeoramientos++;
      else if (e === 'leve') leves++;
      else if (e === 'igual') iguales++;
      else sinDatos++;
    }
  }
  return { mejoras, empeoramientos, leves, iguales, sinDatos };
});

// ── Filtro tipo (Todos / Urdido / Trama) ─────────────────────────
const filtroTipo = ref('todos');

function getNumTelar(t) {
  const raw = String(t.nombre || t.maquina || t.id || '');
  const n = parseInt(raw.replace(/[^0-9]/g, '').slice(-3), 10);
  return isNaN(n) ? 0 : n;
}

function formatLinea(num, tipo, r1, r6) {
  const r1s = r1 != null ? r1.toFixed(1).padStart(5) : '    —';
  const r6s = r6 != null ? r6.toFixed(1).padStart(5) : '    —';
  let dif = '';
  if (r1 != null && r6 != null) {
    const d = r6 - r1;
    dif = ' ' + ('(' + (d >= 0 ? '+' : '') + d.toFixed(1) + ')').padStart(7);
  }
  return `${String(num).padStart(3)} ${tipo}: ${r1s} → ${r6s}${dif}`;
}

function buildLineasSeccion(tiposEval) {
  const lines = [];
  const inclU = filtroTipo.value !== 'trama';
  const inclT = filtroTipo.value !== 'urdido';
  for (const c of comparacion.value) {
    const num = getNumTelar(c.telar);
    if (inclU && tiposEval.includes(c.evalU) && (c.r1U != null || c.r6U != null))
      lines.push(formatLinea(num, 'Rot.URD', c.r1U, c.r6U));
    if (inclT && tiposEval.includes(c.evalT) && (c.r1T != null || c.r6T != null))
      lines.push(formatLinea(num, 'Rot.TRA', c.r1T, c.r6T));
  }
  return lines;
}

const secEmpeoro  = computed(() => buildLineasSeccion(['peor']));
const secLeves    = computed(() => buildLineasSeccion(['leve']));
const secMejoras  = computed(() => buildLineasSeccion(['mejor']));
const secIguales  = computed(() => buildLineasSeccion(['igual']));

// ── Lógica de evaluación inteligente ─────────────────────────────
function evaluarCambio(valR1, valR6) {
  if (valR1 == null || valR6 == null) return null;
  if (isNaN(valR1) || isNaN(valR6)) return null;

  const diff = valR6 - valR1; // positivo = empeoró, negativo = mejoró
  const absDiff = Math.abs(diff);

  // Dentro de tolerancia absoluta → igual
  if (absDiff <= TOLERANCIA_ABS) return 'igual';

  // Calcular cambio porcentual respecto al valor base (R1)
  // Si R1 es 0, cualquier diferencia fuera de tolerancia absoluta es significativa
  if (valR1 === 0) return diff > 0 ? 'peor' : 'mejor';

  const pctCambio = (absDiff / Math.abs(valR1)) * 100;

  // Si el cambio porcentual es bajo (≤20%), marcar como "leve"
  if (pctCambio <= TOLERANCIA_PCT) return diff > 0 ? 'leve' : 'mejor';

  // Cambio significativo
  return diff < 0 ? 'mejor' : 'peor';
}

function colorCambio(eval_) {
  if (eval_ === 'mejor') return 'text-emerald-700 bg-emerald-50';
  if (eval_ === 'peor') return 'text-red-700 bg-red-50';
  if (eval_ === 'leve') return 'text-amber-600 bg-amber-50';
  if (eval_ === 'igual') return 'text-gray-500 bg-gray-100';
  return 'text-gray-300';
}

function badgeCambio(eval_) {
  if (eval_ === 'mejor') return { text: 'Mejoró', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
  if (eval_ === 'peor') return { text: 'Empeoró', cls: 'bg-red-100 text-red-700 border-red-200' };
  if (eval_ === 'leve') return { text: 'Leve ↑', cls: 'bg-amber-100 text-amber-700 border-amber-200' };
  if (eval_ === 'igual') return { text: 'Igual', cls: 'bg-gray-100 text-gray-500 border-gray-200' };
  return { text: '—', cls: 'bg-gray-50 text-gray-300 border-gray-100' };
}

function diffTexto(r1, r6) {
  if (r1 == null || r6 == null) return '';
  const d = r6 - r1;
  if (d === 0) return '0';
  return (d > 0 ? '+' : '') + d.toFixed(1);
}

function nombreCorto(t) {
  const raw = String(t.maquina || t.id || '');
  const nums = raw.replace(/[^0-9]/g, '');
  const last3 = nums.slice(-3);
  const n = parseInt(last3, 10);
  return `Toyota ${isNaN(n) ? raw : n}`;
}

// ── Compartir por WhatsApp ───────────────────────────────────────
function compartirWhatsApp() {
  const r = resumen.value;

  // Encabezado
  const fecha = patrullaData.value?.fecha
    ? new Date(patrullaData.value.fecha + 'T12:00:00').toLocaleDateString('es-AR')
    : new Date().toLocaleDateString('es-AR');
  const turnoLabel = patrullaData.value?.turno ? getTurnoLabel(patrullaData.value.turno) : '';
  const inspector = patrullaData.value?.inspectorNombre || '';

  let msg = `📊 *Seguimiento de Roturas — Evaluación*\n`;
  msg += `📅 ${fecha}`;
  if (turnoLabel) msg += `  |  🕐 Turno: ${turnoLabel}`;
  if (inspector)  msg += `  |  👷 ${inspector}`;
  msg += `\n\n`;

  msg += `✅ Mejoras: ${r.mejoras}\n`;
  msg += `❌ Empeoramientos: ${r.empeoramientos}\n`;
  if (r.leves) msg += `⚠️ Leves: ${r.leves}\n`;
  msg += `➖ Sin cambio: ${r.iguales}\n`;

  // Helpers de alineación
  function getModelo(t) {
    const raw = String(t.nombre || t.maquina || t.id || '');
    const match = raw.match(/^([A-Za-záéíóúÁÉÍÓÚñÑ\s]+?)\s+\d/);
    return match ? match[1].trim() : 'Sin modelo';
  }
  function getNumero(t) {
    const raw = String(t.nombre || t.maquina || t.id || '');
    const n = parseInt(raw.replace(/[^0-9]/g, '').slice(-3), 10);
    return isNaN(n) ? 0 : n;
  }
  function pN(n) { return n != null ? n.toFixed(1).padStart(5) : '     '; }
  function pD(r1, r6) {
    if (r1 == null || r6 == null) return '       ';
    const d = r6 - r1;
    return `(${(d > 0 ? '+' : '') + d.toFixed(1)})`.padStart(7);
  }

  // Construir líneas de un grupo filtrado por tipo de evaluación
  function buildLines(items, tipos) {
    const lines = [];
    for (const c of items) {
      const num = String(getNumero(c.telar)).padStart(3);
      if (tipos.includes(c.evalU)) lines.push(`${num} Rot. URD: ${pN(c.r1U)} → ${pN(c.r6U)} ${pD(c.r1U, c.r6U)}`);
      if (tipos.includes(c.evalT)) lines.push(`${num} Rot. TRA: ${pN(c.r1T)} → ${pN(c.r6T)} ${pD(c.r1T, c.r6T)}`);
    }
    return lines;
  }

  // Agrupar todo por modelo
  const todos = comparacion.value;
  const modelos = [...new Set(todos.map(c => getModelo(c.telar)))].sort();

  for (const modelo of modelos) {
    const items = todos.filter(c => getModelo(c.telar) === modelo);
    const peores = items.filter(c => c.evalU === 'peor' || c.evalT === 'peor' || c.evalU === 'leve' || c.evalT === 'leve');
    const mejores = items.filter(c => c.evalU === 'mejor' || c.evalT === 'mejor');
    if (!peores.length && !mejores.length) continue;

    msg += `\n*${modelo}*\n`;

    if (peores.length) {
      const lines = buildLines(peores, ['peor', 'leve']);
      if (lines.length) msg += `🔴 *Empeoramientos:*\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`;
    }
    if (mejores.length) {
      const lines = buildLines(mejores, ['mejor']);
      if (lines.length) msg += `🟢 *Mejoras:*\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`;
    }
  }

  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

// ── Carga inicial ────────────────────────────────────────────────
onMounted(async () => {
  try {
    config.value = await loadPatrullaConfig();

    const snap = await getDocs(collection(db, 'maquinas'));
    const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    telares.value = todas.filter(m =>
      String(m.tipo || '').toUpperCase() === 'TELAR' &&
      (m.activo ?? true) &&
      sectoresUsuario.value.includes(normalizeSectorValue(m.sector || DEFAULT_SECTOR))
    );

    const uid = getAuth().currentUser?.uid;
    if (uid) {
      const activa = props.patrullaIdExterno
        ? await cargarPatrullaPorId(props.patrullaIdExterno)
        : await cargarPatrullaActiva(uid);
      if (activa) patrullaData.value = activa;
    }
  } catch (e) {
    console.error('Error cargando seguimiento:', e);
  } finally {
    cargando.value = false;
  }
});
</script>

<template>
  <div>
    <!-- Loading -->
    <div v-if="cargando" class="flex items-center justify-center py-16">
      <Loader2 class="w-6 h-6 text-indigo-400 animate-spin" />
    </div>

    <!-- Sin patrulla activa -->
    <div v-else-if="!patrullaData" class="text-center py-12 space-y-2">
      <AlertTriangle class="w-8 h-8 text-amber-400 mx-auto" />
      <p class="text-sm font-bold text-gray-600">No hay patrulla activa</p>
      <p class="text-xs text-gray-400">Iniciá una patrulla desde Control de Roturas primero.</p>
    </div>

    <!-- Rondas incompletas -->
    <div v-else-if="!puedeComparar" class="space-y-3">
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <p class="text-sm font-black text-amber-700 flex items-center gap-2">
          <AlertTriangle class="w-4 h-4" /> Faltan rondas por completar
        </p>
        <div class="space-y-2 text-sm">
          <div class="flex items-center gap-2">
            <span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black"
                  :class="estadoRondas.r1 === 'completada' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-400'">
              {{ estadoRondas.r1 === 'completada' ? '✓' : '1' }}
            </span>
            <span :class="estadoRondas.r1 === 'completada' ? 'text-emerald-700 font-bold' : 'text-gray-500'">
              Ronda 1 (inicio turno)
              <span v-if="estadoRondas.r1Hora" class="text-[10px] text-gray-400 ml-1">{{ estadoRondas.r1Hora }}</span>
            </span>
          </div>
          <div class="flex items-center gap-2">
            <span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black"
                  :class="estadoRondas.r6 === 'completada' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-400'">
              {{ estadoRondas.r6 === 'completada' ? '✓' : '6' }}
            </span>
            <span :class="estadoRondas.r6 === 'completada' ? 'text-emerald-700 font-bold' : 'text-gray-500'">
              Ronda 6 (fin turno)
              <span v-if="estadoRondas.r6Hora" class="text-[10px] text-gray-400 ml-1">{{ estadoRondas.r6Hora }}</span>
            </span>
          </div>
        </div>
        <p class="text-xs text-amber-600 font-medium">Completá ambas rondas en Control de Roturas para ver la evaluación.</p>
      </div>
      <!-- Botón demo -->
      <button
        @click="modoDemo = true"
        class="w-full py-2.5 rounded-xl text-sm font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 transition-all active:scale-[0.98]"
      >
        👁 Ver vista previa con datos de ejemplo
      </button>
    </div>

    <!-- ═══ EVALUACIÓN COMPLETA ═══ -->
    <template v-if="!cargando && (puedeComparar || modoDemo)">
      <!-- Banner demo -->
      <div v-if="modoDemo" class="bg-indigo-50 border border-indigo-200 rounded-xl p-3 mb-3 flex items-center justify-between gap-2">
        <p class="text-xs font-bold text-indigo-700">👁 Vista previa con datos de ejemplo</p>
        <button @click="modoDemo = false" class="text-[10px] font-bold text-indigo-500 bg-white px-2 py-1 rounded-lg border border-indigo-200">Cerrar</button>
      </div>
      <!-- Filtro de grupo -->
      <div v-if="gruposDisponibles.length > 1" class="mb-3">
        <div class="relative inline-block">
          <select v-model="grupoSeleccionado"
                  class="appearance-none bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 pr-8 focus:outline-none focus:ring-2 focus:ring-gray-300">
            <option value="">Todos los grupos</option>
            <option v-for="g in gruposDisponibles" :key="g" :value="g">Grupo {{ parseInt(g, 10) || g }}</option>
          </select>
          <ChevronDown class="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      <!-- Resumen visual -->
      <div class="grid grid-cols-4 gap-2 mb-3">
        <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 text-center">
          <p class="text-lg font-black text-emerald-700">{{ resumen.mejoras }}</p>
          <p class="text-[9px] font-bold text-emerald-600 uppercase">Mejoras</p>
        </div>
        <div class="bg-red-50 border border-red-200 rounded-xl p-2.5 text-center">
          <p class="text-lg font-black text-red-700">{{ resumen.empeoramientos }}</p>
          <p class="text-[9px] font-bold text-red-600 uppercase">Peores</p>
        </div>
        <div class="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-center">
          <p class="text-lg font-black text-amber-700">{{ resumen.leves }}</p>
          <p class="text-[9px] font-bold text-amber-600 uppercase">Leves</p>
        </div>
        <div class="bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-center">
          <p class="text-lg font-black text-gray-600">{{ resumen.iguales }}</p>
          <p class="text-[9px] font-bold text-gray-500 uppercase">Iguales</p>
        </div>
      </div>

      <!-- Info de tolerancia -->
      <p class="text-[9px] text-gray-400 font-medium mb-3 px-1">
        Tolerancia: ±{{ TOLERANCIA_ABS }} absoluto / ±{{ TOLERANCIA_PCT }}% relativo. Cambios dentro de tolerancia = "igual". Cambios con bajo % = "leve".
      </p>

      <!-- Tabs filtro Todos / Urdido / Trama -->
      <div class="flex bg-gray-100 rounded-xl p-1 mb-4 gap-1">
        <button v-for="tab in [{k:'todos',l:'Todos'},{k:'urdido',l:'Urdido'},{k:'trama',l:'Trama'}]" :key="tab.k"
          @click="filtroTipo = tab.k"
          class="flex-1 py-1.5 rounded-lg text-xs font-bold transition-all"
          :class="filtroTipo === tab.k ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'"
        >{{ tab.l }}</button>
      </div>

      <!-- Empeoramientos -->
      <div v-if="secEmpeoro.length" class="mb-3 rounded-xl overflow-hidden border border-red-200">
        <div class="bg-red-100 px-3 py-1.5 flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-red-500 shrink-0"></span>
          <span class="text-xs font-black text-red-700 uppercase tracking-wide">Empeoramientos</span>
          <span class="ml-auto text-xs font-bold text-red-400">{{ secEmpeoro.length }}</span>
        </div>
        <pre class="bg-red-50 text-red-900 font-mono text-[11.5px] leading-[1.6] px-3 py-2.5 overflow-x-auto whitespace-pre">{{ secEmpeoro.join('\n') }}</pre>
      </div>

      <!-- Leves -->
      <div v-if="secLeves.length" class="mb-3 rounded-xl overflow-hidden border border-amber-200">
        <div class="bg-amber-100 px-3 py-1.5 flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-amber-500 shrink-0"></span>
          <span class="text-xs font-black text-amber-700 uppercase tracking-wide">Leves</span>
          <span class="ml-auto text-xs font-bold text-amber-400">{{ secLeves.length }}</span>
        </div>
        <pre class="bg-amber-50 text-amber-900 font-mono text-[11.5px] leading-[1.6] px-3 py-2.5 overflow-x-auto whitespace-pre">{{ secLeves.join('\n') }}</pre>
      </div>

      <!-- Mejoras -->
      <div v-if="secMejoras.length" class="mb-3 rounded-xl overflow-hidden border border-emerald-200">
        <div class="bg-emerald-100 px-3 py-1.5 flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
          <span class="text-xs font-black text-emerald-700 uppercase tracking-wide">Mejoras</span>
          <span class="ml-auto text-xs font-bold text-emerald-400">{{ secMejoras.length }}</span>
        </div>
        <pre class="bg-emerald-50 text-emerald-900 font-mono text-[11.5px] leading-[1.6] px-3 py-2.5 overflow-x-auto whitespace-pre">{{ secMejoras.join('\n') }}</pre>
      </div>

      <!-- Sin cambio (colapsable) -->
      <details v-if="secIguales.length" class="mb-3 rounded-xl border border-gray-200 overflow-hidden group">
        <summary class="bg-gray-100 px-3 py-1.5 flex items-center gap-1.5 cursor-pointer list-none select-none">
          <span class="w-2 h-2 rounded-full bg-gray-400 shrink-0"></span>
          <span class="text-xs font-black text-gray-500 uppercase tracking-wide">Sin cambio</span>
          <span class="ml-auto text-xs font-bold text-gray-400">{{ secIguales.length }}</span>
        </summary>
        <pre class="bg-white text-gray-500 font-mono text-[11.5px] leading-[1.6] px-3 py-2.5 overflow-x-auto whitespace-pre">{{ secIguales.join('\n') }}</pre>
      </details>

      <!-- Sin datos -->
      <div v-if="!comparacion.length" class="text-center py-8 text-sm text-gray-400 font-medium">
        No hay datos para comparar.
      </div>

      <!-- WhatsApp -->
      <button
        v-if="comparacion.length"
        @click="compartirWhatsApp"
        class="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-black text-white bg-green-600 hover:bg-green-700 transition-all shadow-md active:scale-[0.98] mt-3"
      >
        <Share2 class="w-4 h-4" />
        Compartir evaluación por WhatsApp
      </button>
    </template>
  </div>
</template>
