<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userRole } from '../services/authService';
import { Languages, CheckCircle, Clock, Search, ChevronLeft, ChevronRight, Save, AlertCircle, Filter } from 'lucide-vue-next';
import Swal from 'sweetalert2';

// ──────────────────────────────────────────────
// Estado principal
// ──────────────────────────────────────────────
const tabActivo = ref('paradas'); // 'paradas' | 'defectos'
const filtroEstado = ref('todos'); // 'todos' | 'pendientes' | 'aprobados'
const searchQuery = ref('');
const isLoading = ref(false);
const isSaving = ref(false);

const paradas = ref([]);
const defectos = ref([]);

// Edición en línea: Map<docId, { campo, valor }>
const editBuffer = ref({});
// Set de IDs marcados como aprobados en esta sesión (antes de guardar)
const approvalBuffer = ref(new Set());
// Set de IDs desmarcados en esta sesión
const unapprovalBuffer = ref(new Set());

// Paginación
const currentPage = ref(1);
const itemsPerPage = 30;

// ──────────────────────────────────────────────
// Carga de datos
// ──────────────────────────────────────────────
const cargarParadas = async () => {
  isLoading.value = true;
  try {
    const snap = await getDocs(collection(db, 'codigos_paradas'));
    paradas.value = snap.docs.map((d) => ({ firestoreId: d.id, ...d.data() })).sort((a, b) => {
      if (a.grupoCodigo !== b.grupoCodigo) return a.grupoCodigo - b.grupoCodigo;
      return a.codigo - b.codigo;
    });
  } catch {
    Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudieron cargar los códigos de parada.' });
  } finally {
    isLoading.value = false;
  }
};

const cargarDefectos = async () => {
  isLoading.value = true;
  try {
    const snap = await getDocs(collection(db, 'codigos_defectos'));
    defectos.value = snap.docs.map((d) => ({ firestoreId: d.id, ...d.data() })).sort((a, b) => a.codigo - b.codigo);
  } catch {
    Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudieron cargar los códigos de defecto.' });
  } finally {
    isLoading.value = false;
  }
};

onMounted(async () => {
  await cargarParadas();
  await cargarDefectos();
});

// ──────────────────────────────────────────────
// Helpers de estado de traducción
// ──────────────────────────────────────────────
const esAprobado = (item) => {
  if (approvalBuffer.value.has(item.firestoreId)) return true;
  if (unapprovalBuffer.value.has(item.firestoreId)) return false;
  return item.translationPending === false;
};

const textoTraducido = (item) => {
  if (editBuffer.value[item.firestoreId] !== undefined) return editBuffer.value[item.firestoreId];
  return tabActivo.value === 'paradas' ? (item.motivoEs || '') : (item.descripcionEs || '');
};

const campoEs = computed(() => tabActivo.value === 'paradas' ? 'motivoEs' : 'descripcionEs');
const campoPt = computed(() => tabActivo.value === 'paradas' ? 'motivoPt' : 'descripcionPt');

// ──────────────────────────────────────────────
// Lista activa (paradas o defectos) con filtros
// ──────────────────────────────────────────────
const listaActiva = computed(() => tabActivo.value === 'paradas' ? paradas.value : defectos.value);

const listaFiltrada = computed(() => {
  const query = searchQuery.value.toLowerCase();
  return listaActiva.value.filter((item) => {
    const pt = String(tabActivo.value === 'paradas' ? item.motivoPt : item.descripcionPt).toLowerCase();
    const es = String(tabActivo.value === 'paradas' ? item.motivoEs : item.descripcionEs).toLowerCase();
    const cod = String(item.codigo).toLowerCase();
    const matchSearch = !query || pt.includes(query) || es.includes(query) || cod.includes(query);

    const aprobado = esAprobado(item);
    const matchEstado =
      filtroEstado.value === 'todos' ||
      (filtroEstado.value === 'pendientes' && !aprobado) ||
      (filtroEstado.value === 'aprobados' && aprobado);

    return matchSearch && matchEstado;
  });
});

const totalPages = computed(() => Math.max(1, Math.ceil(listaFiltrada.value.length / itemsPerPage)));

const listaPaginada = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage;
  return listaFiltrada.value.slice(start, start + itemsPerPage);
});

watch([searchQuery, filtroEstado, tabActivo], () => { currentPage.value = 1; });

// ──────────────────────────────────────────────
// Estadísticas
// ──────────────────────────────────────────────
const statsActivos = computed(() => {
  const lista = listaActiva.value;
  const aprobados = lista.filter((item) => esAprobado(item)).length;
  return { total: lista.length, aprobados, pendientes: lista.length - aprobados };
});

// ──────────────────────────────────────────────
// Interacciones
// ──────────────────────────────────────────────
const onInputTraduccion = (item, valor) => {
  editBuffer.value[item.firestoreId] = valor;
};

const toggleAprobado = (item) => {
  if (userRole.value !== 'admin') return;
  const id = item.firestoreId;
  const actualAprobado = esAprobado(item);
  if (actualAprobado) {
    approvalBuffer.value.delete(id);
    unapprovalBuffer.value.add(id);
  } else {
    unapprovalBuffer.value.delete(id);
    approvalBuffer.value.add(id);
  }
};

// ──────────────────────────────────────────────
// Guardar cambios en Firestore
// ──────────────────────────────────────────────
const guardarCambios = async () => {
  if (userRole.value !== 'admin') {
    Swal.fire('Acceso denegado', 'Solo administradores pueden guardar traducciones.', 'warning');
    return;
  }

  const pendingEdits = Object.keys(editBuffer.value);
  const pendingApprovals = [...approvalBuffer.value];
  const pendingUnapprovals = [...unapprovalBuffer.value];

  if (!pendingEdits.length && !pendingApprovals.length && !pendingUnapprovals.length) {
    Swal.fire({ icon: 'info', title: 'Sin cambios', text: 'No hay modificaciones pendientes.', timer: 1500, showConfirmButton: false });
    return;
  }

  const collectionName = tabActivo.value === 'paradas' ? 'codigos_paradas' : 'codigos_defectos';
  const campoEsField = campoEs.value;

  // Consolidar todos los IDs afectados
  const allIds = new Set([...pendingEdits, ...pendingApprovals, ...pendingUnapprovals]);

  isSaving.value = true;
  try {
    const ids = [...allIds];
    const chunkSize = 400;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const batch = writeBatch(db);

      for (const firestoreId of chunk) {
        const patch = {};

        if (editBuffer.value[firestoreId] !== undefined) {
          patch[campoEsField] = editBuffer.value[firestoreId] || null;
        }

        if (approvalBuffer.value.has(firestoreId)) {
          patch.translationPending = false;
          patch.translationApprovedBy = userRole.value;
          patch.translationApprovedAt = new Date().toISOString();
        } else if (unapprovalBuffer.value.has(firestoreId)) {
          patch.translationPending = true;
          patch.translationApprovedBy = null;
          patch.translationApprovedAt = null;
        }

        if (Object.keys(patch).length) {
          batch.update(doc(db, collectionName, firestoreId), patch);
        }
      }

      await batch.commit();
    }

    // Aplicar cambios localmente para no recargar todo
    const lista = tabActivo.value === 'paradas' ? paradas : defectos;
    for (const item of lista.value) {
      if (editBuffer.value[item.firestoreId] !== undefined) {
        item[campoEsField] = editBuffer.value[item.firestoreId] || null;
      }
      if (approvalBuffer.value.has(item.firestoreId)) {
        item.translationPending = false;
      } else if (unapprovalBuffer.value.has(item.firestoreId)) {
        item.translationPending = true;
      }
    }

    // Limpiar buffers
    editBuffer.value = {};
    approvalBuffer.value = new Set();
    unapprovalBuffer.value = new Set();

    Swal.fire({ icon: 'success', title: 'Guardado', text: `${allIds.size} registro(s) actualizados.`, timer: 1800, showConfirmButton: false, toast: true, position: 'top-end' });
  } catch (e) {
    Swal.fire('Error', 'No se pudieron guardar los cambios: ' + e.message, 'error');
  } finally {
    isSaving.value = false;
  }
};

const cambiosPendientes = computed(() =>
  Object.keys(editBuffer.value).length + approvalBuffer.value.size + unapprovalBuffer.value.size
);
</script>

<template>
  <div class="flex flex-col h-screen bg-gray-50">

    <!-- Header fijo -->
    <div class="bg-white border-b border-gray-200 px-4 pt-4 pb-0 shrink-0 z-10 shadow-sm">
      <div class="max-w-5xl mx-auto">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
              <Languages class="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h1 class="text-base font-black text-gray-800 tracking-tight">Traducciones de catálogo</h1>
              <p class="text-[11px] text-gray-400 font-medium">Portugués → Español | Tejeduría</p>
            </div>
          </div>

          <!-- Botón guardar -->
          <button
            v-if="userRole === 'admin'"
            :disabled="isSaving || cambiosPendientes === 0"
            @click="guardarCambios"
            class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-black transition-all active:scale-95 disabled:opacity-40"
            :class="cambiosPendientes > 0 ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/20 hover:bg-violet-700' : 'bg-gray-100 text-gray-400'"
          >
            <Save class="w-4 h-4" />
            <span>{{ isSaving ? 'Guardando…' : `Guardar${cambiosPendientes > 0 ? ` (${cambiosPendientes})` : ''}` }}</span>
          </button>
        </div>

        <!-- Tabs -->
        <div class="flex gap-1 border-b border-gray-100 -mb-px">
          <button
            v-for="tab in [{ id: 'paradas', label: 'Códigos de Parada', count: paradas.length }, { id: 'defectos', label: 'Códigos de Defecto', count: defectos.length }]"
            :key="tab.id"
            @click="tabActivo = tab.id"
            class="px-4 py-3 text-sm font-black tracking-tight border-b-2 transition-all"
            :class="tabActivo === tab.id
              ? 'border-violet-600 text-violet-700'
              : 'border-transparent text-gray-400 hover:text-gray-600'"
          >
            {{ tab.label }}
            <span
              class="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-black"
              :class="tabActivo === tab.id ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-400'"
            >{{ tab.count }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Controles de filtro y estadísticas -->
    <div class="bg-white border-b border-gray-100 px-4 py-3 shrink-0">
      <div class="max-w-5xl mx-auto flex flex-wrap items-center gap-3">

        <!-- Stats rápidas -->
        <div class="flex items-center gap-3 text-xs font-bold mr-auto">
          <span class="flex items-center gap-1 text-emerald-600">
            <CheckCircle class="w-3.5 h-3.5" />
            {{ statsActivos.aprobados }} aprobados
          </span>
          <span class="flex items-center gap-1 text-amber-500">
            <Clock class="w-3.5 h-3.5" />
            {{ statsActivos.pendientes }} pendientes
          </span>
          <span class="text-gray-400">/ {{ statsActivos.total }} total</span>
        </div>

        <!-- Filtro de estado -->
        <div class="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            v-for="f in [{ id: 'todos', label: 'Todos' }, { id: 'pendientes', label: 'Pendientes' }, { id: 'aprobados', label: 'Aprobados' }]"
            :key="f.id"
            @click="filtroEstado = f.id"
            class="px-3 py-1.5 text-xs font-black rounded-md transition-all"
            :class="filtroEstado === f.id ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'"
          >
            {{ f.label }}
          </button>
        </div>

        <!-- Búsqueda -->
        <div class="relative">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Buscar…"
            class="pl-8 pr-3 py-2 text-sm bg-gray-100 border-0 rounded-lg w-44 focus:w-56 focus:bg-white focus:ring-2 focus:ring-violet-500/20 outline-none transition-all font-medium placeholder-gray-400"
          />
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-3 text-gray-400">
        <div class="w-8 h-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin"></div>
        <span class="text-sm font-bold">Cargando catálogo…</span>
      </div>
    </div>

    <!-- Lista de traducciones -->
    <div v-else class="flex-1 overflow-y-auto px-4 py-3">
      <div class="max-w-5xl mx-auto space-y-2">

        <!-- Sin resultados -->
        <div v-if="listaPaginada.length === 0" class="flex flex-col items-center justify-center py-16 text-gray-400">
          <AlertCircle class="w-10 h-10 mb-3 opacity-30" />
          <p class="font-bold text-base">Sin resultados</p>
          <p class="text-sm">Prueba otro filtro o término de búsqueda.</p>
        </div>

        <!-- Tarjeta por item -->
        <div
          v-for="item in listaPaginada"
          :key="item.firestoreId"
          class="bg-white rounded-xl border transition-all"
          :class="esAprobado(item) ? 'border-emerald-200' : 'border-gray-200 hover:border-violet-200'"
        >
          <div class="flex items-start gap-4 p-4">

            <!-- Código + metadatos -->
            <div class="shrink-0 w-24 sm:w-28">
              <span class="block text-[10px] font-black text-gray-400 tracking-widest mb-1">COD.</span>
              <span class="text-2xl font-black text-gray-800 leading-none">{{ item.codigo }}</span>

              <!-- Grupo (solo paradas) -->
              <template v-if="tabActivo === 'paradas'">
                <span class="block text-[10px] font-bold text-gray-400 mt-1">{{ item.grupoMotivo }}</span>
              </template>
              <!-- Local (solo defectos) -->
              <template v-else>
                <span v-if="item.local" class="block mt-1 px-2 py-0.5 bg-indigo-50 text-[10px] font-black text-indigo-600 rounded">{{ item.local }}</span>
              </template>
            </div>

            <!-- Textos PT → ES -->
            <div class="flex-1 min-w-0 grid sm:grid-cols-2 gap-3">

              <!-- Portugués (solo lectura) -->
              <div>
                <span class="block text-[10px] font-black text-gray-400 tracking-widest mb-1">PT (original)</span>
                <p class="text-sm font-semibold text-gray-700 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  {{ item[campoPt] }}
                </p>
              </div>

              <!-- Español (editable) -->
              <div>
                <span class="block text-[10px] font-black text-gray-400 tracking-widest mb-1 flex items-center gap-1">
                  ES (traducción)
                  <span v-if="editBuffer[item.firestoreId] !== undefined" class="px-1.5 rounded bg-violet-100 text-violet-600 text-[9px] font-black">modificado</span>
                </span>
                <textarea
                  :value="textoTraducido(item)"
                  @input="onInputTraduccion(item, $event.target.value)"
                  rows="2"
                  :readonly="userRole !== 'admin'"
                  placeholder="Escribe la traducción al español…"
                  class="w-full text-sm font-semibold rounded-lg px-3 py-2 border resize-none outline-none transition-all"
                  :class="[
                    userRole !== 'admin' ? 'bg-gray-50 text-gray-500 border-gray-100 cursor-default' : 'bg-white text-gray-800 border-gray-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/10',
                    editBuffer[item.firestoreId] !== undefined ? 'border-violet-300' : ''
                  ]"
                ></textarea>
              </div>
            </div>

            <!-- Botón aprobar -->
            <div class="shrink-0 flex flex-col items-center gap-1 pt-1">
              <button
                @click="toggleAprobado(item)"
                :disabled="userRole !== 'admin'"
                :title="esAprobado(item) ? 'Quitar aprobación' : 'Aprobar traducción'"
                class="w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all active:scale-90"
                :class="esAprobado(item)
                  ? 'bg-emerald-500 border-emerald-500 text-white shadow-md shadow-emerald-500/20'
                  : 'bg-white border-gray-200 text-gray-300 hover:border-emerald-400 hover:text-emerald-400 disabled:cursor-default'"
              >
                <CheckCircle class="w-5 h-5" />
              </button>
              <span class="text-[9px] font-black tracking-wide" :class="esAprobado(item) ? 'text-emerald-500' : 'text-gray-300'">
                {{ esAprobado(item) ? 'OK' : '---' }}
              </span>
            </div>

          </div>
        </div>

      </div>
    </div>

    <!-- Paginación -->
    <div v-if="!isLoading && totalPages > 1" class="bg-white border-t border-gray-100 px-4 py-3 shrink-0">
      <div class="max-w-5xl mx-auto flex items-center justify-between">
        <span class="text-xs font-bold text-gray-400">
          Pág. {{ currentPage }} de {{ totalPages }} · {{ listaFiltrada.length }} registros
        </span>
        <div class="flex items-center gap-1">
          <button
            @click="currentPage--"
            :disabled="currentPage <= 1"
            class="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-all"
          >
            <ChevronLeft class="w-4 h-4" />
          </button>
          <button
            @click="currentPage++"
            :disabled="currentPage >= totalPages"
            class="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-all"
          >
            <ChevronRight class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

  </div>
</template>
