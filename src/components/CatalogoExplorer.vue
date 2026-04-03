<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { maquinaService } from '../services/maquinaService';
import { catalogoService } from '../services/catalogoService';
import { MOTIVOS_POR_TIPO, MOTIVOS_DEFAULT } from '../constants/motivos';
import { getMotivosFirestore, updateCategoriaMotivos } from '../services/motivosService';
import { userRole } from '../services/authService';
import Swal from 'sweetalert2';
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/themes/light-border.css';
import {
  ChevronRight, ChevronDown, BookOpen, Wrench, Zap,
  CheckCircle2, XCircle, ClipboardList, Loader2, Info,
  ChevronUp, BookMarked, Settings2, Eye, Pencil, Plus, Trash2, Save, X,
  ArrowLeft, ToggleLeft, ToggleRight, GripVertical, EyeOff
} from 'lucide-vue-next';

// ── Directiva v-tippy ─────────────────────────────────────────────────────────
const vTippy = {
  mounted(el, binding) {
    tippy(el, {
      content: binding.value,
      theme: 'light-border',
      duration: [120, 100],
      placement: binding.arg || 'top',
    });
  },
  updated(el, binding) {
    if (el._tippy) el._tippy.setContent(binding.value);
  },
  unmounted(el) {
    if (el._tippy) el._tippy.destroy();
  },
};

// ── Estado ────────────────────────────────────────────────────────────────────
const maquinas       = ref([]);
const catalogoItems  = ref([]);
const cargandoMaq    = ref(true);
const cargandoCat    = ref(false);

const tipoSeleccionado  = ref(null);
const modeloSeleccionado = ref(null);
const tabActiva         = ref('catalogo'); // 'catalogo' | 'motivos' | 'maquinas'
const filtroProc        = ref(null);      // null | 'con' | 'sin'
const pasoMobile        = ref('tipos');   // 'tipos' | 'modelos' | 'detalle'

// Viewer de procedimiento (preview móvil)
const showViewer   = ref(false);
const itemViewer   = ref(null);

// Editor CRUD de procedimiento
const showEditor    = ref(false);
const editandoItem  = ref(null);
const editandoPasos = ref([]);
const guardando     = ref(false);

// ── Estado CRUD Catálogo ───────────────────────────────────────────────────
const catEditando    = ref(null);   // { id, denominacion, numeroCatalogo, numeroArticulo, visible }
const catGuardando   = ref(false);
const catNuevoForm   = ref(null);   // { seccion, grupo, denominacion, numeroCatalogo, numeroArticulo }

// Secciones expandidas en el catálogo
const seccionesExpandidas = ref(new Set());

// ── Carga de Máquinas ─────────────────────────────────────────────────────────
onMounted(async () => {
  maquinas.value = await maquinaService.obtenerMaquinasOnce();
  cargandoMaq.value = false;
});

// ── Computed: Tipos + Modelos ─────────────────────────────────────────────────
const tiposDisponibles = computed(() => {
  const mapa = {};
  maquinas.value.forEach(m => {
    if (!m.tipo) return;
    if (!mapa[m.tipo]) mapa[m.tipo] = { tipo: m.tipo, modelos: new Set(), total: 0 };
    mapa[m.tipo].total++;
    const modelo = m.modelo || m.nombre_maquina || null;
    if (modelo) mapa[m.tipo].modelos.add(modelo);
  });
  return Object.values(mapa)
    .map(t => ({ ...t, modelos: [...t.modelos].sort() }))
    .sort((a, b) => a.tipo.localeCompare(b.tipo));
});

const modelosDelTipo = computed(() => {
  if (!tipoSeleccionado.value) return [];
  const found = tiposDisponibles.value.find(t => t.tipo === tipoSeleccionado.value);
  return found ? found.modelos : [];
});

// ── Selección de Tipo ─────────────────────────────────────────────────────────
const seleccionarTipo = (tipo) => {
  if (tipoSeleccionado.value === tipo) return;
  tipoSeleccionado.value = tipo;
  modeloSeleccionado.value = null;
  catalogoItems.value = [];
  seccionesExpandidas.value = new Set();
  // Si solo hay un modelo, cargarlo automáticamente
  const found = tiposDisponibles.value.find(t => t.tipo === tipo);
  if (found && found.modelos.length === 1) {
    seleccionarModelo(found.modelos[0]);
  } else {
    pasoMobile.value = 'modelos';
  }
};

// ── Selección de Modelo ───────────────────────────────────────────────────────
const seleccionarModelo = async (modelo) => {
  modeloSeleccionado.value = modelo;
  catalogoItems.value = [];
  seccionesExpandidas.value = new Set();
  filtroProc.value = null;
  tabActiva.value = 'catalogo';
  pasoMobile.value = 'detalle';
  cargandoCat.value = true;
  try {
    catalogoItems.value = await catalogoService.obtenerPorModelo(modelo);
    // Expandir la primera sección por defecto
    const secciones = [...new Set(catalogoItems.value.map(i => i.seccion))].sort();
    if (secciones.length > 0) seccionesExpandidas.value.add(secciones[0]);
  } finally {
    cargandoCat.value = false;
  }
};

// ── Estructura del catálogo: seccion > grupo > items ─────────────────────────
const catalogoEstructura = computed(() => {
  const mapa = {};
  // Admin ve todos; el resto solo ve los visibles
  const visibles = userRole.value === 'admin'
    ? catalogoItems.value
    : catalogoItems.value.filter(i => i.visible !== false);
  const itemsFiltrados = filtroProc.value === null
    ? visibles
    : filtroProc.value === 'con'
      ? visibles.filter(i => Array.isArray(i.procedimiento) && i.procedimiento.length > 0)
      : visibles.filter(i => !Array.isArray(i.procedimiento) || i.procedimiento.length === 0);
  itemsFiltrados.forEach(item => {
    const sec = item.seccion || 'Sin sección';
    const grp = String(item.grupo || 'Sin grupo');
    if (!mapa[sec]) mapa[sec] = {};
    if (!mapa[sec][grp]) mapa[sec][grp] = [];
    mapa[sec][grp].push(item);
  });
  // Convertir a array ordenado
  return Object.entries(mapa)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([seccion, grupos]) => ({
      seccion,
      grupos: Object.entries(grupos)
        .sort((a, b) => {
          const na = Number(a[0]), nb = Number(b[0]);
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          return a[0].localeCompare(b[0]);
        })
        .map(([grupo, items]) => ({ grupo, items }))
    }));
});

// ── Estadísticas ──────────────────────────────────────────────────────────────
const statsModelo = computed(() => {
  const total = catalogoItems.value.length;
  const conProc = catalogoItems.value.filter(i =>
    Array.isArray(i.procedimiento) && i.procedimiento.length > 0
  ).length;
  return { total, conProc, sinProc: total - conProc };
});

const toggleSeccion = (sec) => {
  if (seccionesExpandidas.value.has(sec)) {
    seccionesExpandidas.value.delete(sec);
  } else {
    seccionesExpandidas.value.add(sec);
  }
};

const expandirTodo = () => {
  catalogoEstructura.value.forEach(s => seccionesExpandidas.value.add(s.seccion));
};
const colapsarTodo = () => { seccionesExpandidas.value.clear(); };

// ── Motivos desde Firestore ───────────────────────────────────────────────────
const motivosFirestore = ref(null);   // { 'Mecánico': [{nombre,visible}], 'Eléctrico': [...] }
const cargandoMotivos  = ref(false);

// Cargar motivos cada vez que cambia el tipo o se activa la tab
watch([() => tipoSeleccionado.value, () => tabActiva.value], async ([tipo, tab]) => {
  if (tab !== 'motivos' || !tipo) return;
  cargandoMotivos.value = true;
  try {
    const data = await getMotivosFirestore(tipo);
    // Si no hay doc en Firestore, construir desde hardcoded
    if (data) {
      motivosFirestore.value = {
        'Mecánico':  data['Mecánico']  || [],
        'Eléctrico': data['Eléctrico'] || [],
      };
    } else {
      const fallback = MOTIVOS_POR_TIPO[tipo] || MOTIVOS_DEFAULT;
      motivosFirestore.value = {
        'Mecánico':  (fallback['Mecánico']  || []).map(n => ({ nombre: n, visible: true })),
        'Eléctrico': (fallback['Eléctrico'] || []).map(n => ({ nombre: n, visible: true })),
      };
    }
  } finally {
    cargandoMotivos.value = false;
  }
}, { immediate: false });

// Estado CRUD de motivos
const motivoEditCat    = ref(null);   // 'Mecánico' | 'Eléctrico'
const motivoEditLista  = ref([]);     // copia editable
const motivoNuevo      = ref('');
const guardandoMotivos = ref(false);

const iniciarEditMotivos = (cat) => {
  motivoEditCat.value = cat;
  motivoEditLista.value = (motivosFirestore.value?.[cat] || []).map(m => ({ ...m }));
  motivoNuevo.value = '';
};

const cancelarEditMotivos = () => {
  motivoEditCat.value = null;
  motivoEditLista.value = [];
};

const agregarMotivo = () => {
  const nombre = motivoNuevo.value.trim().toUpperCase();
  if (!nombre) return;
  if (motivoEditLista.value.some(m => m.nombre === nombre)) return;
  motivoEditLista.value.push({ nombre, visible: true });
  motivoNuevo.value = '';
};

const eliminarMotivo = (idx) => {
  motivoEditLista.value.splice(idx, 1);
};

const toggleVisible = (idx) => {
  motivoEditLista.value[idx].visible = !motivoEditLista.value[idx].visible;
};

const guardarMotivos = async () => {
  guardandoMotivos.value = true;
  try {
    await updateCategoriaMotivos(
      tipoSeleccionado.value,
      motivoEditCat.value,
      motivoEditLista.value
    );
    motivosFirestore.value[motivoEditCat.value] = [...motivoEditLista.value];
    motivoEditCat.value = null;
    motivoEditLista.value = [];
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message, confirmButtonColor: '#2563eb' });
  } finally {
    guardandoMotivos.value = false;
  }
};

// motivosDelTipo para compatibilidad (sinónimo readonly)
const motivosDelTipo = computed(() => {
  if (!tipoSeleccionado.value) return null;
  if (motivosFirestore.value) return motivosFirestore.value;
  return MOTIVOS_POR_TIPO[tipoSeleccionado.value] || MOTIVOS_DEFAULT || null;
});

// ── Máquinas del modelo ───────────────────────────────────────────────────────
const maquinasDelModelo = computed(() => {
  if (!modeloSeleccionado.value || !tipoSeleccionado.value) return [];
  return maquinas.value.filter(m =>
    m.tipo === tipoSeleccionado.value &&
    (m.modelo === modeloSeleccionado.value || m.nombre_maquina === modeloSeleccionado.value)
  );
});

const maquinasSinModelo = computed(() => {
  if (!tipoSeleccionado.value) return [];
  return maquinas.value.filter(m =>
    m.tipo === tipoSeleccionado.value && !m.modelo && !m.nombre_maquina
  );
});

// ── Viewer de procedimiento ───────────────────────────────────────────────────
const abrirViewer = (item) => {
  itemViewer.value = item;
  showViewer.value = true;
};

// ── Editor CRUD de procedimiento ──────────────────────────────────────────────
const abrirEditor = (item) => {
  editandoItem.value = item;
  editandoPasos.value = (item.procedimiento || []).map(p => ({ ...p }));
  showEditor.value = true;
};

const agregarPaso = () => {
  editandoPasos.value.push({ texto: '', imagenUrl: null });
};

const eliminarPaso = (i) => {
  editandoPasos.value.splice(i, 1);
};

const guardarEdicion = async () => {
  const pasosFiltrados = editandoPasos.value.filter(p => p.texto?.trim());
  guardando.value = true;
  try {
    await catalogoService.actualizarProcedimiento(editandoItem.value.id, pasosFiltrados);
    const idx = catalogoItems.value.findIndex(x => x.id === editandoItem.value.id);
    if (idx !== -1) catalogoItems.value[idx].procedimiento = pasosFiltrados;
    showEditor.value = false;
    Swal.fire({ icon: 'success', title: 'Guardado', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error al guardar', text: e.message });
  } finally {
    guardando.value = false;
  }
};// ── CRUD Catálogo ─────────────────────────────────────────────────────────
const catIniciarEdicion = (item) => {
  catEditando.value = {
    id: item.id,
    denominacion: item.denominacion || '',
    numeroCatalogo: item.numeroCatalogo || '',
    numeroArticulo: item.numeroArticulo || '',
    visible: item.visible !== false,
  };
};
const catCancelarEdicion = () => { catEditando.value = null; };

const catGuardarEdicion = async () => {
  if (!catEditando.value) return;
  catGuardando.value = true;
  const { id, ...campos } = catEditando.value;
  try {
    await catalogoService.actualizarItemCatalogo(id, campos);
    const idx = catalogoItems.value.findIndex(i => i.id === id);
    if (idx !== -1) catalogoItems.value[idx] = { ...catalogoItems.value[idx], ...campos };
    catEditando.value = null;
    Swal.fire({ icon: 'success', title: 'Guardado', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error al guardar', text: e.message });
  } finally {
    catGuardando.value = false;
  }
};

const catToggleVisible = async (item) => {
  const newVisible = item.visible === false;
  try {
    await catalogoService.toggleVisibleItem(item.id, newVisible);
    const idx = catalogoItems.value.findIndex(i => i.id === item.id);
    if (idx !== -1) catalogoItems.value[idx] = { ...catalogoItems.value[idx], visible: newVisible };
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  }
};

const catAbrirNuevo = (seccion, grupo) => {
  catNuevoForm.value = { seccion, grupo, denominacion: '', numeroCatalogo: '', numeroArticulo: '' };
};
const catCancelarNuevo = () => { catNuevoForm.value = null; };

const catCrearItem = async () => {
  if (!catNuevoForm.value?.denominacion?.trim()) return;
  catGuardando.value = true;
  try {
    const datos = {
      modelo: modeloSeleccionado.value,
      seccion: catNuevoForm.value.seccion,
      grupo: catNuevoForm.value.grupo,
      denominacion: catNuevoForm.value.denominacion.trim(),
      numeroCatalogo: catNuevoForm.value.numeroCatalogo.trim() || '-',
      numeroArticulo: catNuevoForm.value.numeroArticulo.trim() || '-',
    };
    const newId = await catalogoService.crearItemCatalogo(datos);
    catalogoItems.value.push({ id: newId, ...datos, visible: true, procedimiento: [] });
    catNuevoForm.value = null;
    Swal.fire({ icon: 'success', title: 'Ítem creado', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error al crear', text: e.message });
  } finally {
    catGuardando.value = false;
  }
};

const catEliminar = async (item) => {
  const result = await Swal.fire({
    icon: 'warning', title: '¿Eliminar ítem?', text: item.denominacion,
    showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc2626',
  });
  if (!result.isConfirmed) return;
  try {
    await catalogoService.eliminarItemCatalogo(item.id);
    catalogoItems.value = catalogoItems.value.filter(i => i.id !== item.id);
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  }
};
</script>

<template>
  <div class="flex flex-col h-screen bg-gray-50 overflow-hidden">

    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <div class="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
      <!-- Botón atrás — solo mobile -->
      <button
        v-if="pasoMobile !== 'tipos'"
        @click="pasoMobile === 'detalle' ? (pasoMobile = 'modelos') : (pasoMobile = 'tipos', tipoSeleccionado = null, modeloSeleccionado = null, catalogoItems = [])"
        class="sm:hidden p-1 -ml-1 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
      >
        <ArrowLeft class="w-5 h-5" />
      </button>
      <BookMarked class="w-5 h-5 text-indigo-600 hidden sm:block" />
      <!-- Breadcrumb mobile -->
      <div class="flex-1 sm:hidden">
        <h1 class="font-bold text-gray-800 text-base leading-tight">
          <span v-if="pasoMobile === 'tipos'">Explorador de Catálogo</span>
          <span v-else-if="pasoMobile === 'modelos'">{{ tipoSeleccionado }}</span>
          <span v-else>{{ modeloSeleccionado }}</span>
        </h1>
        <p v-if="pasoMobile === 'modelos'" class="text-xs text-gray-400">{{ modelosDelTipo.length }} modelos</p>
        <p v-else-if="pasoMobile === 'detalle'" class="text-xs text-gray-400">{{ tipoSeleccionado }}</p>
      </div>
      <!-- Título normal desktop -->
      <h1 class="font-bold text-gray-800 text-base hidden sm:block">Explorador de Catálogo</h1>
      <span v-if="!cargandoMaq" class="ml-auto text-xs text-gray-400">
        {{ maquinas.length }} máquinas · {{ tiposDisponibles.length }} tipos
      </span>
    </div>

    <!-- ── Layout DESKTOP: 3 columnas ──────────────────────────────────────── -->
    <div class="hidden sm:flex flex-1 overflow-hidden">

      <!-- COLUMNA 1: Tipos ──────────────────────────────────────────────────── -->
      <div class="w-40 shrink-0 bg-white border-r border-gray-200 overflow-y-auto">
        <div class="p-2 border-b border-gray-100">
          <p class="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Tipo</p>
        </div>

        <div v-if="cargandoMaq" class="flex justify-center py-8">
          <Loader2 class="w-5 h-5 text-indigo-400 animate-spin" />
        </div>

        <ul v-else class="py-1">
          <li
            v-for="t in tiposDisponibles"
            :key="t.tipo"
            @click="seleccionarTipo(t.tipo)"
            class="flex items-center justify-between px-3 py-2.5 cursor-pointer text-sm transition-colors"
            :class="tipoSeleccionado === t.tipo
              ? 'bg-indigo-600 text-white font-bold'
              : 'text-gray-700 hover:bg-gray-50'"
          >
            <span class="truncate">{{ t.tipo }}</span>
            <span
              class="text-xs ml-1 shrink-0 font-mono rounded-full px-1.5 py-0.5"
              :class="tipoSeleccionado === t.tipo ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'"
            >{{ t.total }}</span>
          </li>
        </ul>
      </div>

      <!-- COLUMNA 2: Modelos ────────────────────────────────────────────────── -->
      <div class="w-44 shrink-0 bg-white border-r border-gray-200 overflow-y-auto">
        <div class="p-2 border-b border-gray-100">
          <p class="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Modelo</p>
        </div>

        <div v-if="!tipoSeleccionado" class="flex flex-col items-center justify-center h-40 text-gray-300 gap-2 px-3 text-center">
          <ChevronRight class="w-6 h-6" />
          <p class="text-xs">Seleccioná un tipo</p>
        </div>

        <ul v-else-if="modelosDelTipo.length > 0" class="py-1">
          <li
            v-for="mod in modelosDelTipo"
            :key="mod"
            @click="seleccionarModelo(mod)"
            class="px-3 py-2.5 cursor-pointer text-sm transition-colors flex items-center gap-1.5"
            :class="modeloSeleccionado === mod
              ? 'bg-indigo-50 text-indigo-700 font-bold border-l-2 border-indigo-600'
              : 'text-gray-700 hover:bg-gray-50'"
          >
            <ChevronRight class="w-3.5 h-3.5 shrink-0" />
            <span class="truncate">{{ mod }}</span>
          </li>
        </ul>

        <div v-else class="flex flex-col items-center justify-center h-40 text-gray-300 gap-2 px-3 text-center">
          <Info class="w-5 h-5" />
          <p class="text-xs">Sin modelos registrados</p>
        </div>
      </div>

      <!-- COLUMNA 3: Detalle ────────────────────────────────────────────────── -->
      <div class="flex-1 overflow-y-auto">

        <!-- Placeholder inicial -->
        <div v-if="!tipoSeleccionado" class="flex flex-col items-center justify-center h-full text-gray-300 gap-3">
          <BookOpen class="w-12 h-12" />
          <p class="text-sm font-medium">Seleccioná un tipo de máquina para comenzar</p>
        </div>

        <!-- Tipo seleccionado pero sin modelo -->
        <div v-else-if="!modeloSeleccionado" class="flex flex-col items-center justify-center h-full text-gray-300 gap-3">
          <Settings2 class="w-10 h-10" />
          <p class="text-sm font-medium">Seleccioná un modelo</p>
          <p class="text-xs">{{ tipoSeleccionado }} · {{ modelosDelTipo.length }} modelos disponibles</p>
        </div>

        <!-- Cargando catálogo -->
        <div v-else-if="cargandoCat" class="flex flex-col items-center justify-center h-full gap-3 text-indigo-400">
          <Loader2 class="w-8 h-8 animate-spin" />
          <p class="text-sm">Cargando catálogo...</p>
        </div>

        <template v-else>
          <!-- Cabecera del modelo -->
          <div class="sticky top-0 bg-white border-b border-gray-200 z-10 px-4 py-3">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 class="font-bold text-gray-800">{{ modeloSeleccionado }}</h2>
                <p class="text-xs text-gray-500">{{ tipoSeleccionado }}</p>
              </div>

              <!-- Stats / Filtros -->
              <div v-if="statsModelo.total > 0" class="flex gap-2 text-xs flex-wrap">
                <button
                  @click="filtroProc = filtroProc === null ? null : null; filtroProc = null"
                  class="flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors"
                  :class="filtroProc === null ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
                >
                  <ClipboardList class="w-3.5 h-3.5" />
                  {{ statsModelo.total }} items
                </button>
                <button
                  v-if="statsModelo.conProc > 0"
                  @click="filtroProc = filtroProc === 'con' ? null : 'con'"
                  class="flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors"
                  :class="filtroProc === 'con' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'"
                >
                  <CheckCircle2 class="w-3.5 h-3.5" />
                  {{ statsModelo.conProc }} con procedimiento
                </button>
                <button
                  v-if="statsModelo.sinProc > 0"
                  @click="filtroProc = filtroProc === 'sin' ? null : 'sin'"
                  class="flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors"
                  :class="filtroProc === 'sin' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'"
                >
                  <XCircle class="w-3.5 h-3.5" />
                  {{ statsModelo.sinProc }} sin procedimiento
                </button>
              </div>
            </div>

            <!-- Tabs -->
            <div class="flex gap-1 mt-3">
              <button
                @click="tabActiva = 'catalogo'"
                class="px-3 py-1.5 rounded-md text-xs font-bold transition-colors"
                :class="tabActiva === 'catalogo' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'"
              >
                <BookOpen class="w-3.5 h-3.5 inline mr-1" />Catálogo
              </button>
              <button
                @click="tabActiva = 'motivos'"
                class="px-3 py-1.5 rounded-md text-xs font-bold transition-colors"
                :class="tabActiva === 'motivos' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'"
              >
                <Wrench class="w-3.5 h-3.5 inline mr-1" />Motivos
              </button>
              <button
                @click="tabActiva = 'maquinas'"
                class="px-3 py-1.5 rounded-md text-xs font-bold transition-colors"
                :class="tabActiva === 'maquinas' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'"
              >
                <Settings2 class="w-3.5 h-3.5 inline mr-1" />Máquinas
                <span class="ml-1 bg-white/20 text-current rounded-full px-1.5 text-xs"
                  :class="tabActiva !== 'maquinas' ? 'bg-gray-200 text-gray-600' : ''">{{ maquinasDelModelo.length }}</span>
              </button>
            </div>
          </div>

          <!-- ── TAB: CATÁLOGO ── -->
          <div v-if="tabActiva === 'catalogo'" class="p-4">

            <!-- Sin catálogo -->
            <div v-if="catalogoItems.length === 0" class="flex flex-col items-center justify-center py-16 text-gray-300 gap-3">
              <XCircle class="w-10 h-10" />
              <p class="text-sm font-medium text-gray-400">Sin catálogo cargado para <span class="font-bold">{{ modeloSeleccionado }}</span></p>
              <p class="text-xs text-gray-400">Los procedimientos estarán disponibles cuando se importe el catálogo de este modelo.</p>
            </div>

            <template v-else>
              <!-- Acciones expandir/colapsar -->
              <div class="flex justify-end gap-2 mb-3">
                <button @click="expandirTodo" class="text-xs text-indigo-600 hover:underline flex items-center gap-1">
                  <ChevronDown class="w-3 h-3" /> Expandir todo
                </button>
                <button @click="colapsarTodo" class="text-xs text-gray-500 hover:underline flex items-center gap-1">
                  <ChevronUp class="w-3 h-3" /> Colapsar todo
                </button>
              </div>

              <!-- Secciones -->
              <div class="space-y-3">
                <div
                  v-for="{ seccion, grupos } in catalogoEstructura"
                  :key="seccion"
                  class="border border-gray-200 rounded-lg overflow-hidden"
                >
                  <!-- Header sección -->
                  <button
                    @click="toggleSeccion(seccion)"
                    class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                  >
                    <span class="font-bold text-gray-700 text-sm">{{ seccion }}</span>
                    <div class="flex items-center gap-2">
                      <span class="text-xs text-gray-400">
                        {{ grupos.reduce((s, g) => s + g.items.length, 0) }} items
                      </span>
                      <ChevronDown v-if="!seccionesExpandidas.has(seccion)" class="w-4 h-4 text-gray-400" />
                      <ChevronUp v-else class="w-4 h-4 text-gray-500" />
                    </div>
                  </button>

                  <!-- Grupos dentro de la sección -->
                  <div v-if="seccionesExpandidas.has(seccion)">
                    <div
                      v-for="{ grupo, items } in grupos"
                      :key="grupo"
                      class="border-t border-gray-100"
                    >
                      <!-- Grupo label -->
                      <div class="flex items-center gap-2 px-4 py-2 bg-white">
                        <span class="text-xs font-bold text-indigo-600 bg-indigo-50 rounded px-2 py-0.5 font-mono">{{ grupo }}</span>
                        <span class="text-xs text-gray-400">{{ items.length }} items</span>
                      </div>

                      <!-- Items del grupo -->
                      <ul class="divide-y divide-gray-50">
                        <li
                          v-for="item in items"
                          :key="item.id"
                          class="px-4 py-2 hover:bg-gray-50 transition-colors"
                          :class="item.visible === false ? 'opacity-50' : ''"
                        >
                          <!-- ── Modo edición inline ── -->
                          <div v-if="catEditando && catEditando.id === item.id" class="space-y-1.5">
                            <input
                              v-model="catEditando.denominacion"
                              placeholder="Denominación"
                              class="w-full border border-indigo-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                            <div class="flex gap-2">
                              <input
                                v-model="catEditando.numeroCatalogo"
                                placeholder="Nº Catálogo"
                                class="w-1/2 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-400 outline-none"
                              />
                              <input
                                v-model="catEditando.numeroArticulo"
                                placeholder="Nº Artículo"
                                class="w-1/2 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-400 outline-none"
                              />
                            </div>
                            <div class="flex items-center gap-2 pt-1">
                              <button
                                @click="catGuardarEdicion"
                                :disabled="catGuardando"
                                class="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
                              >
                                <Loader2 v-if="catGuardando" class="w-3.5 h-3.5 animate-spin" />
                                <Save v-else class="w-3.5 h-3.5" />
                                Guardar
                              </button>
                              <button @click="catCancelarEdicion" class="px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition">
                                Cancelar
                              </button>
                            </div>
                          </div>

                          <!-- ── Modo lectura ── -->
                          <div v-else class="flex items-start gap-3">
                            <!-- Indicador procedimiento -->
                            <div class="shrink-0 mt-0.5">
                              <CheckCircle2
                                v-if="Array.isArray(item.procedimiento) && item.procedimiento.length > 0"
                                class="w-4 h-4 text-emerald-500"
                                v-tippy="'Tiene procedimiento'"
                              />
                              <XCircle
                                v-else
                                class="w-4 h-4 text-gray-300"
                                v-tippy="'Sin procedimiento'"
                              />
                            </div>

                            <!-- Nombre -->
                            <div class="flex-1 min-w-0">
                              <!-- Toggle visible al comienzo del texto (solo admin) -->
                              <div class="flex items-start gap-1.5">
                                <button
                                  v-if="userRole === 'admin'"
                                  @click="catToggleVisible(item)"
                                  v-tippy="item.visible !== false ? 'Visible — click para ocultar' : 'Oculto — click para mostrar'"
                                  class="shrink-0 mt-0.5 p-0.5 rounded transition-colors hover:bg-gray-100"
                                >
                                  <Eye v-if="item.visible !== false" class="w-3.5 h-3.5 text-green-500" />
                                  <EyeOff v-else class="w-3.5 h-3.5 text-gray-300" />
                                </button>
                                <p class="text-sm font-medium leading-snug" :class="item.visible === false ? 'text-gray-400 line-through' : 'text-gray-700'">{{ item.denominacion }}</p>
                              </div>
                              <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5" :class="userRole === 'admin' ? 'pl-5' : ''">
                                <span v-if="item.numeroCatalogo && item.numeroCatalogo !== '-'" class="text-xs text-gray-400">Cat: {{ item.numeroCatalogo }}</span>
                                <span v-if="item.numeroArticulo && item.numeroArticulo !== '-'" class="text-xs text-gray-400">Art: {{ item.numeroArticulo }}</span>
                                <span v-if="item.tipoTarea" class="text-xs font-medium"
                                  :class="{
                                    'text-blue-500': item.tipoTarea === 'Preventivo',
                                    'text-orange-500': item.tipoTarea === 'Mecánico',
                                    'text-violet-500': item.tipoTarea === 'Eléctrico',
                                  }">
                                  {{ item.tipoTarea }}
                                </span>
                                <span v-if="item.tiempoEstimado" class="text-xs text-gray-400">⏱ {{ item.tiempoEstimado }}</span>
                              </div>

                              <!-- Pasos del procedimiento (colapsados, solo count) -->
                              <div v-if="Array.isArray(item.procedimiento) && item.procedimiento.length > 0"
                                class="mt-1 text-xs text-emerald-600 font-medium" :class="userRole === 'admin' ? 'pl-5' : ''">
                                {{ item.procedimiento.length }} pasos · {{ item.herramientas?.length || 0 }} herramientas
                                <span v-if="item.repuestos?.length > 0"> · {{ item.repuestos.length }} repuesto(s)</span>
                              </div>
                            </div>

                            <!-- Acciones -->
                            <div class="shrink-0 flex items-center gap-1 mt-0.5">
                              <!-- Admin: editar campos del ítem -->
                              <button
                                v-if="userRole === 'admin'"
                                @click="catIniciarEdicion(item)"
                                class="p-1 rounded-md text-indigo-400 hover:bg-indigo-50 transition-colors"
                                v-tippy="'Editar campos del ítem'"
                              >
                                <Pencil class="w-4 h-4" />
                              </button>
                              <!-- Ver procedimiento — siempre visible, apagado si no hay contenido -->
                              <button
                                @click="Array.isArray(item.procedimiento) && item.procedimiento.length > 0 ? abrirViewer(item) : null"
                                v-tippy="Array.isArray(item.procedimiento) && item.procedimiento.length > 0 ? 'Ver procedimiento' : 'Sin procedimiento cargado'"
                                class="p-1 rounded-md transition-colors"
                                :class="Array.isArray(item.procedimiento) && item.procedimiento.length > 0
                                  ? 'text-indigo-500 hover:bg-indigo-50 cursor-pointer'
                                  : 'text-gray-200 cursor-default'"
                              >
                                <BookOpen class="w-4 h-4" />
                              </button>
                              <!-- Admin: editar o crear procedimiento -->
                              <button
                                v-if="userRole === 'admin'"
                                @click="abrirEditor(item)"
                                class="p-1 rounded-md transition-colors"
                                :class="Array.isArray(item.procedimiento) && item.procedimiento.length > 0
                                  ? 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                                  : 'text-amber-500 hover:bg-amber-50'"
                                v-tippy="Array.isArray(item.procedimiento) && item.procedimiento.length > 0 ? 'Editar procedimiento' : 'Crear procedimiento'"
                              >
                                <ClipboardList v-if="Array.isArray(item.procedimiento) && item.procedimiento.length > 0" class="w-4 h-4" />
                                <Plus v-else class="w-4 h-4" />
                              </button>
                              <!-- Admin: eliminar ítem -->
                              <button
                                v-if="userRole === 'admin'"
                                @click="catEliminar(item)"
                                class="p-1 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                v-tippy="'Eliminar ítem del catálogo'"
                              >
                                <Trash2 class="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </li>
                      </ul>

                      <!-- Admin: agregar nuevo ítem en este grupo -->
                      <div v-if="userRole === 'admin'" class="px-4 py-2 border-t border-gray-50 bg-white">
                        <!-- Formulario inline si el grupo activo coincide -->
                        <template v-if="catNuevoForm && catNuevoForm.seccion === seccion && catNuevoForm.grupo === grupo">
                          <div class="space-y-1.5 py-1">
                            <input
                              v-model="catNuevoForm.denominacion"
                              placeholder="Denominación del nuevo ítem *"
                              class="w-full border border-indigo-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                              autofocus
                            />
                            <div class="flex gap-2">
                              <input
                                v-model="catNuevoForm.numeroCatalogo"
                                placeholder="Nº Catálogo (opcional)"
                                class="w-1/2 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-400 outline-none"
                              />
                              <input
                                v-model="catNuevoForm.numeroArticulo"
                                placeholder="Nº Artículo (opcional)"
                                class="w-1/2 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-400 outline-none"
                              />
                            </div>
                            <div class="flex items-center gap-2 pt-1">
                              <button
                                @click="catCrearItem"
                                :disabled="!catNuevoForm.denominacion?.trim() || catGuardando"
                                class="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition"
                              >
                                <Loader2 v-if="catGuardando" class="w-3.5 h-3.5 animate-spin" />
                                <Save v-else class="w-3.5 h-3.5" />
                                Crear ítem
                              </button>
                              <button @click="catCancelarNuevo" class="px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition">
                                Cancelar
                              </button>
                            </div>
                          </div>
                        </template>
                        <button
                          v-else
                          @click="catAbrirNuevo(seccion, grupo)"
                          class="flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-700 font-medium transition-colors py-0.5"
                        >
                          <Plus class="w-3.5 h-3.5" /> Agregar ítem
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- ── TAB: MOTIVOS ── -->
          <div v-if="tabActiva === 'motivos'" class="p-4">
            <!-- Cargando -->
            <div v-if="cargandoMotivos" class="flex justify-center py-16">
              <Loader2 class="w-6 h-6 animate-spin text-indigo-400" />
            </div>

            <!-- Sin motivos -->
            <div v-else-if="!motivosDelTipo" class="flex flex-col items-center py-16 text-gray-300 gap-2">
              <Info class="w-8 h-8" />
              <p class="text-sm">Sin motivos configurados para {{ tipoSeleccionado }}</p>
            </div>

            <template v-else>
              <!-- ── MODO EDICIÓN ── -->
              <div v-if="motivoEditCat" class="space-y-3">
                <div class="flex items-center gap-2 mb-1">
                  <button @click="cancelarEditMotivos" class="p-1 hover:bg-gray-100 rounded-lg transition" v-tippy="'Volver sin guardar'">
                    <ArrowLeft class="w-4 h-4 text-gray-500" />
                  </button>
                  <span class="font-bold text-sm text-gray-800">
                    Editando motivos — <span :class="motivoEditCat === 'Mecánico' ? 'text-orange-600' : 'text-violet-600'">{{ motivoEditCat }}</span>
                  </span>
                  <button @click="guardarMotivos" :disabled="guardandoMotivos"
                    class="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition">
                    <Loader2 v-if="guardandoMotivos" class="w-3.5 h-3.5 animate-spin" />
                    <Save v-else class="w-3.5 h-3.5" />
                    Guardar
                  </button>
                </div>

                <!-- Campo agregar nuevo motivo -->
                <div class="flex gap-2">
                  <input v-model="motivoNuevo" @keyup.enter="agregarMotivo"
                    placeholder="Nombre del motivo (Enter para agregar)..."
                    class="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none uppercase" />
                  <button @click="agregarMotivo" :disabled="!motivoNuevo.trim()"
                    class="px-3 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-100 disabled:opacity-40 transition"
                    v-tippy="'Agregar motivo a la lista'">
                    <Plus class="w-4 h-4" />
                  </button>
                </div>

                <!-- Lista editable -->
                <ul class="border border-gray-200 rounded-lg divide-y divide-gray-50 overflow-hidden">
                  <li v-for="(m, idx) in motivoEditLista" :key="idx"
                    class="flex items-center gap-2 px-3 py-2"
                    :class="m.visible ? 'bg-white' : 'bg-gray-50'">
                    <!-- Ícono visible/oculto -->
                    <button @click="toggleVisible(idx)" v-tippy="m.visible ? 'Visible en app — click para ocultar' : 'Oculto en app — click para mostrar'"
                      class="shrink-0 transition-colors">
                      <Eye v-if="m.visible" class="w-4 h-4 text-green-500" />
                      <EyeOff v-else class="w-4 h-4 text-gray-300" />
                    </button>
                    <!-- Input editable inline -->
                    <input
                      v-model="motivoEditLista[idx].nombre"
                      @input="motivoEditLista[idx].nombre = motivoEditLista[idx].nombre.toUpperCase()"
                      class="flex-1 text-sm font-medium bg-transparent border-0 border-b border-transparent focus:border-indigo-400 focus:outline-none py-1 transition-colors"
                      :class="m.visible ? 'text-gray-800' : 'text-gray-400 line-through'"
                    />
                    <button @click="eliminarMotivo(idx)"
                      class="shrink-0 p-1 hover:bg-red-50 text-gray-300 hover:text-red-500 rounded transition"
                      v-tippy="'Eliminar este motivo'">
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  </li>
                  <li v-if="motivoEditLista.length === 0" class="px-4 py-6 text-center text-gray-400 text-sm">
                    Sin motivos. Agregá el primero arriba.
                  </li>
                </ul>

                <p class="text-[10px] text-gray-400 px-1">
                  <Eye class="w-3 h-3 inline mr-0.5 text-green-500" /> visible en "Reportar Falla" ·
                  <EyeOff class="w-3 h-3 inline mr-0.5 text-gray-300" /> oculto (no aparece en la app)
                </p>
              </div>

              <!-- ── MODO LECTURA ── -->
              <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <!-- Mecánico -->
                <div v-if="motivosDelTipo['Mecánico']" class="border border-gray-200 rounded-lg overflow-hidden">
                  <div class="flex items-center gap-2 px-4 py-3 bg-orange-50 border-b border-orange-100">
                    <Wrench class="w-4 h-4 text-orange-500" />
                    <span class="font-bold text-orange-700 text-sm">Mecánico</span>
                    <span class="text-xs text-orange-400">{{ motivosDelTipo['Mecánico'].filter(m => m.visible !== false).length }} visibles</span>
                    <button v-if="userRole === 'admin'" @click="iniciarEditMotivos('Mecánico')"
                      class="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-white border border-orange-200 text-orange-600 hover:bg-orange-50 transition">
                      <Pencil class="w-3 h-3" /> Editar
                    </button>
                  </div>
                  <ul class="divide-y divide-gray-50">
                    <li v-for="m in motivosDelTipo['Mecánico']" :key="m.nombre || m"
                      class="flex items-center gap-2 px-4 py-2.5"
                      :class="(m.visible === false) ? 'opacity-40' : ''">
                      <EyeOff v-if="m.visible === false" class="w-3.5 h-3.5 text-gray-300 shrink-0" />
                      <span class="text-sm text-gray-700" :class="m.visible === false ? 'line-through' : ''">
                        {{ m.nombre || m }}
                      </span>
                    </li>
                  </ul>
                </div>

                <!-- Eléctrico -->
                <div v-if="motivosDelTipo['Eléctrico']" class="border border-gray-200 rounded-lg overflow-hidden">
                  <div class="flex items-center gap-2 px-4 py-3 bg-violet-50 border-b border-violet-100">
                    <Zap class="w-4 h-4 text-violet-500" />
                    <span class="font-bold text-violet-700 text-sm">Eléctrico</span>
                    <span class="text-xs text-violet-400">{{ motivosDelTipo['Eléctrico'].filter(m => m.visible !== false).length }} visibles</span>
                    <button v-if="userRole === 'admin'" @click="iniciarEditMotivos('Eléctrico')"
                      class="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-white border border-violet-200 text-violet-600 hover:bg-violet-50 transition">
                      <Pencil class="w-3 h-3" /> Editar
                    </button>
                  </div>
                  <ul class="divide-y divide-gray-50">
                    <li v-for="m in motivosDelTipo['Eléctrico']" :key="m.nombre || m"
                      class="flex items-center gap-2 px-4 py-2.5"
                      :class="(m.visible === false) ? 'opacity-40' : ''">
                      <EyeOff v-if="m.visible === false" class="w-3.5 h-3.5 text-gray-300 shrink-0" />
                      <span class="text-sm text-gray-700" :class="m.visible === false ? 'line-through' : ''">
                        {{ m.nombre || m }}
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            </template>
          </div>

          <!-- ── TAB: MÁQUINAS ── -->
          <div v-if="tabActiva === 'maquinas'" class="p-4">
            <div v-if="maquinasDelModelo.length === 0" class="flex flex-col items-center py-16 text-gray-300 gap-2">
              <Settings2 class="w-8 h-8" />
              <p class="text-sm">Sin máquinas registradas con modelo <span class="font-bold">{{ modeloSeleccionado }}</span></p>
            </div>

            <div v-else class="overflow-x-auto">
              <table class="w-full text-sm border-collapse">
                <thead>
                  <tr class="bg-gray-50 text-left">
                    <th class="px-3 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Máquina</th>
                    <th class="px-3 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Local Físico</th>
                    <th class="px-3 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Sector</th>
                    <th class="px-3 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Marca</th>
                    <th class="px-3 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Estado</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  <tr
                    v-for="m in maquinasDelModelo"
                    :key="m.id"
                    class="hover:bg-gray-50 transition-colors"
                  >
                    <td class="px-3 py-2.5 font-medium text-gray-800">{{ m.maquina || m.nombre_maquina || m.id }}</td>
                    <td class="px-3 py-2.5 text-gray-600 font-mono">{{ m.local_fisico || '—' }}</td>
                    <td class="px-3 py-2.5 text-gray-600">{{ m.sector || '—' }}</td>
                    <td class="px-3 py-2.5 text-gray-600">{{ m.marca || '—' }}</td>
                    <td class="px-3 py-2.5">
                      <span
                        class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold"
                        :class="(m.activo ?? true) ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'"
                      >
                        {{ (m.activo ?? true) ? 'Activa' : 'Inactiva' }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

        </template>
      </div>
    </div>

    <!-- ── Layout MOBILE: drill-down paso a paso ───────────────────────────── -->
    <div class="sm:hidden flex-1 overflow-hidden flex flex-col">

      <!-- PASO 1: Lista de Tipos -->
      <div v-if="pasoMobile === 'tipos'" class="flex-1 overflow-y-auto">
        <div v-if="cargandoMaq" class="flex justify-center py-16">
          <Loader2 class="w-6 h-6 text-indigo-400 animate-spin" />
        </div>
        <ul v-else class="divide-y divide-gray-100">
          <li
            v-for="t in tiposDisponibles"
            :key="t.tipo"
            @click="seleccionarTipo(t.tipo)"
            class="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50 active:bg-gray-100 transition-colors"
          >
            <span class="font-semibold text-gray-800">{{ t.tipo }}</span>
            <div class="flex items-center gap-2">
              <span class="text-xs bg-gray-100 text-gray-500 rounded-full px-2.5 py-1 font-mono font-bold">{{ t.total }}</span>
              <ChevronRight class="w-4 h-4 text-gray-300" />
            </div>
          </li>
        </ul>
      </div>

      <!-- PASO 2: Lista de Modelos -->
      <div v-else-if="pasoMobile === 'modelos'" class="flex-1 overflow-y-auto">
        <ul class="divide-y divide-gray-100">
          <li
            v-for="mod in modelosDelTipo"
            :key="mod"
            @click="seleccionarModelo(mod)"
            class="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50 active:bg-gray-100 transition-colors"
          >
            <span class="font-semibold text-gray-800">{{ mod }}</span>
            <ChevronRight class="w-4 h-4 text-gray-300" />
          </li>
        </ul>
        <div v-if="modelosDelTipo.length === 0" class="flex flex-col items-center justify-center py-16 text-gray-300 gap-2">
          <Info class="w-8 h-8" />
          <p class="text-sm">Sin modelos registrados</p>
        </div>
      </div>

      <!-- PASO 3: Detalle del modelo (reutiliza el mismo contenido) -->
      <div v-else-if="pasoMobile === 'detalle'" class="flex-1 overflow-y-auto">
        <div v-if="cargandoCat" class="flex flex-col items-center justify-center h-full gap-3 text-indigo-400">
          <Loader2 class="w-8 h-8 animate-spin" />
          <p class="text-sm">Cargando catálogo...</p>
        </div>

        <template v-else>
          <!-- Stats / Filtros -->
          <div class="px-4 py-3 bg-white border-b border-gray-200 flex gap-2 flex-wrap">
            <button
              @click="filtroProc = null"
              class="flex items-center gap-1 rounded-full px-2.5 py-1 font-medium text-xs transition-colors"
              :class="filtroProc === null ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'"
            ><ClipboardList class="w-3.5 h-3.5" /> {{ statsModelo.total }} items</button>
            <button
              v-if="statsModelo.conProc > 0"
              @click="filtroProc = filtroProc === 'con' ? null : 'con'"
              class="flex items-center gap-1 rounded-full px-2.5 py-1 font-medium text-xs transition-colors"
              :class="filtroProc === 'con' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'"
            ><CheckCircle2 class="w-3.5 h-3.5" /> {{ statsModelo.conProc }} con proc.</button>
            <button
              v-if="statsModelo.sinProc > 0"
              @click="filtroProc = filtroProc === 'sin' ? null : 'sin'"
              class="flex items-center gap-1 rounded-full px-2.5 py-1 font-medium text-xs transition-colors"
              :class="filtroProc === 'sin' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700'"
            ><XCircle class="w-3.5 h-3.5" /> {{ statsModelo.sinProc }} sin proc.</button>
          </div>

          <!-- Tabs mobile -->
          <div class="flex gap-1 px-4 py-2 bg-white border-b border-gray-100">
            <button @click="tabActiva = 'catalogo'" class="px-3 py-1.5 rounded-md text-xs font-bold transition-colors"
              :class="tabActiva === 'catalogo' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'">
              <BookOpen class="w-3.5 h-3.5 inline mr-1" />Catálogo
            </button>
            <button @click="tabActiva = 'motivos'" class="px-3 py-1.5 rounded-md text-xs font-bold transition-colors"
              :class="tabActiva === 'motivos' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'">
              <Wrench class="w-3.5 h-3.5 inline mr-1" />Motivos
            </button>
            <button @click="tabActiva = 'maquinas'" class="px-3 py-1.5 rounded-md text-xs font-bold transition-colors"
              :class="tabActiva === 'maquinas' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'">
              <Settings2 class="w-3.5 h-3.5 inline mr-1" />Máquinas
            </button>
          </div>

          <!-- Catálogo mobile: lista plana con secciones como separadores -->
          <div v-if="tabActiva === 'catalogo'" class="pb-4">
            <div v-if="catalogoItems.length === 0" class="flex flex-col items-center py-16 text-gray-300 gap-2">
              <XCircle class="w-8 h-8" />
              <p class="text-sm text-gray-400">Sin catálogo para {{ modeloSeleccionado }}</p>
            </div>
            <template v-else>
              <div v-for="{ seccion, grupos } in catalogoEstructura" :key="seccion">
                <!-- Separador de sección -->
                <div class="px-4 py-2 bg-gray-100 border-y border-gray-200 sticky top-0 z-10">
                  <p class="text-xs font-black text-gray-500 uppercase tracking-widest">{{ seccion }}</p>
                </div>
                <div v-for="{ grupo, items } in grupos" :key="grupo">
                  <!-- Grupo label -->
                  <div class="flex items-center gap-2 px-4 py-1.5 bg-white border-b border-gray-50">
                    <span class="text-xs font-bold text-indigo-600 bg-indigo-50 rounded px-2 py-0.5 font-mono">{{ grupo }}</span>
                  </div>
                  <!-- Items -->
                  <ul class="divide-y divide-gray-50 bg-white">
                    <li v-for="item in items" :key="item.id"
                      class="px-4 py-3 transition-colors"
                      :class="item.visible === false ? 'opacity-50' : 'active:bg-gray-50'">

                      <!-- ── Modo edición inline mobile ── -->
                      <div v-if="catEditando && catEditando.id === item.id" class="space-y-1.5">
                        <input v-model="catEditando.denominacion" placeholder="Denominación"
                          class="w-full border border-indigo-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                        <div class="flex gap-2">
                          <input v-model="catEditando.numeroCatalogo" placeholder="Nº Catálogo"
                            class="w-1/2 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-400 outline-none" />
                          <input v-model="catEditando.numeroArticulo" placeholder="Nº Artículo"
                            class="w-1/2 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-400 outline-none" />
                        </div>
                        <div class="flex items-center gap-2 pt-1">
                          <button @click="catGuardarEdicion" :disabled="catGuardando"
                            class="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition">
                            <Loader2 v-if="catGuardando" class="w-3.5 h-3.5 animate-spin" />
                            <Save v-else class="w-3.5 h-3.5" />
                            Guardar
                          </button>
                          <button @click="catCancelarEdicion" class="px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition">
                            Cancelar
                          </button>
                        </div>
                      </div>

                      <!-- ── Modo lectura mobile ── -->
                      <div v-else class="flex items-center gap-3">
                        <CheckCircle2 v-if="Array.isArray(item.procedimiento) && item.procedimiento.length > 0" class="w-4 h-4 text-emerald-500 shrink-0" />
                        <XCircle v-else class="w-4 h-4 text-gray-300 shrink-0" />
                        <div class="flex-1 min-w-0">
                          <div class="flex items-start gap-1.5">
                            <button v-if="userRole === 'admin'" @click="catToggleVisible(item)"
                              class="shrink-0 mt-0.5 p-0.5 rounded transition-colors">
                              <Eye v-if="item.visible !== false" class="w-3.5 h-3.5 text-green-500" />
                              <EyeOff v-else class="w-3.5 h-3.5 text-gray-300" />
                            </button>
                            <p class="text-sm font-medium leading-snug"
                              :class="item.visible === false ? 'text-gray-400 line-through' : 'text-gray-800'">{{ item.denominacion }}</p>
                          </div>
                          <div class="flex flex-wrap gap-x-2 mt-0.5" :class="userRole === 'admin' ? 'pl-5' : ''">
                            <span v-if="item.numeroCatalogo && item.numeroCatalogo !== '-'" class="text-xs text-gray-400">Cat: {{ item.numeroCatalogo }}</span>
                            <span v-if="item.tipoTarea" class="text-xs font-bold"
                              :class="{ 'text-blue-500': item.tipoTarea==='Preventivo', 'text-orange-500': item.tipoTarea==='Mecánico', 'text-violet-500': item.tipoTarea==='Eléctrico' }">
                              {{ item.tipoTarea }}
                            </span>
                            <span v-if="Array.isArray(item.procedimiento) && item.procedimiento.length > 0" class="text-xs text-emerald-600 font-medium">{{ item.procedimiento.length }} pasos</span>
                          </div>
                        </div>
                        <div class="flex gap-1 shrink-0">
                          <!-- Editar campos (admin) -->
                          <button v-if="userRole === 'admin'" @click="catIniciarEdicion(item)"
                            class="p-1.5 rounded-lg text-indigo-400 hover:bg-indigo-50 transition-colors">
                            <Pencil class="w-4 h-4" />
                          </button>
                          <!-- Ver procedimiento — siempre visible -->
                          <button
                            @click="Array.isArray(item.procedimiento) && item.procedimiento.length > 0 ? abrirViewer(item) : null"
                            class="p-1.5 rounded-lg transition-colors"
                            :class="Array.isArray(item.procedimiento) && item.procedimiento.length > 0 ? 'text-indigo-500 hover:bg-indigo-50' : 'text-gray-200 cursor-default'">
                            <BookOpen class="w-4 h-4" />
                          </button>
                          <!-- Editar/crear procedimiento (admin) -->
                          <button v-if="userRole === 'admin'" @click="abrirEditor(item)"
                            class="p-1.5 rounded-lg transition-colors"
                            :class="Array.isArray(item.procedimiento) && item.procedimiento.length > 0 ? 'text-gray-400 hover:bg-gray-100' : 'text-amber-500 hover:bg-amber-50'">
                            <ClipboardList v-if="Array.isArray(item.procedimiento) && item.procedimiento.length > 0" class="w-4 h-4" />
                            <Plus v-else class="w-4 h-4" />
                          </button>
                          <!-- Eliminar (admin) -->
                          <button v-if="userRole === 'admin'" @click="catEliminar(item)"
                            class="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                            <Trash2 class="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </li>
                  </ul>

                  <!-- Admin: agregar nuevo ítem en este grupo (mobile) -->
                  <div v-if="userRole === 'admin'" class="px-4 py-2 border-t border-gray-50 bg-white">
                    <template v-if="catNuevoForm && catNuevoForm.seccion === seccion && catNuevoForm.grupo === grupo">
                      <div class="space-y-1.5 py-1">
                        <input v-model="catNuevoForm.denominacion" placeholder="Denominación del nuevo ítem *"
                          class="w-full border border-indigo-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                        <div class="flex gap-2">
                          <input v-model="catNuevoForm.numeroCatalogo" placeholder="Nº Catálogo (opc.)"
                            class="w-1/2 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-400 outline-none" />
                          <input v-model="catNuevoForm.numeroArticulo" placeholder="Nº Artículo (opc.)"
                            class="w-1/2 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-400 outline-none" />
                        </div>
                        <div class="flex items-center gap-2 pt-1">
                          <button @click="catCrearItem" :disabled="!catNuevoForm.denominacion?.trim() || catGuardando"
                            class="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition">
                            <Loader2 v-if="catGuardando" class="w-3.5 h-3.5 animate-spin" />
                            <Save v-else class="w-3.5 h-3.5" />
                            Crear ítem
                          </button>
                          <button @click="catCancelarNuevo" class="px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition">
                            Cancelar
                          </button>
                        </div>
                      </div>
                    </template>
                    <button v-else @click="catAbrirNuevo(seccion, grupo)"
                      class="flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-700 font-medium transition-colors py-0.5">
                      <Plus class="w-3.5 h-3.5" /> Agregar ítem
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- Motivos mobile -->
          <div v-else-if="tabActiva === 'motivos'" class="p-4 space-y-4">
            <div v-if="cargandoMotivos" class="flex justify-center py-12">
              <Loader2 class="w-6 h-6 animate-spin text-indigo-400" />
            </div>
            <div v-else-if="!motivosDelTipo" class="flex flex-col items-center py-12 text-gray-300 gap-2">
              <Info class="w-8 h-8" /><p class="text-sm">Sin motivos para {{ tipoSeleccionado }}</p>
            </div>
            <template v-else>

              <!-- ── MODO EDICIÓN mobile ── -->
              <div v-if="motivoEditCat" class="space-y-3">
                <div class="flex items-center gap-2 mb-1">
                  <button @click="cancelarEditMotivos" class="p-1 hover:bg-gray-100 rounded-lg transition">
                    <ArrowLeft class="w-4 h-4 text-gray-500" />
                  </button>
                  <span class="font-bold text-sm text-gray-800">
                    Editando — <span :class="motivoEditCat === 'Mecánico' ? 'text-orange-600' : 'text-violet-600'">{{ motivoEditCat }}</span>
                  </span>
                  <button @click="guardarMotivos" :disabled="guardandoMotivos"
                    class="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition">
                    <Loader2 v-if="guardandoMotivos" class="w-3.5 h-3.5 animate-spin" />
                    <Save v-else class="w-3.5 h-3.5" />
                    Guardar
                  </button>
                </div>
                <div class="flex gap-2">
                  <input v-model="motivoNuevo" @keyup.enter="agregarMotivo"
                    placeholder="Nuevo motivo (Enter para agregar)..."
                    class="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none uppercase" />
                  <button @click="agregarMotivo" :disabled="!motivoNuevo.trim()"
                    class="px-3 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-100 disabled:opacity-40 transition">
                    <Plus class="w-4 h-4" />
                  </button>
                </div>
                <ul class="border border-gray-200 rounded-lg divide-y divide-gray-50 overflow-hidden">
                  <li v-for="(m, idx) in motivoEditLista" :key="idx"
                    class="flex items-center gap-2 px-3 py-2" :class="m.visible ? 'bg-white' : 'bg-gray-50'">
                    <button @click="toggleVisible(idx)" class="shrink-0 transition-colors">
                      <Eye v-if="m.visible" class="w-4 h-4 text-green-500" />
                      <EyeOff v-else class="w-4 h-4 text-gray-300" />
                    </button>
                    <input v-model="motivoEditLista[idx].nombre"
                      @input="motivoEditLista[idx].nombre = motivoEditLista[idx].nombre.toUpperCase()"
                      class="flex-1 text-sm font-medium bg-transparent border-0 border-b border-transparent focus:border-indigo-400 focus:outline-none py-1 transition-colors"
                      :class="m.visible ? 'text-gray-800' : 'text-gray-400 line-through'" />
                    <button @click="eliminarMotivo(idx)"
                      class="shrink-0 p-1 hover:bg-red-50 text-gray-300 hover:text-red-500 rounded transition">
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  </li>
                  <li v-if="motivoEditLista.length === 0" class="px-4 py-6 text-center text-gray-400 text-sm">
                    Sin motivos. Agregá el primero arriba.
                  </li>
                </ul>
              </div>

              <!-- ── MODO LECTURA mobile ── -->
              <template v-else>
                <div v-if="motivosDelTipo['Mecánico']" class="border border-gray-200 rounded-xl overflow-hidden">
                  <div class="flex items-center gap-2 px-4 py-3 bg-orange-50 border-b border-orange-100">
                    <Wrench class="w-4 h-4 text-orange-500" />
                    <span class="font-bold text-orange-700 text-sm">Mecánico</span>
                    <span class="text-xs text-orange-400">{{ motivosDelTipo['Mecánico'].filter(m => m.visible !== false).length }} visibles</span>
                    <button v-if="userRole === 'admin'" @click="iniciarEditMotivos('Mecánico')"
                      class="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-white border border-orange-200 text-orange-600 hover:bg-orange-50 transition">
                      <Pencil class="w-3 h-3" /> Editar
                    </button>
                  </div>
                  <ul class="divide-y divide-gray-50">
                    <li v-for="m in motivosDelTipo['Mecánico']" :key="m.nombre || m"
                      class="flex items-center gap-2 px-4 py-2.5" :class="m.visible === false ? 'opacity-40' : ''">
                      <EyeOff v-if="m.visible === false" class="w-3.5 h-3.5 text-gray-300 shrink-0" />
                      <span class="text-sm text-gray-700" :class="m.visible === false ? 'line-through' : ''">{{ m.nombre || m }}</span>
                    </li>
                  </ul>
                </div>
                <div v-if="motivosDelTipo['Eléctrico']" class="border border-gray-200 rounded-xl overflow-hidden">
                  <div class="flex items-center gap-2 px-4 py-3 bg-violet-50 border-b border-violet-100">
                    <Zap class="w-4 h-4 text-violet-500" />
                    <span class="font-bold text-violet-700 text-sm">Eléctrico</span>
                    <span class="text-xs text-violet-400">{{ motivosDelTipo['Eléctrico'].filter(m => m.visible !== false).length }} visibles</span>
                    <button v-if="userRole === 'admin'" @click="iniciarEditMotivos('Eléctrico')"
                      class="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-white border border-violet-200 text-violet-600 hover:bg-violet-50 transition">
                      <Pencil class="w-3 h-3" /> Editar
                    </button>
                  </div>
                  <ul class="divide-y divide-gray-50">
                    <li v-for="m in motivosDelTipo['Eléctrico']" :key="m.nombre || m"
                      class="flex items-center gap-2 px-4 py-2.5" :class="m.visible === false ? 'opacity-40' : ''">
                      <EyeOff v-if="m.visible === false" class="w-3.5 h-3.5 text-gray-300 shrink-0" />
                      <span class="text-sm text-gray-700" :class="m.visible === false ? 'line-through' : ''">{{ m.nombre || m }}</span>
                    </li>
                  </ul>
                </div>
              </template>
            </template>
          </div>

          <!-- Máquinas mobile -->
          <div v-else-if="tabActiva === 'maquinas'" class="p-4">
            <div v-if="maquinasDelModelo.length === 0" class="flex flex-col items-center py-12 text-gray-300 gap-2">
              <Settings2 class="w-8 h-8" /><p class="text-sm">Sin máquinas con modelo {{ modeloSeleccionado }}</p>
            </div>
            <ul v-else class="space-y-2">
              <li v-for="m in maquinasDelModelo" :key="m.id"
                class="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p class="font-bold text-gray-800 text-sm">{{ m.maquina || m.nombre_maquina || m.id }}</p>
                  <p class="text-xs text-gray-400">{{ m.local_fisico || '—' }} · {{ m.sector || '—' }}</p>
                </div>
                <span class="text-xs font-bold px-2 py-0.5 rounded-full"
                  :class="(m.activo ?? true) ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'">
                  {{ (m.activo ?? true) ? 'Activa' : 'Inactiva' }}
                </span>
              </li>
            </ul>
          </div>
        </template>
      </div>
    </div>
  </div>

  <!-- ── MODAL: Viewer de procedimiento (preview móvil) ──────────────────────── -->
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="showViewer && itemViewer"
        class="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-gray-900/60 backdrop-blur-sm"
        @click.self="showViewer = false"
      >
        <div class="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[95dvh] sm:max-h-[85vh] flex flex-col">
          <!-- Header -->
          <div class="p-4 border-b border-gray-100 flex items-start justify-between shrink-0">
            <div class="flex-1 min-w-0 pr-3">
              <p class="text-[10px] font-extrabold text-indigo-500 tracking-widest mb-0.5">PROCEDIMIENTO</p>
              <h3 class="text-sm font-black text-gray-800 leading-tight">{{ itemViewer.denominacion }}</h3>
              <p class="text-xs text-gray-400 font-medium mt-0.5">{{ itemViewer.seccion }} · Grupo {{ itemViewer.grupo }}</p>
              <div class="flex gap-2 mt-1.5 flex-wrap">
                <span v-if="itemViewer.tipoTarea" class="text-xs font-bold px-2 py-0.5 rounded-full"
                  :class="{
                    'bg-blue-50 text-blue-600': itemViewer.tipoTarea === 'Preventivo',
                    'bg-orange-50 text-orange-600': itemViewer.tipoTarea === 'Mecánico',
                    'bg-violet-50 text-violet-600': itemViewer.tipoTarea === 'Eléctrico',
                  }">
                  {{ itemViewer.tipoTarea }}
                </span>
                <span v-if="itemViewer.tiempoEstimado" class="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
                  ⏱ {{ itemViewer.tiempoEstimado }}
                </span>
              </div>
            </div>
            <button @click="showViewer = false" class="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors shrink-0" v-tippy="'Cerrar'">
              <X class="w-4 h-4" />
            </button>
          </div>

          <!-- Herramientas / Repuestos chips -->
          <div v-if="itemViewer.herramientas?.length || itemViewer.repuestos?.length" class="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex gap-3 flex-wrap shrink-0">
            <div v-if="itemViewer.herramientas?.length" class="flex-1 min-w-0">
              <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Herramientas</p>
              <div class="flex flex-wrap gap-1">
                <span v-for="h in itemViewer.herramientas" :key="h"
                  class="text-xs bg-blue-50 text-blue-700 rounded-full px-2 py-0.5 font-medium">{{ h }}</span>
              </div>
            </div>
            <div v-if="itemViewer.repuestos?.length" class="flex-1 min-w-0">
              <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Repuestos</p>
              <div class="flex flex-wrap gap-1">
                <span v-for="r in itemViewer.repuestos" :key="r"
                  class="text-xs bg-amber-50 text-amber-700 rounded-full px-2 py-0.5 font-medium">{{ r }}</span>
              </div>
            </div>
          </div>

          <!-- Pasos -->
          <div class="overflow-y-auto flex-1 p-4 space-y-4">
            <div v-for="(paso, i) in itemViewer.procedimiento" :key="i" class="space-y-2">
              <div class="flex gap-3">
                <div class="flex-none w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-black flex items-center justify-center shrink-0 mt-0.5">
                  {{ i + 1 }}
                </div>
                <p class="text-sm text-gray-800 font-medium leading-relaxed pt-0.5">{{ paso.texto }}</p>
              </div>
              <div v-if="paso.imagenUrl" class="ml-9 rounded-lg overflow-hidden border border-gray-200">
                <img :src="paso.imagenUrl" class="w-full max-h-64 object-contain bg-gray-900" alt="Imagen del paso" />
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-gray-100 flex gap-2 shrink-0">
            <button
              v-if="userRole === 'admin'"
              @click="abrirEditor(itemViewer); showViewer = false"
              class="flex-none px-4 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-bold text-sm flex items-center gap-1.5 hover:bg-gray-50 transition-colors"
              v-tippy="'Editar pasos del procedimiento'"
            >
              <Pencil class="w-4 h-4" /> Editar
            </button>
            <button @click="showViewer = false" class="flex-1 py-2.5 bg-gray-900 text-white rounded-xl font-bold text-sm">
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- ── MODAL: Editor CRUD de procedimiento ─────────────────────────────────── -->
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="showEditor && editandoItem"
        class="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-gray-900/60 backdrop-blur-sm"
        @click.self="showEditor = false"
      >
        <div class="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[95dvh] sm:max-h-[90vh] flex flex-col">
          <!-- Header editor -->
          <div class="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
            <div>
              <p class="text-[10px] font-extrabold text-indigo-500 tracking-widest">
                {{ editandoPasos.length > 0 ? 'EDITAR PROCEDIMIENTO' : 'CREAR PROCEDIMIENTO' }}
              </p>
              <h3 class="text-sm font-black text-gray-800 leading-tight mt-0.5">{{ editandoItem.denominacion }}</h3>
              <p class="text-xs text-gray-400 mt-0.5">{{ editandoItem.seccion }} · Grupo {{ editandoItem.grupo }}</p>
            </div>
            <button @click="showEditor = false" class="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors shrink-0" v-tippy="'Cerrar sin guardar'">
              <X class="w-4 h-4" />
            </button>
          </div>

          <!-- Lista de pasos editables -->
          <div class="overflow-y-auto flex-1 p-4 space-y-3">
            <div v-if="editandoPasos.length === 0" class="text-center py-8 text-gray-400">
              <p class="text-sm">Sin pasos todavía. Agregá el primero.</p>
            </div>
            <div
              v-for="(paso, i) in editandoPasos"
              :key="i"
              class="flex gap-3 items-start bg-gray-50 rounded-xl p-3"
            >
              <div class="flex-none w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-black flex items-center justify-center shrink-0 mt-0.5">
                {{ i + 1 }}
              </div>
              <textarea
                v-model="paso.texto"
                :placeholder="`Paso ${i + 1}...`"
                rows="2"
                class="flex-1 text-sm text-gray-800 bg-white border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 leading-relaxed"
              />
              <button
                @click="eliminarPaso(i)"
                class="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors shrink-0"
                v-tippy="'Eliminar paso'"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </div>

            <!-- Botón agregar paso -->
            <button
              @click="agregarPaso"
              class="w-full py-2.5 border-2 border-dashed border-indigo-200 text-indigo-500 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-indigo-50 transition-colors"
            >
              <Plus class="w-4 h-4" /> Agregar paso
            </button>
          </div>

          <!-- Footer editor -->
          <div class="px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-gray-100 flex gap-2 shrink-0">
            <button
              @click="showEditor = false"
              class="flex-none px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              @click="guardarEdicion"
              :disabled="guardando"
              class="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors disabled:opacity-60"
            >
              <Loader2 v-if="guardando" class="w-4 h-4 animate-spin" />
              <Save v-else class="w-4 h-4" />
              {{ guardando ? 'Guardando...' : 'Guardar procedimiento' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
