<script setup>
import { ref, computed, onMounted } from 'vue';
import { getAuth } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userProfile } from '../services/authService';
import { normalizeSectorValue, DEFAULT_SECTOR, DEFECTOS_TRAMA } from '../constants/organization';
import { cargarPatrullaActiva, crearPatrulla, guardarRondaTrama, cargarPatrullaPorId } from '../services/patrullaService';
import Swal from 'sweetalert2';
import { Save, Loader2, ChevronDown, CheckCircle, AlertTriangle, X } from 'lucide-vue-next';

const emit = defineEmits(['completada']);

const props = defineProps({
  soloLectura:       { type: Boolean, default: false },
  patrullaIdExterno: { type: String,  default: null },
});

// ── Estado ───────────────────────────────────────────────────────
const telares = ref([]);
const registros = ref({});  // { maq_id: { defectos: [], sinDefectos: false, metros: '', hora: null } }
const patrullaId = ref(null);
const cargando = ref(true);
const guardando = ref(false);
const grupoSeleccionado = ref('');

// Bottom sheet
const sheetAbierto = ref(false);
const telarActivo = ref(null);

// ── Computed ─────────────────────────────────────────────────────
const sectoresUsuario = computed(() =>
  Array.isArray(userProfile.value?.sectoresAsignados)
    ? userProfile.value.sectoresAsignados
    : [normalizeSectorValue(userProfile.value?.sectorDefault || DEFAULT_SECTOR)]
);

const telaresOrdenados = computed(() => {
  let list = telares.value;
  if (grupoSeleccionado.value) {
    list = list.filter(t => String(t.grp_tear || '').trim() === grupoSeleccionado.value);
  }
  return list.sort((a, b) => (a.orden_patrulla || 999) - (b.orden_patrulla || 999));
});

const gruposDisponibles = computed(() => {
  const gs = telares.value.map(t => String(t.grp_tear || '').trim()).filter(Boolean);
  return [...new Set(gs)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
});

const resumen = computed(() => {
  let revisados = 0, conDefectos = 0, sinRevision = 0;
  for (const t of telaresOrdenados.value) {
    const r = registros.value[t.id];
    if (!r || (!r.sinDefectos && r.defectos.length === 0)) { sinRevision++; continue; }
    revisados++;
    if (r.defectos.length > 0) conDefectos++;
  }
  return { revisados, conDefectos, sinRevision };
});

const telarTieneDatos = computed(() => {
  if (!telarActivo.value) return false;
  const r = registros.value[telarActivo.value.id];
  return r && (r.sinDefectos || r.defectos.length > 0);
});

// ── Carga inicial ────────────────────────────────────────────────
onMounted(async () => {
  try {
    const snap = await getDocs(collection(db, 'maquinas'));
    const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    telares.value = todas.filter(m =>
      String(m.tipo || '').toUpperCase() === 'TELAR' &&
      (m.activo ?? true) &&
      sectoresUsuario.value.includes(normalizeSectorValue(m.sector || DEFAULT_SECTOR))
    );

    const regs = {};
    for (const t of telares.value) {
      regs[t.id] = { defectos: [], sinDefectos: false, metros: '', hora: null };
    }
    registros.value = regs;

    const uid = getAuth().currentUser?.uid;
    if (uid) {
      const activa = props.patrullaIdExterno
        ? await cargarPatrullaPorId(props.patrullaIdExterno)
        : await cargarPatrullaActiva(uid);
      if (activa) {
        patrullaId.value = activa.id;
        const rondaData = activa.rondas?.ronda_3?.datos;
        if (rondaData) {
          for (const [maqId, vals] of Object.entries(rondaData)) {
            if (registros.value[maqId]) {
              registros.value[maqId].defectos = vals.defectos || [];
              registros.value[maqId].sinDefectos = vals.sinDefectos || false;
              registros.value[maqId].metros = vals.metros ?? '';
              registros.value[maqId].hora = vals.hora ?? null;
            }
          }
        }
      } else if (!props.patrullaIdExterno) {
        const nueva = await crearPatrulla({
          inspectorUid: uid,
          inspectorNombre: userProfile.value?.nombre || getAuth().currentUser?.displayName || getAuth().currentUser?.email || 'Inspector',
          inspectorEmail: userProfile.value?.email || getAuth().currentUser?.email || null,
          sector: sectoresUsuario.value[0] || DEFAULT_SECTOR,
        });
        patrullaId.value = nueva.id;
      }
    }
  } catch (e) {
    console.error('Error cargando trama negra:', e);
  } finally {
    cargando.value = false;
  }
});

// ── Bottom sheet ─────────────────────────────────────────────────
function abrirSheet(telar) {
  telarActivo.value = telar;
  sheetAbierto.value = true;
}

async function guardarYCerrar() {
  if (!patrullaId.value) { sheetAbierto.value = false; telarActivo.value = null; return; }
  const r = telarActivo.value ? registros.value[telarActivo.value.id] : null;
  if (r && (r.sinDefectos || r.defectos.length > 0)) {
    guardando.value = true;
    try {
      const datos = {};
      // Incluir todos los registros que tengan datos
      for (const [maqId, vals] of Object.entries(registros.value)) {
        if (vals.sinDefectos || vals.defectos.length > 0) {
          datos[maqId] = {
            defectos: vals.defectos,
            sinDefectos: vals.sinDefectos,
            metros: vals.metros !== '' ? parseFloat(vals.metros) : null,
            hora: vals.hora || new Date().toISOString(),
          };
        }
      }
      await guardarRondaTrama(patrullaId.value, datos);
      emit('completada');
    } catch (e) {
      console.error('Error guardando trama:', e);
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo guardar.' });
      guardando.value = false;
      return;
    }
    guardando.value = false;
  }
  sheetAbierto.value = false;
  telarActivo.value = null;
}

function toggleDefecto(defectoId) {
  if (!telarActivo.value) return;
  const r = registros.value[telarActivo.value.id];
  const idx = r.defectos.indexOf(defectoId);
  if (idx >= 0) {
    r.defectos.splice(idx, 1);
  } else {
    r.defectos.push(defectoId);
    r.sinDefectos = false;
  }
  if (!r.hora) r.hora = new Date().toISOString();
}

function marcarSinDefectos() {
  if (!telarActivo.value) return;
  const r = registros.value[telarActivo.value.id];
  r.sinDefectos = !r.sinDefectos;
  if (r.sinDefectos) r.defectos = [];
  if (!r.hora) r.hora = new Date().toISOString();
}

// ── Helpers ──────────────────────────────────────────────────────
function nombreCorto(t) {
  const id = String(t.maquina || '');
  const n = parseInt(id.slice(-2), 10);
  return `Toyota ${isNaN(n) ? id : n}`;
}

function grupoLabel(t) {
  const g = String(t.grp_tear || '').trim();
  if (!g) return '';
  const last = parseInt(g.slice(-1), 10);
  return `Grupo ${isNaN(last) ? g : last}`;
}

function gmLabel(t) {
  const c = String(t.g_cmest || '').trim();
  if (!c) return '';
  const n = parseInt(c, 10);
  return `GM ${isNaN(n) ? c : n}`;
}

function formatHora(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function estadoTelar(maqId) {
  const r = registros.value[maqId];
  if (!r) return 'pendiente';
  if (r.sinDefectos) return 'ok';
  if (r.defectos.length > 0) return 'defectos';
  return 'pendiente';
}

function defectoLabel(id) {
  return DEFECTOS_TRAMA.find(d => d.id === id)?.label || id;
}
</script>

<template>
  <div class="space-y-3">
    <!-- Filtro de grupo -->
    <div class="bg-white p-3 rounded-xl shadow-sm border border-gray-100 space-y-2">
      <div class="flex items-center gap-2">
        <div v-if="gruposDisponibles.length > 1" class="relative flex-1">
          <select v-model="grupoSeleccionado"
                  class="w-full appearance-none bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 pr-8 focus:outline-none focus:ring-2 focus:ring-gray-300">
            <option value="">Todos los grupos</option>
            <option v-for="g in gruposDisponibles" :key="g" :value="g">Grupo {{ parseInt(g, 10) || g }}</option>
          </select>
          <ChevronDown class="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
        <div class="flex items-center gap-3 text-[10px] font-bold">
          <span class="text-emerald-500">✓ {{ resumen.revisados }}</span>
          <span class="text-red-500" v-if="resumen.conDefectos">⚠ {{ resumen.conDefectos }}</span>
          <span class="text-gray-400">{{ resumen.sinRevision }} sin revisar</span>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="cargando" class="flex items-center justify-center py-12">
      <Loader2 class="w-6 h-6 text-indigo-400 animate-spin" />
    </div>

    <!-- Grilla de telares -->
    <div v-else class="space-y-1.5">
      <div
        v-for="t in telaresOrdenados"
        :key="t.id"
        @click="abrirSheet(t)"
        class="flex items-center gap-3 bg-white px-3 py-2.5 rounded-lg border shadow-sm cursor-pointer active:scale-[0.99] transition-all"
        :class="{
          'border-emerald-200 bg-emerald-50/30': estadoTelar(t.id) === 'ok',
          'border-red-200 bg-red-50/30': estadoTelar(t.id) === 'defectos',
          'border-gray-100': estadoTelar(t.id) === 'pendiente',
        }"
      >
        <!-- Badge estado -->
        <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
             :class="{
               'bg-emerald-100 text-emerald-600': estadoTelar(t.id) === 'ok',
               'bg-red-100 text-red-600': estadoTelar(t.id) === 'defectos',
               'bg-gray-100 text-gray-400': estadoTelar(t.id) === 'pendiente',
             }">
          <CheckCircle v-if="estadoTelar(t.id) === 'ok'" class="w-4 h-4" />
          <AlertTriangle v-else-if="estadoTelar(t.id) === 'defectos'" class="w-4 h-4" />
          <span v-else class="text-[10px] font-black">—</span>
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0">
          <p class="text-sm font-black text-gray-800 truncate">{{ nombreCorto(t) }}</p>
          <div class="flex items-center gap-1.5 flex-wrap">
            <span v-if="t.grp_tear" class="text-[10px] text-gray-400 font-medium">{{ grupoLabel(t) }}</span>
            <span v-if="t.g_cmest" class="text-[10px] text-indigo-400 font-bold">{{ gmLabel(t) }}</span>
            <span v-if="registros[t.id]?.hora" class="text-[10px] text-emerald-500 font-medium">{{ formatHora(registros[t.id].hora) }}</span>
          </div>
          <!-- Mini resumen de defectos -->
          <div v-if="registros[t.id]?.defectos?.length" class="flex flex-wrap gap-1 mt-1">
            <span v-for="d in registros[t.id].defectos" :key="d"
                  class="text-[9px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded">
              {{ defectoLabel(d) }}
            </span>
          </div>
          <span v-else-if="registros[t.id]?.sinDefectos" class="text-[9px] font-bold text-emerald-600">Sin defectos</span>
        </div>

        <!-- Metros -->
        <div v-if="registros[t.id]?.metros !== '' && registros[t.id]?.metros != null" class="text-right shrink-0">
          <p class="text-xs font-black text-gray-600">{{ registros[t.id].metros }}m</p>
        </div>
      </div>

      <div v-if="!telaresOrdenados.length" class="text-center py-8 text-sm text-gray-400 font-medium">
        No hay telares asignados a tu sector.
      </div>
    </div>



    <!-- Bottom Sheet -->
    <teleport to="body">
      <!-- Overlay -->
      <transition
        enter-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0" enter-to-class="opacity-100"
        leave-active-class="transition-opacity duration-150"
        leave-from-class="opacity-100" leave-to-class="opacity-0"
      >
        <div v-if="sheetAbierto" @click="guardarYCerrar" class="fixed inset-0 bg-black/40 z-[100]"></div>
      </transition>

      <!-- Sheet -->
      <transition
        enter-active-class="transition-transform duration-250 ease-out"
        enter-from-class="translate-y-full" enter-to-class="translate-y-0"
        leave-active-class="transition-transform duration-200 ease-in"
        leave-from-class="translate-y-0" leave-to-class="translate-y-full"
      >
        <div v-if="sheetAbierto && telarActivo" class="fixed inset-x-0 bottom-0 z-[101] bg-white rounded-t-2xl shadow-2xl max-h-[80vh] overflow-y-auto">
          <div class="p-4 space-y-4">
            <!-- Handle -->
            <div class="w-12 h-1.5 rounded-full bg-gray-300 mx-auto"></div>

            <!-- Header -->
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-base font-black text-gray-800">{{ nombreCorto(telarActivo) }}</h3>
                <div class="flex items-center gap-2 text-[10px] text-gray-400 font-medium">
                  <span v-if="telarActivo.grp_tear">{{ grupoLabel(telarActivo) }}</span>
                  <span v-if="telarActivo.g_cmest" class="text-indigo-400 font-bold">{{ gmLabel(telarActivo) }}</span>
                  <span v-if="registros[telarActivo.id]?.hora" class="text-emerald-500">{{ formatHora(registros[telarActivo.id].hora) }}</span>
                </div>
              </div>
              <button @click="guardarYCerrar" class="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-all">
                <X class="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <!-- Metros -->
            <div>
              <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider">Metros del contador</label>
              <input
                v-model="registros[telarActivo.id].metros"
                type="number"
                step="1"
                min="0"
                inputmode="numeric"
                placeholder="Ej: 1240"
                class="w-full mt-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
            </div>

            <!-- Defectos -->
            <div>
              <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider">Defectos encontrados</label>
              <div class="grid grid-cols-2 gap-2 mt-2">
                <button
                  v-for="d in DEFECTOS_TRAMA"
                  :key="d.id"
                  @click="!props.soloLectura && toggleDefecto(d.id)"
                  :disabled="props.soloLectura"
                  class="px-3 py-2.5 rounded-lg border text-xs font-bold transition-all active:scale-[0.97] disabled:cursor-not-allowed"
                  :class="registros[telarActivo.id]?.defectos?.includes(d.id)
                    ? 'bg-red-600 border-red-600 text-white shadow-md'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-red-200 hover:bg-red-50'"
                >
                  {{ d.label }}
                </button>
              </div>
            </div>

            <!-- Sin defectos -->
            <button
              @click="!props.soloLectura && marcarSinDefectos()"
              :disabled="props.soloLectura"
              class="w-full px-4 py-3 rounded-xl border text-sm font-black transition-all active:scale-[0.98]"
              :class="registros[telarActivo.id]?.sinDefectos
                ? 'bg-emerald-600 border-emerald-600 text-white shadow-md'
                : 'bg-white border-gray-200 text-gray-500 hover:border-emerald-300 hover:bg-emerald-50'"
            >
              ✓ Sin defectos
            </button>

            <!-- Guardar y cerrar -->
            <button
              v-if="!props.soloLectura"
              @click="guardarYCerrar"
              :disabled="guardando || !telarTieneDatos"
              class="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-black text-white transition-all shadow-md active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              :class="guardando ? 'bg-gray-400' : 'bg-amber-600 hover:bg-amber-700'"
            >
              <Loader2 v-if="guardando" class="w-4 h-4 animate-spin" />
              <Save v-else class="w-4 h-4" />
              {{ guardando ? 'Guardando…' : 'Guardar' }}
            </button>
          </div>
        </div>
      </transition>
    </teleport>
  </div>
</template>
