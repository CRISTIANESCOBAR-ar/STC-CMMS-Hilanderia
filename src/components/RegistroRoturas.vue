<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { getAuth } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userProfile } from '../services/authService';
import { normalizeSectorValue, DEFAULT_SECTOR } from '../constants/organization';
import { loadPatrullaConfig, cargarPatrullaActiva, crearPatrulla, guardarRondaRoturas } from '../services/patrullaService';
import Swal from 'sweetalert2';
import { useRouter } from 'vue-router';
import { Save, AlertTriangle, Loader2, ChevronDown, BellRing } from 'lucide-vue-next';

const router = useRouter();

// ── Estado ───────────────────────────────────────────────────────
const telares = ref([]);
const registros = ref({});        // { maq_id: { roU: '', roT: '', hora: null } }
const config = ref({ umbralRoturaU: 2, umbralRoturaT: 3 });
const patrullaId = ref(null);
const rondaSeleccionada = ref('ronda_1');
const cargando = ref(true);
const guardando = ref(false);
const grupoSeleccionado = ref('');

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
  return list.sort((a, b) => (a.local_fisico || 0) - (b.local_fisico || 0));
});

const gruposDisponibles = computed(() => {
  const gs = telares.value.map(t => String(t.grp_tear || '').trim()).filter(Boolean);
  return [...new Set(gs)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
});

const alertas = computed(() => {
  const list = [];
  for (const t of telaresOrdenados.value) {
    const r = registros.value[t.id];
    if (!r) continue;
    const roU = parseFloat(r.roU);
    const roT = parseFloat(r.roT);
    if (!isNaN(roU) && roU > config.value.umbralRoturaU) list.push({ maq: t, campo: 'Ro.U', valor: roU, umbral: config.value.umbralRoturaU });
    if (!isNaN(roT) && roT > config.value.umbralRoturaT) list.push({ maq: t, campo: 'Ro.T', valor: roT, umbral: config.value.umbralRoturaT });
  }
  return list;
});

const tieneRegistros = computed(() =>
  Object.values(registros.value).some(r => r.roU !== '' || r.roT !== '')
);

// ── Carga inicial ────────────────────────────────────────────────
onMounted(async () => {
  try {
    // Config umbrales
    config.value = await loadPatrullaConfig();

    // Cargar telares del sector
    const snap = await getDocs(collection(db, 'maquinas'));
    const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    telares.value = todas.filter(m =>
      String(m.tipo || '').toUpperCase() === 'TELAR' &&
      (m.activo ?? true) &&
      sectoresUsuario.value.includes(normalizeSectorValue(m.sector || DEFAULT_SECTOR))
    );

    // Inicializar registros vacíos
    const regs = {};
    for (const t of telares.value) {
      regs[t.id] = { roU: '', roT: '', hora: null };
    }
    registros.value = regs;

    // Buscar o crear patrulla activa
    const uid = getAuth().currentUser?.uid;
    if (uid) {
      const activa = await cargarPatrullaActiva(uid);
      if (activa) {
        patrullaId.value = activa.id;
        // Precargar datos de ronda si ya existen
        const rondaData = activa.rondas?.[rondaSeleccionada.value]?.datos;
        if (rondaData) {
          for (const [maqId, vals] of Object.entries(rondaData)) {
            if (registros.value[maqId]) {
              registros.value[maqId].roU = vals.roU ?? '';
              registros.value[maqId].roT = vals.roT ?? '';
              registros.value[maqId].hora = vals.hora ?? null;
            }
          }
        }
      } else {
        const nueva = await crearPatrulla({
          inspectorUid: uid,
          inspectorNombre: userProfile.value?.nombre || 'Inspector',
          sector: sectoresUsuario.value[0] || DEFAULT_SECTOR,
        });
        patrullaId.value = nueva.id;
      }
    }
  } catch (e) {
    console.error('Error cargando roturas:', e);
  } finally {
    cargando.value = false;
  }
});

// ── Verificación de umbral ───────────────────────────────────────
async function verificarUmbral(telar, campo, valor) {
  const num = parseFloat(valor);
  if (isNaN(num)) return;
  const umbral = campo === 'roU' ? config.value.umbralRoturaU : config.value.umbralRoturaT;
  if (num <= umbral) return;

  const label = campo === 'roU' ? 'Ro.U' : 'Ro.T';
  const nombreTelar = nombreCorto(telar);

  const result = await Swal.fire({
    icon: 'warning',
    title: `${label} = ${num}`,
    html: `<b>${nombreTelar}</b> supera el umbral (${umbral}).<br>¿Solicitar intervención?`,
    showCancelButton: true,
    confirmButtonText: 'Sí, solicitar',
    cancelButtonText: 'Solo registrar',
    confirmButtonColor: '#2563eb',
    cancelButtonColor: '#6b7280',
  });

  if (result.isConfirmed) {
    solicitarIntervencion(telar);
  }
}

// ── Solicitar intervención → guardar ronda + navegar a /llamar con datos precargados ──
async function solicitarIntervencion(telar) {
  // Guardar ronda en Firestore antes de salir para no perder datos
  if (patrullaId.value && tieneRegistros.value) {
    try {
      const datos = {};
      for (const [maqId, vals] of Object.entries(registros.value)) {
        const roU = parseFloat(vals.roU);
        const roT = parseFloat(vals.roT);
        if (!isNaN(roU) || !isNaN(roT)) {
          datos[maqId] = {
            roU: isNaN(roU) ? null : roU,
            roT: isNaN(roT) ? null : roT,
            hora: vals.hora || new Date().toISOString(),
          };
        }
      }
      await guardarRondaRoturas(patrullaId.value, rondaSeleccionada.value, datos);
    } catch (e) {
      console.warn('Auto-save ronda antes de navegar:', e);
    }
  }

  const r = registros.value[telar.id];
  const roU = r ? r.roU : '';
  const roT = r ? r.roT : '';
  const obs = [
    roU !== '' ? `Ro.U: ${roU}` : null,
    roT !== '' ? `Ro.T: ${roT}` : null,
    `${rondaSeleccionada.value === 'ronda_1' ? 'Ronda 1' : 'Ronda 6'} - Patrulla de Calidad`,
  ].filter(Boolean).join(' · ');

  router.push({
    path: '/llamar',
    query: {
      maqId: telar.id,
      tipo: 'TELAR',
      grp: String(telar.grp_tear || '').trim(),
      obs,
      sintomaName: 'Corte de trama',
      origen: 'roturas',
    },
  });
}

// ── Guardar ronda ────────────────────────────────────────────────
async function guardarRonda() {
  if (!patrullaId.value || !tieneRegistros.value) return;
  guardando.value = true;
  try {
    const datos = {};
    for (const [maqId, vals] of Object.entries(registros.value)) {
      const roU = parseFloat(vals.roU);
      const roT = parseFloat(vals.roT);
      if (!isNaN(roU) || !isNaN(roT)) {
        datos[maqId] = {
          roU: isNaN(roU) ? null : roU,
          roT: isNaN(roT) ? null : roT,
          hora: vals.hora || new Date().toISOString(),
        };
      }
    }
    await guardarRondaRoturas(patrullaId.value, rondaSeleccionada.value, datos);
    Swal.fire({ icon: 'success', title: 'Ronda guardada', timer: 1500, showConfirmButton: false });
  } catch (e) {
    console.error('Error guardando ronda:', e);
    Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo guardar la ronda.' });
  } finally {
    guardando.value = false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────
function superaUmbral(maqId, campo) {
  const val = parseFloat(registros.value[maqId]?.[campo]);
  if (isNaN(val)) return false;
  const umbral = campo === 'roU' ? config.value.umbralRoturaU : config.value.umbralRoturaT;
  return val > umbral;
}

function registrarHora(maqId) {
  if (registros.value[maqId] && !registros.value[maqId].hora) {
    registros.value[maqId].hora = new Date().toISOString();
  }
}

function formatHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function onInputDecimal(maqId, campo, event) {
  let val = event.target.value.replace(',', '.');
  val = val.replace(/[^0-9.]/g, '');
  // solo un punto decimal
  const parts = val.split('.');
  if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
  registros.value[maqId][campo] = val;
  event.target.value = val.replace('.', ',');
}

function displayDecimal(val) {
  if (val === '' || val == null) return '';
  return String(val).replace('.', ',');
}

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
</script>

<template>
  <div class="space-y-3">
    <!-- Selector de ronda y grupo -->
    <div class="bg-white p-3 rounded-xl shadow-sm border border-gray-100 space-y-3">
      <div class="flex items-center gap-2">
        <div class="relative flex-1">
          <select v-model="rondaSeleccionada"
                  class="w-full appearance-none bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm font-bold text-blue-700 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-300">
            <option value="ronda_1">Ronda 1 (inicio turno)</option>
            <option value="ronda_6">Ronda 6 (fin turno)</option>
          </select>
          <ChevronDown class="w-4 h-4 text-blue-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
        <div v-if="gruposDisponibles.length > 1" class="relative">
          <select v-model="grupoSeleccionado"
                  class="appearance-none bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 pr-8 focus:outline-none focus:ring-2 focus:ring-gray-300">
            <option value="">Todos</option>
            <option v-for="g in gruposDisponibles" :key="g" :value="g">Grupo {{ parseInt(g, 10) || g }}</option>
          </select>
          <ChevronDown class="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>
      <div class="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[9px] font-bold text-gray-400">
        <span>Roturas Urdimbre 10<sup>5</sup>: {{ config.umbralRoturaU }}</span>
        <span>·</span>
        <span>Roturas Trama 10<sup>5</sup>: {{ config.umbralRoturaT }}</span>
        <span>·</span>
        <span>{{ telaresOrdenados.length }} telares</span>
      </div>
    </div>

    <!-- Alertas activas -->
    <div v-if="alertas.length" class="bg-red-50 border border-red-200 rounded-xl p-3 space-y-1">
      <p class="text-xs font-black text-red-700 flex items-center gap-1">
        <AlertTriangle class="w-3.5 h-3.5" /> {{ alertas.length }} lectura(s) sobre umbral
      </p>
      <p v-for="a in alertas" :key="a.maq.id + a.campo" class="text-[11px] text-red-600 font-medium">
        {{ nombreCorto(a.maq) }} — {{ a.campo }}: {{ a.valor }} (umbral: {{ a.umbral }})
      </p>
    </div>

    <!-- Loading -->
    <div v-if="cargando" class="flex items-center justify-center py-12">
      <Loader2 class="w-6 h-6 text-indigo-400 animate-spin" />
    </div>

    <!-- Grilla de telares -->
    <div v-else class="space-y-2">
      <!-- Header -->
      <div class="grid grid-cols-[1fr_80px_80px_32px] gap-2 px-3 text-[10px] font-black text-gray-400 uppercase tracking-wider">
        <span>Telar</span>
        <span class="text-center">Ro.U</span>
        <span class="text-center">Ro.T</span>
        <span></span>
      </div>

      <!-- Filas -->
      <div
        v-for="t in telaresOrdenados"
        :key="t.id"
        class="grid grid-cols-[1fr_80px_80px_32px] gap-2 items-center bg-white px-3 py-2 rounded-lg border border-gray-100 shadow-sm"
      >
        <div class="min-w-0">
          <p class="text-sm font-black text-gray-800 truncate">{{ nombreCorto(t) }}</p>
          <div class="flex items-center gap-1.5 flex-wrap">
            <span v-if="t.grp_tear" class="text-[10px] text-gray-400 font-medium">{{ grupoLabel(t) }}</span>
            <span v-if="t.g_cmest" class="text-[10px] text-indigo-400 font-bold">{{ gmLabel(t) }}</span>
            <span v-if="registros[t.id]?.hora" class="text-[10px] text-emerald-500 font-medium">{{ formatHora(registros[t.id].hora) }}</span>
          </div>
        </div>

        <input
          :value="displayDecimal(registros[t.id].roU)"
          @input="onInputDecimal(t.id, 'roU', $event)"
          type="text"
          inputmode="decimal"
          placeholder="—"
          @blur="registrarHora(t.id); verificarUmbral(t, 'roU', registros[t.id].roU)"
          class="w-full text-center text-sm font-bold rounded-lg border px-1 py-1.5 focus:outline-none focus:ring-2 transition-colors"
          :class="superaUmbral(t.id, 'roU')
            ? 'border-red-400 bg-red-50 text-red-700 focus:ring-red-300'
            : 'border-gray-200 bg-gray-50 text-gray-800 focus:ring-blue-300'"
        />

        <input
          :value="displayDecimal(registros[t.id].roT)"
          @input="onInputDecimal(t.id, 'roT', $event)"
          type="text"
          inputmode="decimal"
          placeholder="—"
          @blur="registrarHora(t.id); verificarUmbral(t, 'roT', registros[t.id].roT)"
          class="w-full text-center text-sm font-bold rounded-lg border px-1 py-1.5 focus:outline-none focus:ring-2 transition-colors"
          :class="superaUmbral(t.id, 'roT')
            ? 'border-red-400 bg-red-50 text-red-700 focus:ring-red-300'
            : 'border-gray-200 bg-gray-50 text-gray-800 focus:ring-blue-300'"
        />

        <button
          @click="solicitarIntervencion(t)"
          class="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-orange-500 hover:bg-orange-50 transition-colors active:scale-95"
          title="Solicitar intervención"
        >
          <BellRing class="w-4 h-4" />
        </button>
      </div>

      <!-- Vacío -->
      <div v-if="!telaresOrdenados.length" class="text-center py-8 text-sm text-gray-400 font-medium">
        No hay telares asignados a tu sector.
      </div>
    </div>

    <!-- Botón guardar -->
    <button
      v-if="!cargando && telaresOrdenados.length"
      @click="guardarRonda"
      :disabled="guardando || !tieneRegistros"
      class="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-black text-white transition-all shadow-md active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
      :class="guardando ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'"
    >
      <Loader2 v-if="guardando" class="w-4 h-4 animate-spin" />
      <Save v-else class="w-4 h-4" />
      {{ guardando ? 'Guardando…' : 'Guardar Ronda' }}
    </button>
  </div>
</template>
