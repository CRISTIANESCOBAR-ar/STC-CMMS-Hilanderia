<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { getAuth } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userProfile, userRole } from '../services/authService';
import { getTurnoLabel } from '../constants/organization';
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
  ['supervisor', 'supervisor_mecanico', 'admin', 'gerente_produccion', 'jefe_produccion'].includes(userRole.value)
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

              <!-- Estado rondas -->
              <div>
                <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Rondas</p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="(label, key) in {
                      ronda_1: 'R1 Roturas',
                      ronda_2: 'R2 Paros',
                      ronda_3: 'R3 Trama',
                      ronda_4: 'R4 Paros',
                      ronda_5: 'R5 Paros',
                      ronda_6: 'R6 Roturas',
                      ronda_7: 'R7 Eval.',
                    }"
                    :key="key"
                    class="text-sm font-black px-2.5 py-1 rounded-full"
                    :class="p.rondas?.[key]?.completada
                      ? 'bg-emerald-100 text-emerald-700'
                      : p.rondas?.[key]?.datos || p.rondas?.[key]?.horaInicio
                        ? 'bg-blue-100 text-blue-600'
                        : 'bg-gray-100 text-gray-400'"
                  >
                    {{ p.rondas?.[key]?.completada ? '✓' : '·' }} {{ label }}
                    <span v-if="p.rondas?.[key]?.hora" class="font-black opacity-80">
                      {{ horaRonda(p.rondas[key].hora) }}
                    </span>
                  </span>
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
