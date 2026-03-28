<script setup>
import { ref, computed, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { getAuth } from 'firebase/auth';
import { intervencionService } from '../services/intervencionService';
import { userProfile, userRole } from '../services/authService';
import { sanitizeSectorList, normalizeSectorValue, DEFAULT_SECTOR, canDespacharIntervencion } from '../constants/organization';
import { Wrench, Zap, Clock, ChevronRight, Check, AlertTriangle, BellOff, Plus } from 'lucide-vue-next';
import Swal from 'sweetalert2';

const router = useRouter();

// ── Estado ─────────────────────────────────────────────────────────────────────
const intervenciones = ref([]);
const loading        = ref(true);
const filtroEstado   = ref('PENDIENTE');
const actualizando   = ref(null); // id del item en proceso de actualización

// ── Sectores ───────────────────────────────────────────────────────────────────
const sectoresUsuario = computed(() => {
  if (!userProfile.value) return [DEFAULT_SECTOR];
  return sanitizeSectorList(userProfile.value.sectoresAsignados, userProfile.value.sectorDefault);
});
const sectorPrincipal = computed(() => sectoresUsuario.value[0] || DEFAULT_SECTOR);

// ── Suscripción realtime ───────────────────────────────────────────────────────
let unsubscribe = null;

watch(sectorPrincipal, (sector) => {
  if (unsubscribe) unsubscribe();
  loading.value = true;
  unsubscribe = intervencionService.suscribirActivas(sector, (docs) => {
    intervenciones.value = docs;
    loading.value = false;
  });
}, { immediate: true });

onUnmounted(() => { unsubscribe?.(); });

// ── Filtros ────────────────────────────────────────────────────────────────────
const countPendiente = computed(() => intervenciones.value.filter(i => i.estado === 'PENDIENTE').length);
const countEnProceso = computed(() => intervenciones.value.filter(i => i.estado === 'EN_PROCESO').length);

const tabs = computed(() => [
  { id: 'PENDIENTE',  label: 'Pendientes', count: countPendiente.value },
  { id: 'EN_PROCESO', label: 'En proceso', count: countEnProceso.value },
  { id: 'TODO',       label: 'Todos',      count: null },
]);

const intervencionesFiltered = computed(() =>
  filtroEstado.value === 'TODO'
    ? intervenciones.value
    : intervenciones.value.filter(i => i.estado === filtroEstado.value)
);

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

const tipoConfig = {
  MECANICO:  { label: 'Mecánico',  bg: 'bg-blue-100 text-blue-700',   bar: 'bg-blue-500' },
  ELECTRICO: { label: 'Eléctrico', bg: 'bg-amber-100 text-amber-700', bar: 'bg-amber-400' },
};
const estadoConfig = {
  PENDIENTE:  { label: 'Pendiente',  bg: 'bg-orange-100 text-orange-700' },
  EN_PROCESO: { label: 'En proceso', bg: 'bg-emerald-100 text-emerald-700' },
  COMPLETADO: { label: 'Completado', bg: 'bg-gray-100 text-gray-500' },
};

const currentUid = () => getAuth().currentUser?.uid || null;
const isAssignedToMe = (item) => item.asignadoA === currentUid();

// ── Acciones ───────────────────────────────────────────────────────────────────
const onTomar = async (item) => {
  const user = getAuth().currentUser;
  actualizando.value = item.id;
  try {
    await intervencionService.actualizarEstado(item.id, 'EN_PROCESO', {
      asignadoA:       user?.uid || null,
      asignadoNombre:  user?.displayName || user?.email || 'Usuario',
    });
    filtroEstado.value = 'EN_PROCESO';
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  } finally { actualizando.value = null; }
};

const onCompletar = async (item) => {
  const confirm = await Swal.fire({
    title: '¿Intervención completada?',
    text: 'Confirmar que la tarea finalizó correctamente.',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Sí, completar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#16a34a',
  });
  if (!confirm.isConfirmed) return;
  actualizando.value = item.id;
  try {
    await intervencionService.actualizarEstado(item.id, 'COMPLETADO');
    filtroEstado.value = 'TODO';
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  } finally { actualizando.value = null; }
};
</script>

<template>
  <div class="min-h-screen bg-gray-50 pb-8">

    <!-- ── Tab bar ───────────────────────────────────────────────────────────── -->
    <div class="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-2 sticky top-16 z-30">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        @click="filtroEstado = tab.id"
        class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all"
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

      <!-- FAB "Nueva" para quienes pueden despachar -->
      <button
        v-if="canDespacharIntervencion(userRole)"
        @click="router.push('/llamar')"
        class="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 text-white rounded-full text-xs font-bold shadow-sm shadow-orange-500/20 active:scale-95 transition"
      >
        <Plus class="w-3.5 h-3.5" />
        Nueva
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
      </p>
      <p class="text-xs text-gray-300 mt-1 font-medium">Sector {{ sectorPrincipal }}</p>
    </div>

    <!-- ── Lista ─────────────────────────────────────────────────────────────── -->
    <div v-else class="max-w-lg mx-auto px-3 pt-3 space-y-3">
      <div
        v-for="item in intervencionesFiltered"
        :key="item.id"
        class="bg-white rounded-2xl border overflow-hidden shadow-sm transition-shadow"
        :class="item.critico ? 'border-red-200 shadow-red-100' : 'border-gray-100'"
      >
        <!-- Franja de color -->
        <div class="h-1.5" :class="tipoConfig[item.tipoIntervencion]?.bar || 'bg-gray-300'"></div>

        <div class="p-4">
          <!-- Badges row -->
          <div class="flex items-center gap-2 mb-3 flex-wrap">
            <span
              class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black"
              :class="tipoConfig[item.tipoIntervencion]?.bg || 'bg-gray-100 text-gray-600'"
            >
              <component :is="item.tipoIntervencion === 'MECANICO' ? Wrench : Zap" class="w-3 h-3" />
              {{ tipoConfig[item.tipoIntervencion]?.label || item.tipoIntervencion }}
            </span>

            <span
              v-if="item.critico"
              class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black bg-red-100 text-red-700"
            >
              <AlertTriangle class="w-3 h-3" />
              CRÍTICO
            </span>

            <span
              class="ml-auto inline-flex px-2.5 py-1 rounded-full text-[11px] font-black"
              :class="estadoConfig[item.estado]?.bg || 'bg-gray-100 text-gray-600'"
            >
              {{ estadoConfig[item.estado]?.label || item.estado }}
            </span>
          </div>

          <!-- Máquina -->
          <p class="font-black text-gray-900 text-lg leading-tight">
            {{ item.tipoMaquina }} {{ item.numeroMaquina }}
            <span v-if="item.lado && item.lado !== 'U'" class="text-gray-400 font-semibold text-base"> ({{ item.lado }})</span>
          </p>
          <p class="text-xs text-gray-400 font-semibold mb-2.5 tracking-wide">{{ item.sector }}</p>

          <!-- Denominación -->
          <p v-if="item.denominacion" class="text-sm text-gray-700 font-semibold leading-snug">
            {{ [item.seccion, item.grupo, item.denominacion].filter(Boolean).join(' › ') }}
          </p>

          <!-- Observaciones -->
          <p v-if="item.observaciones" class="text-sm text-gray-500 mt-1 italic leading-snug">
            "{{ item.observaciones }}"
          </p>

          <!-- Foto miniatura -->
          <div v-if="item.fotoUrl" class="mt-2.5 rounded-xl overflow-hidden border border-gray-200 h-28 bg-gray-900">
            <img :src="item.fotoUrl" class="w-full h-full object-cover" />
          </div>

          <!-- Footer: tiempo + acción -->
          <div class="mt-3 pt-2.5 border-t border-gray-50 flex items-center gap-2">
            <Clock class="w-3.5 h-3.5 text-gray-300 shrink-0" />
            <span class="text-xs text-gray-400 flex-1">{{ timeAgo(item.createdAt) }}</span>

            <!-- Solicitante (solo en PENDIENTE) -->
            <span v-if="item.estado === 'PENDIENTE' && item.creadoPorNombre" class="text-xs text-gray-400 mr-1">
              por {{ item.creadoPorNombre }}
            </span>

            <!-- Asignado (en EN_PROCESO) -->
            <span v-if="item.estado === 'EN_PROCESO' && item.asignadoNombre"
              class="text-xs text-emerald-600 font-bold mr-1 flex items-center gap-1">
              <span class="text-base leading-none">👤</span> {{ item.asignadoNombre }}
            </span>

            <!-- Botón Tomar -->
            <button
              v-if="item.estado === 'PENDIENTE'"
              @click="onTomar(item)"
              :disabled="actualizando === item.id"
              class="flex items-center gap-1.5 px-4 py-2 bg-orange-500 text-white rounded-xl text-xs font-black active:scale-95 transition disabled:opacity-50 shadow-sm shadow-orange-500/20"
            >
              <span v-if="actualizando === item.id"
                class="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full inline-block">
              </span>
              <ChevronRight v-else class="w-3.5 h-3.5" />
              Tomar
            </button>

            <!-- Botón Completar (solo si me asignaron a mí) -->
            <button
              v-else-if="item.estado === 'EN_PROCESO' && isAssignedToMe(item)"
              @click="onCompletar(item)"
              :disabled="actualizando === item.id"
              class="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 text-white rounded-xl text-xs font-black active:scale-95 transition disabled:opacity-50 shadow-sm shadow-emerald-500/20"
            >
              <span v-if="actualizando === item.id"
                class="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full inline-block">
              </span>
              <Check v-else class="w-3.5 h-3.5" />
              Completar
            </button>

            <!-- EN_PROCESO asignado a otro: sin botón -->
          </div>
        </div>
      </div>
    </div>

  </div>
</template>
