<script setup>
import { ref, computed, watch, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { getAuth } from 'firebase/auth';
import { intervencionService } from '../services/intervencionService';
import OperationalImage from './OperationalImage.vue';
import IntervencionDetalle from './IntervencionDetalle.vue';
import AttentionRehearsal from './AttentionRehearsal.vue';
import MobileMechanicWork from './MobileMechanicWork.vue';
import { mobileWorkAction } from '../utils/mobileWorkAction';
import { attentionLabel,attentionQueueMatches } from '../utils/attentionQueue';
import { getSectorScope } from '../utils/sectorScope';
import { attentionSpecialties } from '../../functions/attentionPolicy.js';
import { transitionAttention } from '../services/attentionService';
import { notificationService } from '../services/notificationService';
import { previewSector } from '../services/authService';
import { userProfile, userRole } from '../services/authService';
import { getEffectivePermisosForUser } from '../services/profileService';
import { canExecuteIntervention } from '../utils/interventionAccess';
import { sanitizeSectorList, normalizeSectorValue, DEFAULT_SECTOR, canDespacharIntervencion } from '../constants/organization';
import { Wrench, Zap, Clock, ChevronRight, AlertTriangle, BellOff, Plus, OctagonX, CirclePlay, ChevronDown, ChevronUp, Package, Stethoscope, User, Flame, ArrowUp, Minus, Layers } from 'lucide-vue-next';
import Swal from 'sweetalert2';
import { vTippy } from '../utils/tooltipDirective';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/themes/light-border.css';
import { eventView } from '../utils/faultEvents';

const router = useRouter();

// ── Estado ─────────────────────────────────────────────────────────────────────
const intervenciones = ref([]);
const loading        = ref(true);
const filtroEstado   = ref(userRole.value === 'mecanico' ? 'TODO':userRole.value === 'inspector' ? 'PENDIENTE' : 'EN_PROCESO');
const actualizando   = ref(null);          // id o 'batch-xxx'
const expandedId     = ref(null);          // intervención expandida
const collapsedMaq   = ref(new Set());     // maquinaIds colapsados (grupos)
const busqueda = ref('');
const filtroTipo = ref('');
const filtroSector = ref('');
const filtroAsignacion = ref(userRole.value==='mecanico' ? 'team':'');
const errorCarga = ref(false);
const detalleId = ref(null);
const ensayo = ref(false);
const mobileItems=computed(()=>[...intervenciones.value].sort((a,b)=>calcPrioridad(a).score-calcPrioridad(b).score));
const mobileAction=item=>mobileWorkAction(item,currentUid(),canAtender(item) || canTomarItem(item));
function mobileOpen(item) { const action=mobileAction(item); if(previewSector.value!==null || action.kind==='detail') abrirDetalle(item); else if(action.kind==='claim') onAtender(item); else onTomar(item); }
const activatingAlerts=ref(false),alertsEnabled=ref(false);

async function activateAlerts() {
  if(activatingAlerts.value || previewSector.value!==null) return;
  const owner=getAuth().currentUser?.uid; if(!owner) return;
  activatingAlerts.value=true;
  try {
    const token=await notificationService.solicitarPermisosYRegistrarToken(owner);
    if(getAuth().currentUser?.uid!==owner) return;
    alertsEnabled.value=!!token;
    if(!token) Swal.fire({ icon:'info',title:'Avisos no activados',text:'Revisá los permisos de notificación y la compatibilidad de este navegador.' });
  } finally { activatingAlerts.value=false; }
}

async function finishDuty() {
  const owner=getAuth().currentUser?.uid; if(!owner || activatingAlerts.value) return;
  activatingAlerts.value=true;
  try { await notificationService.finalizarTurno(owner); if(getAuth().currentUser?.uid===owner) alertsEnabled.value=false; }
  catch(error) { Swal.fire({ icon:'error',title:'No se pudo finalizar el turno',text:error.message }); }
  finally { activatingAlerts.value=false; }
}
let detalleTrigger;
const abrirDetalle = item => { detalleTrigger = globalThis.document?.activeElement; detalleId.value = item.id; };
const cerrarDetalle = async () => { detalleId.value = null; await nextTick(); if (detalleTrigger?.isConnected) detalleTrigger.focus(); };
const presentationKey = 'cmms.interventions.presentation';
function storedPresentation() {
  try { return globalThis.localStorage?.getItem(presentationKey) === 'specialty' ? 'specialty' : 'table'; }
  catch { return 'table'; }
}
const presentacion = ref(storedPresentation());
const especialidadActiva = ref('MECANICO');
watch(presentacion, value => {
  try { globalThis.localStorage?.setItem(presentationKey, value); } catch { /* La vista sigue disponible sin almacenamiento. */ }
});

const toggleExpand   = (id) => { expandedId.value = expandedId.value === id ? null : id; };
const toggleMaqGroup = (key) => {
  const s = new Set(collapsedMaq.value);
  s.has(key) ? s.delete(key) : s.add(key);
  collapsedMaq.value = s;
};

// ── Sectores ───────────────────────────────────────────────────────────────────
const sectoresUsuario = computed(() => {
  try { return getSectorScope(userProfile.value) || ['HILANDERIA','TEJEDURIA']; }
  catch { return []; }
});

// ── Suscripción realtime ───────────────────────────────────────────────────────
let unsubscribe = null;
let subscriptionVersion = 0;

function cargarIntervenciones(sectores = sectoresUsuario.value) {
  const version = ++subscriptionVersion;
  if (unsubscribe) unsubscribe();
  intervenciones.value = [];
  loading.value = true;
  errorCarga.value = false;
  if(!sectores.length) { loading.value=false; errorCarga.value=true; return; }
  unsubscribe = intervencionService.suscribirActivas(sectores, (docs) => {
    if (version !== subscriptionVersion) return;
    intervenciones.value = docs;
    loading.value = false;
  }, () => { if (version === subscriptionVersion) { loading.value = false; errorCarga.value = true; } });
}
watch(sectoresUsuario, cargarIntervenciones, { immediate: true });

onUnmounted(() => { subscriptionVersion++; unsubscribe?.(); });

// ── Filtros ────────────────────────────────────────────────────────────────────
const countPendiente  = computed(() => intervenciones.value.filter(i => i.estado === 'PENDIENTE').length);
const countEnProceso  = computed(() => intervenciones.value.filter(i => i.estado === 'EN_PROCESO').length);
const countCompletado = computed(() => intervenciones.value.filter(i => i.estado === 'COMPLETADO').length);

const tabs = computed(() => [
  { id: 'PENDIENTE',  label: 'Pend.',    count: countPendiente.value },
  { id: 'EN_PROCESO', label: 'Proceso',  count: countEnProceso.value },
  { id: 'COMPLETADO', label: 'Finaliz.', count: countCompletado.value || null },
  { id: 'TODO',       label: 'Todo',     count: null },
]);

const intervencionesFiltered = computed(() => {
  const list = filtroEstado.value === 'TODO'
    ? intervenciones.value
    : intervenciones.value.filter(i => i.estado === filtroEstado.value);
  const term = busqueda.value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return list.filter(item => (presentacion.value === 'specialty' || !filtroTipo.value || item.tipoIntervencion === filtroTipo.value)
    && (!filtroSector.value || item.sector === filtroSector.value)
    && attentionQueueMatches(item,filtroAsignacion.value,currentUid())
    && (!(userRole.value==='mecanico' && ['team','available'].includes(filtroAsignacion.value)) || attentionSpecialties(userProfile.value).includes(item.tipoIntervencion))
    && (!term || [item.numeroMaquina, nombreMaquina(item), item.sintomaNombre, item.observaciones, item.asignadoNombre, item.creadoPorNombre, item.sector]
      .join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(term)))
    .sort((a, b) => calcPrioridad(a).score - calcPrioridad(b).score);
});
const limpiarFiltros = () => { busqueda.value = ''; filtroTipo.value = ''; filtroSector.value = ''; filtroAsignacion.value = ''; };
const elegirBandeja = value => { filtroAsignacion.value=value; filtroEstado.value='TODO'; };
const numeroCorto = item => eventView(item).numeroMaquinaDisplay;
const fechaCompleta = ts => ts?.seconds ? new Date(ts.seconds * 1000).toLocaleString('es-AR') : 'Fecha pendiente';

// ── Prioridad ──────────────────────────────────────────────────────────────────
const calcPrioridad = (item) => {
  if(item.atencionEstado==='COMPLETADA') return { level:'P2',score:-20 };
  if (item.estado === 'COMPLETADO') return { level: 'P4', score: 9999 };
  if(item.prioridadAtencion) return { URGENTE:{ level:'P1',score:-100 },ALTA:{ level:'P2',score:-50 },NORMAL:{ level:'P4',score:200 } }[item.prioridadAtencion] || { level:'P4',score:200 };
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
function agruparIntervenciones(list) {
  const map = new Map();
  for (const item of list) {
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
}
const grupos = computed(() => agruparIntervenciones(intervencionesFiltered.value));

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
const columnasEspecialidad = computed(() => {
  const definitions = Object.entries(tipoConfig).map(([id, config]) => ({ id, label:config.label }));
  if (intervencionesFiltered.value.some(item => !Object.hasOwn(tipoConfig, item.tipoIntervencion))) {
    definitions.push({ id:'OTHER', label:'Sin categoría' });
  }
  return definitions.map(column => {
    const items = intervencionesFiltered.value.filter(item => column.id === 'OTHER'
      ? !Object.hasOwn(tipoConfig, item.tipoIntervencion) : item.tipoIntervencion === column.id);
    return { ...column, count:items.length, grupos:agruparIntervenciones(items) };
  });
});
watch(columnasEspecialidad, columns => {
  if (!columns.some(column => column.id === especialidadActiva.value)) especialidadActiva.value = 'MECANICO';
});
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
  if(item.atencionVersion) return false;
  return canExecuteIntervention(userRole.value,
    getEffectivePermisosForUser(userRole.value, userProfile.value?.permisosPersonalizados), item);
};
const canAtender=item=>item.atencionVersion===1 && item.atencionEstado==='REPORTADA' && !item.asignadoA && canExecuteIntervention(userRole.value,getEffectivePermisosForUser(userRole.value,userProfile.value?.permisosPersonalizados),item) && (userRole.value==='admin' || attentionSpecialties(userProfile.value).includes(item.tipoIntervencion));
async function onAtender(item) {
  if(actualizando.value || !canAtender(item)) return;
  const owner=currentUid(),version=subscriptionVersion;
  actualizando.value=item.id;
  try {
    await transitionAttention({ interventionId:item.id,operationId:globalThis.crypto.randomUUID(),expectedRevision:item.atencionRevision,action:'tomar' });
    if(currentUid()!==owner || subscriptionVersion!==version) return;
    elegirBandeja('mine');
    Swal.fire({ icon:'success',title:'Confirmaste que vas a atender',text:'Al llegar a la máquina, abrí Detalle e iniciá el trabajo.',timer:2200,showConfirmButton:false,toast:true,position:'top-end' });
  } catch(error) { if(currentUid()===owner && subscriptionVersion===version) Swal.fire({ icon:'error',title:'No se pudo confirmar la toma',text:error.message }); }
  finally { actualizando.value=null; }
}

// ── Acciones individuales ──────────────────────────────────────────────────────
const onTomar = async (item) => {
  if (previewSector.value!==null || actualizando.value || item.estado !== 'PENDIENTE' || !canTomarItem(item)) return;
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
  if (previewSector.value!==null || actualizando.value) return;
  const user = getAuth().currentUser;
  const pendientes = grupo.items.filter(i => i.estado === 'PENDIENTE' && canTomarItem(i));
  if (!pendientes.length) return;

  const confirm = await Swal.fire({
    title: `Tomar ${pendientes.length} en ${grupo.nombre}`,
    text: pendientes.map(i => `${tipoConfig[i.tipoIntervencion]?.label || i.tipoIntervencion} — ${i.sintomaNombre || 'Sin síntoma'}`).join('\n'),
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: `Tomar ${pendientes.length}`,
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#f97316',
  });
  if (!confirm.isConfirmed || actualizando.value) return;

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
  <div class="interventions-page min-h-screen bg-gray-50 pb-8" :inert="detalleId !== null || ensayo" :class="{ 'mechanic-layout':userRole==='mecanico' }">
    <MobileMechanicWork v-if="userRole==='mecanico'" :items="mobileItems" :profile="userProfile" :uid="currentUid()" :preview="previewSector!==null" :loading="loading" :error="errorCarga" :busy="actualizando" :can-take="item=>canAtender(item) || canTomarItem(item)" :alerts="alertsEnabled" :alerts-busy="activatingAlerts" @detail="abrirDetalle" @take="onTomar" @claim="onAtender" @practice="ensayo=true" @retry="cargarIntervenciones()" @alerts="activateAlerts" @off="finishDuty" />
    <header class="management-header"><div><h1>Intervenciones</h1><p>Gestión de solicitudes · Prioridad más alta primero</p></div><button v-if="canDespacharIntervencion(userRole)" class="management-button primary" @click="router.push('/llamar')" v-tippy="'Registrar una nueva solicitud de intervención'"><Plus :size="16" />Nueva solicitud</button></header>

    <!-- ── Tab bar ───────────────────────────────────────────────────────────── -->
    <div class="management-toolbar">
    <div class="management-tabs flex items-center gap-1" role="group" aria-label="Estado de intervenciones">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        @click="filtroEstado = tab.id"
        :aria-pressed="filtroEstado === tab.id"
        class="flex items-center justify-center gap-1 px-2.5 py-1.5 text-[11px] font-bold transition-all whitespace-nowrap min-w-0"
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
        aria-label="Nueva intervención" v-tippy="'Nueva intervención'"
      >
        <Plus class="w-4 h-4" />
      </button>
    </div>
    <div class="presentation-switch" role="group" aria-label="Presentación de intervenciones">
      <button :aria-pressed="presentacion === 'table'" @click="presentacion = 'table'" v-tippy="'Ver la lista completa agrupada por máquina'">Tabla</button>
      <button :aria-pressed="presentacion === 'specialty'" @click="presentacion = 'specialty'" v-tippy="'Separar las solicitudes en Mecánico, Eléctrico y Calidad'">Por especialidad</button>
    </div>
    </div>
    <div class="management-filters">
      <button class="management-button" :disabled="activatingAlerts || previewSector!==null" @click="activateAlerts" v-tippy="'Declarar que estás de turno y habilitar avisos hasta las 06, 14 o 22; el envío se activa con el piloto'">{{ activatingAlerts ? 'Activando…':alertsEnabled ? 'Renovar turno y avisos':'Estoy de turno · Avisos' }}</button><button v-if="alertsEnabled" class="management-button" :disabled="activatingAlerts" @click="finishDuty">Fuera de turno</button>
      <div class="work-inboxes" role="group" aria-label="Bandejas de trabajo"><button class="management-button" :aria-pressed="filtroAsignacion==='team'" @click="elegirBandeja('team')">Avisos del equipo</button><button class="management-button" :aria-pressed="filtroAsignacion==='mine'" @click="elegirBandeja('mine')">Mis trabajos</button></div>
      <button v-if="userRole==='admin' || previewSector!==null" class="management-button" @click="ensayo=true" v-tippy="'Probar asignación, aceptación, espera y relevo con datos ficticios'">Ensayar atención</button>
      <label class="management-search">Buscar<input v-model="busqueda" type="search" placeholder="Máquina, síntoma o persona…" /></label>
      <label v-if="presentacion === 'table'">Categoría<select v-model="filtroTipo"><option value="">Todas</option><option v-for="(config, key) in tipoConfig" :key="key" :value="key">{{ config.label }}</option></select></label>
      <label v-if="sectoresUsuario.length > 1">Sector<select v-model="filtroSector"><option value="">Todos los permitidos</option><option v-for="sector in sectoresUsuario" :key="sector" :value="sector">{{ sector }}</option></select></label>
      <label>Bandeja<select :value="filtroAsignacion" @change="elegirBandeja($event.target.value)"><option value="">Todas</option><option value="mine">Mi trabajo abierto</option><option value="team">Avisos del equipo</option><option value="available">Disponibles para atender</option><option value="free">Sin asignar</option><option value="accept">Sin aceptar · piloto</option><option value="waiting">En espera · piloto</option><option value="review">Por validar · piloto</option></select></label>
      <button class="management-button" @click="limpiarFiltros" v-tippy="'Limpiar búsqueda, categoría, sector y asignación'">Limpiar</button>
    </div>

    <!-- ── Loading ───────────────────────────────────────────────────────────── -->
    <div v-if="errorCarga" class="management-error" role="alert">No se pudieron cargar las intervenciones. Revisá tu conexión o permisos. <button class="management-button" @click="cargarIntervenciones()">Reintentar</button></div>
    <div v-else-if="loading" class="flex items-center justify-center py-24">
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
    <div v-else class="management-results">
    <section v-if="presentacion === 'specialty'" class="specialty-board" aria-label="Solicitudes por especialidad">
      <div class="specialty-selector" role="group" aria-label="Especialidad visible">
        <button v-for="column in columnasEspecialidad" :key="column.id" :aria-pressed="especialidadActiva === column.id" @click="especialidadActiva = column.id">{{ column.label }} <span>{{ column.count }}</span></button>
      </div>
      <div class="specialty-columns">
        <section v-for="column in columnasEspecialidad" :key="column.id" class="specialty-column" :class="{ 'specialty-active': especialidadActiva === column.id }" :aria-label="column.label">
          <header class="specialty-heading" :class="'specialty-' + column.id"><h2>{{ column.label }}</h2><span>{{ column.count }} solicitudes</span></header>
          <div class="specialty-list">
            <p v-if="!column.count" class="specialty-empty">Sin solicitudes con estos filtros</p>
            <table v-else class="specialty-table"><thead><tr><th>Máq.</th><th>Prioridad</th><th>Síntoma / estado</th><th>Detalle</th></tr></thead>
              <tbody v-for="group in column.grupos" :key="group.key">
                <tr v-if="group.items.length > 1" class="specialty-group-row"><td colspan="4"><div><span>Máquina {{ numeroCorto(group.items[0]) }} · {{ group.items.length }}</span><button v-if="group.items.some(item => item.estado === 'PENDIENTE' && canTomarItem(item))" class="management-button" :disabled="!!actualizando" @click="onTomarGrupo(group)" v-tippy="'Tomar solicitudes permitidas de esta máquina y especialidad'">Tomar grupo</button></div></td></tr>
                <tr v-for="item in group.items" :key="item.id" :class="{ 'specialty-stopped': item.estadoMaquina === 'PARADA' && item.estado !== 'COMPLETADO' }">
                  <td><strong>{{ numeroCorto(item) }}</strong><small v-tippy="fechaCompleta(item.createdAt)">{{ timeAgo(item.createdAt) }}</small></td>
                  <td><span class="specialty-badge" :class="prioConfig[calcPrioridad(item).level].bg">{{ prioConfig[calcPrioridad(item).level].label }}</span><small v-if="item.critico" class="text-red-600">Crítica</small></td>
                  <td><strong>{{ item.sintomaNombre || item.motivoDescripcion || 'Solicitud de asistencia' }}</strong><small :class="estadoMaqConfig[item.estadoMaquina]?.color">{{ estadoMaqConfig[item.estadoMaquina]?.label }}</small><span class="specialty-badge" :class="estadoConfig[item.estado]?.bg">{{ attentionLabel(item) }}</span><small>{{ item.asignadoNombre || 'Disponible para el equipo' }}</small><small v-if="item.mencionadoNombre">Dirigido a: {{ item.mencionadoNombre }}</small></td>
                  <td><button class="management-button specialty-detail-button" :aria-label="'Detalle de máquina ' + numeroCorto(item)" @click="abrirDetalle(item)" v-tippy="'Abrir detalle y acciones'"><ChevronRight :size="16" /></button></td>
                </tr>
              </tbody></table>
          </div>
        </section>
      </div>
    </section>
    <div v-if="presentacion === 'table'" class="management-table-scroll"><table class="management-table"><thead><tr><th>Prioridad</th><th>Máquina</th><th>Categoría / estado</th><th>Solicitud</th><th>Asignación</th><th>Ingreso</th><th>Acciones</th></tr></thead>
      <tbody v-for="g in grupos" :key="g.key">
        <tr v-if="g.items.length > 1" class="machine-group-row"><td colspan="7"><div><span>{{ g.nombre }} · {{ g.items.length }} solicitudes</span><button v-if="g.items.some(i => i.estado === 'PENDIENTE' && canTomarItem(i))" class="management-button" :disabled="!!actualizando" @click="onTomarGrupo(g)">Tomar {{ g.items.filter(i => i.estado === 'PENDIENTE' && canTomarItem(i)).length }} permitidas</button></div></td></tr>
        <tr v-for="item in g.items" :key="item.id" :class="{ 'stopped-row': item.estadoMaquina === 'PARADA' && item.estado !== 'COMPLETADO' }">
          <td><span class="management-badge" :class="prioConfig[calcPrioridad(item).level].bg">{{ prioConfig[calcPrioridad(item).level].label }}</span><small v-if="item.critico">Crítica</small></td>
          <td><strong>{{ numeroCorto(item) }}</strong><small>{{ item.tipoMaquina }} · {{ item.sector }}</small><small v-if="item.grupoTelar">GP {{ item.grupoTelar }}<span v-if="item.gmTelar"> · GM {{ item.gmTelar }}</span></small></td>
          <td><span class="management-badge" :class="tipoConfig[item.tipoIntervencion]?.bg">{{ tipoConfig[item.tipoIntervencion]?.label || item.tipoIntervencion }}</span><small :class="estadoMaqConfig[item.estadoMaquina]?.color">{{ estadoMaqConfig[item.estadoMaquina]?.label }}</small><span class="management-badge" :class="estadoConfig[item.estado]?.bg">{{ attentionLabel(item) }}</span></td>
          <td class="request-description"><strong>{{ item.sintomaNombre || item.motivoDescripcion || 'Solicitud de asistencia' }}</strong><p>{{ item.observaciones }}</p><small v-if="item.fotoUrl">Foto adjunta</small></td>
          <td>{{ item.asignadoNombre || 'Sin asignar' }}<small v-if="item.proximaAccion">{{ item.proximaAccion }}</small><small>Solicita: {{ item.creadoPorNombre || 'Sin identificar' }}</small></td>
          <td><span v-tippy="fechaCompleta(item.createdAt)">{{ timeAgo(item.createdAt) }}</span></td>
          <td><div class="management-row-actions"><button class="management-button" @click="abrirDetalle(item)" v-tippy="'Abrir detalle, diagnóstico y acciones'">Detalle</button><button v-if="canAtender(item)" class="management-button primary" :disabled="!!actualizando" @click.stop="onAtender(item)">{{ actualizando===item.id ? 'Confirmando…':'Voy a atender' }}</button><button v-if="item.estado === 'PENDIENTE' && canTomarItem(item)" class="management-button primary" :disabled="!!actualizando" @click="onTomar(item)">{{ actualizando === item.id ? 'Tomando…' : 'Tomar' }}</button></div></td>
        </tr>
      </tbody></table></div>
    <section class="mobile-work-list" aria-label="Trabajos y acciones">
      <p class="mobile-work-guide">Tomá el trabajo, registrá la corrección y completalo desde el detalle.</p>
      <div v-if="previewSector!==null" class="mobile-preview-note">Vista previa: la identidad sigue siendo tu cuenta. Para probar la atención completa sin cambiar trabajos reales, <button @click="ensayo=true">ensayá como mecánico</button>.</div>
      <article v-for="item in intervencionesFiltered" :key="item.id" class="mobile-work-card">
        <div class="mobile-work-heading"><strong>Máquina {{ numeroCorto(item) }}</strong><span>{{ attentionLabel(item) }}</span></div>
        <p class="mobile-work-meta">{{ tipoConfig[item.tipoIntervencion]?.label || item.tipoIntervencion }} · {{ item.sector }} · {{ timeAgo(item.createdAt) }}</p>
        <h2>{{ item.sintomaNombre || 'Problema reportado' }}</h2>
        <p class="mobile-work-description">{{ item.observaciones }}</p>
        <p v-if="mobileAction(item).hint" class="mobile-work-hint">{{ mobileAction(item).hint }}</p>
        <div class="mobile-work-actions"><button class="management-button primary" :disabled="!!actualizando" @click="mobileOpen(item)">{{ actualizando===item.id ? 'Confirmando…' : previewSector!==null && mobileAction(item).kind!=='detail' ? 'Ver cómo atender' : mobileAction(item).label }}</button><button v-if="mobileAction(item).kind!=='detail'" class="management-button" @click="abrirDetalle(item)">Ver detalle</button></div>
      </article>
    </section>
    <footer class="management-footer">{{ intervencionesFiltered.length }} solicitudes · {{ grupos.length }} máquinas · Cerradas: últimas 24 horas</footer>
    </div>
  </div>
  <IntervencionDetalle v-if="detalleId" :key="detalleId" :id="detalleId" @close="cerrarDetalle" />
  <AttentionRehearsal v-if="ensayo" :initial-actor-id="userRole==='mecanico' ? 'demo-mechanic' : 'demo-coordinator'" @close="ensayo=false" />
</template>

<style scoped>
@media(max-width:767px){.mechanic-layout > :not(.mechanic-mobile){display:none!important}}
@media(min-width:768px) and (max-width:980px){.management-table-scroll{display:block;overflow:auto;flex:1;min-height:0}.management-table{width:100%;min-width:760px;border-collapse:collapse;background:white;font-size:12px}.management-table th,.management-table td{padding:10px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}.management-table th{background:#f8fafc}.management-table small{display:block;color:#64748b;margin-top:4px}}

.mobile-work-list{padding:12px;display:grid;gap:12px;padding-bottom:24px}.mobile-work-guide{font-size:14px;color:#475569;margin:0}.mobile-preview-note{padding:12px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:6px;font-size:14px;line-height:1.5}.mobile-preview-note button{color:#4338ca;text-decoration:underline;min-height:44px;font-weight:600}.mobile-work-card{padding:16px;background:white;border:1px solid #e2e8f0;border-radius:8px;min-width:0}.mobile-work-heading{display:flex;justify-content:space-between;gap:8px;align-items:center}.mobile-work-heading strong{font-size:18px}.mobile-work-heading span{font-size:12px;background:#eef2ff;color:#4338ca;padding:4px 7px;border-radius:4px}.mobile-work-meta,.mobile-work-hint{font-size:13px;color:#64748b;margin:8px 0}.mobile-work-card h2{font-size:16px;font-weight:650;margin:12px 0 6px}.mobile-work-description{font-size:15px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.mobile-work-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.mobile-work-actions button{min-height:44px;font-size:14px;flex:1}.mobile-work-actions button.primary{flex:2}
@media(min-width:768px){.mobile-work-list{display:none}}
@media(max-width:767px){.specialty-board,.presentation-switch{display:none}.work-inboxes{flex-wrap:nowrap;overflow-x:auto}.work-inboxes button{white-space:nowrap;min-height:44px}}

.work-inboxes{display:flex;gap:6px;flex-wrap:wrap}.work-inboxes button[aria-pressed=true]{background:#eef2ff;color:#4338ca;border-color:#c7d2fe}.mobile-attend{width:100%;min-height:44px!important;font-size:14px!important}
.management-toolbar { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px 12px; padding:6px 12px; background:white; border-bottom:1px solid #e2e8f0; flex-shrink:0; }
.management-tabs { min-width:0; }
.management-tabs > button { min-height:32px; border-radius:4px; font-weight:600; }
.management-tabs > button[aria-pressed="true"] { background:#eef2ff; color:#4338ca; box-shadow:none; }
.management-tabs > button span { color:inherit; opacity:.75; margin-left:2px; }
.presentation-switch { display:flex; gap:4px; padding:0 0 0 12px; margin:0; border-left:1px solid #e2e8f0; flex-shrink:0; }
.presentation-switch button { min-height:32px; border-radius:4px; padding:6px 10px; font-size:12px; font-weight:600; color:#64748b; cursor:pointer; }
.specialty-selector button { min-height:34px; border-radius:6px; padding:6px 12px; font-size:12px; font-weight:600; color:#64748b; cursor:pointer; }
.presentation-switch button[aria-pressed="true"],.specialty-selector button[aria-pressed="true"] { color:#4338ca; background:#eef2ff; }
.presentation-switch button:focus-visible,.specialty-selector button:focus-visible { outline:2px solid #818cf8; outline-offset:1px; }
.specialty-board { padding:10px 12px; }
.specialty-selector { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px; background:white; border:1px solid #e2e8f0; border-radius:8px; padding:4px; }
.specialty-selector button { flex:1; padding:6px 8px; }
.specialty-selector span { display:inline-block; margin-left:4px; font-size:11px; }
.specialty-columns { display:grid; grid-template-columns:minmax(0,1fr); gap:10px; }
.specialty-column { display:none; min-width:0; border:1px solid #e2e8f0; border-radius:9px; background:#f1f5f9; overflow:hidden; }
.specialty-column.specialty-active { display:flex; flex-direction:column; }
.specialty-heading { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:4px; padding:11px 12px; background:white; border-bottom:1px solid #e2e8f0; border-top:3px solid #94a3b8; flex-shrink:0; }
.specialty-MECANICO { border-top-color:#3b82f6; } .specialty-ELECTRICO { border-top-color:#f59e0b; } .specialty-CALIDAD { border-top-color:#ef4444; }
.specialty-heading h2 { font-size:14px; font-weight:650; color:#334155; }
.specialty-heading > span { font-size:11px; color:#64748b; }
.specialty-list { padding:0; }
.specialty-table { width:100%; table-layout:fixed; border-collapse:separate; border-spacing:0; background:white; font-size:12px; color:#334155; }
.specialty-table th { position:sticky; top:0; z-index:1; text-align:left; background:#f8fafc; border-bottom:1px solid #cbd5e1; padding:9px 6px; font-size:10px; font-weight:600; color:#64748b; }
.specialty-table th:nth-child(1) { width:15%; } .specialty-table th:nth-child(2) { width:23%; } .specialty-table th:nth-child(3) { width:calc(62% - 42px); } .specialty-table th:nth-child(4) { width:42px; }
.specialty-table td { padding:10px 6px; border-bottom:1px solid #e2e8f0; vertical-align:top; overflow-wrap:anywhere; }
.specialty-table tr:hover td { background:#f8fafc; }
.specialty-table strong { font-size:12px; font-weight:600; }
.specialty-table small { display:block; font-size:10px; color:#64748b; margin-top:4px; }
.specialty-table small.text-red-600 { color:#dc2626; } .specialty-table small.text-amber-600 { color:#d97706; } .specialty-table small.text-green-600 { color:#16a34a; }
.specialty-table .specialty-badge { padding:3px 4px; font-size:9px; }
.specialty-group-row td { background:#f1f5f9; padding:6px; } .specialty-group-row td > div { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:5px; font-size:11px; font-weight:600; }
.specialty-group-row button { font-size:10px; min-height:30px; padding:4px 6px; }
.specialty-detail-button { padding:5px; min-width:30px; }
.specialty-stopped td:first-child { border-left:3px solid #ef4444; }
.specialty-stopped { border-left:3px solid #ef4444; }
.specialty-badge { display:inline-block; border-radius:5px; padding:3px 6px; font-size:10px; font-weight:600; flex-shrink:0; }
.specialty-empty { padding:30px 10px; color:#64748b; font-size:12px; text-align:center; }
.management-header,.management-table-scroll,.management-footer { display:none; }
.management-filters { display:flex; gap:8px; flex-wrap:wrap; padding:10px 12px; align-items:end; background:white; border-bottom:1px solid #e2e8f0; }
.management-filters label { display:flex; flex-direction:column; gap:4px; font-size:11px; font-weight:600; color:#64748b; }
.management-filters input,.management-filters select { height:34px; padding:0 9px; border:1px solid #cbd5e1; border-radius:7px; font-size:12px; color:#334155; background:white; max-width:100%; }
.management-search { flex:1; min-width:180px; }
.management-button { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:34px; padding:6px 10px; border:1px solid #cbd5e1; border-radius:7px; background:white; color:#334155; font-size:12px; font-weight:600; white-space:nowrap; cursor:pointer; }
.management-button:hover { background:#f1f5f9; }
.management-button.primary { background:#4f46e5; border-color:#4f46e5; color:white; }
.management-button.primary:hover { background:#4338ca; }
.management-button:disabled { opacity:.5; cursor:wait; }
.management-button:focus-visible,.management-filters input:focus-visible,.management-filters select:focus-visible { outline:2px solid #818cf8; outline-offset:2px; }
.management-error { padding:24px; color:#b91c1c; font-size:14px; }
@media(min-width:768px) {
 .presentation-switch { margin:0; }
 .specialty-board { display:flex; flex-direction:column; flex:1; min-height:0; padding:0; }
 .specialty-columns { flex:1; min-height:0; }
 .specialty-column { min-height:0; }
 .specialty-list { overflow:auto; flex:1; min-height:0; scrollbar-gutter:stable; }
 .interventions-page { height:100%; min-height:0; display:flex; flex-direction:column; padding:12px; gap:10px; overflow:hidden; }
 .management-header { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-shrink:0; }
 .management-header h1 { font-size:19px; font-weight:650; color:#0f172a; }
 .management-header p { margin-top:2px; font-size:12px; color:#64748b; }
 .management-toolbar { border:1px solid #e2e8f0; border-radius:6px; padding:5px 6px; flex-wrap:nowrap; }
 .management-tabs > button { font-size:12px; }
 .management-tabs > button[aria-pressed="true"] { background:#eef2ff; color:#4338ca; box-shadow:none; }
 .management-tabs > button:last-child:not([aria-pressed]) { display:none; }
 .management-filters { border:1px solid #e2e8f0; border-radius:9px; flex-shrink:0; }
 .management-results { flex:1; min-height:0; display:flex; flex-direction:column; }
 .management-cards { max-width:none; width:100%; padding:0; overflow:auto; flex:1; min-height:0; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; align-content:start; }
 .management-cards > div { margin:0; min-width:0; }
 .management-cards .animate-pulse-subtle { animation:none; }
 .management-cards button { min-height:32px; }
 .management-cards button.bg-orange-500 { background:#4f46e5; border-radius:7px; font-size:12px; font-weight:600; box-shadow:none; }
 .management-footer { display:block; flex-shrink:0; font-size:11px; color:#64748b; padding:7px 2px 0; }
}
@media(min-width:981px) {
 .specialty-selector { display:none; }
 .specialty-columns { grid-template-columns:repeat(3,minmax(0,1fr)); }
 .specialty-column { display:flex; flex-direction:column; }
 .specialty-column:last-child:nth-child(4) { grid-column:1 / -1; }
 .management-cards { display:none; }
 .management-table-scroll { display:block; flex:1; min-height:0; overflow:auto; border:1px solid #e2e8f0; border-radius:9px; background:white; }
 .management-table { width:100%; border-collapse:separate; border-spacing:0; table-layout:fixed; font-size:12px; color:#334155; }
 .management-table th { position:sticky; top:0; z-index:1; text-align:left; background:#f8fafc; color:#64748b; font-size:11px; font-weight:600; padding:11px 9px; border-bottom:1px solid #cbd5e1; }
 .management-table th:nth-child(1) { width:9%; } .management-table th:nth-child(2) { width:13%; } .management-table th:nth-child(3) { width:15%; } .management-table th:nth-child(4) { width:25%; } .management-table th:nth-child(5) { width:15%; } .management-table th:nth-child(6) { width:9%; } .management-table th:nth-child(7) { width:14%; }
 .management-table td { padding:10px 9px; border-bottom:1px solid #e2e8f0; vertical-align:top; overflow-wrap:anywhere; }
 .management-table tr:hover td { background:#f8fafc; }
 .management-table strong { font-weight:600; color:#0f172a; }
 .management-table small { display:block; color:#64748b; font-size:11px; margin-top:4px; }
 .management-table small.text-red-600 { color:#dc2626; }
 .management-table small.text-amber-600 { color:#d97706; }
 .management-table small.text-green-600 { color:#16a34a; }
 .management-badge { display:inline-block; padding:3px 6px; border-radius:5px; font-size:10px; font-weight:600; }
 .request-description p { margin-top:4px; color:#64748b; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
 .management-row-actions { display:flex; gap:5px; flex-wrap:wrap; }
 .management-row-actions button { padding:5px 8px; }
 .machine-group-row td { background:#f1f5f9; padding:6px 9px; }
 .machine-group-row td > div { display:flex; align-items:center; justify-content:space-between; gap:8px; font-weight:600; }
 .stopped-row td:first-child { border-left:3px solid #ef4444; }
}
@media(min-width:981px) and (max-width:1199px) {
 .specialty-heading { padding:9px; }
 .specialty-list { padding:0; }
}
@keyframes pulse-subtle {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
  50%      { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
}
.animate-pulse-subtle {
  animation: pulse-subtle 2s ease-in-out infinite;
}
</style>
