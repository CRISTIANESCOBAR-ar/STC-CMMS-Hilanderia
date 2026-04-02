<script setup>
import { ref, computed, onMounted } from 'vue';
import { maquinaService } from '../services/maquinaService';
import { catalogoService } from '../services/catalogoService';
import { MOTIVOS_POR_TIPO, MOTIVOS_DEFAULT } from '../constants/motivos';
import {
  ChevronRight, ChevronDown, BookOpen, Wrench, Zap,
  CheckCircle2, XCircle, ClipboardList, Loader2, Info,
  ChevronUp, BookMarked, Settings2
} from 'lucide-vue-next';

// ── Estado ────────────────────────────────────────────────────────────────────
const maquinas       = ref([]);
const catalogoItems  = ref([]);
const cargandoMaq    = ref(true);
const cargandoCat    = ref(false);

const tipoSeleccionado  = ref(null);
const modeloSeleccionado = ref(null);
const tabActiva         = ref('catalogo'); // 'catalogo' | 'motivos' | 'maquinas'

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
  }
};

// ── Selección de Modelo ───────────────────────────────────────────────────────
const seleccionarModelo = async (modelo) => {
  modeloSeleccionado.value = modelo;
  catalogoItems.value = [];
  seccionesExpandidas.value = new Set();
  tabActiva.value = 'catalogo';
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
  catalogoItems.value.forEach(item => {
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

// ── Motivos ───────────────────────────────────────────────────────────────────
const motivosDelTipo = computed(() => {
  if (!tipoSeleccionado.value) return null;
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
</script>

<template>
  <div class="flex flex-col h-screen bg-gray-50 overflow-hidden">

    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <div class="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
      <BookMarked class="w-5 h-5 text-indigo-600" />
      <h1 class="font-bold text-gray-800 text-base">Explorador de Catálogo</h1>
      <span v-if="!cargandoMaq" class="ml-auto text-xs text-gray-400">
        {{ maquinas.length }} máquinas · {{ tiposDisponibles.length }} tipos
      </span>
    </div>

    <!-- ── Layout 3 columnas ────────────────────────────────────────────────── -->
    <div class="flex flex-1 overflow-hidden">

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

              <!-- Stats -->
              <div v-if="statsModelo.total > 0" class="flex gap-2 text-xs">
                <span class="flex items-center gap-1 bg-gray-100 rounded-full px-2.5 py-1 text-gray-600 font-medium">
                  <ClipboardList class="w-3.5 h-3.5" />
                  {{ statsModelo.total }} items
                </span>
                <span class="flex items-center gap-1 bg-emerald-50 text-emerald-700 rounded-full px-2.5 py-1 font-medium">
                  <CheckCircle2 class="w-3.5 h-3.5" />
                  {{ statsModelo.conProc }} con procedimiento
                </span>
                <span v-if="statsModelo.sinProc > 0" class="flex items-center gap-1 bg-amber-50 text-amber-700 rounded-full px-2.5 py-1 font-medium">
                  <XCircle class="w-3.5 h-3.5" />
                  {{ statsModelo.sinProc }} sin procedimiento
                </span>
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
                          class="flex items-start gap-3 px-4 py-2 hover:bg-gray-50 transition-colors"
                        >
                          <!-- Indicador procedimiento -->
                          <div class="shrink-0 mt-0.5">
                            <CheckCircle2
                              v-if="Array.isArray(item.procedimiento) && item.procedimiento.length > 0"
                              class="w-4 h-4 text-emerald-500"
                              title="Tiene procedimiento"
                            />
                            <XCircle
                              v-else
                              class="w-4 h-4 text-gray-300"
                              title="Sin procedimiento"
                            />
                          </div>

                          <!-- Nombre -->
                          <div class="flex-1 min-w-0">
                            <p class="text-sm text-gray-700 font-medium leading-snug">{{ item.denominacion }}</p>
                            <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
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
                              class="mt-1 text-xs text-emerald-600 font-medium">
                              {{ item.procedimiento.length }} pasos · {{ item.herramientas?.length || 0 }} herramientas
                              <span v-if="item.repuestos?.length > 0"> · {{ item.repuestos.length }} repuesto(s)</span>
                            </div>
                          </div>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- ── TAB: MOTIVOS ── -->
          <div v-if="tabActiva === 'motivos'" class="p-4">
            <div v-if="!motivosDelTipo" class="flex flex-col items-center py-16 text-gray-300 gap-2">
              <Info class="w-8 h-8" />
              <p class="text-sm">Sin motivos configurados para {{ tipoSeleccionado }}</p>
            </div>

            <template v-else>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <!-- Mecánico -->
                <div v-if="motivosDelTipo['Mecánico']" class="border border-gray-200 rounded-lg overflow-hidden">
                  <div class="flex items-center gap-2 px-4 py-3 bg-orange-50 border-b border-orange-100">
                    <Wrench class="w-4 h-4 text-orange-500" />
                    <span class="font-bold text-orange-700 text-sm">Mecánico</span>
                    <span class="ml-auto text-xs text-orange-400">{{ motivosDelTipo['Mecánico'].length }} motivos</span>
                  </div>
                  <ul class="divide-y divide-gray-50">
                    <li
                      v-for="m in motivosDelTipo['Mecánico']"
                      :key="m"
                      class="px-4 py-2.5 text-sm text-gray-700"
                    >{{ m }}</li>
                  </ul>
                </div>

                <!-- Eléctrico -->
                <div v-if="motivosDelTipo['Eléctrico']" class="border border-gray-200 rounded-lg overflow-hidden">
                  <div class="flex items-center gap-2 px-4 py-3 bg-violet-50 border-b border-violet-100">
                    <Zap class="w-4 h-4 text-violet-500" />
                    <span class="font-bold text-violet-700 text-sm">Eléctrico</span>
                    <span class="ml-auto text-xs text-violet-400">{{ motivosDelTipo['Eléctrico'].length }} motivos</span>
                  </div>
                  <ul class="divide-y divide-gray-50">
                    <li
                      v-for="m in motivosDelTipo['Eléctrico']"
                      :key="m"
                      class="px-4 py-2.5 text-sm text-gray-700"
                    >{{ m }}</li>
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
  </div>
</template>
