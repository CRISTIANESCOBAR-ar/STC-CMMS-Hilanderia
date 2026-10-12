<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import { getAuth } from 'firebase/auth';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { intervencionService } from '../services/intervencionService';
import OperationalImage from './OperationalImage.vue';
import AttentionPanel from './AttentionPanel.vue';
import { userProfile, userRole } from '../services/authService';
import { getEffectivePermisosForUser } from '../services/profileService';
import { canExecuteIntervention } from '../utils/interventionAccess';
import { catalogoService }     from '../services/catalogoService';
import {
  ArrowLeft, Wrench, Zap, ShieldAlert, AlertTriangle, OctagonX,
  Clock, CheckCircle2, BookOpen, Save, CirclePlay, X
} from 'lucide-vue-next';
import Swal from 'sweetalert2';
import { vTippy } from '../utils/tooltipDirective';
import { eventView, machineStateLabel } from '../utils/faultEvents';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/themes/light-border.css';
const props = defineProps({ id: { type:String, default:null } });
const emit = defineEmits(['close']);
const interventionId = computed(() => props.id || route.params.id);
const dialog = ref(null);
const errorCarga = ref(false);
const fotoAmpliada = ref(false);
const baseline = ref('');
const showAttention = ref(false);
const attentionBusy = ref(false);
const attentionDirty = ref(false);
const dirty = computed(() => baseline.value && baseline.value !== JSON.stringify(diagnostico.value));
let previousFocus;
let alive = true;
const close = async () => {
  if (guardando.value || tomando.value || attentionBusy.value) return;
  if (dirty.value || attentionDirty.value) {
    const result = await Swal.fire({ title:'¿Descartar cambios sin guardar?', text:'El diagnóstico tiene cambios pendientes.', icon:'question', showCancelButton:true, confirmButtonText:'Descartar', cancelButtonText:'Seguir editando' });
    if (!result.isConfirmed) return;
    baseline.value = JSON.stringify(diagnostico.value);
  }
  if (props.id) emit('close'); else router.push('/intervenciones');
};
function beforeUnload(event) { if (dirty.value || attentionDirty.value || guardando.value || tomando.value || attentionBusy.value) { event.preventDefault(); event.returnValue = ''; } }
onBeforeRouteLeave(async () => {
  if (guardando.value || tomando.value || attentionBusy.value) return false;
  if (!dirty.value && !attentionDirty.value) return true;
  const result = await Swal.fire({ title:'¿Descartar cambios sin guardar?', showCancelButton:true, confirmButtonText:'Descartar', cancelButtonText:'Seguir editando' });
  return result.isConfirmed;
});
function dialogKeydown(event) {
  if (event.key === 'Escape') { event.stopPropagation(); if (showProcedimientoViewer.value) showProcedimientoViewer.value = false; else if (fotoAmpliada.value) fotoAmpliada.value = false; else close(); }
  if (event.key !== 'Tab') return;
  const focusRoot = showProcedimientoViewer.value || fotoAmpliada.value ? dialog.value?.querySelector('.detail-nested') : dialog.value;
  const nodes = [...(focusRoot?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') || [])].filter(node => node.getClientRects().length);
  if (!nodes.length) { event.preventDefault(); return; }
  const first = nodes[0], last = nodes.at(-1), active = globalThis.document?.activeElement;
  if (event.shiftKey && (active === first || !nodes.includes(active))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (active === last || !nodes.includes(active))) { event.preventDefault(); first.focus(); }
}

const route  = useRoute();
const router = useRouter();

// ── Estado ────────────────────────────────────────────────────────────────────
const intervencion = ref(null);
const prioridadLabel = computed(() => {
  const item = intervencion.value;
  if (!item || item.estado === 'COMPLETADO') return 'Normal';
  return item.estadoMaquina === 'PARADA' ? 'Urgente' : item.estadoMaquina === 'CON_PROBLEMA' ? (item.critico ? 'Alta' : 'Media') : 'Normal';
});
const loading      = ref(true);
const guardando    = ref(false);
let   unsub        = null;

// ── Timer en vivo ─────────────────────────────────────────────────────────────
const ahora        = ref(Date.now());
let   timerInterval = null;

// Minutos desde que se tomó la intervención (EN_PROCESO) — se actualiza cada 30s
const minutosTranscurridos = computed(() => {
  const iv = intervencion.value;
  if (!iv?.fechaInicio?.seconds) return null;
  const fin = iv.fechaFin?.seconds || (ahora.value / 1000);
  return Math.max(1, Math.round((fin - iv.fechaInicio.seconds) / 60));
});

// tiempoAuto: siempre calculado, solo lectura
// tiempoReal: campo manual del mecánico (override / ajuste)

// ── Grupo y GM telar (pueden no estar en intervenciones antiguas) ─────────────
const grupoTelarResuelto = ref(null);
const gmTelarResuelto    = ref(null);
const formatGrpTear = (raw) => {
  const r = String(raw || '').trim();
  if (!r) return null;
  const n = parseInt(r.slice(-2), 10);
  return isNaN(n) ? r.slice(-2) : String(n);
};
const formatGCmest = (raw) => {
  const r = String(raw || '').trim();
  if (!r) return null;
  const n = parseInt(r, 10);
  return isNaN(n) ? r : String(n);
};

// ── Catálogo ──────────────────────────────────────────────────────────────────
const catalogo        = ref([]);
const catalogoCargado = ref(false);
const catalogoError = ref(false);
const piezaSeleccionada = ref(null);

// Cascada de selección
const seccionSeleccionada     = ref('');
const grupoSeleccionado       = ref('');
const denominacionSeleccionada = ref(null);
const showProcedimientoViewer  = ref(false);
let nestedTrigger;
watch([showProcedimientoViewer, fotoAmpliada], async ([procedure, photo], [previousProcedure, previousPhoto]) => {
  if (procedure || photo) { nestedTrigger = globalThis.document?.activeElement; await nextTick(); dialog.value?.querySelector('.detail-nested button')?.focus?.(); }
  else if (previousProcedure || previousPhoto) { await nextTick(); nestedTrigger?.focus?.(); }
});
async function cargarCatalogo(modelo = intervencion.value?.modeloMaquina) {
  if (!modelo) return;
  catalogoError.value = false; catalogoCargado.value = true;
  try { const items = await catalogoService.obtenerPorModelo(modelo); if (alive) catalogo.value = items; }
  catch { if (alive) { catalogoCargado.value = false; catalogoError.value = true; } }
}

// ── Formulario diagnóstico ────────────────────────────────────────────────────
const diagnostico = ref({
  causaRaiz:     '',
  accionTomada:  '',
  piezaId:       null,
  piezaNombre:   null,
  tiempoReal:    '',   // ajuste manual del mecánico
  tiempoAuto:    null, // calculado automáticamente (fechaFin - fechaInicio)
  numeroCatalogo: null,
  numeroArticulo: null,
});

// ── Carga realtime ────────────────────────────────────────────────────────────
function subscribe() {
  unsub?.(); errorCarga.value = false; loading.value = true;
  unsub = intervencionService.suscribirPorId(interventionId.value, (data) => {
    if (!alive) return;
    intervencion.value = data;
    loading.value = false;
    if (data && !dirty.value && !guardando.value) {
      for (const key of Object.keys(diagnostico.value)) diagnostico.value[key] = data[key] ?? (['causaRaiz', 'accionTomada', 'tiempoReal'].includes(key) ? '' : null);
      baseline.value = JSON.stringify(diagnostico.value);
    }
  }, () => { if (alive) { loading.value = false; errorCarga.value = true; } });
}
onMounted(() => {
  previousFocus = globalThis.document?.activeElement;
  nextTick(() => dialog.value?.focus?.());
  globalThis.window?.addEventListener('beforeunload', beforeUnload);
  subscribe();
  // Actualizar el reloj cada 30 s para el timer en vivo
  timerInterval = setInterval(() => { ahora.value = Date.now(); }, 30_000);
});

onUnmounted(() => { alive = false; unsub?.(); clearInterval(timerInterval); globalThis.window?.removeEventListener('beforeunload', beforeUnload); if (previousFocus?.isConnected) previousFocus.focus(); });

// ── Cargar catálogo + resolver grupo cuando se conoce el modelo ──────────────
watch(intervencion, async (iv) => {
  if (!iv) return;
  // Resolver grupo y GM telar
  if (iv.tipoMaquina === 'TELAR' && grupoTelarResuelto.value === null) {
    if (iv.grupoTelar) {
      grupoTelarResuelto.value = iv.grupoTelar;
      gmTelarResuelto.value    = iv.gmTelar || null;
    } else if (iv.maquinaId) {
      const snap = await getDoc(doc(db, 'maquinas', iv.maquinaId)).catch(() => null);
      if (!alive) return;
      if (snap?.exists()) {
        const d = snap.data();
        grupoTelarResuelto.value = formatGrpTear(d.grp_tear);
        gmTelarResuelto.value    = formatGCmest(d.g_cmest);
      }
    }
  }
  // Cargar catálogo
  if (catalogoCargado.value) return;
  const modelo = iv.modeloMaquina;
  if (!modelo) return;
  await cargarCatalogo(modelo);
}, { immediate: true });

// ── Cascada catálogo ──────────────────────────────────────────────────────────
const seccionesDisponibles = computed(() =>
  [...new Set(catalogo.value.map(c => c.seccion))].filter(Boolean).sort()
);
const gruposDisponibles = computed(() => {
  if (!seccionSeleccionada.value) return [];
  return [...new Set(
    catalogo.value.filter(c => c.seccion === seccionSeleccionada.value).map(c => c.grupo)
  )].filter(Boolean).sort();
});
const denominacionesDisponibles = computed(() => {
  if (!grupoSeleccionado.value) return [];
  const items = catalogo.value.filter(c =>
    c.seccion === seccionSeleccionada.value && c.grupo === grupoSeleccionado.value
  );
  const seen = new Set();
  return items.filter(c => {
    const sub = (c.subGrupo || '').trim().replace(/^-$/, '');
    const key = `${c.denominacion}||${sub}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});

watch(seccionSeleccionada, () => { grupoSeleccionado.value = ''; denominacionSeleccionada.value = null; });
watch(grupoSeleccionado,   () => { denominacionSeleccionada.value = null; });
watch(denominacionSeleccionada, (pieza) => {
  showProcedimientoViewer.value = false;
  if (!pieza) {
    piezaSeleccionada.value = null;
    diagnostico.value.piezaId = null;
    diagnostico.value.piezaNombre = null;
    diagnostico.value.numeroCatalogo = null;
    diagnostico.value.numeroArticulo = null;
    return;
  }
  piezaSeleccionada.value = pieza;
  diagnostico.value.piezaId        = pieza.id;
  diagnostico.value.piezaNombre    = pieza.denominacion;
  diagnostico.value.numeroCatalogo = pieza.numeroCatalogo || null;
  diagnostico.value.numeroArticulo = pieza.numeroArticulo || null;
});

const limpiarPieza = () => {
  denominacionSeleccionada.value = null;
  seccionSeleccionada.value = '';
  grupoSeleccionado.value = '';
  Object.assign(diagnostico.value, { piezaId:null, piezaNombre:null, numeroCatalogo:null, numeroArticulo:null });
};

// ── Helpers UI ────────────────────────────────────────────────────────────────
const DERIVA_COLOR = {
  MECANICO:  { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'Mecánico'  },
  ELECTRICO: { bg: 'bg-amber-100',  text: 'text-amber-700',  label: 'Eléctrico' },
  AMBOS:     { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Ambos'     },
  TEJEDOR:   { bg: 'bg-green-100',  text: 'text-green-700',  label: 'Tejedor'   },
  CALIDAD:   { bg: 'bg-red-100',    text: 'text-red-700',    label: 'Calidad'   },
};

const ESTADOS_MAQUINA = [
  { id: 'EN_MARCHA',    label: 'En marcha',    ic: CirclePlay,    activeBg: 'bg-green-50 border-green-400',  iconColor: 'text-green-600',  textColor: 'text-green-700'  },
  { id: 'CON_PROBLEMA', label: 'Con problema', ic: AlertTriangle, activeBg: 'bg-amber-50 border-amber-400',  iconColor: 'text-amber-600',  textColor: 'text-amber-700'  },
  { id: 'PARADA',       label: 'Parada',       ic: OctagonX,      activeBg: 'bg-red-50 border-red-400',      iconColor: 'text-red-600',    textColor: 'text-red-700'    },
];

const tipoConfig = {
  MECANICO:  { label: 'Mecánico',  ic: Wrench,      bg: 'bg-blue-100 text-blue-700',   bar: 'bg-blue-500'  },
  ELECTRICO: { label: 'Eléctrico', ic: Zap,         bg: 'bg-amber-100 text-amber-700', bar: 'bg-amber-400' },
  CALIDAD:   { label: 'Calidad',   ic: ShieldAlert, bg: 'bg-red-100 text-red-700',     bar: 'bg-red-500'   },
};

const estadoMaqConfig = {
  EN_MARCHA:    { label: 'En marcha',    ic: CirclePlay,    color: 'text-green-600' },
  CON_PROBLEMA: { label: 'Con problema', ic: AlertTriangle, color: 'text-amber-600' },
  PARADA:       { label: 'Parada',       ic: OctagonX,      color: 'text-red-600'   },
};

// Nombre de máquina como lo ve el operador
const modeloCorto = computed(() => {
  const m = intervencion.value?.modeloMaquina || '';
  return m.slice(-4) || m || '—';
});

const nombreMaquinaDisplay = computed(() => {
  const iv = intervencion.value;
  if (!iv) return '';
  if (iv.nombreMaquinaDisplay) return iv.nombreMaquinaDisplay;
  if (iv.tipoMaquina === 'TELAR') {
    const n = parseInt(String(iv.numeroMaquina).slice(-2), 10);
    return `Toyota ${isNaN(n) ? iv.numeroMaquina : n}`;
  }
  return `${iv.tipoMaquina} ${iv.numeroMaquina}`;
});

const timeAgo = (ts) => {
  if (!ts?.seconds) return 'ahora';
  const s = Math.floor(Date.now() / 1000 - ts.seconds);
  if (s < 90)       return 'hace un momento';
  const m = Math.floor(s / 60);
  if (m < 60)       return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24)       return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
};

const esElMecanico = computed(() => {
  const uid = getAuth().currentUser?.uid;
  return intervencion.value?.asignadoA === uid;
});

const puedeEditar = computed(() =>
  !intervencion.value?.atencionVersion && intervencion.value?.estado === 'EN_PROCESO' && esElMecanico.value && puedeEjecutar.value
);

const puedeEjecutar = computed(() => canExecuteIntervention(userRole.value,
  getEffectivePermisosForUser(userRole.value, userProfile.value?.permisosPersonalizados), intervencion.value));

const puedeTomarIntervencion = computed(() =>
  !intervencion.value?.atencionVersion && intervencion.value?.estado === 'PENDIENTE' && puedeEjecutar.value
);

const tomando = ref(false);
const tomarIntervencion = async () => {
  if (tomando.value || guardando.value || !puedeTomarIntervencion.value) return;
  const user = getAuth().currentUser;
  tomando.value = true;
  try {
    await intervencionService.actualizarEstado(interventionId.value, 'EN_PROCESO', {
      asignadoA:      user?.uid || null,
      asignadoNombre: user?.displayName || user?.email || 'Usuario',
    });
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  } finally { tomando.value = false; }
};

// ── Guardar diagnóstico ───────────────────────────────────────────────────────
const guardarDiagnostico = async () => {
  if (guardando.value || tomando.value || attentionBusy.value || !puedeEditar.value) return;
  guardando.value = true;
  const payload = { ...diagnostico.value };
  try {
    await intervencionService.guardarDiagnostico(interventionId.value, payload);
    baseline.value = JSON.stringify(payload);
    Swal.fire({ toast: true, position: 'top', icon: 'success', title: 'Diagnóstico guardado', showConfirmButton: false, timer: 2000, iconColor: '#ea580c' });
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  } finally { guardando.value = false; }
};

// ── Completar ─────────────────────────────────────────────────────────────────
const completar = async () => {
  if (guardando.value || tomando.value || attentionBusy.value || !puedeEditar.value) return;
  const confirm = await Swal.fire({
    title: '¿Completar intervención?',
    text: 'El problema fue resuelto.',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Sí, completar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#16a34a',
  });
  if (!confirm.isConfirmed || guardando.value || !puedeEditar.value) return;
  guardando.value = true;
  try {
    // Siempre guardar tiempoAuto al completar; tiempoReal es el campo manual
    diagnostico.value.tiempoAuto = minutosTranscurridos.value !== null ? String(minutosTranscurridos.value) : null;
    // Si el mecánico no ingresó nada en tiempoReal, lo dejamos null (no pisamos el auto)
    await intervencionService.guardarDiagnostico(interventionId.value, { ...diagnostico.value });
    await intervencionService.actualizarEstado(interventionId.value, 'COMPLETADO');
    baseline.value = JSON.stringify(diagnostico.value);
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  } finally { guardando.value = false; }
};
</script>

<template>
  <Teleport to="body">
    <div class="detail-overlay" @click.self="close">
      <section ref="dialog" class="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="intervention-detail-title" tabindex="-1" @keydown="dialogKeydown">
        <header class="detail-header"><div><h2 id="intervention-detail-title">Detalle de intervención<span v-if="intervencion"> · Máquina {{ eventView(intervencion).numeroMaquinaDisplay }}</span></h2><p v-if="intervencion">{{ tipoConfig[intervencion.tipoIntervencion]?.label || intervencion.tipoIntervencion }} · {{ intervencion.sector }} · Prioridad {{ prioridadLabel }} · {{ intervencion.estado === 'PENDIENTE' ? 'Pendiente' : intervencion.estado === 'EN_PROCESO' ? 'En proceso' : 'Completada' }}<span v-if="intervencion.critico" class="detail-critical"> · Crítica</span></p></div><button class="detail-button" aria-label="Cerrar detalle" :disabled="guardando || tomando || attentionBusy" @click="close" v-tippy="'Cerrar detalle'"><X :size="18" /></button></header>
        <div v-if="loading" class="detail-message" role="status">Cargando intervención…</div>
        <div v-else-if="errorCarga" class="detail-message" role="alert">No se pudo cargar la intervención. <button class="detail-button" @click="subscribe">Reintentar</button></div>
        <div v-else-if="!intervencion" class="detail-message">Intervención no encontrada.</div>
        <div v-else class="detail-body" :class="{ 'managed-attention': intervencion.atencionVersion }">
          <section class="detail-request"><h3>Solicitud</h3><dl class="detail-metadata"><dt>Máquina</dt><dd>{{ nombreMaquinaDisplay }} · {{ intervencion.numeroMaquina }}</dd><dt>Modelo</dt><dd>{{ intervencion.modeloMaquina || '—' }}</dd><dt v-if="grupoTelarResuelto">Grupo / GM</dt><dd v-if="grupoTelarResuelto">{{ grupoTelarResuelto }} / {{ gmTelarResuelto || '—' }}</dd><dt>Estado de máquina</dt><dd :class="estadoMaqConfig[intervencion.estadoMaquina]?.color">{{ machineStateLabel(intervencion.estadoMaquina) }}</dd><dt>Solicitado por</dt><dd>{{ intervencion.creadoPorNombre || 'Sin identificar' }}</dd><dt>Ingreso</dt><dd>{{ intervencion.createdAt?.seconds ? new Date(intervencion.createdAt.seconds * 1000).toLocaleString('es-AR') : '—' }}</dd><dt>Asignado a</dt><dd>{{ intervencion.asignadoNombre || 'Sin asignar' }}</dd><dt v-if="intervencion.derivaA">Se notifica a</dt><dd v-if="intervencion.derivaA">{{ DERIVA_COLOR[intervencion.derivaA]?.label || intervencion.derivaA }}</dd></dl>
            <h4>Síntoma</h4><p class="detail-symptom">{{ intervencion.sintomaNombre || intervencion.motivoDescripcion || 'Sin síntoma registrado' }}</p><h4>Observaciones</h4><p class="detail-observations">{{ intervencion.observaciones || 'Sin observaciones' }}</p>
            <button v-if="intervencion.fotoUrl" class="detail-photo" @click="fotoAmpliada = true" v-tippy="'Ampliar foto adjunta'" aria-label="Ampliar foto adjunta"><OperationalImage :src="intervencion.fotoUrl" /></button>
          </section>
          <section class="detail-work"><h3>Diagnóstico y resolución</h3><p v-if="intervencion.atencionVersion" class="detail-symptom">{{ intervencion.observaciones || intervencion.sintomaNombre }}</p><AttentionPanel v-if="intervencion.atencionVersion || showAttention" :key="intervencion.id" :item="intervencion" @busy="attentionBusy=$event" @dirty="attentionDirty=$event" /><p class="detail-readonly" v-if="!puedeEditar && !intervencion.atencionVersion">{{ intervencion.estado === 'COMPLETADO' ? 'Intervención completada. Datos de consulta.' : puedeTomarIntervencion ? 'Tomá la intervención para registrar el trabajo realizado.' : 'Consulta de la intervención. La edición corresponde al usuario asignado con permiso de ejecución.' }}</p>
            <p v-if="catalogoError" class="detail-readonly">No se pudo cargar el catálogo. <button class="detail-button" @click="cargarCatalogo()">Reintentar catálogo</button></p><fieldset :disabled="!puedeEditar || guardando || tomando">
              <label for="iv-cause">Causa raíz<textarea id="iv-cause" v-model="diagnostico.causaRaiz" rows="3" placeholder="¿Qué causó el problema?" /></label>
              <label for="iv-action">Acción tomada<textarea id="iv-action" v-model="diagnostico.accionTomada" rows="3" placeholder="¿Qué se hizo para resolverlo?" /></label>
              <div class="detail-time"><div><span>Tiempo automático</span><strong>{{ minutosTranscurridos !== null ? minutosTranscurridos + ' min' : '—' }}</strong></div><label for="iv-time">Ajuste manual (min)<input id="iv-time" v-model="diagnostico.tiempoReal" type="number" min="1" placeholder="Opcional" /></label></div>
              <div v-if="catalogo.length" class="detail-catalog"><h4>Pieza del catálogo</h4><div class="detail-catalog-selectors"><label for="iv-section">Sección<select id="iv-section" v-model="seccionSeleccionada"><option value="">Seleccionar…</option><option v-for="section in seccionesDisponibles" :key="section" :value="section">{{ section }}</option></select></label><label for="iv-group">Grupo<select id="iv-group" v-model="grupoSeleccionado" :disabled="!seccionSeleccionada"><option value="">Seleccionar…</option><option v-for="group in gruposDisponibles" :key="group" :value="group">{{ group }}</option></select></label></div><label for="iv-part">Denominación<select id="iv-part" v-model="denominacionSeleccionada" :disabled="!grupoSeleccionado"><option :value="null">Seleccionar…</option><option v-for="part in denominacionesDisponibles" :key="part.id" :value="part">{{ part.denominacion }}{{ part.subGrupo && part.subGrupo !== '-' ? ' [' + part.subGrupo + ']' : '' }}</option></select></label><button v-if="diagnostico.piezaNombre" type="button" class="detail-button" @click="limpiarPieza">Quitar pieza</button></div>
            </fieldset>
            <div v-if="diagnostico.piezaNombre" class="detail-piece"><strong>{{ diagnostico.piezaNombre }}</strong><p>Catálogo: {{ diagnostico.numeroCatalogo || '—' }} · Artículo: {{ diagnostico.numeroArticulo || '—' }}</p></div>
            <button v-if="denominacionSeleccionada" class="detail-button" :disabled="!denominacionSeleccionada.procedimiento?.length" @click="showProcedimientoViewer = true" v-tippy="denominacionSeleccionada.procedimiento?.length ? 'Consultar procedimiento de la pieza' : 'La pieza no tiene procedimiento'">Procedimiento</button>
            <button v-if="userRole==='admin' && !intervencion.atencionVersion && !showAttention" class="detail-button" @click="showAttention=true">Circuito de atención · piloto</button>

          </section>
        </div>
        <footer class="detail-actions"><span role="status">{{ guardando ? 'Guardando…' : tomando ? 'Tomando intervención…' : dirty ? 'Cambios sin guardar' : '' }}</span><div><button class="detail-button" :disabled="guardando || tomando || attentionBusy" @click="close">Cerrar</button><button v-if="puedeTomarIntervencion" class="detail-button primary" :disabled="guardando || tomando || attentionBusy" @click="tomarIntervencion">Tomar intervención</button><template v-if="puedeEditar"><button class="detail-button primary" :disabled="guardando || tomando || attentionBusy" @click="guardarDiagnostico"><Save :size="16" />Guardar diagnóstico</button><button class="detail-button complete" :disabled="guardando || tomando || attentionBusy" @click="completar"><CheckCircle2 :size="16" />Completar</button></template></div></footer>
        <div v-if="showProcedimientoViewer || fotoAmpliada" class="detail-nested-overlay" @click.self="showProcedimientoViewer = false; fotoAmpliada = false"><section class="detail-nested" role="dialog" aria-modal="true" aria-label="Información adjunta"><header><h3>{{ fotoAmpliada ? 'Foto adjunta' : 'Procedimiento · ' + denominacionSeleccionada?.denominacion }}</h3><button class="detail-button" aria-label="Cerrar información adjunta" @click="showProcedimientoViewer = false; fotoAmpliada = false"><X :size="18" /></button></header><div class="detail-nested-body"><OperationalImage v-if="fotoAmpliada" :src="intervencion.fotoUrl" /><ol v-else><li v-for="(step, index) in denominacionSeleccionada?.procedimiento" :key="index"><strong>{{ index + 1 }}.</strong> {{ step.texto }}<img v-if="step.imagenUrl" :src="step.imagenUrl" alt="Imagen del paso" /></li></ol></div></section></div>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.detail-overlay { position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; padding:16px; background:rgb(15 23 42 / .45); }
.detail-dialog { position:relative; width:min(1100px,100%); max-height:calc(100dvh - 32px); display:flex; flex-direction:column; background:white; border:1px solid #e2e8f0; border-radius:12px; box-shadow:0 20px 60px #0f172a40; overflow:hidden; outline:none; }
.detail-header { display:flex; justify-content:space-between; align-items:start; gap:12px; padding:16px 20px; border-bottom:1px solid #e2e8f0; flex-shrink:0; }
.detail-header h2 { font-size:18px; color:#0f172a; font-weight:650; } .detail-header p { margin-top:4px; font-size:12px; color:#64748b; } .detail-critical { color:#b91c1c; font-weight:600; }
.detail-body { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.15fr); overflow:auto; min-height:0; }
.detail-request,.detail-work { padding:20px; min-width:0; overflow-wrap:anywhere; } .detail-request { background:#f8fafc; border-right:1px solid #e2e8f0; }
h3 { font-size:15px; font-weight:650; color:#334155; margin-bottom:12px; } h4 { font-size:12px; font-weight:600; color:#475569; margin:16px 0 6px; }
.detail-metadata { display:grid; grid-template-columns:130px minmax(0,1fr); gap:7px 10px; font-size:12px; } dt { color:#64748b; } dd { color:#334155; }
.detail-symptom { color:#0f172a; font-size:14px; font-weight:600; } .detail-observations { white-space:pre-wrap; font-size:13px; color:#475569; line-height:1.6; }
.detail-photo { display:block; margin-top:16px; width:100%; border:1px solid #cbd5e1; border-radius:8px; overflow:hidden; background:#f1f5f9; cursor:zoom-in; } .detail-photo :deep(img) { width:100%; max-height:260px; object-fit:contain; }
.detail-readonly { font-size:12px; color:#64748b; line-height:1.5; margin-bottom:12px; }
fieldset { border:0; padding:0; min-width:0; } label { display:flex; flex-direction:column; gap:5px; margin-bottom:12px; color:#475569; font-size:12px; font-weight:600; }
input,select,textarea { width:100%; min-width:0; border:1px solid #cbd5e1; border-radius:7px; padding:9px; background:white; color:#334155; font-size:13px; font-weight:400; } textarea { resize:vertical; min-height:85px; } fieldset:disabled input,fieldset:disabled select,fieldset:disabled textarea { background:#f8fafc; color:#64748b; }
.detail-time,.detail-catalog-selectors { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; } .detail-time > div { font-size:12px; color:#64748b; } .detail-time strong { display:block; padding:9px; margin-top:5px; background:#ecfdf5; border-radius:7px; color:#047857; }
.detail-piece { padding:10px; background:#eef2ff; border:1px solid #c7d2fe; border-radius:8px; font-size:12px; color:#4338ca; margin:10px 0; } .detail-piece p { margin-top:4px; }
.detail-button { min-height:36px; display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:7px 11px; border:1px solid #cbd5e1; border-radius:7px; background:white; color:#334155; font-size:12px; font-weight:600; cursor:pointer; } .detail-button:hover { background:#f1f5f9; } .detail-button.primary { background:#4f46e5; border-color:#4f46e5; color:white; } .detail-button.complete { background:#059669; border-color:#059669; color:white; } .detail-button:disabled { opacity:.45; cursor:default; } button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible { outline:2px solid #818cf8; outline-offset:2px; }
.detail-actions { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; padding:12px 20px; border-top:1px solid #e2e8f0; background:white; flex-shrink:0; } .detail-actions > span { font-size:12px; color:#64748b; } .detail-actions > div { display:flex; flex-wrap:wrap; gap:8px; } .detail-message { padding:40px 20px; color:#64748b; font-size:14px; }
.detail-nested-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:12px; background:#0f172a60; } .detail-nested { width:100%; max-height:100%; background:white; border-radius:9px; display:flex; flex-direction:column; overflow:hidden; } .detail-nested header { display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid #e2e8f0; } .detail-nested h3 { margin:0; } .detail-nested-body { overflow:auto; padding:16px; } .detail-nested-body :deep(img) { width:100%; max-height:65dvh; object-fit:contain; } .detail-nested li { margin-bottom:16px; font-size:13px; color:#334155; line-height:1.6; }
@media(max-width:800px) { .managed-attention .detail-work { order:-1; } .detail-body { grid-template-columns:minmax(0,1fr); } .detail-request { border-right:0; border-bottom:1px solid #e2e8f0; } .detail-request,.detail-work { padding:14px; } }
@media(max-width:480px) { .detail-overlay { padding:8px; } .detail-dialog { max-height:calc(100dvh - 16px); } .detail-header,.detail-actions { padding:12px; } .detail-header h2 { font-size:16px; } .detail-metadata { grid-template-columns:110px minmax(0,1fr); } .detail-actions > div { width:100%; } .detail-actions button { flex:1; } }
</style>
