<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { getAuth } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userProfile } from '../services/authService';
import { normalizeSectorValue, DEFAULT_SECTOR, ESTADOS_TELAR, DEFECTOS_TRAMA } from '../constants/organization';
import { cargarPatrullaActiva, crearPatrulla, guardarRondaParoDefecto, guardarRondaParcialGenerico, cargarPatrullaPorId, cargarRutasPatrulla, iniciarRonda } from '../services/patrullaService';
import Swal from 'sweetalert2';
import { Check, Loader2, ChevronDown, ChevronUp, CloudUpload, AlertTriangle, X, Wrench, Zap } from 'lucide-vue-next';



const props = defineProps({
  rondaKey:          { type: String,  required: true },
  rondaLabel:        { type: String,  default: '' },
  soloLectura:       { type: Boolean, default: false },
  patrullaIdExterno: { type: String,  default: null },
});

const emit = defineEmits(['completada']);

const router = useRouter();

// ── Estado ───────────────────────────────────────────────────────
const telares = ref([]);
const registros = ref({});
const patrullaId = ref(null);
const patrullaData = ref(null);
const cargando = ref(true);
const guardando = ref(false);
const grupoSeleccionado = ref('');
const telarActivo = ref(null);
const rutas = ref([]); // Rutas de Patrulla cargadas de Firestore
const rutaSeleccionada = ref(null); // objeto ruta o null = sin filtro
const pendingRutaId = ref(null); // para restaurar ruta al cargar datos guardados

// Auto-guardado
const autoSaveStatus = ref('idle');
let _autoSaveTimer = null;
let _autoSaveStatusTimer = null;

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
  if (rutaSeleccionada.value?.maquinas?.length) {
    const ordenPorId = new Map(rutaSeleccionada.value.maquinas.map(m => [m.maquinaId, m.orden]));
    list = list.filter(t => ordenPorId.has(t.id));
    return list.sort((a, b) => (ordenPorId.get(a.id) || 999) - (ordenPorId.get(b.id) || 999));
  }
  return list.sort((a, b) => (a.orden_patrulla || 999) - (b.orden_patrulla || 999));
});

const gruposDisponibles = computed(() => {
  const gs = telares.value.map(t => String(t.grp_tear || '').trim()).filter(Boolean);
  return [...new Set(gs)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
});

const resumen = computed(() => {
  let revisados = 0, paros = 0, trabajando = 0;
  for (const t of telaresOrdenados.value) {
    const r = registros.value[t.id];
    if (!r?.estado) continue;
    revisados++;
    if (r.estado === 'trabajando') trabajando++;
    else paros++;
  }
  return { revisados, paros, trabajando, total: telaresOrdenados.value.length };
});

const tieneRegistros = computed(() =>
  Object.values(registros.value).some(r => r.estado)
);

const rondaCompletada = computed(() =>
  patrullaData.value?.rondas?.[props.rondaKey]?.completada === true
);

// ── Helpers visuales ─────────────────────────────────────────────
function estadoInfo(id) {
  return ESTADOS_TELAR.find(e => e.id === id) || { label: id, icon: '?', color: 'gray' };
}

function statusDotClass(maqId) {
  const estado = registros.value[maqId]?.estado;
  if (!estado) return 'bg-gray-200';
  const map = { emerald: 'bg-emerald-400', red: 'bg-red-500', amber: 'bg-amber-400', blue: 'bg-blue-500', purple: 'bg-purple-500', rose: 'bg-rose-500', cyan: 'bg-cyan-500', gray: 'bg-gray-400' };
  return map[estadoInfo(estado).color] || 'bg-gray-400';
}

function estadoBadgeClass(maqId) {
  const estado = registros.value[maqId]?.estado;
  if (!estado) return '';
  const map = { emerald: 'bg-emerald-100 text-emerald-700', red: 'bg-red-100 text-red-700', amber: 'bg-amber-100 text-amber-700', blue: 'bg-blue-100 text-blue-700', purple: 'bg-purple-100 text-purple-700', rose: 'bg-rose-100 text-rose-700', cyan: 'bg-cyan-100 text-cyan-700', gray: 'bg-gray-100 text-gray-600' };
  return map[estadoInfo(estado).color] || 'bg-gray-100 text-gray-600';
}

function estadoButtonClass(maqId, est) {
  const isSelected = registros.value[maqId]?.estado === est.id;
  if (!isSelected) return 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50';
  const map = { emerald: 'bg-emerald-600 border-emerald-600 text-white', red: 'bg-red-600 border-red-600 text-white', amber: 'bg-amber-500 border-amber-500 text-white', blue: 'bg-blue-600 border-blue-600 text-white', purple: 'bg-purple-600 border-purple-600 text-white', rose: 'bg-rose-600 border-rose-600 text-white', cyan: 'bg-cyan-600 border-cyan-600 text-white', gray: 'bg-gray-600 border-gray-600 text-white' };
  return map[est.color] || 'bg-gray-600 border-gray-600 text-white';
}

function nombreCorto(t) {
  const raw = String(t.maquina || t.id || '');
  const nums = raw.replace(/[^0-9]/g, '');
  const n = parseInt(nums.slice(-3), 10);
  return `Toyota ${isNaN(n) ? raw : n}`;
}

function grupoLabel(t) {
  const g = String(t.grp_tear || '').trim();
  if (!g) return '';
  const last = parseInt(g.slice(-1), 10);
  return `GP ${isNaN(last) ? g : last}`;
}

// ── Interacción ──────────────────────────────────────────────────
function setRuta(ruta) {
  if (props.soloLectura || rondaCompletada.value) return;
  rutaSeleccionada.value = ruta;
  grupoSeleccionado.value = ''; // re-mostrar todos los grupos al cambiar ruta
}

function scrollToTelarRow(id) {
  setTimeout(() => {
    const el = document.getElementById('telar-row-' + id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 280);
}

function toggleTelar(telarId) {
  if (telarActivo.value === telarId) {
    telarActivo.value = null;
  } else {
    telarActivo.value = telarId;
    scrollToTelarRow(telarId);
  }
}

function solicitarIntervencion(t, tipoInterv) {
  // Guardar contexto para restaurar al volver
  sessionStorage.setItem('patrol_intervention_return', JSON.stringify({
    telarId: t.id,
    rondaKey: props.rondaKey,
    tipoInterv,
  }));
  // Auto-save antes de navegar
  clearTimeout(_autoSaveTimer);
  ejecutarAutoSave();
  const grp = String(t.grp_tear || '').trim();
  const obs = registros.value[t.id]?.observacion || '';
  router.push({
    path: '/llamar',
    query: {
      maqId: t.id,
      tipo: 'TELAR',
      ...(grp ? { grp } : {}),
      ...(obs ? { obs } : {}),
      tipoInterv,
      origen: 'patrulla',
    },
  });
}

function seleccionarEstado(telarId, estadoId) {
  if (rondaCompletada.value || props.soloLectura) return;
  if (!registros.value[telarId]) return;
  registros.value[telarId].estado = estadoId;
  if (!registros.value[telarId].hora) {
    registros.value[telarId].hora = new Date().toISOString();
  }
  programarAutoSave();
  // Si es "trabajando" no necesita observación → avanzar automáticamente
  if (estadoId === 'trabajando') {
    avanzarSiguiente(telarId);
  }
}

function toggleDefectoCalidad(telarId, defId) {
  if (rondaCompletada.value || props.soloLectura) return;
  registros.value[telarId].defectoCalidad = registros.value[telarId].defectoCalidad === defId ? '' : defId;
  programarAutoSave();
}

function listo(telarId) {
  programarAutoSave();
  avanzarSiguiente(telarId);
}

function avanzarSiguiente(telarId) {
  const lista = telaresOrdenados.value;
  const idx = lista.findIndex(t => t.id === telarId);
  if (idx >= 0 && idx < lista.length - 1) {
    const next = lista[idx + 1];
    telarActivo.value = next.id;
    // Esperar a que la Transition abra la tarjeta antes de scrollear
    scrollToTelarRow(next.id);
  } else {
    telarActivo.value = null;
  }
}

// ── Auto-guardado ────────────────────────────────────────────────
function programarAutoSave() {
  if (!patrullaId.value) return;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => ejecutarAutoSave(), 3000);
}

async function ejecutarAutoSave() {
  if (!patrullaId.value || !tieneRegistros.value || rondaCompletada.value) return;
  autoSaveStatus.value = 'saving';
  try {
    const datos = buildDatos();
    if (!Object.keys(datos).length) { autoSaveStatus.value = 'idle'; return; }
    await guardarRondaParcialGenerico(patrullaId.value, props.rondaKey, 'paro_defecto', datos);
    autoSaveStatus.value = 'saved';
    clearTimeout(_autoSaveStatusTimer);
    _autoSaveStatusTimer = setTimeout(() => { autoSaveStatus.value = 'idle'; }, 4000);
  } catch (e) {
    console.error('Auto-save paro/defecto error:', e);
    autoSaveStatus.value = 'error';
    clearTimeout(_autoSaveStatusTimer);
    _autoSaveStatusTimer = setTimeout(() => { autoSaveStatus.value = 'idle'; }, 5000);
  }
}

function buildDatos() {
  const datos = {};
  for (const [maqId, vals] of Object.entries(registros.value)) {
    if (vals.estado) {
      datos[maqId] = {
        estado: vals.estado,
        observacion: vals.observacion || '',
        hora: vals.hora || new Date().toISOString(),
        ...(vals.intervencion ? { intervencion: vals.intervencion } : {}),
        ...(vals.defectoCalidad ? { defectoCalidad: vals.defectoCalidad } : {}),
      };
    }
  }
  return datos;
}

async function completarRonda() {
  if (!patrullaId.value || !tieneRegistros.value) return;
  guardando.value = true;
  try {
    const datos = buildDatos();
    await guardarRondaParoDefecto(patrullaId.value, props.rondaKey, datos, {
      rutaId: rutaSeleccionada.value?.id || null,
      rutaNombre: rutaSeleccionada.value?.nombre || null,
    });
    if (!patrullaData.value.rondas) patrullaData.value.rondas = {};
    patrullaData.value.rondas[props.rondaKey] = { tipo: 'paro_defecto', completada: true, datos };
    Swal.fire({ icon: 'success', title: 'Ronda completada', timer: 1500, showConfirmButton: false });
    emit('completada');
  } catch (e) {
    console.error('Error completando ronda:', e);
    Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo completar la ronda.' });
  } finally {
    guardando.value = false;
  }
}

function cargarDatosRonda(patrulla) {
  const rondaData = patrulla.rondas?.[props.rondaKey];
  if (rondaData?.rutaId) pendingRutaId.value = rondaData.rutaId;
  if (!rondaData?.datos) return;
  for (const [maqId, vals] of Object.entries(rondaData.datos)) {
    if (registros.value[maqId]) {
      registros.value[maqId].estado = vals.estado || '';
      registros.value[maqId].observacion = vals.observacion || '';
      registros.value[maqId].hora = vals.hora || null;
      if (vals.intervencion) registros.value[maqId].intervencion = vals.intervencion;
      if (vals.defectoCalidad) registros.value[maqId].defectoCalidad = vals.defectoCalidad;
    }
  }
}

// ── Carga ────────────────────────────────────────────────────────
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
      regs[t.id] = { estado: '', observacion: '', hora: null, intervencion: null, defectoCalidad: '' };
    }
    registros.value = regs;

    const uid = getAuth().currentUser?.uid;
    if (uid) {
      const activa = props.patrullaIdExterno
        ? await cargarPatrullaPorId(props.patrullaIdExterno)
        : await cargarPatrullaActiva(uid);
      if (activa) {
        patrullaId.value = activa.id;
        patrullaData.value = activa;
        cargarDatosRonda(activa);
        if (!props.soloLectura && !activa.rondas?.[props.rondaKey]?.horaInicio) {
          iniciarRonda(activa.id, props.rondaKey, 'paro_defecto').catch(() => {});
        }
      } else if (!props.patrullaIdExterno) {
        const nueva = await crearPatrulla({
          inspectorUid: uid,
          inspectorNombre: userProfile.value?.nombre || getAuth().currentUser?.displayName || getAuth().currentUser?.email || 'Inspector',
          inspectorEmail: userProfile.value?.email || getAuth().currentUser?.email || null,
          sector: sectoresUsuario.value[0] || DEFAULT_SECTOR,
        });
        patrullaId.value = nueva.id;
        patrullaData.value = { id: nueva.id, rondas: {} };
      }
    }
    // Cargar Rutas de Patrulla activas para TEJEDURIA
    const rutasCargadas = await cargarRutasPatrulla(null, 'TEJEDURIA');
    rutas.value = rutasCargadas;
    // Restaurar ruta seleccionada si había datos guardados
    if (pendingRutaId.value) {
      rutaSeleccionada.value = rutasCargadas.find(r => r.id === pendingRutaId.value) || null;
      pendingRutaId.value = null;
    }
    // Restaurar estado al volver de Solicitar Intervención
    const returnStr = sessionStorage.getItem('patrol_intervention_return');
    if (returnStr) {
      try {
        const ret = JSON.parse(returnStr);
        if (ret.rondaKey === props.rondaKey && ret.telarId && registros.value[ret.telarId]) {
          // Guardar datos de la intervención en el registro del telar
          if (ret.sintomaLabel || ret.obsRaw) {
            registros.value[ret.telarId].intervencion = {
              tipo: ret.tipoInterv || '',
              sintoma: ret.sintomaLabel || '',
              obs: ret.obsRaw || '',
              hora: new Date().toISOString(),
            };
            // Si no tenía obs previa, llenar con síntoma + obs de la intervención
            if (!registros.value[ret.telarId].observacion) {
              const partes = [ret.sintomaLabel, ret.obsRaw].filter(Boolean);
              if (partes.length) registros.value[ret.telarId].observacion = partes.join(' — ');
            }
            // Auto-guardar inmediatamente
            programarAutoSave();
          }
          // Reabrir la tarjeta del telar que disparó la intervención
          telarActivo.value = ret.telarId;
          scrollToTelarRow(ret.telarId);
        }
      } catch {}
      sessionStorage.removeItem('patrol_intervention_return');
    }
  } catch (e) {
    console.error('Error cargando paro/defecto:', e);
  } finally {
    cargando.value = false;
  }
});
</script>

<template>
  <div class="space-y-2">
    <!-- Cargando -->
    <div v-if="cargando" class="flex items-center justify-center py-16">
      <Loader2 class="w-6 h-6 text-indigo-400 animate-spin" />
    </div>

    <template v-else>
      <!-- ═══ STICKY HEADER ═══ -->
      <div class="sticky top-0 z-30 bg-gray-50 -mx-3 px-3 pb-2 pt-1">

        <!-- Resumen + filtros (única fila) -->
        <div class="flex items-center gap-2 flex-wrap">
          <span class="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full">✓ {{ resumen.trabajando }}</span>
          <span class="bg-red-100 text-red-700 text-[10px] font-bold px-2 py-0.5 rounded-full">⚠ {{ resumen.paros }} paros</span>
          <span class="text-[10px] text-gray-400 font-bold">{{ resumen.revisados }}/{{ resumen.total }}</span>
          <span v-if="rondaCompletada" class="bg-blue-100 text-blue-700 text-[10px] font-black px-2 py-0.5 rounded-full">✓ Completada</span>

          <!-- Select Ruta de patrulla -->
          <div v-if="rutas.length > 0" class="relative ml-auto">
            <select
              :value="rutaSeleccionada?.id || ''"
              @change="setRuta(rutas.find(r => r.id === $event.target.value) || null)"
              :disabled="props.soloLectura || rondaCompletada"
              class="appearance-none bg-white border border-violet-200 rounded-lg pl-2 pr-6 py-1 text-[11px] font-bold text-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:opacity-60 max-w-[130px] truncate"
            >
              <option value="">Todas las rutas</option>
              <option v-for="r in rutas" :key="r.id" :value="r.id">{{ r.nombre }}</option>
            </select>
            <ChevronDown class="w-3 h-3 text-violet-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <!-- Select Grupo -->
          <div v-if="gruposDisponibles.length > 1" class="relative" :class="rutas.length > 0 ? '' : 'ml-auto'">
            <select
              v-model="grupoSeleccionado"
              class="appearance-none bg-white border border-gray-200 rounded-lg pl-2.5 pr-6 py-1 text-[11px] font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            >
              <option value="">Todos los grupos</option>
              <option v-for="g in gruposDisponibles" :key="g" :value="g">Grupo {{ parseInt(g, 10) || g }}</option>
            </select>
            <ChevronDown class="w-3 h-3 text-gray-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      <!-- ═══ LISTA DE TELARES ═══ -->
      <div class="space-y-1.5">
        <div v-for="t in telaresOrdenados" :key="t.id" :id="'telar-row-' + t.id">

          <!-- Fila principal -->
          <button
            @click="toggleTelar(t.id)"
            class="w-full flex items-center gap-3 px-3 py-3 bg-white border transition-all active:scale-[0.99] text-left"
            :class="telarActivo === t.id
              ? 'border-indigo-200 border-b-transparent bg-indigo-50/40 rounded-t-xl'
              : 'border-gray-200 rounded-xl hover:border-gray-300'"
          >
            <!-- Dot de estado + indicador de intervención -->
            <div class="relative shrink-0">
              <div
                class="w-2.5 h-2.5 rounded-full transition-colors"
                :class="statusDotClass(t.id)"
              ></div>
              <div
                v-if="registros[t.id]?.intervencion"
                class="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-400 border border-white"
              ></div>
            </div>

            <!-- Info telar -->
            <div class="flex-1 min-w-0">
              <p class="text-sm font-black text-gray-800 leading-tight">{{ nombreCorto(t) }}</p>
              <p v-if="grupoLabel(t)" class="text-[10px] text-gray-400 font-medium">{{ grupoLabel(t) }}</p>
            </div>

            <!-- Badge de estado actual -->
            <div class="shrink-0 flex flex-col items-end gap-0.5 min-w-0">
              <div
                v-if="registros[t.id]?.estado"
                class="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                :class="estadoBadgeClass(t.id)"
              >
                <span>{{ estadoInfo(registros[t.id].estado).icon }}</span>
                <span class="hidden xs:inline">{{ estadoInfo(registros[t.id].estado).label }}</span>
              </div>
              <span v-else class="text-[10px] text-gray-300 font-medium">Sin revisar</span>
              <!-- Sub-badge defecto de calidad -->
              <div
                v-if="registros[t.id]?.defectoCalidad"
                class="text-[9px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0 rounded-full max-w-[100px] truncate"
              >
                {{ DEFECTOS_TRAMA.find(d => d.id === registros[t.id].defectoCalidad)?.label }}
              </div>
            </div>

            <!-- Chevron -->
            <ChevronUp v-if="telarActivo === t.id" class="w-4 h-4 text-indigo-400 shrink-0" />
            <ChevronDown v-else class="w-4 h-4 text-gray-300 shrink-0" />
          </button>

          <!-- ── TARJETA EXPANDIDA ── -->
          <Transition
            enter-active-class="transition-all duration-200 ease-out"
            enter-from-class="opacity-0 -translate-y-2"
            enter-to-class="opacity-100 translate-y-0"
            leave-active-class="transition-all duration-150 ease-in"
            leave-from-class="opacity-100 translate-y-0"
            leave-to-class="opacity-0 -translate-y-2"
          >
            <div
              v-if="telarActivo === t.id"
              class="bg-white border border-t-0 border-indigo-200 rounded-b-xl px-4 pt-3 pb-4 space-y-3 shadow-sm"
            >
              <!-- Banner de intervención solicitada -->
              <div
                v-if="registros[t.id]?.intervencion"
                class="flex items-start gap-2.5 rounded-xl border px-3 py-2.5"
                :class="registros[t.id].intervencion.tipo === 'MECANICO'
                  ? 'bg-blue-50 border-blue-200'
                  : 'bg-amber-50 border-amber-200'"
              >
                <Wrench v-if="registros[t.id].intervencion.tipo === 'MECANICO'" class="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <Zap v-else class="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div class="min-w-0 flex-1">
                  <p
                    class="text-[10px] font-black uppercase tracking-wide"
                    :class="registros[t.id].intervencion.tipo === 'MECANICO' ? 'text-blue-700' : 'text-amber-700'"
                  >🔔 Intervención solicitada</p>
                  <p v-if="registros[t.id].intervencion.sintoma" class="text-xs font-bold text-gray-800 mt-0.5">
                    {{ registros[t.id].intervencion.sintoma }}
                  </p>
                  <p v-if="registros[t.id].intervencion.obs" class="text-[11px] text-gray-500 mt-0.5">
                    {{ registros[t.id].intervencion.obs }}
                  </p>
                </div>
              </div>

              <!-- Header de tarjeta -->
              <div class="flex items-center justify-between">
                <p class="text-[11px] font-black text-gray-500 uppercase tracking-wider">
                  {{ nombreCorto(t) }} — ¿Cómo está?
                </p>
                <button
                  @click="telarActivo = null"
                  class="p-1 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>

              <!-- Grid de estados -->
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="est in ESTADOS_TELAR"
                  :key="est.id"
                  @click="seleccionarEstado(t.id, est.id)"
                  :disabled="rondaCompletada || props.soloLectura"
                  class="flex items-center gap-2.5 px-3 py-3 rounded-xl border text-sm font-bold transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
                  :class="estadoButtonClass(t.id, est)"
                >
                  <span class="text-xl leading-none">{{ est.icon }}</span>
                  <span>{{ est.label }}</span>
                </button>
              </div>

              <!-- Selector de defecto de calidad (solo para paro_calidad) -->
              <div v-if="registros[t.id]?.estado === 'paro_calidad'" class="space-y-1.5">
                <label class="text-[9px] font-black text-gray-400 uppercase tracking-wider">Defecto encontrado</label>
                <div class="grid grid-cols-2 gap-1.5">
                  <button
                    v-for="def in DEFECTOS_TRAMA"
                    :key="def.id"
                    @click="toggleDefectoCalidad(t.id, def.id)"
                    :disabled="rondaCompletada || props.soloLectura"
                    class="text-left text-xs px-2.5 py-2 rounded-lg border font-semibold transition-all active:scale-[0.97] disabled:opacity-50"
                    :class="registros[t.id].defectoCalidad === def.id
                      ? 'bg-rose-600 border-rose-600 text-white'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-rose-300 hover:bg-rose-50'"
                  >
                    {{ def.label }}
                  </button>
                </div>
              </div>

              <!-- Campo de observación -->
              <div v-if="registros[t.id]?.estado && registros[t.id].estado !== 'trabajando'" class="space-y-1">
                <label class="text-[9px] font-black text-gray-400 uppercase tracking-wider">Observación</label>
                <input
                  type="text"
                  v-model="registros[t.id].observacion"
                  @blur="programarAutoSave()"
                  placeholder="Detalle del paro (opcional)..."
                  :disabled="rondaCompletada || props.soloLectura"
                  class="w-full text-xs border border-gray-200 rounded-lg px-3 py-2.5 text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
                />
              </div>

              <!-- Botón Solicitar Intervención (Paro Mec/Elec) -->
              <button
                v-if="!props.soloLectura && !rondaCompletada &&
                  (registros[t.id]?.estado === 'paro_mecanico' || registros[t.id]?.estado === 'paro_electrico')"
                @click="solicitarIntervencion(t, registros[t.id]?.estado === 'paro_mecanico' ? 'MECANICO' : 'ELECTRICO')"
                class="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-black transition-all active:scale-[0.98] shadow-sm"
                :class="registros[t.id]?.estado === 'paro_mecanico'
                  ? 'bg-blue-50 border-blue-500 text-blue-700 hover:bg-blue-100'
                  : 'bg-amber-50 border-amber-500 text-amber-700 hover:bg-amber-100'"
              >
                <Wrench v-if="registros[t.id]?.estado === 'paro_mecanico'" class="w-4 h-4" />
                <Zap v-else class="w-4 h-4" />
                Solicitar Intervención
              </button>

              <!-- Botón Listo → siguiente -->
              <button
                v-if="!props.soloLectura && !rondaCompletada && registros[t.id]?.estado"
                @click="listo(t.id)"
                class="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 transition-all active:scale-[0.98] shadow-sm"
              >
                <Check class="w-3.5 h-3.5" />
                Listo — Siguiente
              </button>
            </div>
          </Transition>
        </div>
      </div>

      <!-- Auto-guardado -->
      <div
        v-if="autoSaveStatus !== 'idle'"
        class="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-all"
        :class="{
          'text-blue-500 bg-blue-50': autoSaveStatus === 'saving',
          'text-emerald-600 bg-emerald-50': autoSaveStatus === 'saved',
          'text-red-500 bg-red-50': autoSaveStatus === 'error',
        }"
      >
        <Loader2 v-if="autoSaveStatus === 'saving'" class="w-3 h-3 animate-spin" />
        <CloudUpload v-else-if="autoSaveStatus === 'saved'" class="w-3 h-3" />
        <AlertTriangle v-else-if="autoSaveStatus === 'error'" class="w-3 h-3" />
        {{ autoSaveStatus === 'saving' ? 'Guardando borrador…' : autoSaveStatus === 'saved' ? 'Borrador guardado ✓' : 'Error al guardar' }}
      </div>

      <!-- Botón completar ronda -->
      <button
        v-if="!rondaCompletada && !props.soloLectura"
        @click="completarRonda"
        :disabled="guardando || !tieneRegistros"
        class="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-black text-white transition-all shadow-md active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
        :class="guardando ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'"
      >
        <Loader2 v-if="guardando" class="w-4 h-4 animate-spin" />
        <Check v-else class="w-4 h-4" />
        {{ guardando ? 'Guardando…' : 'Completar Ronda' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>

