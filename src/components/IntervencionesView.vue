<script setup>
import { ref, computed, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { getAuth } from 'firebase/auth';
import { intervencionService } from '../services/intervencionService';
import { userProfile, userRole } from '../services/authService';
import { sanitizeSectorList, normalizeSectorValue, DEFAULT_SECTOR, canDespacharIntervencion } from '../constants/organization';
import { Wrench, Zap, Clock, ChevronRight, AlertTriangle, BellOff, Plus, OctagonX, CirclePlay, ChevronDown, ChevronUp, Package, Stethoscope, User, Flame, ArrowUp, Minus, Layers } from 'lucide-vue-next';
import Swal from 'sweetalert2';

const router = useRouter();

// ── Estado ─────────────────────────────────────────────────────────────────────
const intervenciones = ref([]);
const loading        = ref(true);
const filtroEstado   = ref(userRole.value === 'inspector' ? 'PENDIENTE' : 'EN_PROCESO');
const actualizando   = ref(null);          // id o 'batch-xxx'
const expandedId     = ref(null);          // intervención expandida
const collapsedMaq   = ref(new Set());     // maquinaIds colapsados (grupos)

const toggleExpand   = (id) => { expandedId.value = expandedId.value === id ? null : id; };
const toggleMaqGroup = (key) => {
  const s = new Set(collapsedMaq.value);
  s.has(key) ? s.delete(key) : s.add(key);
  collapsedMaq.value = s;
};

// ── Sectores ───────────────────────────────────────────────────────────────────
const sectoresUsuario = computed(() => {
  if (!userProfile.value) return [DEFAULT_SECTOR];
  return sanitizeSectorList(userProfile.value.sectoresAsignados, userProfile.value.sectorDefault);
});

// ── Suscripción realtime ───────────────────────────────────────────────────────
let unsubscribe = null;

watch(sectoresUsuario, (sectores) => {
  if (unsubscribe) unsubscribe();
  loading.value = true;
  unsubscribe = intervencionService.suscribirActivas(sectores, (docs) => {
    intervenciones.value = docs;
    loading.value = false;
  });
}, { immediate: true });

onUnmounted(() => { unsubscribe?.(); });

// ── Filtros ────────────────────────────────────────────────────────────────────
const countPendiente  = computed(() => intervenciones.value.filter(i => i.estado === 'PENDIENTE').length);
const countEnProceso  = computed(() => intervenciones.value.filter(i => i.estado === 'EN_PROCESO').length);
const countCompletado = computed(() => intervenciones.value.filter(i => i.estado === 'COMPLETADO').length);

const tabs = computed(() => [
  { id: 'PENDIENTE',  label: 'Pend.',    count: countPendiente.value },
  { id: 'EN_PROCESO', label: 'Proceso',  count: countEnProceso.value },
  { id: 'COMPLETADO', label: 'Cerradas', count: countCompletado.value || null },
  { id: 'TODO',       label: 'Todo',     count: null },
]);

const intervencionesFiltered = computed(() => {
  const list = filtroEstado.value === 'TODO'
    ? intervenciones.value
    : intervenciones.value.filter(i => i.estado === filtroEstado.value);
  return [...list].sort((a, b) => calcPrioridad(a).score - calcPrioridad(b).score);
});

// ── Prioridad ──────────────────────────────────────────────────────────────────
const calcPrioridad = (item) => {
  if (item.estado === 'COMPLETADO') return { level: 'P4', score: 9999 };
  const base = { PARADA: 0, CON_PROBLEMA: 100, EN_MARCHA: 200 };
  let score = base[item.estadoMaquina] ?? 200;
  if (item.critico) score -= 50;
  const age = (Date.now() / 1000 - (item.createdAt?.seconds || 0)) / 60;
  score -= Math.min(age * 0.5, 80);
  let level;
  if (item.estadoMaquina === 'PARADA')                            level = 'P1';
  else if (item.estadoMaquina === 'CON_PROBLEMA' && item.critico) level = 'P2';
  else if (item.estadoMaquina === 'CON_PROBLEMA')                 level = 'P3';
  else                                                            level = 'P4';
  return { level, score };
};

const prioConfig = {
  P1: { label: 'URGENTE', bg: 'bg-red-600 text-white',         ic: Flame,   ring: 'ring-2 ring-red-400 ring-offset-1' },
  P2: { label: 'ALTA',    bg: 'bg-orange-500 text-white',      ic: ArrowUp, ring: '' },
  P3: { label: 'MEDIA',   bg: 'bg-yellow-400 text-yellow-900', ic: Minus,   ring: '' },
  P4: { label: 'NORMAL',  bg: 'bg-gray-200 text-gray-500',     ic: null,    ring: '' },
};

// ── Agrupación por máquina (Fase B) ────────────────────────────────────────────
const grupos = computed(() => {
  const map = new Map();
  for (const item of intervencionesFiltered.value) {
    const key = item.maquinaId || `${item.tipoMaquina}_${item.numeroMaquina}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        nombre:   nombreMaquina(item),
        modelo:   modeloCorto(item),
        sector:   item.sector,
        grupo:    item.grupoTelar,
        gm:       item.gmTelar,
        lado:     item.lado,
        items:    [],
        bestPrio: null,
      });
    }
    const g = map.get(key);
    g.items.push(item);
    const prio = calcPrioridad(item);
    if (!g.bestPrio || prio.score < g.bestPrio.score) g.bestPrio = prio;
  }
  // Ordenar grupos por mejor prioridad
  return [...map.values()].sort((a, b) => a.bestPrio.score - b.bestPrio.score);
});

// ── Helpers ────────────────────────────────────────────────────────────────────
const timeAgo = (ts) => {
  if (!ts?.seconds) return 'ahora';
  const s = Math.floor(Date.now() / 1000 - ts.seconds);
  if (s < 90)          return 'hace un momento';
  const m = Math.floor(s / 60);
  if (m < 60)          return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24)          return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
};

const nombreMaquina = (item) => {
  if (item.nombreMaquinaDisplay) return item.nombreMaquinaDisplay;
  if (String(item.tipoMaquina).toUpperCase() === 'TELAR') {
    const n = parseInt(String(item.numeroMaquina).slice(-2), 10);
    return `Toyota ${isNaN(n) ? item.numeroMaquina : n}`;
  }
  return `${item.tipoMaquina} ${item.numeroMaquina}`;
};

const modeloCorto = (item) => {
  const m = item.modeloMaquina || '';
  return m.slice(-4) || m || '';
};

const tipoConfig = {
  MECANICO:  { label: 'Mecánico',  bg: 'bg-blue-100 text-blue-700',   bar: 'bg-blue-500'  },
  ELECTRICO: { label: 'Eléctrico', bg: 'bg-amber-100 text-amber-700', bar: 'bg-amber-400' },
  CALIDAD:   { label: 'Calidad',   bg: 'bg-red-100 text-red-700',     bar: 'bg-red-500'   },
};
const estadoMaqConfig = {
  EN_MARCHA:    { label: 'En marcha',    ic: CirclePlay,    color: 'text-green-600' },
  CON_PROBLEMA: { label: 'Con problema', ic: AlertTriangle, color: 'text-amber-600' },
  PARADA:       { label: 'Parada',       ic: OctagonX,      color: 'text-red-600'   },
};
const estadoConfig = {
  PENDIENTE:  { label: 'Pendiente',  bg: 'bg-orange-100 text-orange-700' },
  EN_PROCESO: { label: 'En proceso', bg: 'bg-emerald-100 text-emerald-700' },
  COMPLETADO: { label: 'Completado', bg: 'bg-gray-200 text-gray-600' },
};

const currentUid = () => getAuth().currentUser?.uid || null;
const isAssignedToMe = (item) => item.asignadoA === currentUid();

// Inspector solo puede tomar intervenciones de CALIDAD
const canTomarItem = (item) => {
  if (userRole.value === 'inspector') return item.tipoIntervencion === 'CALIDAD';
  return true;
};

// ── Acciones individuales ──────────────────────────────────────────────────────
const onTomar = async (item) => {
  const user = getAuth().currentUser;
  actualizando.value = item.id;
  try {
    await intervencionService.actualizarEstado(item.id, 'EN_PROCESO', {
      asignadoA:      user?.uid || null,
      asignadoNombre: user?.displayName || user?.email || 'Usuario',
    });
    filtroEstado.value = 'EN_PROCESO';
    Swal.fire({ icon: 'success', title: 'Intervención tomada', timer: 1000, showConfirmButton: false, toast: true, position: 'top-end' });
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  } finally { actualizando.value = null; }
};

// ── Acciones batch por grupo (Fase C) ──────────────────────────────────────────
const onTomarGrupo = async (grupo) => {
  const user = getAuth().currentUser;
  const pendientes = grupo.items.filter(i => i.estado === 'PENDIENTE');
  if (!pendientes.length) return;

  const confirm = await Swal.fire({
    title: `Tomar ${pendientes.length} en ${grupo.nombre}`,
    html: pendientes.map(i =>
      `<div class="text-left text-sm py-1 border-b border-gray-100">
        <b>${tipoConfig[i.tipoIntervencion]?.label || i.tipoIntervencion}</b> — ${i.sintomaNombre || 'Sin síntoma'}
      </div>`
    ).join(''),
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: `Tomar ${pendientes.length}`,
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#f97316',
  });
  if (!confirm.isConfirmed) return;

  actualizando.value = `batch-${grupo.key}`;
  try {
    await intervencionService.actualizarEstadoBatch(
      pendientes.map(i => i.id),
      'EN_PROCESO',
      { asignadoA: user?.uid || null, asignadoNombre: user?.displayName || user?.email || 'Usuario' }
    );
    filtroEstado.value = 'EN_PROCESO';
    Swal.fire({ icon: 'success', title: `${pendientes.length} intervenciones tomadas`, timer: 1500, showConfirmButton: false, toast: true, position: 'top-end' });
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  } finally { actualizando.value = null; }
};

</script>

<template>
  <div class="min-h-screen bg-gray-50 pb-8">

    <!-- ── Tab bar ───────────────────────────────────────────────────────────── -->
    <div class="bg-white border-b border-gray-100 px-2.5 py-2 flex items-center gap-1 sticky top-[54px] z-30">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        @click="filtroEstado = tab.id"
        class="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-bold transition-all whitespace-nowrap min-w-0"
        :class="filtroEstado === tab.id
          ? 'bg-gray-900 text-white shadow-sm'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'"
      >
        {{ tab.label }}
        <span
          v-if="tab.count"
          class="text-[10px] font-black"
          :class="filtroEstado === tab.id ? 'text-white/80' : 'text-gray-400'"
        >{{ tab.count }}</span>
      </button>

      <button
        v-if="canDespacharIntervencion(userRole)"
        @click="router.push('/llamar')"
        class="ml-auto w-8 h-8 flex items-center justify-center bg-orange-600 text-white rounded-full shadow-sm shadow-orange-500/20 active:scale-95 transition shrink-0"
        title="Nueva intervención"
      >
        <Plus class="w-4 h-4" />
      </button>
    </div>

    <!-- ── Loading ───────────────────────────────────────────────────────────── -->
    <div v-if="loading" class="flex items-center justify-center py-24">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
    </div>

    <!-- ── Empty state ───────────────────────────────────────────────────────── -->
    <div v-else-if="!intervencionesFiltered.length" class="flex flex-col items-center justify-center py-24 px-8 text-center">
      <div class="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        <BellOff class="w-8 h-8 text-gray-300" />
      </div>
      <p class="font-black text-gray-400 text-base">
        Sin intervenciones
        <span v-if="filtroEstado === 'PENDIENTE'">pendientes</span>
        <span v-else-if="filtroEstado === 'EN_PROCESO'">en proceso</span>
        <span v-else-if="filtroEstado === 'COMPLETADO'">cerradas</span>
      </p>
      <p class="text-xs text-gray-300 mt-1 font-medium">{{ sectoresUsuario.join(' · ') }}</p>
    </div>

    <!-- ── Lista agrupada ────────────────────────────────────────────────────── -->
    <div v-else class="max-w-lg mx-auto px-3 pt-3 space-y-3">
      <div v-for="g in grupos" :key="g.key">

        <!-- ═══ GRUPO CON MÚLTIPLES ═══ -->
        <div v-if="g.items.length > 1"
          class="rounded-2xl border overflow-hidden shadow-sm"
          :class="[
            g.bestPrio.level === 'P1' ? 'border-red-400 shadow-red-200 animate-pulse-subtle' : g.bestPrio.level === 'P2' ? 'border-orange-300' : 'border-gray-200',
            prioConfig[g.bestPrio.level]?.ring || ''
          ]"
        >
          <!-- Header del grupo -->
          <button
            @click="toggleMaqGroup(g.key)"
            class="w-full bg-gray-50 px-3.5 py-2.5 flex items-center gap-2 text-left active:bg-gray-100 transition-colors"
          >
            <span
              class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-black shrink-0"
              :class="prioConfig[g.bestPrio.level]?.bg"
            >
              <component v-if="prioConfig[g.bestPrio.level]?.ic" :is="prioConfig[g.bestPrio.level].ic" class="w-3 h-3" />
              {{ prioConfig[g.bestPrio.level]?.label }}
            </span>

            <p class="font-black text-gray-900 text-base leading-tight">{{ g.nombre }}</p>
            <span v-if="g.modelo" class="text-[10px] font-bold text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">{{ g.modelo }}</span>

            <div class="ml-auto flex items-center gap-1.5">
              <span class="inline-flex items-center gap-1 bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-[10px] font-black">
                <Layers class="w-3 h-3" />
                {{ g.items.length }}
              </span>
              <ChevronDown v-if="collapsedMaq.has(g.key)" class="w-4 h-4 text-gray-400" />
              <ChevronUp v-else class="w-4 h-4 text-gray-400" />
            </div>
          </button>

          <!-- Sub-cards -->
          <div v-if="!collapsedMaq.has(g.key)" class="divide-y divide-gray-100">
            <div
              v-for="item in g.items"
              :key="item.id"
              class="bg-white transition-all"
              :class="item.estado === 'COMPLETADO' ? 'opacity-60' : ''"
            >
              <div class="px-3.5 py-2.5">
                <!-- Row badges -->
                <div class="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  <span
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black"
                    :class="tipoConfig[item.tipoIntervencion]?.bg || 'bg-gray-100 text-gray-600'"
                  >
                    <component :is="item.tipoIntervencion === 'MECANICO' ? Wrench : Zap" class="w-3 h-3" />
                    {{ tipoConfig[item.tipoIntervencion]?.label || item.tipoIntervencion }}
                  </span>
                  <span v-if="item.estadoMaquina"
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-gray-100"
                    :class="estadoMaqConfig[item.estadoMaquina]?.color"
                  >
                    <component :is="estadoMaqConfig[item.estadoMaquina]?.ic" class="w-3 h-3" />
                    {{ estadoMaqConfig[item.estadoMaquina]?.label }}
                  </span>
                  <span class="ml-auto inline-flex px-2 py-0.5 rounded-full text-[10px] font-black"
                    :class="estadoConfig[item.estado]?.bg || 'bg-gray-100 text-gray-600'"
                  >{{ estadoConfig[item.estado]?.label || item.estado }}</span>
                </div>

                <!-- Síntoma + obs -->
                <p v-if="item.sintomaNombre" class="text-sm font-semibold text-gray-700 leading-snug">{{ item.sintomaNombre }}</p>
                <p v-if="item.observaciones" class="text-xs text-gray-400 italic line-clamp-1">"{{ item.observaciones }}"</p>

                <!-- Mini footer individual -->
                <div class="flex items-center gap-2 mt-1.5 text-[11px] text-gray-400">
                  <Clock class="w-3 h-3" />
                  <span>{{ timeAgo(item.createdAt) }}</span>
                  <span v-if="item.asignadoNombre" class="text-emerald-600 font-bold flex items-center gap-0.5">
                    <User class="w-3 h-3" /> {{ item.asignadoNombre }}
                  </span>
                  <div class="ml-auto flex items-center gap-1">
                    <button @click.stop="router.push('/intervenciones/' + item.id)" class="p-1 rounded bg-gray-100 text-gray-400 hover:bg-gray-200">
                      <ChevronRight class="w-3 h-3" />
                    </button>
                    <button v-if="item.estado === 'PENDIENTE' && canTomarItem(item)" @click.stop="onTomar(item)" :disabled="actualizando === item.id"
                      class="px-2 py-0.5 bg-orange-500 text-white rounded-lg text-[10px] font-black active:scale-95 transition disabled:opacity-50">
                      Tomar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Acciones batch del grupo -->
          <div v-if="!collapsedMaq.has(g.key)" class="bg-gray-50 px-3.5 py-2 flex items-center gap-2 border-t border-gray-200">
            <span class="text-[10px] font-bold text-gray-400 flex items-center gap-1">
              <Layers class="w-3 h-3" /> {{ g.items.length }} intervenciones
            </span>
            <div class="ml-auto flex items-center gap-1.5">
              <button
                v-if="g.items.some(i => i.estado === 'PENDIENTE' && canTomarItem(i))"
                @click.stop="onTomarGrupo(g)"
                :disabled="actualizando === `batch-${g.key}`"
                class="flex items-center gap-1 px-2.5 py-1 bg-orange-500 text-white rounded-lg text-[10px] font-black active:scale-95 transition disabled:opacity-50"
              >
                <span v-if="actualizando === `batch-${g.key}`" class="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full inline-block"></span>
                <ChevronRight v-else class="w-3 h-3" />
                Tomar {{ g.items.filter(i => i.estado === 'PENDIENTE').length }}
              </button>
            </div>
          </div>
        </div>

        <!-- ═══ TARJETA SIMPLE (1 intervención) ═══ -->
        <div v-else
          class="bg-white rounded-2xl border overflow-hidden shadow-sm transition-all"
          :class="[
            g.bestPrio.level === 'P1' ? 'border-red-400 shadow-red-200 animate-pulse-subtle' : g.items[0].estadoMaquina === 'PARADA' ? 'border-red-300 shadow-red-100' : g.items[0].critico ? 'border-red-200 shadow-red-50' : 'border-gray-100',
            g.items[0].estado === 'COMPLETADO' ? 'opacity-70' : '',
            prioConfig[g.bestPrio.level]?.ring || ''
          ]"
        >
          <div class="h-1.5" :class="tipoConfig[g.items[0].tipoIntervencion]?.bar || 'bg-gray-300'"></div>

          <div class="p-3.5 pb-0">
            <!-- Badges -->
            <div class="flex items-center gap-1.5 mb-2 flex-wrap">
              <span v-if="g.items[0].estado !== 'COMPLETADO'"
                class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-black"
                :class="prioConfig[g.bestPrio.level]?.bg"
              >
                <component v-if="prioConfig[g.bestPrio.level]?.ic" :is="prioConfig[g.bestPrio.level].ic" class="w-3 h-3" />
                {{ prioConfig[g.bestPrio.level]?.label }}
              </span>
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black"
                :class="tipoConfig[g.items[0].tipoIntervencion]?.bg || 'bg-gray-100 text-gray-600'"
              >
                <component :is="g.items[0].tipoIntervencion === 'MECANICO' ? Wrench : Zap" class="w-3 h-3" />
                {{ tipoConfig[g.items[0].tipoIntervencion]?.label || g.items[0].tipoIntervencion }}
              </span>
              <span v-if="g.items[0].estadoMaquina"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-gray-100"
                :class="estadoMaqConfig[g.items[0].estadoMaquina]?.color"
              >
                <component :is="estadoMaqConfig[g.items[0].estadoMaquina]?.ic" class="w-3 h-3" />
                {{ estadoMaqConfig[g.items[0].estadoMaquina]?.label }}
              </span>
              <span class="ml-auto inline-flex px-2 py-0.5 rounded-full text-[10px] font-black"
                :class="estadoConfig[g.items[0].estado]?.bg || 'bg-gray-100 text-gray-600'"
              >{{ estadoConfig[g.items[0].estado]?.label || g.items[0].estado }}</span>
            </div>

            <!-- Máquina -->
            <div class="flex items-baseline gap-2 mb-0.5">
              <p class="font-black text-gray-900 text-lg leading-tight">{{ g.nombre }}</p>
              <span v-if="g.modelo" class="text-[11px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{{ g.modelo }}</span>
              <span v-if="g.lado && g.lado !== 'U'" class="text-[11px] text-gray-400 font-semibold">L{{ g.lado }}</span>
            </div>
            <div class="flex items-center gap-2 text-[10px] text-gray-400 font-bold tracking-wide mb-2">
              <span>{{ g.sector }}</span>
              <span v-if="g.grupo" class="text-gray-300">·</span>
              <span v-if="g.grupo">GP {{ g.grupo }}</span>
              <span v-if="g.gm" class="text-gray-300">·</span>
              <span v-if="g.gm">GM {{ g.gm }}</span>
            </div>

            <!-- Síntoma + obs -->
            <p v-if="g.items[0].sintomaNombre" class="text-sm font-semibold text-gray-700 leading-snug mb-0.5">{{ g.items[0].sintomaNombre }}</p>
            <p v-if="g.items[0].observaciones" class="text-sm text-gray-500 italic leading-snug line-clamp-2">"{{ g.items[0].observaciones }}"</p>

            <!-- Foto -->
            <div v-if="g.items[0].fotoUrl" class="mt-2 rounded-xl overflow-hidden border border-gray-200 h-24 bg-gray-900">
              <img :src="g.items[0].fotoUrl" class="w-full h-full object-cover" />
            </div>
          </div>

          <!-- Expandible -->
          <div v-if="expandedId === g.items[0].id" class="px-3.5 pt-2 pb-1 space-y-2 border-t border-gray-100 mt-2 bg-gray-50/60">
            <div v-if="g.items[0].diagnostico?.piezaNombre" class="flex items-start gap-2">
              <Package class="w-3.5 h-3.5 text-indigo-500 mt-0.5 shrink-0" />
              <div class="text-xs">
                <span class="font-black text-gray-600">Pieza:</span>
                <span class="text-gray-500 ml-1">{{ g.items[0].diagnostico.piezaNombre }}</span>
              </div>
            </div>
            <div v-if="g.items[0].diagnostico?.causaRaiz" class="flex items-start gap-2">
              <Stethoscope class="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
              <div class="text-xs">
                <span class="font-black text-gray-600">Causa raíz:</span>
                <span class="text-gray-500 ml-1">{{ g.items[0].diagnostico.causaRaiz }}</span>
              </div>
            </div>
            <div v-if="!g.items[0].diagnostico?.piezaNombre && !g.items[0].diagnostico?.causaRaiz" class="text-[10px] text-gray-400 italic py-1">
              Sin diagnóstico completado
            </div>
          </div>

          <!-- Footer -->
          <div class="px-3.5 py-2.5 flex items-center gap-2 border-t border-gray-50 mt-2">
            <Clock class="w-3.5 h-3.5 text-gray-300 shrink-0" />
            <span class="text-xs text-gray-400">{{ timeAgo(g.items[0].createdAt) }}</span>
            <span v-if="g.items[0].asignadoNombre" class="text-xs text-emerald-600 font-bold flex items-center gap-1 ml-1">
              <User class="w-3 h-3" /> {{ g.items[0].asignadoNombre }}
            </span>
            <span v-else-if="g.items[0].creadoPorNombre" class="text-xs text-gray-400 ml-1">{{ g.items[0].creadoPorNombre }}</span>

            <div class="ml-auto flex items-center gap-1.5">
              <button @click.stop="toggleExpand(g.items[0].id)" class="p-1.5 rounded-lg bg-gray-100 text-gray-400 hover:bg-gray-200 transition-all">
                <ChevronDown v-if="expandedId !== g.items[0].id" class="w-3.5 h-3.5" />
                <ChevronUp v-else class="w-3.5 h-3.5" />
              </button>
              <button @click.stop="router.push('/intervenciones/' + g.items[0].id)" class="p-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition-all">
                <ChevronRight class="w-3.5 h-3.5" />
              </button>
              <button v-if="g.items[0].estado === 'PENDIENTE' && canTomarItem(g.items[0])" @click.stop="onTomar(g.items[0])" :disabled="actualizando === g.items[0].id"
                class="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 text-white rounded-xl text-[11px] font-black active:scale-95 transition disabled:opacity-50 shadow-sm shadow-orange-500/20">
                <span v-if="actualizando === g.items[0].id" class="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full inline-block"></span>
                <ChevronRight v-else class="w-3.5 h-3.5" />
                Tomar
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes pulse-subtle {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
  50%      { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
}
.animate-pulse-subtle {
  animation: pulse-subtle 2s ease-in-out infinite;
}
</style>
