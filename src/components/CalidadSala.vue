<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userProfile } from '../services/authService';
import { normalizeSectorValue, DEFAULT_SECTOR, getTurnoActual, getTurnoLabel } from '../constants/organization';
import { loadPatrullaConfig, cargarPatrullasTurnoActual } from '../services/patrullaService';
import { Loader2, RefreshCw, Share2, AlertTriangle, ChevronDown, ChevronUp, User, Clock } from 'lucide-vue-next';

// ── Estado ───────────────────────────────────────────────────────
const telares = ref([]);
const config = ref({ umbralRoturaU: 2, umbralRoturaT: 3 });
const patrullas = ref([]);
const cargando = ref(true);
const recargando = ref(false);
const turnoActual = ref(getTurnoActual());
const ultimaActualizacion = ref(null);
const alertasExpandidas = ref(new Set());
const nombresInspectores = ref({});
let _autoRefresh = null;

// Tolerancia (misma lógica que SeguimientoRoturas)
const TOLERANCIA_ABS = 0.5;
const TOLERANCIA_PCT = 20;

// ── Computed ─────────────────────────────────────────────────────
const sectoresUsuario = computed(() =>
  Array.isArray(userProfile.value?.sectoresAsignados)
    ? userProfile.value.sectoresAsignados
    : [normalizeSectorValue(userProfile.value?.sectorDefault || DEFAULT_SECTOR)]
);

// Telares indexados por ID para lookup rápido
const telaresMap = computed(() => {
  const map = {};
  for (const t of telares.value) map[t.id] = t;
  return map;
});

// Procesar cada patrulla como un bloque de evaluación
const patrullasConEval = computed(() => {
  return patrullas.value.map(p => {
    const r1 = p.rondas?.ronda_1;
    const r6 = p.rondas?.ronda_6;
    const tieneR1 = r1?.completada;
    const tieneR6 = r6?.completada;
    const r1EnProgreso = r1?.datos && !r1?.completada;
    const r6EnProgreso = r6?.datos && !r6?.completada;

    // Contar telares con datos
    const telaresR1 = (tieneR1 || r1EnProgreso) ? Object.keys(r1.datos || {}).length : 0;
    const telaresR6 = (tieneR6 || r6EnProgreso) ? Object.keys(r6.datos || {}).length : 0;

    // Alertas sobre umbral (solo de la última ronda completada)
    const ultimaRonda = tieneR6 ? r6 : (tieneR1 ? r1 : null);
    const alertas = [];
    if (ultimaRonda?.datos) {
      for (const [maqId, vals] of Object.entries(ultimaRonda.datos)) {
        const t = telaresMap.value[maqId];
        if (!t) continue;
        const roU = parseFloat(vals.roU);
        const roT = parseFloat(vals.roT);
        if (!isNaN(roU) && roU > config.value.umbralRoturaU) alertas.push({ telar: t, campo: 'Ro.U', valor: roU });
        if (!isNaN(roT) && roT > config.value.umbralRoturaT) alertas.push({ telar: t, campo: 'Ro.T', valor: roT });
      }
    }

    // Evaluación comparativa si ambas rondas completadas
    let evaluacion = null;
    if (tieneR1 && tieneR6) {
      const d1 = r1.datos || {};
      const d6 = r6.datos || {};
      const allIds = new Set([...Object.keys(d1), ...Object.keys(d6)]);
      let mejoras = 0, empeoramientos = 0, leves = 0, iguales = 0;
      const detalles = [];

      for (const maqId of allIds) {
        const t = telaresMap.value[maqId];
        if (!t) continue;
        const r1U = d1[maqId]?.roU != null ? parseFloat(d1[maqId].roU) : null;
        const r1T = d1[maqId]?.roT != null ? parseFloat(d1[maqId].roT) : null;
        const r6U = d6[maqId]?.roU != null ? parseFloat(d6[maqId].roU) : null;
        const r6T = d6[maqId]?.roT != null ? parseFloat(d6[maqId].roT) : null;
        const evalU = evaluarCambio(r1U, r6U);
        const evalT = evaluarCambio(r1T, r6T);

        for (const e of [evalU, evalT]) {
          if (e === 'mejor') mejoras++;
          else if (e === 'peor') empeoramientos++;
          else if (e === 'leve') leves++;
          else if (e === 'igual') iguales++;
        }

        if (evalU === 'peor' || evalT === 'peor') {
          detalles.push({ telar: t, r1U, r1T, r6U, r6T, evalU, evalT });
        }
      }

      evaluacion = { mejoras, empeoramientos, leves, iguales, detalles };
    }

    return {
      ...p,
      tieneR1, tieneR6,
      r1EnProgreso, r6EnProgreso,
      telaresR1, telaresR6,
      horaR1: tieneR1 ? formatHora(r1.hora) : null,
      horaR6: tieneR6 ? formatHora(r6.hora) : null,
      alertas,
      evaluacion,
    };
  });
});

// Resumen global
const resumenGlobal = computed(() => {
  let totalAlertas = 0, mejoras = 0, empeoramientos = 0, leves = 0, iguales = 0;
  for (const p of patrullasConEval.value) {
    totalAlertas += p.alertas.length;
    if (p.evaluacion) {
      mejoras += p.evaluacion.mejoras;
      empeoramientos += p.evaluacion.empeoramientos;
      leves += p.evaluacion.leves;
      iguales += p.evaluacion.iguales;
    }
  }
  return { totalAlertas, mejoras, empeoramientos, leves, iguales, patrullas: patrullas.value.length };
});

const hayEvaluacion = computed(() => patrullasConEval.value.some(p => p.evaluacion));

// ── Funciones ────────────────────────────────────────────────────
function evaluarCambio(valR1, valR6) {
  if (valR1 == null || valR6 == null) return null;
  if (isNaN(valR1) || isNaN(valR6)) return null;
  const diff = valR6 - valR1;
  const absDiff = Math.abs(diff);
  if (absDiff <= TOLERANCIA_ABS) return 'igual';
  if (valR1 === 0) return diff > 0 ? 'peor' : 'mejor';
  const pctCambio = (absDiff / Math.abs(valR1)) * 100;
  if (pctCambio <= TOLERANCIA_PCT) return diff > 0 ? 'leve' : 'mejor';
  return diff < 0 ? 'mejor' : 'peor';
}

function formatHora(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function nombreCorto(t) {
  return (t.nombre || t.id || '').replace(/^(TELAR|Telar|telar)\s*/i, '');
}

function colorBadge(eval_) {
  if (eval_ === 'mejor') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (eval_ === 'peor') return 'bg-red-100 text-red-700 border-red-200';
  if (eval_ === 'leve') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-gray-100 text-gray-500 border-gray-200';
}

function toggleExpandAlertas(patrullaId) {
  const s = new Set(alertasExpandidas.value);
  s.has(patrullaId) ? s.delete(patrullaId) : s.add(patrullaId);
  alertasExpandidas.value = s;
}

function nombreInspector(p) {
  const info = nombresInspectores.value[p.inspectorUid];
  if (info?.nombre && info.nombre !== 'Inspector') return info.nombre;
  if (info?.email) return info.email.split('@')[0];
  if (p.inspectorNombre && p.inspectorNombre !== 'Inspector') return p.inspectorNombre;
  return p.inspectorUid?.slice(0, 10) || 'Sin nombre';
}

async function cargarNombresInspectores(pts) {
  const uids = [...new Set(pts.map(p => p.inspectorUid).filter(Boolean))];
  const mapa = {};
  await Promise.all(uids.map(async uid => {
    try {
      const snap = await getDoc(doc(db, 'usuarios', uid));
      if (snap.exists()) {
        const d = snap.data();
        mapa[uid] = { nombre: d.nombre || '', email: d.email || '' };
      }
    } catch (_) { /* silenciar */ }
  }));
  nombresInspectores.value = mapa;
}

async function cargarDatos(showSpinner = true) {
  if (showSpinner) recargando.value = true;
  try {
    const [cfg, snap, pts] = await Promise.all([
      loadPatrullaConfig(),
      getDocs(collection(db, 'maquinas')),
      cargarPatrullasTurnoActual(),
    ]);
    config.value = cfg;
    telares.value = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(m =>
      String(m.tipo || '').toUpperCase() === 'TELAR' && (m.activo ?? true)
    );
    patrullas.value = pts;
    await cargarNombresInspectores(pts);
    ultimaActualizacion.value = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) {
    console.error('Error cargando calidad:', e);
  } finally {
    recargando.value = false;
    cargando.value = false;
  }
}

function compartirWhatsApp() {
  const r = resumenGlobal.value;
  let msg = `📊 *CALIDAD DE SALA — ${getTurnoLabel(turnoActual.value)}*\n`;
  msg += `📅 ${new Date().toLocaleDateString('es-AR')} · ${ultimaActualizacion.value}\n\n`;
  msg += `👮 Inspectores activos: ${r.patrullas}\n`;
  msg += `⚠️ Alertas sobre umbral: ${r.totalAlertas}\n\n`;

  if (r.mejoras || r.empeoramientos || r.leves || r.iguales) {
    msg += `📈 *Evaluación general:*\n`;
    msg += `✅ Mejoras: ${r.mejoras} · ❌ Empeoramientos: ${r.empeoramientos}`;
    if (r.leves) msg += ` · ⚠️ Leves: ${r.leves}`;
    msg += ` · ➖ Iguales: ${r.iguales}\n\n`;
  }

  for (const p of patrullasConEval.value) {
    msg += `👤 *${nombreInspector(p)}*\n`;
    if (p.alertas.length) {
      msg += `  ⚠️ ${p.alertas.length} alerta(s): `;
      msg += p.alertas.slice(0, 5).map(a => `${nombreCorto(a.telar)} ${a.campo}:${a.valor}`).join(', ');
      if (p.alertas.length > 5) msg += ` +${p.alertas.length - 5} más`;
      msg += '\n';
    }
    if (p.evaluacion) {
      msg += `  ✅${p.evaluacion.mejoras} ❌${p.evaluacion.empeoramientos} ➖${p.evaluacion.iguales}\n`;
    } else {
      msg += `  R1: ${p.tieneR1 ? '✓' : '—'} · R6: ${p.tieneR6 ? '✓' : '—'}\n`;
    }
    msg += '\n';
  }

  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

// ── Lifecycle ────────────────────────────────────────────────────
onMounted(async () => {
  await cargarDatos(false);
  // Auto-refresh cada 60 segundos
  _autoRefresh = setInterval(() => cargarDatos(false), 60000);
});

onUnmounted(() => {
  if (_autoRefresh) clearInterval(_autoRefresh);
});
</script>

<template>
  <div class="h-[calc(100vh-110px)] bg-gray-50 flex flex-col overflow-hidden">
    <main class="flex-1 max-w-lg mx-auto w-full px-3 pt-3 pb-4 flex flex-col space-y-3 overflow-y-auto">

      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-black text-gray-700">
            {{ getTurnoLabel(turnoActual) }}
            <span v-if="ultimaActualizacion" class="text-gray-400 font-semibold"> · {{ ultimaActualizacion }}</span>
          </p>
        </div>
        <button
          @click="cargarDatos(true)"
          :disabled="recargando"
          class="p-2 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 transition-all active:scale-95"
        >
          <RefreshCw class="w-4 h-4 text-gray-500" :class="recargando ? 'animate-spin' : ''" />
        </button>
      </div>

      <!-- Loading -->
      <div v-if="cargando" class="flex-1 flex items-center justify-center">
        <Loader2 class="w-6 h-6 text-indigo-400 animate-spin" />
      </div>

      <template v-else>
        <!-- Sin patrullas -->
        <div v-if="!patrullas.length" class="flex-1 flex flex-col items-center justify-center text-center space-y-3 py-8">
          <div class="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center">
            <User class="w-7 h-7 text-gray-300" />
          </div>
          <div>
            <p class="text-sm font-bold text-gray-600">Sin patrullas en este turno</p>
            <p class="text-xs text-gray-400 mt-1">Ningún inspector ha iniciado su patrulla aún.</p>
          </div>
        </div>

        <!-- Contenido -->
        <template v-else>
          <!-- Resumen global -->
          <div class="grid grid-cols-2 gap-2">
            <div class="bg-white border border-gray-200 rounded-xl p-3 text-center">
              <p class="text-2xl font-black text-gray-800">{{ resumenGlobal.patrullas }}</p>
              <p class="text-[9px] font-bold text-gray-400 uppercase">Inspector{{ resumenGlobal.patrullas !== 1 ? 'es' : '' }}</p>
            </div>
            <div class="border rounded-xl p-3 text-center"
                 :class="resumenGlobal.totalAlertas ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'">
              <p class="text-2xl font-black" :class="resumenGlobal.totalAlertas ? 'text-red-700' : 'text-emerald-700'">{{ resumenGlobal.totalAlertas }}</p>
              <p class="text-[9px] font-bold uppercase" :class="resumenGlobal.totalAlertas ? 'text-red-500' : 'text-emerald-500'">Alertas</p>
            </div>
          </div>

          <!-- Resumen evaluación global (si hay comparaciones) -->
          <div v-if="hayEvaluacion" class="grid grid-cols-4 gap-1.5">
            <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-center">
              <p class="text-base font-black text-emerald-700">{{ resumenGlobal.mejoras }}</p>
              <p class="text-[8px] font-bold text-emerald-600 uppercase">Mejoras</p>
            </div>
            <div class="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
              <p class="text-base font-black text-red-700">{{ resumenGlobal.empeoramientos }}</p>
              <p class="text-[8px] font-bold text-red-600 uppercase">Peores</p>
            </div>
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
              <p class="text-base font-black text-amber-700">{{ resumenGlobal.leves }}</p>
              <p class="text-[8px] font-bold text-amber-600 uppercase">Leves</p>
            </div>
            <div class="bg-gray-50 border border-gray-200 rounded-lg p-2 text-center">
              <p class="text-base font-black text-gray-600">{{ resumenGlobal.iguales }}</p>
              <p class="text-[8px] font-bold text-gray-500 uppercase">Iguales</p>
            </div>
          </div>

          <!-- Patrullas individuales -->
          <div v-for="p in patrullasConEval" :key="p.id" class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <!-- Header patrulla -->
            <div class="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
              <div class="min-w-0">
                <p class="text-sm font-black text-gray-800 truncate">{{ nombreInspector(p) }}</p>
                <div class="flex items-center gap-2 text-[10px] text-gray-400 font-medium mt-0.5">
                  <span v-if="p.sector" class="uppercase">{{ p.sector }}</span>
                  <span v-if="p.horaR1" class="flex items-center gap-0.5"><Clock class="w-3 h-3" /> R1: {{ p.horaR1 }}</span>
                  <span v-if="p.horaR6">R6: {{ p.horaR6 }}</span>
                </div>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      :class="p.tieneR1 ? 'bg-emerald-100 text-emerald-700' : p.r1EnProgreso ? 'bg-blue-100 text-blue-600 animate-pulse' : 'bg-gray-100 text-gray-400'">
                  R1 {{ p.tieneR1 ? '✓' : p.r1EnProgreso ? `✎ ${p.telaresR1}` : '—' }}
                </span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      :class="p.tieneR6 ? 'bg-emerald-100 text-emerald-700' : p.r6EnProgreso ? 'bg-blue-100 text-blue-600 animate-pulse' : 'bg-gray-100 text-gray-400'">
                  R6 {{ p.tieneR6 ? '✓' : p.r6EnProgreso ? `✎ ${p.telaresR6}` : '—' }}
                </span>
              </div>
            </div>

            <!-- Alertas -->
            <div v-if="p.alertas.length" class="px-3 py-2 bg-red-50/50 border-b border-red-100">
              <p class="text-[10px] font-black text-red-700 flex items-center gap-1 mb-1">
                <AlertTriangle class="w-3 h-3" /> {{ p.alertas.length }} sobre umbral
              </p>
              <div class="flex flex-wrap gap-1">
                <span v-for="a in (alertasExpandidas.has(p.id) ? p.alertas : p.alertas.slice(0, 8))" :key="a.telar.id + a.campo"
                      class="text-[9px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                  {{ nombreCorto(a.telar) }} {{ a.campo }}:{{ a.valor }}
                </span>
                <button v-if="p.alertas.length > 8"
                        @click="toggleExpandAlertas(p.id)"
                        class="text-[9px] font-bold text-red-400 hover:text-red-600 flex items-center gap-0.5 transition-colors">
                  <template v-if="!alertasExpandidas.has(p.id)">+{{ p.alertas.length - 8 }} más <ChevronDown class="w-3 h-3" /></template>
                  <template v-else>Colapsar <ChevronUp class="w-3 h-3" /></template>
                </button>
              </div>
            </div>

            <!-- Evaluación resumida -->
            <div v-if="p.evaluacion" class="px-3 py-2">
              <div class="flex items-center gap-2 text-[10px] font-bold">
                <span class="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">✅ {{ p.evaluacion.mejoras }}</span>
                <span class="text-red-700 bg-red-50 px-1.5 py-0.5 rounded">❌ {{ p.evaluacion.empeoramientos }}</span>
                <span v-if="p.evaluacion.leves" class="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">⚠️ {{ p.evaluacion.leves }}</span>
                <span class="text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">➖ {{ p.evaluacion.iguales }}</span>
              </div>

              <!-- Detalle empeoramientos -->
              <div v-if="p.evaluacion.detalles.length" class="mt-2 space-y-0.5">
                <p class="text-[9px] font-black text-red-600 uppercase">Empeoramientos:</p>
                <p v-for="d in p.evaluacion.detalles" :key="d.telar.id" class="text-[10px] text-red-600 font-medium">
                  {{ nombreCorto(d.telar) }}
                  <template v-if="d.evalU === 'peor'"> Ro.U: {{ d.r1U }}→{{ d.r6U }}</template>
                  <template v-if="d.evalT === 'peor'"> Ro.T: {{ d.r1T }}→{{ d.r6T }}</template>
                </p>
              </div>
            </div>

            <!-- Sin evaluación aún -->
            <div v-else class="px-3 py-2 text-[10px] text-gray-400 font-medium">
              <template v-if="p.r1EnProgreso && !p.tieneR1">
                <span class="text-blue-500">Ronda 1 en progreso…</span>
                <span class="text-gray-300 ml-1">{{ p.telaresR1 }} telares parciales</span>
              </template>
              <template v-else-if="p.tieneR1 && p.r6EnProgreso && !p.tieneR6">
                <span class="text-blue-500">Ronda 6 en progreso…</span>
                <span class="text-gray-300 ml-1">{{ p.telaresR6 }} telares parciales</span>
              </template>
              <template v-else>
                {{ p.tieneR1 ? 'Esperando Ronda 6 para evaluación…' : 'Esperando Ronda 1…' }}
                <span class="text-gray-300 ml-1">{{ p.telaresR1 || p.telaresR6 }} telares registrados</span>
              </template>
            </div>
          </div>

          <!-- WhatsApp global -->
          <button
            @click="compartirWhatsApp"
            class="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-black text-white bg-green-600 hover:bg-green-700 transition-all shadow-md active:scale-[0.98]"
          >
            <Share2 class="w-4 h-4" />
            Compartir resumen por WhatsApp
          </button>
        </template>
      </template>
    </main>
  </div>
</template>
