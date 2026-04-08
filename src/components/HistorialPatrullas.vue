<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { getAuth } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userProfile, userRole } from '../services/authService';
import { getTurnoLabel } from '../constants/organization';
import { ESTADOS_TELAR, DEFECTOS_TRAMA } from '../constants/organization';
import { cargarHistorialPatrullas } from '../services/patrullaService';
import {
  ArrowLeft, Loader2, ChevronDown, ChevronUp,
  AlertTriangle, History, RefreshCw, User
} from 'lucide-vue-next';

const router = useRouter();

const cargando    = ref(true);
const patrullas   = ref([]);
const telares     = ref([]);
const abierta     = ref(null);
const soloPropias = ref(true);

const esSupervisorOAdmin = computed(() =>
  ['supervisor', 'supervisor_mecanico', 'admin', 'gerente_produccion', 'jefe_produccion']
    .includes(userProfile.value?.role || userRole.value)
);

// ── Helpers de nombre de máquina ───────────────────────────────────
function resolverTelar(maqId) {
  return telares.value.find(t => t.id === maqId) || null;
}

function getModelo(t, fallbackId) {
  const raw = t
    ? String(t.nombre || t.maquina || t.id || '')
    : String(fallbackId || '');
  const match = raw.match(/^([A-Za-záéíóúÁÉÍÓÚñÑ\s]+?)\s+\d/);
  return match ? match[1].trim() : 'Sin modelo';
}

function getNumero(t, fallbackId) {
  const raw = t
    ? String(t.nombre || t.maquina || t.id || '')
    : String(fallbackId || '');
  const nums = raw.replace(/[^0-9]/g, '');
  const n = parseInt(nums.slice(-3), 10);
  return isNaN(n) ? 0 : n;
}

// ── Evaluación (misma lógica que SeguimientoRoturas) ──────────────────
const TOLS_ABS = 0.5;
const TOLS_PCT = 20;

function evaluarCambio(r1, r6) {
  if (r1 == null || r6 == null) return null;
  const diff = r6 - r1;
  const absDiff = Math.abs(diff);
  if (absDiff <= TOLS_ABS) return 'igual';
  if (r1 === 0) return diff > 0 ? 'peor' : 'mejor';
  const pct = (absDiff / Math.abs(r1)) * 100;
  if (pct <= TOLS_PCT) return diff > 0 ? 'leve' : 'mejor';
  return diff < 0 ? 'mejor' : 'peor';
}

// ── Formateo monoespaciado para alineación perfecta ──────────────────
function pN(n) {
  return n != null ? n.toFixed(1).padStart(5) : '     ';
}
function pD(r1, r6) {
  if (r1 == null || r6 == null) return '        ';
  const d = r6 - r1;
  return `(${(d > 0 ? '+' : '') + d.toFixed(1)})`.padStart(8);
}
function lineaDetalle(num, tipo, r1, r6) {
  const numStr  = String(num).padStart(3);
  const tipoStr = tipo === 'URD' ? 'Rot.URD' : 'Rot.TRA';
  return `${numStr} ${tipoStr}: ${pN(r1)} → ${pN(r6)} ${pD(r1, r6)}`;
}

// ── Resumen agrupado por modelo ─────────────────────────────────────
function resumenRoturas(patrulla) {
  const d1 = patrulla.rondas?.ronda_1?.datos || {};
  const d6 = patrulla.rondas?.ronda_6?.datos || {};
  if (!Object.keys(d1).length || !Object.keys(d6).length) return null;

  let mejoras = 0, empeoramientos = 0, leves = 0, iguales = 0;
  const items = [];
  const allIds = new Set([...Object.keys(d1), ...Object.keys(d6)]);

  for (const id of allIds) {
    const telar  = resolverTelar(id);
    const modelo = getModelo(telar, id);
    const num    = getNumero(telar, id);
    const r1U = d1[id]?.roU != null ? parseFloat(d1[id].roU) : null;
    const r1T = d1[id]?.roT != null ? parseFloat(d1[id].roT) : null;
    const r6U = d6[id]?.roU != null ? parseFloat(d6[id].roU) : null;
    const r6T = d6[id]?.roT != null ? parseFloat(d6[id].roT) : null;
    const evalU = evaluarCambio(r1U, r6U);
    const evalT = evaluarCambio(r1T, r6T);
    for (const e of [evalU, evalT]) {
      if (e === 'mejor') mejoras++;
      else if (e === 'peor') empeoramientos++;
      else if (e === 'leve') leves++;
      else if (e === 'igual') iguales++;
    }
    if (evalU === 'peor' || evalU === 'leve')
      items.push({ modelo, num, tipo: 'URD', r1: r1U, r6: r6U, eval: evalU });
    if (evalT === 'peor' || evalT === 'leve')
      items.push({ modelo, num, tipo: 'TRA', r1: r1T, r6: r6T, eval: evalT });
    if (evalU === 'mejor')
      items.push({ modelo, num, tipo: 'URD', r1: r1U, r6: r6U, eval: evalU });
    if (evalT === 'mejor')
      items.push({ modelo, num, tipo: 'TRA', r1: r1T, r6: r6T, eval: evalT });
  }

  const modelos = [...new Set(items.map(i => i.modelo))].sort();
  const porModelo = modelos.map(modelo => {
    const mis = items.filter(i => i.modelo === modelo);
    const ordenFn = (a, b) => a.num - b.num;
    const peores  = mis.filter(i => i.eval === 'peor' || i.eval === 'leve').sort(ordenFn);
    const mejores = mis.filter(i => i.eval === 'mejor').sort(ordenFn);
    return {
      modelo,
      lineasPeores:  peores.map(d => ({ text: lineaDetalle(d.num, d.tipo, d.r1, d.r6), esTrama: d.tipo === 'TRA' })),
      lineasMejores: mejores.map(d => ({ text: lineaDetalle(d.num, d.tipo, d.r1, d.r6), esTrama: d.tipo === 'TRA' })),
    };
  }).filter(g => g.lineasPeores.length || g.lineasMejores.length);

  return { mejoras, empeoramientos, leves, iguales, porModelo };
}

// ── Agrupación por fecha ─────────────────────────────────────────
const grupos = computed(() => {
  const map = {};
  for (const p of patrullas.value) {
    const f = p.fecha || 'Sin fecha';
    if (!map[f]) map[f] = [];
    map[f].push(p);
  }
  // Ordenar fechas desc
  return Object.entries(map)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([fecha, items]) => ({
      fecha,
      label: formatearFecha(fecha),
      items: items.sort((a, b) => {
        const ord = { A: 0, B: 1, C: 2 };
        return (ord[a.turno] ?? 9) - (ord[b.turno] ?? 9);
      }),
    }));
});

function formatearFecha(fechaStr) {
  if (!fechaStr || fechaStr === 'Sin fecha') return fechaStr;
  const [y, m, d] = fechaStr.split('-');
  return `${d}/${m}/${y}`;
}

function contarRondasCompletadas(p) {
  if (!p.rondas) return 0;
  return Object.values(p.rondas).filter(r => r?.completada).length;
}

function horaRonda(isoStr) {
  if (!isoStr) return null;
  return new Date(isoStr).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

// ── Toggle expansión ─────────────────────────────────────────────
function togglePatrulla(id) {
  abierta.value = abierta.value === id ? null : id;
  if (rondaDetalle.value?.patId !== id) rondaDetalle.value = null;
}

// ── Timeline de rondas ───────────────────────────────────────────
const RONDAS_DEF = [
  { key: 'ronda_1', num: 1, label: 'Roturas',        tipo: 'roturas'      },
  { key: 'ronda_2', num: 2, label: 'Paros/Defectos', tipo: 'paro_defecto' },
  { key: 'ronda_3', num: 3, label: 'Trama Negra',    tipo: 'trama_negra'  },
  { key: 'ronda_4', num: 4, label: 'Paros/Defectos', tipo: 'paro_defecto' },
  { key: 'ronda_5', num: 5, label: 'Paros/Defectos', tipo: 'paro_defecto' },
  { key: 'ronda_6', num: 6, label: 'Roturas',        tipo: 'roturas'      },
  { key: 'ronda_7', num: 7, label: 'Evaluación',     tipo: 'evaluacion'   },
];

const rondaDetalle = ref(null); // { patId, key }
function toggleRondaDetalle(patId, key) {
  if (rondaDetalle.value?.patId === patId && rondaDetalle.value?.key === key) {
    rondaDetalle.value = null;
  } else {
    rondaDetalle.value = { patId, key };
  }
}

function calcDuracion(inicio, fin) {
  if (!inicio || !fin) return null;
  const mins = Math.round((new Date(fin) - new Date(inicio)) / 60000);
  if (mins < 0 || isNaN(mins)) return null;
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function horaInicioAprox(rondaData) {
  if (!rondaData) return null;
  if (rondaData.horaInicio) return rondaData.horaInicio;
  if (!rondaData.datos) return null;
  const hs = Object.values(rondaData.datos).map(d => d?.hora).filter(Boolean).sort();
  return hs[0] || null;
}

function telarNombre(id) {
  const t = resolverTelar(id);
  return t ? (t.nombre || t.maquina || id) : id;
}

function estadoBgClass(estadoId) {
  const map = {
    trabajando:         'bg-emerald-100 text-emerald-700',
    paro_mecanico:      'bg-red-100 text-red-700',
    paro_electrico:     'bg-amber-100 text-amber-700',
    cambio_articulo:    'bg-blue-100 text-blue-700',
    sin_urdido:         'bg-purple-100 text-purple-700',
    paro_calidad:       'bg-rose-100 text-rose-700',
    mantenimiento:      'bg-cyan-100 text-cyan-700',
    otro:               'bg-gray-100 text-gray-600',
  };
  return map[estadoId] || 'bg-gray-100 text-gray-600';
}

function estadoLbl(estadoId) {
  return ESTADOS_TELAR.find(e => e.id === estadoId)?.label || estadoId || '—';
}

function defectoLabel(id) {
  return DEFECTOS_TRAMA.find(d => d.id === id)?.label || id;
}

function buildDetalleRonda(patrulla, rondaKey) {
  const r = patrulla.rondas?.[rondaKey];
  if (!r?.datos) return null;
  const tipo = r.tipo;
  const datos = r.datos;

  if (tipo === 'roturas') {
    return {
      tipo,
      items: Object.entries(datos).map(([id, d]) => ({
        id, nombre: telarNombre(id), num: getNumero(resolverTelar(id), id),
        roU: d.roU != null ? parseFloat(d.roU) : null,
        roT: d.roT != null ? parseFloat(d.roT) : null,
        hora: d.hora,
      })).sort((a, b) => a.num - b.num),
    };
  }

  if (tipo === 'paro_defecto') {
    return {
      tipo,
      rutaNombre: r.rutaNombre || null,
      items: Object.entries(datos)
        .map(([id, d]) => ({
          id, nombre: telarNombre(id), num: getNumero(resolverTelar(id), id),
          estado: d.estado, observacion: d.observacion,
          defectoCalidad: d.defectoCalidad, intervencion: d.intervencion, hora: d.hora,
        }))
        .filter(i => i.estado)
        .sort((a, b) => a.hora && b.hora ? a.hora.localeCompare(b.hora) : a.num - b.num),
    };
  }

  if (tipo === 'trama_negra') {
    return {
      tipo,
      items: Object.entries(datos).map(([id, d]) => ({
        id, nombre: telarNombre(id), num: getNumero(resolverTelar(id), id),
        sinDefecto: d.sinDefecto, defectos: d.defectos || [],
      })).sort((a, b) => a.num - b.num),
    };
  }

  return null;
}

// ── Carga ────────────────────────────────────────────────────────
async function cargar() {
  cargando.value = true;
  try {
    const uid = getAuth().currentUser?.uid;
    const inspectorId = (esSupervisorOAdmin.value && !soloPropias.value) ? null : uid;
    patrullas.value = await cargarHistorialPatrullas(inspectorId, 50);
  } catch (e) {
    console.error('Error cargando historial:', e);
  } finally {
    cargando.value = false;
  }
}

onMounted(async () => {
  try {
    const snap = await getDocs(collection(db, 'maquinas'));
    telares.value = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(m => String(m.tipo || '').toUpperCase() === 'TELAR' && (m.activo ?? true));
  } catch (e) {
    console.error('Error cargando telares:', e);
  }
  await cargar();
});
</script>

<template>
  <div class="h-[calc(100vh-110px)] bg-gray-50 flex flex-col overflow-hidden">

    <!-- Header -->
    <div class="shrink-0 max-w-lg mx-auto w-full px-4 pt-3 pb-2 bg-gray-50">
      <div class="flex items-center gap-3 px-1">
        <button @click="router.push('/patrulla')" class="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-all">
          <ArrowLeft class="w-5 h-5 text-gray-600" />
        </button>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-black text-gray-800 flex items-center gap-1.5">
            <History class="w-4 h-4 text-indigo-500" />
            Historial de Patrullas
          </p>
          <p class="text-[10px] text-gray-400 font-medium">Últimas 50 patrullas</p>
        </div>
        <button @click="cargar" :disabled="cargando" class="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-all disabled:opacity-40">
          <RefreshCw class="w-4 h-4 text-gray-600" :class="cargando ? 'animate-spin' : ''" />
        </button>
      </div>

      <!-- Toggle propias / todas (solo supervisores) -->
      <div v-if="esSupervisorOAdmin" class="mt-2 flex gap-1.5 bg-gray-100 rounded-lg p-1">
        <button
          @click="soloPropias = true; cargar()"
          class="flex-1 py-1.5 rounded-md text-[11px] font-black transition-all"
          :class="soloPropias ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500'"
        >Mis patrullas</button>
        <button
          @click="soloPropias = false; cargar()"
          class="flex-1 py-1.5 rounded-md text-[11px] font-black transition-all"
          :class="!soloPropias ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500'"
        >Todas</button>
      </div>
    </div>

    <!-- Contenido -->
    <main class="flex-1 max-w-lg mx-auto w-full px-3 pb-4 overflow-y-auto space-y-4">

      <!-- Loading -->
      <div v-if="cargando" class="flex items-center justify-center py-16">
        <Loader2 class="w-6 h-6 text-indigo-400 animate-spin" />
      </div>

      <!-- Sin resultados -->
      <div v-else-if="patrullas.length === 0" class="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
        <History class="w-10 h-10 opacity-30" />
        <p class="text-sm font-bold">No hay patrullas registradas</p>
      </div>

      <!-- Grupos por fecha -->
      <template v-else>
        <div v-for="grupo in grupos" :key="grupo.fecha" class="space-y-2">
          <!-- Cabecera de fecha -->
          <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1 pt-2">{{ grupo.label }}</p>

          <!-- Card por patrulla -->
          <div
            v-for="p in grupo.items"
            :key="p.id"
            class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
          >
            <!-- Fila principal (siempre visible) -->
            <button
              @click="togglePatrulla(p.id)"
              class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-all"
            >
              <!-- Turno pill -->
              <span class="shrink-0 text-[10px] font-black px-2 py-1 rounded-md"
                :class="{
                  'bg-amber-100 text-amber-700': p.turno === 'A',
                  'bg-blue-100 text-blue-700': p.turno === 'B',
                  'bg-indigo-100 text-indigo-700': p.turno === 'C',
                  'bg-gray-100 text-gray-500': !p.turno,
                }"
              >{{ getTurnoLabel(p.turno) }}</span>

              <!-- Inspector + rondas -->
              <div class="flex-1 min-w-0">
                <p class="text-xs font-black text-gray-800 truncate flex items-center gap-1">
                  <User class="w-3 h-3 text-gray-400 shrink-0" />
                  {{ (p.inspectorNombre && p.inspectorNombre !== 'Inspector') ? p.inspectorNombre : (p.inspectorEmail || p.inspectorNombre || 'Sin nombre') }}
                </p>
                <p class="text-[10px] text-gray-400 font-medium mt-0.5">
                  {{ contarRondasCompletadas(p) }}/7 rondas completadas
                </p>
              </div>

              <!-- Resumen evaluación (si hay) -->
              <div v-if="p.rondas?.ronda_1?.completada && p.rondas?.ronda_6?.completada"
                   class="shrink-0 flex items-center gap-1 text-[10px] font-black">
                <span class="text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                  ✓ {{ resumenRoturas(p)?.mejoras ?? 0 }}↑
                </span>
                <span class="text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                  {{ resumenRoturas(p)?.empeoramientos ?? 0 }}↓
                </span>
              </div>

              <!-- Chevron -->
              <ChevronDown v-if="abierta !== p.id" class="w-4 h-4 text-gray-400 shrink-0" />
              <ChevronUp v-else class="w-4 h-4 text-gray-400 shrink-0" />
            </button>

            <!-- Detalle expandido -->
            <div v-if="abierta === p.id" class="border-t border-gray-100 bg-gray-50/60 px-4 py-3 space-y-3">

              <!-- Timeline de rondas con tiempos y drill-down -->
              <div>
                <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">Rondas</p>
                <div class="space-y-0.5">
                  <div v-for="rDef in RONDAS_DEF" :key="rDef.key">
                    <!-- Fila de ronda -->
                    <div
                      class="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                      :class="p.rondas?.[rDef.key]?.completada
                        ? 'bg-emerald-50'
                        : (p.rondas?.[rDef.key]?.datos || p.rondas?.[rDef.key]?.horaInicio)
                          ? 'bg-blue-50' : ''"
                    >
                      <!-- Dot estado -->
                      <div class="w-2 h-2 rounded-full shrink-0"
                           :class="p.rondas?.[rDef.key]?.completada
                             ? 'bg-emerald-500'
                             : (p.rondas?.[rDef.key]?.datos || p.rondas?.[rDef.key]?.horaInicio)
                               ? 'bg-blue-400' : 'bg-gray-300'">
                      </div>
                      <!-- Número + nombre -->
                      <span class="text-[9px] font-black text-gray-400 w-5 shrink-0">R{{ rDef.num }}</span>
                      <span class="text-[11px] font-bold flex-1 min-w-0 truncate"
                            :class="p.rondas?.[rDef.key]?.completada
                              ? 'text-emerald-700'
                              : (p.rondas?.[rDef.key]?.datos || p.rondas?.[rDef.key]?.horaInicio)
                                ? 'text-blue-600' : 'text-gray-400'">
                        {{ rDef.label }}
                      </span>
                      <!-- Timing inicio → fin + duración -->
                      <div v-if="p.rondas?.[rDef.key]?.completada || p.rondas?.[rDef.key]?.horaInicio"
                           class="shrink-0 flex items-center gap-1 text-[9px]">
                        <span v-if="horaInicioAprox(p.rondas?.[rDef.key])" class="text-gray-500">
                          {{ horaRonda(horaInicioAprox(p.rondas[rDef.key])) }}
                        </span>
                        <span v-if="horaInicioAprox(p.rondas?.[rDef.key]) && p.rondas?.[rDef.key]?.hora"
                              class="text-gray-400">→</span>
                        <span v-if="p.rondas?.[rDef.key]?.hora" class="font-black text-emerald-600">
                          {{ horaRonda(p.rondas[rDef.key].hora) }}
                        </span>
                        <span v-if="p.rondas?.[rDef.key]?.completada && calcDuracion(horaInicioAprox(p.rondas[rDef.key]), p.rondas[rDef.key].hora)"
                              class="ml-0.5 bg-emerald-100 text-emerald-700 font-black rounded px-1 text-[8px]">
                          {{ calcDuracion(horaInicioAprox(p.rondas[rDef.key]), p.rondas[rDef.key].hora) }}
                        </span>
                        <span v-else-if="!p.rondas?.[rDef.key]?.completada && p.rondas?.[rDef.key]?.horaInicio"
                              class="text-[9px] text-blue-500 font-bold">en curso</span>
                      </div>
                      <!-- Botón Ver datos -->
                      <button
                        v-if="(p.rondas?.[rDef.key]?.completada || p.rondas?.[rDef.key]?.datos) && rDef.tipo !== 'evaluacion'"
                        @click.stop="toggleRondaDetalle(p.id, rDef.key)"
                        class="shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded transition-all"
                        :class="rondaDetalle?.patId === p.id && rondaDetalle?.key === rDef.key
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white border border-gray-200 text-gray-500 hover:text-indigo-600'"
                      >
                        {{ rondaDetalle?.patId === p.id && rondaDetalle?.key === rDef.key ? '✕' : 'Ver ›' }}
                      </button>
                    </div>

                    <!-- Panel de detalle inline -->
                    <div v-if="rondaDetalle?.patId === p.id && rondaDetalle?.key === rDef.key"
                         class="mx-1 mb-1 rounded-lg border border-indigo-100 bg-white overflow-hidden">
                      <template v-for="det in [buildDetalleRonda(p, rDef.key)]" :key="rDef.key + '_det'">
                        <div v-if="!det" class="px-3 py-3 text-[10px] text-gray-400 text-center italic">
                          Sin datos registrados
                        </div>

                        <!-- Roturas -->
                        <template v-else-if="det.tipo === 'roturas'">
                          <div class="px-3 py-2">
                            <div class="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-[9px] font-black text-gray-400 uppercase border-b border-gray-100 pb-1 mb-1">
                              <span>Telar</span><span class="text-right">Rot.Urd</span><span class="text-right">Rot.Trama</span><span class="text-right">Hora</span>
                            </div>
                            <div v-for="item in det.items" :key="item.id"
                                 class="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 py-0.5 text-[10px] border-b border-gray-50 last:border-0">
                              <span class="font-bold text-gray-700 truncate">{{ item.nombre }}</span>
                              <span class="font-black text-right"
                                    :class="item.roU != null && item.roU >= 2 ? 'text-red-600' : 'text-gray-600'">
                                {{ item.roU?.toFixed(1) ?? '—' }}
                              </span>
                              <span class="font-black text-right"
                                    :class="item.roT != null && item.roT >= 3 ? 'text-red-600' : 'text-gray-600'">
                                {{ item.roT?.toFixed(1) ?? '—' }}
                              </span>
                              <span class="text-gray-400 text-right text-[9px]">{{ item.hora ? horaRonda(item.hora) : '—' }}</span>
                            </div>
                          </div>
                        </template>

                        <!-- Paro / Defecto -->
                        <template v-else-if="det.tipo === 'paro_defecto'">
                          <div class="px-3 py-2">
                            <div v-if="det.rutaNombre" class="text-[9px] font-black text-indigo-600 mb-2">
                              📍 Ruta: {{ det.rutaNombre }}
                            </div>
                            <div v-for="(item, idx) in det.items" :key="item.id"
                                 class="flex items-start gap-2 py-1 border-b border-gray-50 last:border-0">
                              <span class="text-[9px] text-gray-400 font-bold w-4 shrink-0 mt-0.5">{{ idx + 1 }}</span>
                              <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-1.5 flex-wrap">
                                  <span class="text-[10px] font-black text-gray-700">{{ item.nombre }}</span>
                                  <span class="text-[9px] font-black px-1.5 py-0.5 rounded-full" :class="estadoBgClass(item.estado)">
                                    {{ estadoLbl(item.estado) }}
                                  </span>
                                  <span v-if="item.defectoCalidad" class="text-[9px] bg-rose-50 text-rose-600 font-bold px-1.5 py-0.5 rounded-full border border-rose-200">
                                    {{ defectoLabel(item.defectoCalidad) }}
                                  </span>
                                  <span v-if="item.intervencion" class="text-[9px] bg-orange-50 text-orange-600 font-black px-1.5 py-0.5 rounded-full border border-orange-200">
                                    🔧 Interv.
                                  </span>
                                </div>
                                <p v-if="item.observacion" class="text-[9px] text-gray-500 mt-0.5 italic">{{ item.observacion }}</p>
                              </div>
                              <span v-if="item.hora" class="text-[8px] text-gray-400 shrink-0 mt-0.5">{{ horaRonda(item.hora) }}</span>
                            </div>
                            <div v-if="!det.items.length" class="text-[10px] text-gray-400 italic text-center py-2">
                              Ningún telar registrado en esta ronda
                            </div>
                          </div>
                        </template>

                        <!-- Trama Negra -->
                        <template v-else-if="det.tipo === 'trama_negra'">
                          <div class="px-3 py-2 space-y-0.5">
                            <div v-for="item in det.items" :key="item.id"
                                 class="flex items-center gap-2 py-0.5 border-b border-gray-50 last:border-0">
                              <span class="text-[10px] font-bold text-gray-700 flex-1">{{ item.nombre }}</span>
                              <span v-if="item.sinDefecto" class="text-[9px] font-black text-emerald-600">✓ Sin defecto</span>
                              <span v-else-if="item.defectos.length" class="text-[9px] font-bold text-rose-600">
                                {{ item.defectos.map(d => defectoLabel(d)).join(', ') }}
                              </span>
                              <span v-else class="text-[9px] text-gray-400">—</span>
                            </div>
                          </div>
                        </template>
                      </template>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Evaluación Roturas (R1 vs R6) -->
              <template v-if="p.rondas?.ronda_1?.completada && p.rondas?.ronda_6?.completada">
                <div>
                  <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Evaluación Roturas (R1 → R6)</p>

                  <!-- Resumen contadores -->
                  <div class="flex gap-2 mb-2">
                    <div class="flex-1 bg-emerald-50 border border-emerald-200 rounded-lg py-1.5 text-center">
                      <p class="text-base font-black text-emerald-700">{{ resumenRoturas(p)?.mejoras ?? 0 }}</p>
                      <p class="text-[8px] font-bold text-emerald-500 uppercase">Mejoras</p>
                    </div>
                    <div class="flex-1 bg-red-50 border border-red-200 rounded-lg py-1.5 text-center">
                      <p class="text-base font-black text-red-700">{{ resumenRoturas(p)?.empeoramientos ?? 0 }}</p>
                      <p class="text-[8px] font-bold text-red-500 uppercase">Empeoró</p>
                    </div>
                    <div class="flex-1 bg-amber-50 border border-amber-200 rounded-lg py-1.5 text-center">
                      <p class="text-base font-black text-amber-700">{{ resumenRoturas(p)?.leves ?? 0 }}</p>
                      <p class="text-[8px] font-bold text-amber-500 uppercase">Leves</p>
                    </div>
                    <div class="flex-1 bg-gray-50 border border-gray-200 rounded-lg py-1.5 text-center">
                      <p class="text-base font-black text-gray-600">{{ resumenRoturas(p)?.iguales ?? 0 }}</p>
                      <p class="text-[8px] font-bold text-gray-400 uppercase">Igual</p>
                    </div>
                  </div>

                  <!-- Detalles agrupados por modelo -->
                  <template v-for="grupo in (resumenRoturas(p)?.porModelo || [])" :key="grupo.modelo">
                    <p class="text-[12px] font-black text-gray-700 mt-2 mb-1">{{ grupo.modelo }}</p>
                    <div v-if="grupo.lineasPeores.length" class="mb-1.5">
                      <p class="text-[9px] font-bold text-red-500 mb-0.5">🔴 Empeoramientos</p>
                      <div class="font-mono text-sm leading-relaxed bg-red-50 border border-red-100 rounded-lg px-2.5 py-2 overflow-x-auto">
                        <div
                          v-for="(linea, li) in grupo.lineasPeores" :key="li"
                          :class="linea.esTrama ? 'font-black text-red-900' : 'font-bold text-red-700'"
                          class="whitespace-pre"
                        >{{ linea.text }}</div>
                      </div>
                    </div>
                    <div v-if="grupo.lineasMejores.length">
                      <p class="text-[9px] font-bold text-emerald-500 mb-0.5">🟢 Mejoras</p>
                      <div class="font-mono text-sm leading-relaxed bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-2 overflow-x-auto">
                        <div
                          v-for="(linea, li) in grupo.lineasMejores" :key="li"
                          :class="linea.esTrama ? 'font-black text-emerald-900' : 'font-bold text-emerald-700'"
                          class="whitespace-pre"
                        >{{ linea.text }}</div>
                      </div>
                    </div>
                  </template>
                </div>
              </template>

              <!-- Sin evaluación -->
              <div v-else-if="!p.rondas?.ronda_1?.completada || !p.rondas?.ronda_6?.completada"
                   class="flex items-center gap-2 text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                <AlertTriangle class="w-3.5 h-3.5 shrink-0" />
                <span>
                  {{ !p.rondas?.ronda_1?.completada ? 'Ronda 1 pendiente' : 'Ronda 6 pendiente' }}
                  — evaluación incompleta
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>
