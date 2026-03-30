<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getAuth } from 'firebase/auth';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { intervencionService } from '../services/intervencionService';
import { catalogoService }     from '../services/catalogoService';
import {
  ArrowLeft, Wrench, Zap, ShieldAlert, AlertTriangle, OctagonX,
  Clock, CheckCircle2, BookOpen, Save, CirclePlay, X
} from 'lucide-vue-next';
import Swal from 'sweetalert2';

const route  = useRoute();
const router = useRouter();

// ── Estado ────────────────────────────────────────────────────────────────────
const intervencion = ref(null);
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
const piezaSeleccionada = ref(null);

// Cascada de selección
const seccionSeleccionada     = ref('');
const grupoSeleccionado       = ref('');
const denominacionSeleccionada = ref(null);
const showProcedimientoViewer  = ref(false);

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
onMounted(() => {
  unsub = intervencionService.suscribirPorId(route.params.id, (data) => {
    intervencion.value = data;
    loading.value = false;
    // Prellenar diagnostico si ya existe
    if (data.causaRaiz     && !diagnostico.value.causaRaiz)    diagnostico.value.causaRaiz    = data.causaRaiz;
    if (data.accionTomada  && !diagnostico.value.accionTomada) diagnostico.value.accionTomada = data.accionTomada;
    if (data.piezaId       && !diagnostico.value.piezaId)      Object.assign(diagnostico.value, { piezaId: data.piezaId, piezaNombre: data.piezaNombre, numeroCatalogo: data.numeroCatalogo, numeroArticulo: data.numeroArticulo });
    if (data.tiempoReal && !diagnostico.value.tiempoReal) diagnostico.value.tiempoReal = data.tiempoReal;
  });
  // Actualizar el reloj cada 30 s para el timer en vivo
  timerInterval = setInterval(() => { ahora.value = Date.now(); }, 30_000);
});

onUnmounted(() => { unsub?.(); clearInterval(timerInterval); });

// ── Cargar catálogo + resolver grupo cuando se conoce el modelo ──────────────
watch(intervencion, async (iv) => {
  if (!iv) return;
  // Resolver grupo y GM telar
  if (iv.tipoMaquina === 'TELAR' && grupoTelarResuelto.value === null) {
    if (iv.grupoTelar) {
      grupoTelarResuelto.value = iv.grupoTelar;
      gmTelarResuelto.value    = iv.gmTelar || null;
    } else if (iv.maquinaId) {
      const snap = await getDoc(doc(db, 'maquinas', iv.maquinaId));
      if (snap.exists()) {
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
  catalogoCargado.value = true;
  catalogo.value = await catalogoService.obtenerPorModelo(modelo);
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
  intervencion.value?.estado === 'EN_PROCESO' && esElMecanico.value
);

const puedeTomarIntervencion = computed(() =>
  intervencion.value?.estado === 'PENDIENTE'
);

const tomando = ref(false);
const tomarIntervencion = async () => {
  const user = getAuth().currentUser;
  tomando.value = true;
  try {
    await intervencionService.actualizarEstado(route.params.id, 'EN_PROCESO', {
      asignadoA:      user?.uid || null,
      asignadoNombre: user?.displayName || user?.email || 'Usuario',
    });
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  } finally { tomando.value = false; }
};

// ── Guardar diagnóstico ───────────────────────────────────────────────────────
const guardarDiagnostico = async () => {
  guardando.value = true;
  try {
    await intervencionService.guardarDiagnostico(route.params.id, diagnostico.value);
    Swal.fire({ toast: true, position: 'top', icon: 'success', title: 'Diagnóstico guardado', showConfirmButton: false, timer: 2000, iconColor: '#ea580c' });
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  } finally { guardando.value = false; }
};

// ── Completar ─────────────────────────────────────────────────────────────────
const completar = async () => {
  const confirm = await Swal.fire({
    title: '¿Completar intervención?',
    text: 'El problema fue resuelto.',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Sí, completar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#16a34a',
  });
  if (!confirm.isConfirmed) return;
  guardando.value = true;
  try {
    // Siempre guardar tiempoAuto al completar; tiempoReal es el campo manual
    diagnostico.value.tiempoAuto = minutosTranscurridos.value !== null ? String(minutosTranscurridos.value) : null;
    // Si el mecánico no ingresó nada en tiempoReal, lo dejamos null (no pisamos el auto)
    await intervencionService.guardarDiagnostico(route.params.id, diagnostico.value);
    await intervencionService.actualizarEstado(route.params.id, 'COMPLETADO');
    router.push('/intervenciones');
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  } finally { guardando.value = false; }
};
</script>

<template>
  <div class="bg-transparent pb-28">

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-32">
      <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-500"></div>
    </div>

    <template v-else-if="intervencion">

      <!-- ── Navbar portal: solo badges tipo + crítico ─────── -->
      <Teleport to="#navbar-header-portal">
        <div class="flex items-center gap-1.5">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black"
            :class="tipoConfig[intervencion.tipoIntervencion]?.bg || 'bg-gray-100 text-gray-500'">
            <component :is="tipoConfig[intervencion.tipoIntervencion]?.ic" class="w-2.5 h-2.5" />
            {{ tipoConfig[intervencion.tipoIntervencion]?.label }}
          </span>
          <span v-if="intervencion.critico"
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-red-100 text-red-700">
            <AlertTriangle class="w-2.5 h-2.5" /> CRÍTICO
          </span>
        </div>
      </Teleport>

      <main class="max-w-sm mx-auto pt-2">
        <div class="bg-white border-y border-gray-100">

          <!-- ── ① MÁQUINA (solo lectura) ──────────────────────── -->
          <div class="px-4 py-2 border-b border-gray-100">
            <div class="flex items-center gap-2 mb-2 min-w-0">
              <span class="w-5 h-5 rounded-full bg-orange-100 text-orange-600 text-[10px] font-black flex items-center justify-center shrink-0">1</span>
              <label class="text-[10px] font-extrabold text-gray-400 tracking-widest shrink-0">MÁQUINA</label>
              <div class="flex items-center gap-1 text-[10px] text-gray-400 min-w-0 overflow-hidden ml-1">
                <span class="font-bold text-gray-500 shrink-0">{{ modeloCorto }}</span>
                <span class="text-gray-300 mx-0.5">·</span>
                <Clock class="w-3 h-3 text-gray-300 shrink-0" />
                <span class="ml-0.5 shrink-0">{{ timeAgo(intervencion.createdAt) }}</span>
                <span class="text-gray-300 mx-0.5">·</span>
                <span class="truncate">{{ intervencion.creadoPorNombre }}</span>
              </div>
            </div>

            <div class="flex gap-2">
              <!-- Tipo -->
              <div :class="intervencion.tipoMaquina === 'TELAR' ? 'flex-[0.8]' : 'flex-1'">
                <label class="block text-[9px] font-extrabold text-gray-400 tracking-widest mb-1">TIPO</label>
                <div class="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
                  <span class="text-sm font-bold text-gray-900">{{ intervencion.tipoMaquina || '—' }}</span>
                </div>
              </div>
              <!-- Grupo (solo TELAR) -->
              <div v-if="intervencion.tipoMaquina === 'TELAR'" class="flex-[0.5]">
                <label class="block text-[9px] font-extrabold text-gray-400 tracking-widest mb-1">GRUPO</label>
                <div class="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
                  <span class="text-sm font-bold text-gray-700">{{ grupoTelarResuelto || '—' }}</span>
                </div>
              </div>
              <!-- Máquina -->
              <div :class="intervencion.tipoMaquina === 'TELAR' ? 'flex-[1.1]' : 'flex-[1.2]'">
                <label class="block text-[9px] font-extrabold text-gray-400 tracking-widest mb-1">MÁQUINA</label>
                <div class="bg-orange-50 border border-orange-300 rounded-lg px-2.5 py-1.5">
                  <span class="text-sm font-bold text-orange-700">
                    {{ nombreMaquinaDisplay }}
                    <span v-if="intervencion.lado && intervencion.lado !== 'U'" class="text-orange-500"> ({{ intervencion.lado }})</span>
                  </span>
                </div>
              </div>
              <!-- GM (solo TELAR) -->
              <div v-if="intervencion.tipoMaquina === 'TELAR'" class="flex-[0.45]">
                <label class="block text-[9px] font-extrabold text-gray-400 tracking-widest mb-1">GM</label>
                <div class="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
                  <span class="text-sm font-bold text-gray-700">{{ gmTelarResuelto || '—' }}</span>
                </div>
              </div>
            </div>

          </div>

          <!-- ── ② ¿QUÉ ESTÁ PASANDO? (solo lectura) ───────────── -->
          <div class="px-4 pt-3 pb-3 border-b border-gray-100">
            <div class="flex items-center gap-2 mb-2">
              <span class="w-5 h-5 rounded-full bg-orange-100 text-orange-600 text-[10px] font-black flex items-center justify-center shrink-0">2</span>
              <label class="text-[10px] font-extrabold text-gray-400 tracking-widest">¿QUÉ ESTÁ PASANDO?</label>
              <!-- Badge derivaA inline al título -->
              <div v-if="intervencion.derivaA" class="ml-auto flex items-center gap-1.5">
                <span class="text-[9px] font-extrabold text-gray-400 tracking-widest">SE NOTIFICA A:</span>
                <span class="text-[11px] font-black px-2.5 py-0.5 rounded-full"
                  :class="[DERIVA_COLOR[intervencion.derivaA]?.bg, DERIVA_COLOR[intervencion.derivaA]?.text]">
                  {{ DERIVA_COLOR[intervencion.derivaA]?.label }}
                </span>
              </div>
            </div>

            <!-- Síntoma -->
            <div v-if="intervencion.sintomaNombre"
              class="border border-orange-300 bg-orange-50 rounded-lg px-2.5 py-1.5 mb-2">
              <span class="text-sm font-bold text-orange-700">
                {{ intervencion.sintomaNombre }}
              </span>
            </div>
            <div v-else class="border border-gray-200 bg-gray-50 rounded-lg px-2.5 py-1.5 mb-2">
              <span class="text-sm text-gray-400 italic">Sin síntoma registrado</span>
            </div>

            <!-- Observaciones del operador -->
            <div v-if="intervencion.observaciones" class="mt-2 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2">
              <p class="text-[9px] font-extrabold text-gray-400 tracking-widest mb-0.5">OBSERVACIONES</p>
              <p class="text-sm text-gray-700 italic leading-snug">"{{ intervencion.observaciones }}"</p>
            </div>

            <!-- Foto -->
            <div v-if="intervencion.fotoUrl" class="mt-2 rounded-xl overflow-hidden border border-gray-200 max-h-48 bg-gray-900">
              <img :src="intervencion.fotoUrl" class="w-full h-full object-contain" />
            </div>
          </div>

          <!-- ── ③ ESTADO DE LA MÁQUINA (solo lectura) ─────────── -->
          <div class="px-4 pt-3 pb-3 border-b border-gray-100">
            <div class="flex items-center gap-2 mb-2">
              <span class="w-5 h-5 rounded-full bg-orange-100 text-orange-600 text-[10px] font-black flex items-center justify-center shrink-0">3</span>
              <label class="text-[10px] font-extrabold text-gray-400 tracking-widest">ESTADO DE LA MÁQUINA</label>
            </div>
            <div class="grid grid-cols-3 gap-2">
              <div v-for="e in ESTADOS_MAQUINA" :key="e.id"
                class="flex flex-row items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl border-2 transition-all"
                :class="intervencion.estadoMaquina === e.id ? e.activeBg : 'bg-white border-gray-100 opacity-40'"
              >
                <component :is="e.ic" class="w-3.5 h-3.5 shrink-0"
                  :class="intervencion.estadoMaquina === e.id ? e.iconColor : 'text-gray-300'" />
                <span class="text-[10px] font-black leading-tight"
                  :class="intervencion.estadoMaquina === e.id ? e.textColor : 'text-gray-300'">
                  {{ e.label }}
                </span>
              </div>
            </div>
          </div>

          <!-- ── ④ CATÁLOGO DE PIEZAS ──────────────────────────────── -->
          <div v-if="catalogo.length" class="border-t border-gray-100">
            <!-- Header sección -->
            <div class="px-4 pt-3 pb-1 flex items-center gap-2">
              <span class="w-5 h-5 rounded-full bg-orange-100 text-orange-600 text-[10px] font-black flex items-center justify-center shrink-0">4</span>
              <label class="text-[10px] font-extrabold text-gray-400 tracking-widest">CATÁLOGO DE PIEZAS</label>
            </div>

            <!-- 1. Sección + 2. Grupo -->
            <div class="px-4 py-3 border-b border-gray-50 flex gap-4">
              <div class="flex-[1.4]">
                <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest mb-1">1. Sección</label>
                <select v-model="seccionSeleccionada" :disabled="!puedeEditar"
                  class="w-full bg-transparent border-0 p-0 text-gray-900 text-base font-bold focus:ring-0 focus:outline-none disabled:opacity-40">
                  <option value="">Seleccionar...</option>
                  <option v-for="s in seccionesDisponibles" :key="s" :value="s">{{ s }}</option>
                </select>
              </div>
              <div class="flex-[0.6]">
                <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest mb-1"
                  :class="{'opacity-50': !seccionSeleccionada}">2. Grupo</label>
                <select v-model="grupoSeleccionado" :disabled="!seccionSeleccionada || !puedeEditar"
                  class="w-full bg-transparent border-0 p-0 text-gray-900 text-base font-bold focus:ring-0 focus:outline-none disabled:opacity-30">
                  <option value="">...</option>
                  <option v-for="g in gruposDisponibles" :key="g" :value="g">{{ g }}</option>
                </select>
              </div>
            </div>

            <!-- 3. Punto / Parte específica -->
            <div v-if="grupoSeleccionado" class="px-4 py-3 border-b border-gray-50 animate-in slide-in-from-top-2">
              <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest mb-1">3. Punto / Parte específica</label>
              <select v-model="denominacionSeleccionada" :disabled="!puedeEditar"
                class="w-full bg-transparent border-0 p-0 text-gray-900 text-base font-bold focus:ring-0 focus:outline-none disabled:opacity-40">
                <option :value="null">Seleccionar...</option>
                <option v-for="d in denominacionesDisponibles" :key="d.id" :value="d">
                  {{ d.denominacion }}{{ d.subGrupo && d.subGrupo !== '-' ? ' [' + d.subGrupo + ']' : '' }}
                </option>
              </select>

              <!-- Tiempo + Procedimiento -->
              <div v-if="denominacionSeleccionada" class="mt-2.5 flex items-center gap-2">
                <div v-if="denominacionSeleccionada.tiempo"
                  class="flex items-center gap-1.5 flex-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  <span class="text-[11px] font-black text-amber-700 tracking-wide">{{ denominacionSeleccionada.tiempo }}</span>
                </div>
                <div v-if="denominacionSeleccionada.numeroArticulo && denominacionSeleccionada.numeroArticulo !== '-'"
                  class="bg-indigo-600 text-white text-[9px] font-black px-2 py-1 rounded shrink-0">
                  Art: {{ denominacionSeleccionada.numeroArticulo }}
                </div>
                <button type="button"
                  @click="denominacionSeleccionada?.procedimiento?.length > 0 && (showProcedimientoViewer = true)"
                  :disabled="!denominacionSeleccionada?.procedimiento?.length"
                  class="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition active:scale-[0.97]"
                  :class="denominacionSeleccionada?.procedimiento?.length
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                    : 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'">
                  <BookOpen class="w-3.5 h-3.5" />
                  <span>Procedimiento</span>
                  <span v-if="denominacionSeleccionada?.procedimiento?.length"
                    class="bg-indigo-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
                    {{ denominacionSeleccionada.procedimiento.length }}
                  </span>
                </button>
              </div>

              <!-- Limpiar selección (solo si puedeEditar) -->
              <button v-if="denominacionSeleccionada && puedeEditar" type="button"
                @click="limpiarPieza"
                class="mt-2 text-[10px] font-bold text-gray-400 hover:text-red-500 transition">
                ✕ Limpiar selección
              </button>
            </div>

            <!-- Pieza guardada (solo lectura si no puedeEditar) -->
            <div v-if="!puedeEditar && diagnostico.piezaNombre"
              class="px-4 py-3 border-b border-gray-50">
              <label class="block text-[10px] font-extrabold text-gray-400 tracking-widest mb-1">PIEZA REGISTRADA</label>
              <div class="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                <BookOpen class="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p class="text-sm font-black text-blue-800 leading-tight">{{ diagnostico.piezaNombre }}</p>
                  <p v-if="diagnostico.numeroCatalogo && diagnostico.numeroCatalogo !== '-'"
                    class="text-[11px] text-blue-400">Cat: {{ diagnostico.numeroCatalogo }}</p>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="catalogoCargado && puedeEditar" class="px-4 py-3 text-xs text-gray-400 italic border-t border-gray-100">
            Sin catálogo para {{ intervencion.modeloMaquina || 'este modelo' }}.
          </div>

          <!-- ── ⑤ DIAGNÓSTICO DEL MECÁNICO ────────────────────── -->
          <div class="px-4 pt-3 pb-3 border-b border-gray-100">
            <div class="flex items-center gap-2 mb-3">
              <span class="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-[10px] font-black flex items-center justify-center shrink-0">5</span>
              <label class="text-[10px] font-extrabold text-gray-400 tracking-widest">DIAGNÓSTICO</label>
            </div>

            <!-- Causa raíz -->
            <div class="mb-3">
              <label class="block text-[9px] font-extrabold text-gray-400 tracking-widest mb-1">CAUSA RAÍZ</label>
              <textarea v-model="diagnostico.causaRaiz" :disabled="!puedeEditar" rows="2"
                placeholder="¿Qué causó el problema?"
                class="w-full bg-white border border-gray-200 text-gray-900 text-sm rounded-xl focus:ring-orange-400 focus:border-orange-400 block p-2.5 resize-none outline-none disabled:bg-gray-50 disabled:text-gray-500" />
            </div>

            <!-- Acción tomada -->
            <div class="mb-3">
              <label class="block text-[9px] font-extrabold text-gray-400 tracking-widest mb-1">ACCIÓN TOMADA</label>
              <textarea v-model="diagnostico.accionTomada" :disabled="!puedeEditar" rows="2"
                placeholder="¿Qué se hizo para resolverlo?"
                class="w-full bg-white border border-gray-200 text-gray-900 text-sm rounded-xl focus:ring-orange-400 focus:border-orange-400 block p-2.5 resize-none outline-none disabled:bg-gray-50 disabled:text-gray-500" />
            </div>

            <!-- Tiempo real -->
            <div>
              <label class="block text-[9px] font-extrabold text-gray-400 tracking-widest mb-2">TIEMPO (min)</label>
              <div class="flex gap-2">
                <!-- Auto (solo lectura) -->
                <div class="flex-1">
                  <p class="text-[9px] font-extrabold text-gray-400 tracking-widest mb-1">AUTO</p>
                  <div class="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                    <Clock class="w-3.5 h-3.5 text-emerald-500 shrink-0"
                      :class="puedeEditar ? 'animate-pulse' : ''" />
                    <span class="text-sm font-black text-emerald-700">
                      {{ minutosTranscurridos !== null ? minutosTranscurridos + ' min' : '—' }}
                    </span>
                    <span v-if="puedeEditar" class="text-[9px] text-emerald-400 ml-auto">en curso</span>
                  </div>
                </div>
                <!-- Manual (editable) -->
                <div class="flex-1">
                  <p class="text-[9px] font-extrabold text-gray-400 tracking-widest mb-1">AJUSTE MANUAL</p>
                  <input
                    v-model="diagnostico.tiempoReal"
                    :disabled="!puedeEditar"
                    type="number" min="1"
                    placeholder="Ej: 25"
                    class="w-full bg-white border border-gray-200 text-gray-900 text-sm font-bold rounded-xl focus:ring-orange-400 focus:border-orange-400 block px-3 py-2 outline-none disabled:bg-gray-50 disabled:text-gray-400" />
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>

      <!-- ── Barra inferior fija ──────────────────────────────────── -->
      <div v-if="puedeEditar || puedeTomarIntervencion" class="fixed bottom-0 left-0 right-0 z-40 px-2 pb-2">
        <div class="max-w-sm mx-auto bg-white border border-gray-200 rounded-[1.4rem] shadow-[0_-10px_35px_rgba(15,23,42,0.14)] p-3">
          <div class="flex items-center gap-2">
            <button @click="router.back()"
              class="p-3 bg-gray-100 hover:bg-gray-200 rounded-xl transition active:scale-90">
              <ArrowLeft class="w-5 h-5 text-gray-500" />
            </button>

            <!-- Tomar intervención (PENDIENTE → EN_PROCESO) -->
            <button v-if="puedeTomarIntervencion" @click="tomarIntervencion" :disabled="tomando"
              class="flex-1 flex items-center justify-center gap-2 h-12 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-black transition active:scale-[0.98] disabled:opacity-50 shadow-sm shadow-orange-500/20">
              <span v-if="tomando" class="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              <Wrench v-else class="w-4 h-4" />
              Tomar intervención
            </button>

            <!-- Guardar + Completar (EN_PROCESO, asignado a mí) -->
            <template v-else-if="puedeEditar">
              <button @click="guardarDiagnostico" :disabled="guardando"
                class="flex-1 flex items-center justify-center gap-2 h-12 bg-gray-800 hover:bg-gray-900 text-white rounded-xl text-sm font-black transition active:scale-[0.98] disabled:opacity-50 shadow-sm">
                <Save class="w-4 h-4" />
                Guardar
              </button>
              <button @click="completar" :disabled="guardando"
                class="flex-1 flex items-center justify-center gap-2 h-12 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-black transition active:scale-[0.98] disabled:opacity-50 shadow-sm shadow-emerald-500/20">
                <CheckCircle2 class="w-4 h-4" />
                Completar
              </button>
            </template>
          </div>
        </div>
      </div>

      <!-- Completado -->
      <div v-if="intervencion.estado === 'COMPLETADO'"
        class="max-w-sm mx-auto mx-3 mt-3 bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
        <CheckCircle2 class="w-8 h-8 text-emerald-500 mx-auto mb-2" />
        <p class="text-sm font-black text-emerald-700">Intervención completada</p>
        <p v-if="intervencion.asignadoNombre" class="text-xs text-emerald-500 mt-0.5">por {{ intervencion.asignadoNombre }}</p>
      </div>

    </template>

    <!-- No encontrado -->
    <div v-else class="flex flex-col items-center justify-center py-24 text-center px-8">
      <p class="font-black text-gray-400">Intervención no encontrada</p>
      <button @click="router.back()" class="mt-3 text-sm text-orange-600 font-bold">← Volver</button>
    </div>

  </div>

  <!-- Modal Procedimiento -->
  <Teleport to="body">
    <div v-if="showProcedimientoViewer"
      class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/60 backdrop-blur-sm"
      @click.self="showProcedimientoViewer = false">
      <div class="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
        <div class="p-4 border-b border-gray-100 flex justify-between items-start shrink-0">
          <div class="flex-1 pr-2">
            <p class="text-[10px] font-extrabold text-indigo-500 tracking-widest mb-0.5">PROCEDIMIENTO</p>
            <h3 class="text-sm font-black text-gray-800 leading-tight">{{ denominacionSeleccionada?.denominacion }}</h3>
            <p class="text-xs text-gray-400 font-medium mt-0.5">{{ denominacionSeleccionada?.seccion }} · Grupo {{ denominacionSeleccionada?.grupo }}</p>
          </div>
          <button @click="showProcedimientoViewer = false" class="p-1.5 hover:bg-gray-100 rounded-lg transition shrink-0">
            <X class="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <div class="overflow-y-auto flex-1 p-4 space-y-4">
          <div v-for="(paso, i) in denominacionSeleccionada?.procedimiento" :key="i" class="space-y-2">
            <div class="flex gap-3">
              <div class="flex-none w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-black flex items-center justify-center shrink-0 mt-0.5">{{ i + 1 }}</div>
              <p class="text-sm text-gray-800 font-medium leading-relaxed pt-0.5">{{ paso.texto }}</p>
            </div>
            <div v-if="paso.imagenUrl" class="ml-9 rounded-lg overflow-hidden border border-gray-200">
              <img :src="paso.imagenUrl" class="w-full max-h-64 object-contain bg-gray-900" />
            </div>
          </div>
        </div>
        <div class="p-4 border-t border-gray-100 shrink-0">
          <button @click="showProcedimientoViewer = false" type="button"
            class="w-full py-3 bg-gray-900 text-white rounded-xl font-bold text-sm hover:bg-gray-800 transition">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
