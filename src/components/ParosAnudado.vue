<script setup>
import { shiftSlot, addDays } from '../utils/plantTime';
import { usePlantClock } from '../composables/usePlantClock';
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { collection, getDocs, query } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { crearParo, actualizarParo, eliminarParo, suscribirParos } from '../services/paroTelarService';
import { userRole, userProfile } from '../services/authService';
import { canAccessViewForUser } from '../services/profileService';
import { getSectorScope } from '../utils/sectorScope';
import { onBeforeRouteLeave } from 'vue-router';
import PlantDatePicker from './PlantDatePicker.vue';
import { vTippy } from '../utils/tooltipDirective';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/themes/light-border.css';
import { getTurnoActual } from '../constants/organization';
import { Plus, X, Save, Trash2, Pencil, Clock, Search, RefreshCw, ChevronLeft, ChevronRight, Table2, LayoutGrid, Eye } from 'lucide-vue-next';
import Swal from 'sweetalert2';

// ── Estado general ──
const cargando = ref(true);
const guardando = ref(false);
const paros = ref([]);
const telaresMaquinas = ref([]);
const mostrarForm = ref(false);
const editandoId = ref(null), modal = ref(null), initial = ref(''), error = ref(''), machineError = ref(''), formError = ref(''), deleting = ref(false), search = ref(''), shiftFilter = ref(''), codeFilter = ref(''), stateFilter = ref(''), cards = ref(false);
const canWrite = computed(() => { try { const sectors=getSectorScope(userProfile.value); return (sectors===null || sectors.includes('TEJEDURIA')) && canAccessViewForUser(userRole.value,'paros-anudado',userProfile.value?.vistasPersonalizadas); } catch { return false; } });
const dirty = computed(() => mostrarForm.value && canWrite.value && JSON.stringify(form.value)!==initial.value);
const busy = computed(() => guardando.value || deleting.value);
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
let previousFocus, generation=0, disposed=false;


// ── Fecha y turno ──
const fechaHoy = () => shiftSlot().fecha.replaceAll('-', '/');
const fechaReporte = ref(fechaHoy());
const fechaInput = computed({
  get: () => fechaReporte.value.replace(/\//g, '-'),
  set: (v) => { fechaReporte.value = v.replace(/-/g, '/'); }
});
const clock = usePlantClock();
const turnoActual = computed(() => getTurnoActual(clock.value));
let formSlot = shiftSlot();
let editingRecord = null;
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
function onHoraInput(ev,field) {
  const raw=ev.target.value.replace(/\D/g,'').slice(0,4);
  form.value[field]=raw.length===4 && Number(raw.slice(0,2))<=23 && Number(raw.slice(2))<=59 ? `${raw.slice(0,2)}:${raw.slice(2)}` : raw;
  ev.target.value=form.value[field];
  if(/^([01]\d|2[0-3]):[0-5]\d$/.test(form.value[field])) autoJump(ev);
}
function onHoraBlur(ev,field) { ev.target.value=form.value[field] || ''; }

// Auto-jump al siguiente campo
function autoJump(ev) {
  const next = ev.target.dataset.next;
  if (next) {
    const el = document.querySelector(`[data-field="${next}"]`);
    if (el) { el.focus(); el.select?.(); }
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
  unsubscribeFn?.(); const token=++generation; cargando.value=true; error.value=''; paros.value=[];
  try { unsubscribeFn=suscribirParos(fechaReporte.value,data => { if(disposed || token!==generation) return; paros.value=data; cargando.value=false; error.value=''; },failure => { if(disposed || token!==generation) return; error.value=failure?.message || 'No se pudieron cargar los registros.'; cargando.value=false; }); }
  catch(failure) { error.value=failure.message; cargando.value=false; }
}
async function cargarTelares() {
  machineError.value='';
  try {
    const snap=await getDocs(query(collection(db,'maquinas')));
    if(disposed) return;
    telaresMaquinas.value=snap.docs.map(item => ({ ...item.data(),id:item.id })).filter(machine => String(machine.tipo).toUpperCase()==='TELAR' && machine.activo!==false).sort((a,b) => (a.orden_patrulla || 999)-(b.orden_patrulla || 999));
  } catch(failure) { if(!disposed) machineError.value='No se pudieron cargar los telares. Reintentá antes de registrar.'; }
}
async function reload() { if(busy.value) return; suscribir(); await cargarTelares(); }
onMounted(reload);
watch(fechaReporte,suscribir);
function beforeUnload(event) { if(dirty.value || busy.value) { event.preventDefault(); event.returnValue=''; } }
globalThis.window?.addEventListener('beforeunload',beforeUnload);
onUnmounted(() => { disposed=true; generation++; unsubscribeFn?.(); globalThis.window?.removeEventListener('beforeunload',beforeUnload); });
onBeforeRouteLeave(async () => { if(busy.value) return false; if(mostrarForm.value) { await cerrarForm(); return !mostrarForm.value; } return true; });
function keyboard(event) {
  if(event.key==='Escape') { event.stopPropagation(); cerrarForm(); }
  if(event.key!=='Tab') return;
  const nodes=[...(modal.value?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)') || [])].filter(node => node.getClientRects().length);
  const first=nodes[0],last=nodes.at(-1),active=globalThis.document?.activeElement;
  if(!first) { event.preventDefault(); return; }
  if(event.shiftKey && (active===first || !nodes.includes(active))) { event.preventDefault(); last.focus(); }
  else if(!event.shiftKey && (active===last || !nodes.includes(active))) { event.preventDefault(); first.focus(); }
}
function formatMinutes(value) { if(value==null || !Number.isFinite(Number(value))) return '—'; const minutes=Number(value); return `${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}`; }
function changeDay(delta) { if(!busy.value) fechaInput.value=addDays(fechaInput.value,delta); }
// ── Acciones del formulario ──
function abrirNuevo() {
  if(busy.value || !canWrite.value || machineError.value) return;
  previousFocus=globalThis.document?.activeElement; formError.value='';
  formSlot = shiftSlot();
  editingRecord = null;
  editandoId.value = null;
  form.value = resetForm();
  initial.value=JSON.stringify(form.value);
  mostrarForm.value = true;
  nextTick(() => {
    const el = modal.value?.querySelector('[data-pa-telar]');
    if (el) { el.focus(); el.select?.(); }
  });
}

function abrirEdicion(paro) {
  if(busy.value) return; previousFocus=globalThis.document?.activeElement; formError.value='';
  editingRecord = paro;
  editandoId.value = paro.id;
  form.value = {
    telar: String(paro.telar ?? ''),
    codigo: paro.codigo || 101,
    horaParo: String(paro.horaParo ?? ''),
    horaInicioAnudado: String(paro.horaInicioAnudado ?? ''),
    horaFinAnudado: String(paro.horaFinAnudado ?? ''),
    articulo: String(paro.articulo ?? ''),
    partida: String(paro.partida ?? ''),
    plegador: String(paro.plegador ?? ''),
    color: String(paro.color ?? ''),
    anudadores: [
      String((paro.anudadores || [])[0] ?? ''),
      String((paro.anudadores || [])[1] ?? ''),
      String((paro.anudadores || [])[2] ?? '')
    ],
    hilosCruzados: paro.hilosCruzados || false,
    revisor: String(paro.revisor ?? '')
  };
  initial.value=JSON.stringify(form.value);
  mostrarForm.value = true;
  nextTick(() => modal.value?.focus?.());
}

async function cerrarForm(force=false) {
  if(busy.value && !force) return false;
  if(!force && dirty.value && !(await Swal.fire({ title:'¿Descartar cambios?',text:'El registro tiene modificaciones sin guardar.',icon:'warning',showCancelButton:true,confirmButtonText:'Descartar',cancelButtonText:'Seguir editando' })).isConfirmed) return false;
  mostrarForm.value=false; editandoId.value=null; form.value=resetForm(); formError.value='';
  nextTick(() => previousFocus?.isConnected && previousFocus.focus()); return true;
}

async function guardar() {
  if(busy.value || !canWrite.value || !mostrarForm.value) return;
  formError.value='';
  const current = shiftSlot();
  if (!editandoId.value && (current.fecha !== formSlot.fecha || current.turno !== formSlot.turno)) {
    await Swal.fire({ icon: 'warning', title: 'Cambió el turno', text: 'Conservá los datos y volvé a abrir el formulario para registrar en el turno actual.' });
    return;
  }
  const f = form.value;
  if([f.horaParo,f.horaInicioAnudado,f.horaFinAnudado].some(time => time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) { formError.value='Completá los horarios en formato HH:MM, con horas de 00 a 23 y minutos de 00 a 59.'; return; }
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
    turno: editingRecord?.turno || formSlot.turno,
    supervisor: auth.currentUser?.uid || '',
    supervisorNombre: supervisorNombre.value
  };

  try {
    if (editandoId.value) {
      await actualizarParo(editingRecord.fechaDocumento || fechaReporte.value, editandoId.value, datos);
    } else {
      await crearParo(fechaReporte.value, datos);
    }
    Swal.fire({ icon: 'success', title: 'Guardado', timer: 1200, showConfirmButton: false });
    await cerrarForm(true);
  } catch (e) {
    console.error(e);
    formError.value=e.message || 'No se pudo guardar. Se conservan los datos para reintentar.';
  } finally {
    guardando.value = false;
  }
}

async function eliminarRegistro(paro) {
  if(busy.value || userRole.value!=='admin') return;
  deleting.value=true;
  try {
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
    await eliminarParo(paro.fechaDocumento || fechaReporte.value, paro.id);
    Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1000, showConfirmButton: false });
  } catch (e) {
    Swal.fire('Error', e.message || 'No se pudo eliminar', 'error');
  }
  } finally { deleting.value=false; }
}

// ── Helpers ──
function telarLabel(maquina) {
  const code = String(maquina);
  return code.slice(-2).replace(/^0/, '');
}

// Stats
const stats = computed(() => {
  const total = paros.value.length;
  const termino = paros.value.filter(p => Number(p.codigo) === 101).length;
  const tiempoTotalMin = paros.value.reduce((acc, p) => acc + (Number(p.tiempoTotal) || 0), 0);
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

// Filtros de consulta; los indicadores resumen el día completo.
const parosFiltrados = computed(() => paros.value.filter(paro => (!shiftFilter.value || paro.turno===shiftFilter.value) && (!codeFilter.value || Number(paro.codigo)===Number(codeFilter.value)) && (!stateFilter.value || (stateFilter.value==='pending' ? !paro.horaFinAnudado : stateFilter.value==='finished' ? !!paro.horaFinAnudado : !!paro.hilosCruzados)) && (!search.value.trim() || normalize([paro.telar,telarLabel(paro.telar),paro.articulo,paro.color,paro.partida,paro.plegador,paro.revisor,paro.supervisorNombre,...(paro.anudadores || [])].join(' ')).includes(normalize(search.value.trim())))));
</script>

<template>
  <section class="stops-page" :inert="mostrarForm || undefined">
    <header class="page-header"><div><h1>Paros y anudados</h1><p>{{ supervisorNombre }} · Control de paros de telares</p></div><div class="actions"><button class="btn" :disabled="busy || cargando" @click="reload"><RefreshCw :class="{ spinning:cargando }" />Actualizar</button><button v-if="canWrite" class="btn primary" :disabled="busy || !!machineError" @click="abrirNuevo"><Plus />Nuevo paro</button></div></header>
    <div class="toolbar"><div class="date-controls"><button class="icon-btn" v-tippy="'Día anterior'" aria-label="Día anterior" :disabled="busy" @click="changeDay(-1)"><ChevronLeft /></button><PlantDatePicker v-model="fechaInput" label="Fecha de inicio del turno" /><button class="icon-btn" v-tippy="'Día siguiente'" aria-label="Día siguiente" :disabled="busy" @click="changeDay(1)"><ChevronRight /></button></div><span class="current-shift" v-tippy="'Turno actual de planta. El filtro de registros se selecciona por separado.'">Ahora: {{ turnoActual }}</span><div class="search"><Search /><input v-model="search" aria-label="Buscar telar, artículo, partida o personal" placeholder="Buscar telar, artículo, partida o personal…" /></div><select v-model="shiftFilter" aria-label="Filtrar turno"><option value="">Todos los turnos</option><option v-for="turno in ['A','B','C']" :key="turno" :value="turno">Turno {{ turno }}</option></select><select v-model="codeFilter" aria-label="Filtrar código"><option value="">Todos los códigos</option><option value="101">101</option><option value="102">102</option></select><select v-model="stateFilter" aria-label="Filtrar estado"><option value="">Todos los estados</option><option value="pending">Sin finalizar</option><option value="finished">Finalizados</option><option value="crossed">Hilos cruzados</option></select><div class="view-switch"><button aria-label="Vista de tabla" v-tippy="'Vista de tabla'" :aria-pressed="!cards" :class="{ selected:!cards }" @click="cards=false"><Table2 /></button><button aria-label="Vista de tarjetas" v-tippy="'Vista de tarjetas'" :aria-pressed="cards" :class="{ selected:cards }" @click="cards=true"><LayoutGrid /></button></div></div>
    <div class="summary"><span><strong>{{ stats.total }}</strong> registros</span><span><strong>{{ stats.termino }}</strong> código 101</span><span v-tippy="'Suma del tiempo entre paro e inicio de anudado, de todos los registros del día'"><strong>{{ stats.sinAtencionStr }}</strong> sin atención</span><span v-tippy="'Suma del tiempo total registrado, de todos los registros del día'"><strong>{{ stats.tiempoStr }}</strong> tiempo parado</span><small>Totales del día</small></div>
    <p v-if="error || machineError" class="error" role="alert">{{ error || machineError }} <button :disabled="busy" @click="reload">Reintentar</button></p>
    <div class="data-panel" :aria-busy="cargando"><p v-if="cargando" class="empty" role="status">Cargando paros…</p><p v-else-if="!parosFiltrados.length" class="empty">{{ error ? 'No se pudo completar la carga.':paros.length ? 'No hay registros que coincidan con los filtros.':'No hay paros registrados para esta fecha.' }}</p><div v-else class="data-scroll">
      <table v-if="!cards" class="stops-table"><colgroup><col class="machine-col" /><col class="code-col" /><col class="hours-col" /><col class="duration-col" /><col /><col /><col /><col class="actions-col" /></colgroup><thead><tr><th>Telar</th><th>Código / turno</th><th>Horarios</th><th>Total</th><th>Artículo / color</th><th>Partida / plegador</th><th>Personal</th><th>Acciones</th></tr></thead><tbody><tr v-for="paro in parosFiltrados" :key="`${paro.fechaDocumento || fechaReporte}-${paro.id}`"><td><strong class="machine-number" v-tippy="`Código completo: ${paro.telar}`">{{ telarLabel(paro.telar) }}</strong></td><td><span class="code" :class="{ secondary:Number(paro.codigo)===102 }">{{ paro.codigo }}</span><small>Turno {{ paro.turno || '—' }}</small><span v-if="paro.hilosCruzados" class="crossed" v-tippy="'Hilos cruzados'">HC</span></td><td><div class="hours"><span><small>Paro</small><b>{{ paro.horaParo || '—' }}</b></span><span><small>Inicio</small><b>{{ paro.horaInicioAnudado || '—' }}</b></span><span><small>Fin</small><b>{{ paro.horaFinAnudado || '—' }}</b></span></div></td><td><span class="duration" :class="{ long:Number(paro.tiempoTotal)>120 }">{{ formatMinutes(paro.tiempoTotal) }}</span><small v-if="!paro.horaFinAnudado">Sin finalizar</small></td><td><strong>{{ paro.articulo || '—' }}</strong><small>Color: {{ paro.color || '—' }}</small></td><td><strong>{{ paro.partida || '—' }}</strong><small>Plegador: {{ paro.plegador || '—' }}</small></td><td><span>{{ (paro.anudadores || []).join(', ') || 'Sin anudador' }}</span><small>Revisor: {{ paro.revisor || '—' }}</small><small>{{ paro.supervisorNombre || '—' }}</small></td><td><div class="actions"><button class="icon-btn" v-tippy="canWrite ? 'Editar registro':'Ver detalle'" :aria-label="canWrite ? 'Editar registro':'Ver detalle'" :disabled="busy" @click="abrirEdicion(paro)"><Pencil v-if="canWrite" /><Eye v-else /></button><button v-if="userRole==='admin'" class="icon-btn danger" v-tippy="'Eliminar registro'" aria-label="Eliminar registro" :disabled="busy" @click="eliminarRegistro(paro)"><Trash2 /></button></div></td></tr></tbody></table>
      <div v-else class="stop-cards"><article v-for="paro in parosFiltrados" :key="`${paro.fechaDocumento || fechaReporte}-${paro.id}`"><header><div><h2>Telar {{ telarLabel(paro.telar) }}</h2><span class="code" :class="{ secondary:Number(paro.codigo)===102 }">{{ paro.codigo }}</span><span class="turno">Turno {{ paro.turno || '—' }}</span><span v-if="paro.hilosCruzados" class="crossed">Hilos cruzados</span></div><div class="actions"><button class="icon-btn" v-tippy="canWrite ? 'Editar registro':'Ver detalle'" :aria-label="canWrite ? 'Editar registro':'Ver detalle'" :disabled="busy" @click="abrirEdicion(paro)"><Pencil v-if="canWrite" /><Eye v-else /></button><button v-if="userRole==='admin'" class="icon-btn danger" v-tippy="'Eliminar registro'" aria-label="Eliminar registro" :disabled="busy" @click="eliminarRegistro(paro)"><Trash2 /></button></div></header><dl class="card-times"><div><dt>Paro</dt><dd>{{ paro.horaParo || '—' }}</dd></div><div><dt>Inicio</dt><dd>{{ paro.horaInicioAnudado || '—' }}</dd></div><div><dt>Fin</dt><dd>{{ paro.horaFinAnudado || '—' }}</dd></div><div><dt>Total</dt><dd class="duration" :class="{ long:Number(paro.tiempoTotal)>120 }">{{ formatMinutes(paro.tiempoTotal) }}</dd></div></dl><dl class="card-details"><div><dt>Artículo / color</dt><dd>{{ paro.articulo || '—' }} · {{ paro.color || '—' }}</dd></div><div><dt>Partida / plegador</dt><dd>{{ paro.partida || '—' }} · {{ paro.plegador || '—' }}</dd></div><div><dt>Anudadores</dt><dd>{{ (paro.anudadores || []).join(', ') || '—' }}</dd></div><div><dt>Revisor</dt><dd>{{ paro.revisor || '—' }}</dd></div></dl><footer>{{ paro.supervisorNombre || '—' }} · {{ paro.horaFinAnudado ? 'Finalizado':'Sin finalizar' }}</footer></article></div>
    </div><footer class="panel-footer"><span>{{ parosFiltrados.length }} de {{ paros.length }} registros · Actualización en tiempo real</span><span>Turno C: fecha del día en que comienza.</span></footer></div>
  </section>
  <Teleport to="body"><div v-if="mostrarForm" class="modal-backdrop" @click.self="cerrarForm()"><form ref="modal" class="stop-modal" role="dialog" aria-modal="true" aria-labelledby="stop-title" tabindex="-1" @keydown="keyboard" @submit.prevent="guardar"><header><div><h2 id="stop-title">{{ canWrite ? editandoId ? 'Editar paro':'Nuevo paro':'Detalle del paro' }}</h2><p>{{ fechaInput }} · Turno {{ editingRecord?.turno || formSlot.turno }} · {{ editingRecord?.supervisorNombre || supervisorNombre }}</p></div><button type="button" class="icon-btn" v-tippy="'Cerrar'" aria-label="Cerrar" :disabled="busy" @click="cerrarForm()"><X /></button></header><div class="modal-body"><p v-if="formError" class="error" role="alert">{{ formError }}</p><fieldset :disabled="busy || !canWrite"><section class="form-section"><h3>Telar y horarios</h3><div class="form-grid"><label>Telar<select data-pa-telar v-model="form.telar" required><option value="">Seleccionar</option><option v-if="form.telar && !telaresMaquinas.some(machine => String(machine.maquina)===form.telar)" :value="form.telar">{{ form.telar }} · Registro existente</option><option v-for="machine in telaresMaquinas" :key="machine.id" :value="String(machine.maquina)">Telar {{ telarLabel(machine.maquina) }} · {{ machine.maquina }}</option></select></label><div><span class="field-label">Código</span><div class="code-selector"><button v-for="code in [101,102]" :key="code" type="button" :aria-pressed="Number(form.codigo)===code" :class="{ selected:Number(form.codigo)===code }" @click="form.codigo=code">{{ code }}</button></div></div></div><div class="time-inputs"><label>Hora de paro<input data-field="horaParo" data-next="horaInicio" :value="form.horaParo" @input="onHoraInput($event,'horaParo')" @blur="onHoraBlur($event,'horaParo')" inputmode="numeric" maxlength="5" placeholder="HHMM" required /></label><label>Inicio de anudado<input data-field="horaInicio" data-next="horaFin" :value="form.horaInicioAnudado" @input="onHoraInput($event,'horaInicioAnudado')" @blur="onHoraBlur($event,'horaInicioAnudado')" inputmode="numeric" maxlength="5" placeholder="HHMM" /></label><label>Fin de anudado<input data-field="horaFin" data-next="articulo" :value="form.horaFinAnudado" @input="onHoraInput($event,'horaFinAnudado')" @blur="onHoraBlur($event,'horaFinAnudado')" inputmode="numeric" maxlength="5" placeholder="HHMM" /></label></div><p class="hint">Escribí cuatro dígitos (ej. 0615). Al completar, avanza al campo siguiente.</p><div v-if="tiempoTotalStr" class="time-summary" :class="{ long:tiempoTotal>120 }"><Clock />Tiempo total: <strong>{{ tiempoTotalStr }}</strong></div></section>
      <section class="form-section"><h3>Material y personal</h3><div class="form-grid"><label>Artículo<input data-field="articulo" data-next="color" :value="form.articulo" @input="onArticuloInput" maxlength="10" placeholder="AF311…" /></label><label>Color<input data-field="color" data-next="partida" :value="form.color" @input="onColorInput" maxlength="4" placeholder="0000" /></label><label>Partida<input data-field="partida" data-next="plegador" :value="form.partida" @input="onPartidaInput" @blur="onPartidaBlur" inputmode="numeric" maxlength="9" placeholder="0-0000-00" /></label><label>Plegador<input data-field="plegador" data-next="anud0" :value="form.plegador" @input="onPlegadorInput" inputmode="numeric" maxlength="5" placeholder="00000" /></label></div><span class="field-label">Anudadores · legajos</span><div class="anudadores"><input v-for="(_,index) in form.anudadores" :key="index" :data-field="`anud${index}`" :data-next="index<2 ? `anud${index+1}`:'revisor'" :value="form.anudadores[index]" @input="onLegajoInput($event,index)" inputmode="numeric" maxlength="4" :aria-label="`Legajo del anudador ${index+1}`" :placeholder="`Legajo ${index+1}`" /></div><div class="form-grid"><label>Revisor · legajo<input data-field="revisor" :value="form.revisor" @input="onLegajoInput($event)" inputmode="numeric" maxlength="4" placeholder="Legajo" /></label><label class="check"><input type="checkbox" v-model="form.hilosCruzados" />Hilos cruzados</label></div></section></fieldset></div><footer><span>{{ dirty ? 'Cambios sin guardar':canWrite ? 'Los datos se guardan al confirmar.':'Solo lectura' }}</span><button type="button" class="btn" :disabled="busy" @click="cerrarForm()">{{ canWrite ? 'Cancelar':'Cerrar' }}</button><button v-if="canWrite" type="submit" class="btn primary" :disabled="busy"><Save />{{ guardando ? 'Guardando…':editandoId ? 'Actualizar registro':'Guardar paro' }}</button></footer></form></div></Teleport>
</template>

<style scoped>
.stops-page{height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;padding:14px 16px;color:#334155;font-size:13px}.page-header,.actions,.toolbar,.date-controls,.panel-footer{display:flex;align-items:center;gap:8px}.page-header{justify-content:space-between;flex-wrap:wrap}.page-header h1{font-size:19px;font-weight:700;color:#1e293b}.page-header p{font-size:12px;color:#64748b;margin-top:3px}.btn,.icon-btn,.view-switch button,.code-selector button{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:white;border:1px solid #cbd5e1;border-radius:5px;min-height:34px;padding:0 10px;font-weight:600;color:#475569}.btn svg,.icon-btn svg,.view-switch svg{width:16px;height:16px}.btn:hover,.icon-btn:hover,.view-switch button:hover{background:#f1f5f9}.primary{background:#2563eb;border-color:#2563eb;color:white}.primary:hover{background:#1d4ed8}.icon-btn{width:28px;min-height:28px;padding:0;border-color:transparent}.danger{color:#dc2626}.danger:hover{background:#fef2f2}.btn:disabled,button:disabled{opacity:.4;cursor:not-allowed}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}.toolbar{flex-wrap:wrap;padding:9px;border:1px solid #e2e8f0;background:white;border-radius:7px}.date-controls{gap:4px}.current-shift{background:#f1f5f9;color:#475569;border-radius:4px;font-size:11px;padding:6px 8px;white-space:nowrap}.search{position:relative;flex:1;min-width:200px}.search svg{position:absolute;left:9px;top:9px;width:16px;height:16px;color:#94a3b8}.search input{width:100%;padding-left:31px!important}input:not([type=checkbox]),select{min-width:0;border:1px solid #cbd5e1;background:white;border-radius:5px;padding:7px 9px;font-size:13px;color:#334155}.view-switch{display:flex}.view-switch button{border-radius:4px;padding:0 8px}.selected{background:#eff6ff!important;color:#2563eb!important;border-color:#93c5fd!important}.summary{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:0 4px;font-size:12px;color:#64748b}.summary strong{color:#334155;font-weight:700;font-variant-numeric:tabular-nums;margin-right:3px}.summary small{margin-left:auto;font-size:10px;color:#94a3b8}.data-panel{flex:1;min-height:0;display:flex;flex-direction:column;background:white;border:1px solid #e2e8f0;border-radius:7px;overflow:hidden}.data-scroll{flex:1;min-height:0;overflow:auto}.stops-table{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0}th{position:sticky;top:0;z-index:1;background:#f1f5f9;color:#475569;font-size:11px;font-weight:700;text-align:left;border-bottom:1px solid #cbd5e1}th,td{padding:10px 12px;overflow-wrap:anywhere}td{border-bottom:1px solid #eef2f6;vertical-align:middle}tbody tr:nth-child(even){background:#fafbfd}tbody tr:hover{background:#eff6ff}td strong{font-weight:600}td small{display:block;font-size:11px;color:#64748b;margin-top:4px;line-height:1.4}.machine-col{width:75px}.code-col{width:100px}.hours-col{width:150px}.duration-col{width:90px}.actions-col{width:85px}.machine-number{color:#1d4ed8;font-size:15px}.code,.crossed{display:inline-block;border-radius:4px;padding:3px 6px;font-weight:600;font-size:11px}.code{background:#eff6ff;color:#1d4ed8}.code.secondary,.crossed{background:#fef2f2;color:#b91c1c}.crossed{margin-top:5px}.hours{display:flex;flex-direction:column;gap:3px;font-variant-numeric:tabular-nums}.hours>span{display:flex;align-items:center;gap:8px}.hours small{width:32px;margin:0;font-size:10px}.hours b{font-size:12px;font-weight:600}.duration{font-variant-numeric:tabular-nums;color:#047857;font-weight:600;white-space:nowrap}.duration.long,.time-summary.long{color:#b91c1c}.panel-footer{justify-content:space-between;flex-wrap:wrap;padding:8px 12px;border-top:1px solid #e2e8f0;background:#f8fafc;color:#64748b;font-size:11px}.empty{padding:50px 16px;flex:1;text-align:center;color:#64748b}.error{background:#fef2f2;color:#b91c1c;border-radius:5px;padding:9px 12px;font-size:12px;line-height:1.5}.error button{text-decoration:underline;margin-left:8px}.stop-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:12px;padding:12px}.stop-cards article{border:1px solid #e2e8f0;border-radius:6px;overflow:hidden}.stop-cards header{display:flex;align-items:flex-start;justify-content:space-between;padding:12px;gap:8px}.stop-cards h2{font-size:15px;font-weight:600;margin-bottom:5px}.turno{color:#64748b;font-size:11px;margin-left:8px}.stop-cards .crossed{margin-left:6px}.card-times{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;padding:10px 12px;border-top:1px solid #e2e8f0}.card-times dt,.card-details dt{font-size:10px;color:#64748b;margin-bottom:4px}.card-times dd{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}.card-details{display:grid;grid-template-columns:1fr 1fr;padding:0 12px 12px;gap:10px}.card-details dd{overflow-wrap:anywhere;font-size:12px}.stop-cards footer{padding:8px 12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px;background:#f8fafc}.modal-backdrop{position:fixed;inset:0;z-index:100;background:rgba(15,23,42,.4);display:flex;align-items:center;justify-content:center;padding:16px}.stop-modal{background:white;width:min(1000px,100%);max-height:calc(100dvh - 32px);min-height:0;display:flex;flex-direction:column;border-radius:9px;box-shadow:0 20px 60px #0f172a33;color:#334155;font-size:13px}.stop-modal>header,.stop-modal>footer{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #e2e8f0;flex:none}.stop-modal>header{justify-content:space-between}.stop-modal h2{font-size:17px;font-weight:700}.stop-modal header p{font-size:12px;color:#64748b;margin-top:3px}.modal-body{overflow:auto;min-height:0;padding:18px}.stop-modal fieldset{border:0;display:grid;grid-template-columns:1fr 1fr;gap:24px}.form-section{display:flex;flex-direction:column;gap:14px;min-width:0}.form-section h3{font-size:13px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0;padding-bottom:8px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.stop-modal label{display:flex;flex-direction:column;gap:5px;font-size:11px;color:#64748b;font-weight:600}.field-label{display:block;font-size:11px;color:#64748b;font-weight:600;margin-bottom:5px}.code-selector{display:flex;gap:6px}.code-selector button{flex:1}.time-inputs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.time-inputs input{font-variant-numeric:tabular-nums;text-align:center}.hint{color:#64748b;font-size:11px;line-height:1.5}.time-summary{display:flex;align-items:center;gap:5px;padding:10px;background:#f8fafc;border-radius:5px;color:#047857}.time-summary svg{width:15px;height:15px}.anudadores{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:-10px}.stop-modal .check{flex-direction:row;align-items:center;gap:7px;align-self:end;min-height:34px}.stop-modal>footer{justify-content:flex-end;border-top:1px solid #e2e8f0;border-bottom:0}.stop-modal footer>span{margin-right:auto;color:#64748b;font-size:11px}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:1100px){.stops-page{padding:10px;gap:8px}.machine-col{width:55px}.code-col{width:72px}.hours-col{width:108px}.duration-col{width:68px}.actions-col{width:72px}th,td{padding:8px}.toolbar{gap:7px}.toolbar select{max-width:145px}}
@media(max-width:767px){.stops-page{height:auto;min-height:100%}.data-panel{flex:none;min-height:300px}.data-scroll{max-height:65vh}.stops-table{min-width:680px}.toolbar .search{flex-basis:100%;order:1}.summary{gap:8px 12px;font-size:11px}.summary small{display:none}.panel-footer span:last-child{display:none}.page-header h1{font-size:17px}.stop-cards{grid-template-columns:1fr}.modal-backdrop{padding:10px}.stop-modal{max-height:calc(100dvh - 20px)}.stop-modal fieldset{grid-template-columns:1fr;gap:20px}.modal-body{padding:12px}.stop-modal>header,.stop-modal>footer{padding:10px 12px}.stop-modal footer>span{flex-basis:100%;margin:0}.stop-modal>footer{flex-wrap:wrap}.stop-modal footer .btn{min-height:34px}}
</style>
