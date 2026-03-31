<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { collection, getDocs, query } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { crearParo, actualizarParo, eliminarParo, suscribirParos } from '../services/paroTelarService';
import { getTurnoActual } from '../constants/organization';
import { Plus, X, Save, Trash2, Pencil, Clock } from 'lucide-vue-next';
import Swal from 'sweetalert2';

// ── Estado general ──
const cargando = ref(true);
const guardando = ref(false);
const paros = ref([]);
const telaresMaquinas = ref([]);
const mostrarForm = ref(false);
const editandoId = ref(null);

// ── Fecha y turno ──
const fechaHoy = () => {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
};
const fechaReporte = ref(fechaHoy());
const fechaInput = computed({
  get: () => fechaReporte.value.replace(/\//g, '-'),
  set: (v) => { fechaReporte.value = v.replace(/-/g, '/'); }
});
const turnoActual = computed(() => getTurnoActual());
const supervisorNombre = computed(() => {
  const u = auth.currentUser;
  return u?.displayName || u?.email?.split('@')[0] || 'Supervisor';
});

// ── Formulario ──
const form = ref(resetForm());

function resetForm() {
  return {
    telar: '',
    codigo: 101,
    horaParo: '',
    horaInicioAnudado: '',
    horaFinAnudado: '',
    articulo: '',
    partida: '',
    plegador: '',
    color: '',
    anudadores: ['', '', ''],
    hilosCruzados: false,
    revisor: ''
  };
}

// Cálculo de tiempo total en minutos
const tiempoTotal = computed(() => {
  const { horaParo, horaFinAnudado } = form.value;
  if (!horaParo || !horaFinAnudado) return null;
  const [h1, m1] = horaParo.split(':').map(Number);
  const [h2, m2] = horaFinAnudado.split(':').map(Number);
  if (isNaN(h1) || isNaN(m1) || isNaN(h2) || isNaN(m2)) return null;
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60; // cruza medianoche
  return mins;
});

const tiempoTotalStr = computed(() => {
  if (tiempoTotal.value == null) return '';
  const h = Math.floor(tiempoTotal.value / 60);
  const m = tiempoTotal.value % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
});

// Input de hora: solo 4 dígitos → auto-formatea HH:MM
function onHoraInput(ev, field) {
  const raw = ev.target.value.replace(/\D/g, '').slice(0, 4);
  ev.target.value = raw;
  if (raw.length === 4) {
    const hh = raw.slice(0, 2);
    const mm = raw.slice(2, 4);
    if (Number(hh) <= 23 && Number(mm) <= 59) {
      form.value[field] = `${hh}:${mm}`;
      ev.target.value = `${hh}:${mm}`;
      autoJump(ev);
    }
  }
}
function onHoraBlur(ev, field) {
  const raw = ev.target.value.replace(/\D/g, '');
  if (raw.length === 4) {
    const hh = raw.slice(0, 2);
    const mm = raw.slice(2, 4);
    if (Number(hh) <= 23 && Number(mm) <= 59) {
      form.value[field] = `${hh}:${mm}`;
      ev.target.value = `${hh}:${mm}`;
      return;
    }
  }
  if (raw.length < 4 && raw.length > 0) {
    ev.target.value = form.value[field] || '';
  }
}

// Auto-jump al siguiente campo
function autoJump(ev) {
  const next = ev.target.dataset.next;
  if (next) {
    const el = document.querySelector(`[data-field="${next}"]`);
    if (el) el.focus();
  }
}

function onArticuloInput(ev) {
  const raw = ev.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase();
  form.value.articulo = raw;
  ev.target.value = raw;
  if (raw.length === 10) autoJump(ev);
}

function onPartidaInput(ev) {
  const raw = ev.target.value.replace(/\D/g, '').slice(0, 7);
  form.value.partida = raw;
  ev.target.value = raw;
  if (raw.length === 7) autoJump(ev);
}

function onPartidaBlur(ev) {
  const raw = form.value.partida.replace(/\D/g, '');
  if (raw.length > 0 && raw.length <= 7) {
    const padded = raw.padStart(7, '0');
    const formatted = `${padded[0]}-${padded.slice(1, 5)}-${padded.slice(5, 7)}`;
    form.value.partida = formatted;
    ev.target.value = formatted;
  }
}

function onPlegadorInput(ev) {
  const raw = ev.target.value.replace(/\D/g, '').slice(0, 5);
  form.value.plegador = raw;
  ev.target.value = raw;
  if (raw.length === 5) autoJump(ev);
}

function onColorInput(ev) {
  const raw = ev.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
  form.value.color = raw;
  ev.target.value = raw;
  if (raw.length === 4) autoJump(ev);
}

function onLegajoInput(ev, index) {
  const raw = ev.target.value.replace(/\D/g, '').slice(0, 4);
  if (index !== undefined) {
    form.value.anudadores[index] = raw;
  } else {
    form.value.revisor = raw;
  }
  ev.target.value = raw;
  if (raw.length === 4) autoJump(ev);
}

// ── Suscripción Firestore ──
let unsubscribeFn = null;

function suscribir() {
  if (unsubscribeFn) unsubscribeFn();
  cargando.value = true;
  unsubscribeFn = suscribirParos(fechaReporte.value, (data) => {
    paros.value = data;
    cargando.value = false;
  });
}

onMounted(async () => {
  try {
    const snap = await getDocs(query(collection(db, 'maquinas')));
    telaresMaquinas.value = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(m => m.tipo === 'TELAR' && (m.activo ?? true))
      .sort((a, b) => (a.orden_patrulla || 999) - (b.orden_patrulla || 999));
  } catch (e) {
    console.error('Error cargando telares:', e);
  }
  suscribir();
});

watch(fechaReporte, () => {
  paros.value = [];
  cerrarForm();
  suscribir();
});

onUnmounted(() => { if (unsubscribeFn) unsubscribeFn(); });

// ── Acciones del formulario ──
function abrirNuevo() {
  editandoId.value = null;
  form.value = resetForm();
  mostrarForm.value = true;
  nextTick(() => {
    const el = document.querySelector('[data-pa-telar]');
    if (el) el.focus();
  });
}

function abrirEdicion(paro) {
  editandoId.value = paro.id;
  form.value = {
    telar: paro.telar || '',
    codigo: paro.codigo || 101,
    horaParo: paro.horaParo || '',
    horaInicioAnudado: paro.horaInicioAnudado || '',
    horaFinAnudado: paro.horaFinAnudado || '',
    articulo: paro.articulo || '',
    partida: paro.partida || '',
    plegador: paro.plegador || '',
    color: paro.color || '',
    anudadores: [
      (paro.anudadores || [])[0] || '',
      (paro.anudadores || [])[1] || '',
      (paro.anudadores || [])[2] || ''
    ],
    hilosCruzados: paro.hilosCruzados || false,
    revisor: paro.revisor || ''
  };
  mostrarForm.value = true;
}

function cerrarForm() {
  mostrarForm.value = false;
  editandoId.value = null;
  form.value = resetForm();
}

async function guardar() {
  const f = form.value;
  if (!f.telar) {
    Swal.fire('', 'Seleccioná un telar', 'warning');
    return;
  }
  if (!f.horaParo) {
    Swal.fire('', 'Ingresá la hora de paro', 'warning');
    return;
  }

  guardando.value = true;
  const datos = {
    telar: f.telar,
    codigo: f.codigo,
    horaParo: f.horaParo,
    horaInicioAnudado: f.horaInicioAnudado || null,
    horaFinAnudado: f.horaFinAnudado || null,
    tiempoTotal: tiempoTotal.value,
    articulo: f.articulo.trim(),
    partida: f.partida.trim(),
    plegador: f.plegador.trim(),
    color: f.color.trim(),
    anudadores: f.anudadores.filter(Boolean),
    hilosCruzados: f.hilosCruzados,
    revisor: f.revisor.trim(),
    turno: turnoActual.value,
    supervisor: auth.currentUser?.uid || '',
    supervisorNombre: supervisorNombre.value
  };

  try {
    if (editandoId.value) {
      await actualizarParo(fechaReporte.value, editandoId.value, datos);
    } else {
      await crearParo(fechaReporte.value, datos);
    }
    Swal.fire({ icon: 'success', title: 'Guardado', timer: 1200, showConfirmButton: false });
    cerrarForm();
  } catch (e) {
    console.error(e);
    Swal.fire('Error', 'No se pudo guardar', 'error');
  } finally {
    guardando.value = false;
  }
}

async function eliminarRegistro(paro) {
  const res = await Swal.fire({
    title: '¿Eliminar este registro?',
    text: `Telar ${telarLabel(paro.telar)} — ${paro.horaParo}`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Eliminar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc2626'
  });
  if (!res.isConfirmed) return;
  try {
    await eliminarParo(fechaReporte.value, paro.id);
    Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1000, showConfirmButton: false });
  } catch (e) {
    Swal.fire('Error', 'No se pudo eliminar', 'error');
  }
}

// ── Helpers ──
function telarLabel(maquina) {
  const code = String(maquina);
  return code.slice(-2).replace(/^0/, '');
}

// Stats
const stats = computed(() => {
  const total = paros.value.length;
  const termino = paros.value.filter(p => p.codigo === 101).length;
  const tiempoTotalMin = paros.value.reduce((acc, p) => acc + (p.tiempoTotal || 0), 0);
  const hT = Math.floor(tiempoTotalMin / 60);
  const mT = tiempoTotalMin % 60;
  // Tiempo sin atención: desde horaParo hasta horaInicioAnudado
  const sinAtencionMin = paros.value.reduce((acc, p) => {
    if (!p.horaParo || !p.horaInicioAnudado) return acc;
    const [h1, m1] = p.horaParo.split(':').map(Number);
    const [h2, m2] = p.horaInicioAnudado.split(':').map(Number);
    if (isNaN(h1) || isNaN(m1) || isNaN(h2) || isNaN(m2)) return acc;
    let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (mins < 0) mins += 24 * 60;
    return acc + mins;
  }, 0);
  const hS = Math.floor(sinAtencionMin / 60);
  const mS = sinAtencionMin % 60;
  return {
    total, termino,
    tiempoStr: `${hT}:${String(mT).padStart(2, '0')}`,
    sinAtencionStr: `${hS}:${String(mS).padStart(2, '0')}`
  };
});

// Paros filtrados por turno actual
const parosFiltrados = computed(() => paros.value);
</script>

<template>
  <div class="min-h-[calc(100vh-110px)] bg-gray-50 flex flex-col">
    <main class="flex-1 max-w-4xl mx-auto w-full px-3 pt-3 pb-6 flex flex-col space-y-3 overflow-y-auto">

      <!-- Header -->
      <div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div class="px-3 py-2 flex items-center gap-2">
          <input type="date" v-model="fechaInput" class="px-2 py-1.5 rounded-lg border border-gray-300 text-sm font-bold text-gray-700 focus:outline-none focus:border-blue-500" />
          <span class="px-2 py-1 rounded-lg text-xs font-black uppercase" :class="turnoActual === 'A' ? 'bg-blue-100 text-blue-700' : turnoActual === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'">
            Turno {{ turnoActual }}
          </span>
          <div class="flex-1" />
          <button @click="abrirNuevo" class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 active:scale-95">
            <Plus class="w-4 h-4" /> Nuevo
          </button>
        </div>
        <div class="px-3 pb-1.5 -mt-0.5">
          <span class="text-xs font-bold text-gray-400 truncate">{{ supervisorNombre }}</span>
        </div>

        <!-- Stats -->
        <div class="px-3 py-1.5 border-t border-gray-100">
          <div class="grid grid-cols-4 gap-1.5">
            <div class="bg-gray-50 border border-gray-200 rounded-lg px-1.5 py-1 text-center">
              <p class="text-base font-black text-gray-800 leading-tight">{{ stats.total }}</p>
              <p class="text-[9px] font-bold text-gray-400 uppercase">Parado</p>
            </div>
            <div class="bg-blue-50 border border-blue-200 rounded-lg px-1.5 py-1 text-center">
              <p class="text-base font-black text-blue-700 leading-tight">{{ stats.termino }}</p>
              <p class="text-[9px] font-bold text-blue-400 uppercase">Término</p>
            </div>
            <div class="bg-orange-50 border border-orange-200 rounded-lg px-1.5 py-1 text-center">
              <p class="text-base font-black text-orange-700 leading-tight">{{ stats.sinAtencionStr }}</p>
              <p class="text-[9px] font-bold text-orange-400 uppercase leading-tight">Sin atenc.</p>
            </div>
            <div class="bg-amber-50 border border-amber-200 rounded-lg px-1.5 py-1 text-center">
              <p class="text-base font-black text-amber-700 leading-tight">{{ stats.tiempoStr }}</p>
              <p class="text-[9px] font-bold text-amber-400 uppercase leading-tight">T. parado</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Formulario -->
      <div v-if="mostrarForm" class="bg-white rounded-2xl border border-blue-200 shadow-lg overflow-hidden">
        <div class="flex items-center justify-between px-4 py-2 bg-blue-50 border-b border-blue-100">
          <span class="text-sm font-black text-blue-800">{{ editandoId ? 'Editar Paro' : 'Nuevo Paro' }}</span>
          <button @click="cerrarForm" class="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 active:scale-90">
            <X class="w-4 h-4" />
          </button>
        </div>

        <div class="px-4 py-3 space-y-3">
          <!-- Telar + Código -->
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="text-[10px] font-black text-gray-400 uppercase">Telar</label>
              <select data-pa-telar v-model="form.telar" class="w-full mt-0.5 px-2 py-2 rounded-lg border border-gray-300 text-sm font-bold focus:outline-none focus:border-blue-500">
                <option value="">Seleccionar</option>
                <option v-for="m in telaresMaquinas" :key="m.maquina" :value="String(m.maquina)">
                  Toyota {{ telarLabel(m.maquina) }}
                </option>
              </select>
            </div>
            <div>
              <label class="text-[10px] font-black text-gray-400 uppercase">Código</label>
              <div class="flex gap-1 mt-0.5">
                <button @click="form.codigo = 101" class="flex-1 py-2 rounded-lg text-sm font-black transition-all" :class="form.codigo === 101 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'">
                  101
                </button>
                <button @click="form.codigo = 102" class="flex-1 py-2 rounded-lg text-sm font-black transition-all" :class="form.codigo === 102 ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'">
                  102
                </button>
              </div>
            </div>
          </div>

          <!-- Tiempos -->
          <div>
            <label class="text-[10px] font-black text-gray-400 uppercase">Tiempos</label>
            <div class="grid grid-cols-3 gap-2 mt-0.5">
              <div>
                <span class="text-[10px] text-gray-400">Paro</span>
                <input data-field="horaParo" data-next="horaInicio" type="text" inputmode="numeric" maxlength="5" :value="form.horaParo" @input="onHoraInput($event, 'horaParo')" @blur="onHoraBlur($event, 'horaParo')" placeholder="HHMM" class="w-full px-2 py-2 rounded-lg border border-gray-300 text-sm font-bold text-center focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <span class="text-[10px] text-gray-400">Inicio Anud.</span>
                <input data-field="horaInicio" data-next="horaFin" type="text" inputmode="numeric" maxlength="5" :value="form.horaInicioAnudado" @input="onHoraInput($event, 'horaInicioAnudado')" @blur="onHoraBlur($event, 'horaInicioAnudado')" placeholder="HHMM" class="w-full px-2 py-2 rounded-lg border border-gray-300 text-sm font-bold text-center focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <span class="text-[10px] text-gray-400">Fin Anud.</span>
                <input data-field="horaFin" data-next="articulo" type="text" inputmode="numeric" maxlength="5" :value="form.horaFinAnudado" @input="onHoraInput($event, 'horaFinAnudado')" @blur="onHoraBlur($event, 'horaFinAnudado')" placeholder="HHMM" class="w-full px-2 py-2 rounded-lg border border-gray-300 text-sm font-bold text-center focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            <div v-if="tiempoTotalStr" class="mt-1 flex items-center gap-1 text-xs font-bold" :class="tiempoTotal > 120 ? 'text-red-600' : 'text-emerald-600'">
              <Clock class="w-3 h-3" />
              Tiempo total: {{ tiempoTotalStr }}
            </div>
          </div>

          <!-- Artículo / Color -->
          <div class="flex gap-2 items-end">
            <div>
              <label class="text-[10px] font-black text-gray-400 uppercase">Artículo</label>
              <input data-field="articulo" data-next="color" :value="form.articulo" @input="onArticuloInput" maxlength="10" placeholder="AF311..." class="block mt-0.5 px-2 py-2 w-[13ch] rounded-lg border border-gray-300 text-sm font-bold uppercase focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label class="text-[10px] font-black text-gray-400 uppercase">Color</label>
              <input data-field="color" data-next="partida" :value="form.color" @input="onColorInput" maxlength="4" placeholder="0000" class="block mt-0.5 px-2 py-2 w-[7ch] rounded-lg border border-gray-300 text-sm font-bold uppercase text-center focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          <!-- Partida / Plegador -->
          <div class="flex gap-2 items-end">
            <div>
              <label class="text-[10px] font-black text-gray-400 uppercase">Partida</label>
              <input data-field="partida" data-next="plegador" :value="form.partida" @input="onPartidaInput" @blur="onPartidaBlur" inputmode="numeric" maxlength="9" placeholder="0-0000-00" class="block mt-0.5 px-2 py-2 w-[12ch] rounded-lg border border-gray-300 text-sm font-bold text-center focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label class="text-[10px] font-black text-gray-400 uppercase">Plegador</label>
              <input data-field="plegador" data-next="anud0" :value="form.plegador" @input="onPlegadorInput" inputmode="numeric" maxlength="5" placeholder="00000" class="block mt-0.5 px-2 py-2 w-[8ch] rounded-lg border border-gray-300 text-sm font-bold text-center focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          <!-- Anudadores (legajos) -->
          <div>
            <label class="text-[10px] font-black text-gray-400 uppercase">Anudadores (legajo)</label>
            <div class="flex gap-2 mt-0.5">
              <input data-field="anud0" data-next="anud1" :value="form.anudadores[0]" @input="onLegajoInput($event, 0)" inputmode="numeric" maxlength="4" placeholder="Leg 1" class="px-2 py-2 w-[7ch] rounded-lg border border-gray-300 text-sm font-bold text-center focus:outline-none focus:border-blue-500" />
              <input data-field="anud1" data-next="anud2" :value="form.anudadores[1]" @input="onLegajoInput($event, 1)" inputmode="numeric" maxlength="4" placeholder="Leg 2" class="px-2 py-2 w-[7ch] rounded-lg border border-gray-300 text-sm font-bold text-center focus:outline-none focus:border-blue-500" />
              <input data-field="anud2" data-next="revisor" :value="form.anudadores[2]" @input="onLegajoInput($event, 2)" inputmode="numeric" maxlength="4" placeholder="Leg 3" class="px-2 py-2 w-[7ch] rounded-lg border border-gray-300 text-sm font-bold text-center focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          <!-- Revisor (legajo) -->
          <div>
            <label class="text-[10px] font-black text-gray-400 uppercase">Revisor (legajo)</label>
            <input data-field="revisor" :value="form.revisor" @input="onLegajoInput($event)" inputmode="numeric" maxlength="4" placeholder="Leg." class="block mt-0.5 px-2 py-2 w-[7ch] rounded-lg border border-gray-300 text-sm font-bold text-center focus:outline-none focus:border-blue-500" />
          </div>

          <!-- Hilos cruzados -->
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" v-model="form.hilosCruzados" class="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500" />
            <span class="text-sm font-bold" :class="form.hilosCruzados ? 'text-red-600' : 'text-gray-600'">Hilos Cruzados</span>
          </label>

          <!-- Botones -->
          <button @click="guardar" :disabled="guardando" class="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50">
            <Save class="w-4 h-4" /> {{ editandoId ? 'Actualizar' : 'Guardar' }}
          </button>
        </div>
      </div>

      <!-- Cargando -->
      <div v-if="cargando" class="text-center py-8 text-gray-400 text-sm font-bold">Cargando...</div>

      <!-- Lista de paros -->
      <div v-else-if="parosFiltrados.length === 0 && !mostrarForm" class="text-center py-12">
        <p class="text-gray-400 font-bold">No hay paros registrados</p>
        <button @click="abrirNuevo" class="mt-3 px-4 py-2 rounded-xl text-sm font-bold bg-blue-100 text-blue-700 hover:bg-blue-200 active:scale-95">
          Registrar primer paro
        </button>
      </div>

      <div v-else class="space-y-1.5">
        <div v-for="paro in parosFiltrados" :key="paro.id"
          class="bg-white rounded-2xl border shadow-sm overflow-hidden transition-all"
          :class="paro.codigo === 102 ? 'border-l-4 border-l-red-400 border-gray-200' : 'border-l-4 border-l-blue-400 border-gray-200'"
        >
          <div class="px-4 py-3">
            <!-- Fila superior -->
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <span class="text-lg font-black text-gray-800">Telar {{ telarLabel(paro.telar) }}</span>
                <span class="px-2 py-0.5 rounded-lg text-xs font-black" :class="paro.codigo === 101 ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'">
                  {{ paro.codigo }}
                </span>
                <span v-if="paro.hilosCruzados" class="px-2 py-0.5 rounded-lg bg-red-600 text-white text-xs font-black">HC</span>
              </div>
              <div class="flex items-center gap-2">
                <button @click="abrirEdicion(paro)" class="w-9 h-9 flex items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:border-blue-300 active:scale-90 transition-all">
                  <Pencil class="w-5 h-5" />
                </button>
                <button @click="eliminarRegistro(paro)" class="w-9 h-9 flex items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 hover:border-red-300 active:scale-90 transition-all">
                  <Trash2 class="w-5 h-5" />
                </button>
              </div>
            </div>

            <!-- Fila de tiempos -->
            <div class="flex items-center gap-3 mt-2.5 text-sm">
              <div class="flex items-center gap-1.5 bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-100">
                <Clock class="w-3.5 h-3.5 text-gray-400" />
                <span class="font-bold text-gray-700">{{ paro.horaParo || '—' }}</span>
                <span class="text-gray-300 mx-0.5">→</span>
                <span class="font-bold text-gray-700">{{ paro.horaFinAnudado || '—' }}</span>
              </div>
              <span v-if="paro.tiempoTotal != null" class="px-2.5 py-1.5 rounded-lg font-black text-sm" :class="paro.tiempoTotal > 120 ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'">
                {{ Math.floor(paro.tiempoTotal / 60) }}:{{ String(paro.tiempoTotal % 60).padStart(2, '0') }}
              </span>
            </div>

            <!-- Fila de datos -->
            <div class="flex flex-wrap gap-x-3 gap-y-1 mt-2.5 text-xs text-gray-500">
              <span v-if="paro.articulo" class="font-bold text-gray-700 bg-gray-50 px-2 py-0.5 rounded">{{ paro.articulo }}</span>
              <span v-if="paro.color" class="bg-gray-50 px-2 py-0.5 rounded">Col: <b>{{ paro.color }}</b></span>
              <span v-if="paro.partida" class="bg-gray-50 px-2 py-0.5 rounded">Ptda: <b>{{ paro.partida }}</b></span>
              <span v-if="paro.plegador" class="bg-gray-50 px-2 py-0.5 rounded">Pleg: <b>{{ paro.plegador }}</b></span>
              <span v-if="paro.anudadores?.length" class="bg-gray-50 px-2 py-0.5 rounded">Anud: <b>{{ paro.anudadores.join(', ') }}</b></span>
              <span v-if="paro.revisor" class="bg-gray-50 px-2 py-0.5 rounded">Rev: <b>{{ paro.revisor }}</b></span>
            </div>
          </div>
        </div>
      </div>

      <!-- Tabla desktop -->
      <div class="hidden lg:block bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div class="px-4 py-2 bg-gray-50 border-b border-gray-200">
          <span class="text-xs font-black text-gray-500 uppercase">Vista Tabla</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200">
                <th class="px-2 py-2 text-left text-[10px] font-black text-gray-400 uppercase">Telar</th>
                <th class="px-2 py-2 text-center text-[10px] font-black text-gray-400 uppercase">Cód</th>
                <th class="px-2 py-2 text-center text-[10px] font-black text-gray-400 uppercase">Paro</th>
                <th class="px-2 py-2 text-center text-[10px] font-black text-gray-400 uppercase">Inicio</th>
                <th class="px-2 py-2 text-center text-[10px] font-black text-gray-400 uppercase">Fin</th>
                <th class="px-2 py-2 text-center text-[10px] font-black text-gray-400 uppercase">Total</th>
                <th class="px-2 py-2 text-left text-[10px] font-black text-gray-400 uppercase">Artículo</th>
                <th class="px-2 py-2 text-left text-[10px] font-black text-gray-400 uppercase">Partida</th>
                <th class="px-2 py-2 text-left text-[10px] font-black text-gray-400 uppercase">Plegador</th>
                <th class="px-2 py-2 text-left text-[10px] font-black text-gray-400 uppercase">Anudadores</th>
                <th class="px-2 py-2 text-center text-[10px] font-black text-gray-400 uppercase">HC</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr v-for="paro in parosFiltrados" :key="'tbl-'+paro.id" class="hover:bg-gray-50/50 cursor-pointer" @click="abrirEdicion(paro)">
                <td class="px-2 py-2 font-black text-gray-800">{{ telarLabel(paro.telar) }}</td>
                <td class="px-2 py-2 text-center">
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-black" :class="paro.codigo === 101 ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'">{{ paro.codigo }}</span>
                </td>
                <td class="px-2 py-2 text-center font-bold text-gray-700">{{ paro.horaParo }}</td>
                <td class="px-2 py-2 text-center font-bold text-gray-700">{{ paro.horaInicioAnudado }}</td>
                <td class="px-2 py-2 text-center font-bold text-gray-700">{{ paro.horaFinAnudado }}</td>
                <td class="px-2 py-2 text-center font-black" :class="paro.tiempoTotal > 120 ? 'text-red-600' : 'text-emerald-600'">
                  <template v-if="paro.tiempoTotal != null">{{ Math.floor(paro.tiempoTotal / 60) }}:{{ String(paro.tiempoTotal % 60).padStart(2, '0') }}</template>
                </td>
                <td class="px-2 py-2 text-gray-600 text-xs">{{ paro.articulo }}</td>
                <td class="px-2 py-2 text-gray-600 text-xs">{{ paro.partida }}</td>
                <td class="px-2 py-2 text-gray-600 text-xs">{{ paro.plegador }}</td>
                <td class="px-2 py-2 text-gray-600 text-xs">{{ (paro.anudadores || []).join(', ') }}</td>
                <td class="px-2 py-2 text-center">
                  <span v-if="paro.hilosCruzados" class="w-3 h-3 rounded-full bg-red-500 inline-block"></span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </main>
  </div>
</template>
