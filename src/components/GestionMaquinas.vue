```
<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { authService, userRole } from '../services/authService';
import { db } from '../firebase/config';
import { collection, getDocs, query, doc, updateDoc } from 'firebase/firestore';
import { Plus, Search, Edit3, Trash2, X, Check, Settings2, LayoutGrid, Table2, Save, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileSpreadsheet } from 'lucide-vue-next';
import Swal from 'sweetalert2';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/shift-away.css';
import { DEFAULT_SECTOR, SECTOR_OPTIONS, normalizeSectorValue } from '../constants/organization';

const maquinas = ref([]);
const isLoading = ref(true);
const searchQuery = ref('');
const showModal = ref(false);
const isEditing = ref(false);
const viewMode = ref('cards');

// 'all' | 'activas' | 'inactivas'
const activoFilter = ref('all');

const editingRowId = ref(null);
const editingRow = ref({});

const initialForm = { id: null, unidad: 5, maquina: '', local_fisico: '', nro_tipo: '', tipo: 'CARDA', nombre_maquina: '', lado: 'U', modelo: '', nro_serie: '', sector: DEFAULT_SECTOR, activo: true };
const form = ref({ ...initialForm });

// Paginación
const currentPage = ref(1);
const itemsPerPage = ref(25);

const totalPages = computed(() => Math.ceil(filteredMaquinas.value.length / itemsPerPage.value) || 1);

const paginatedMaquinas = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  return filteredMaquinas.value.slice(start, start + itemsPerPage.value);
});

const goToFirst = () => { currentPage.value = 1; };
const goToPrev = () => { if (currentPage.value > 1) currentPage.value--; };
const goToNext = () => { if (currentPage.value < totalPages.value) currentPage.value++; };
const goToLast = () => { currentPage.value = totalPages.value; };

// Resetear página al buscar o cambiar filtro
watch([searchQuery, activoFilter], () => { currentPage.value = 1; });

onMounted(async () => {
  const timeoutId = setTimeout(() => {
    if (isLoading.value) {
      isLoading.value = false;
      Swal.fire({ 
        icon: 'warning', 
        title: 'Tiempo excedido', 
        text: 'La base de datos tarda demasiado en responder. Intenta recargar la página.' 
      });
    }
  }, 10000);

  try {
    const q = query(collection(db, 'maquinas'));
    const snapshot = await getDocs(q);
    clearTimeout(timeoutId);

    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), sector: normalizeSectorValue(doc.data().sector || DEFAULT_SECTOR), activo: doc.data().activo ?? true }));
    
    // Ordenar manualmente para asegurar consistencia
    maquinas.value = data.sort((a, b) => {
      if ((a.nro_tipo || 0) !== (b.nro_tipo || 0)) return (a.nro_tipo || 0) - (b.nro_tipo || 0);
      return (a.local_fisico || 0) - (b.local_fisico || 0);
    });

    isLoading.value = false;
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("Error cargando máquinas:", error);
    isLoading.value = false;
    Swal.fire({ icon: 'error', title: 'Error de conexión', text: 'No se pudo cargar el catálogo de máquinas.' });
  }
  // Inicializar tooltips con un pequeño delay
  setTimeout(() => {
    tippy('[data-tippy-content]', {
      animation: 'shift-away',
      theme: 'translucent',
      duration: [200, 150]
    });
  }, 500);
});

const filteredMaquinas = computed(() => {
  const q = searchQuery.value.toLowerCase();
  return maquinas.value.filter(m => {
    const estaActivo = m.activo ?? true;
    if (activoFilter.value === 'activas' && !estaActivo) return false;
    if (activoFilter.value === 'inactivas' && estaActivo) return false;
    return (
      String(m.maquina).toLowerCase().includes(q) ||
      m.tipo.toLowerCase().includes(q) ||
      m.nombre_maquina?.toLowerCase().includes(q) ||
      String(m.sector || '').toLowerCase().includes(q)
    );
  });
});

const openAddModal = () => { isEditing.value = false; form.value = { ...initialForm }; showModal.value = true; };
const openEditModal = (maquina) => { isEditing.value = true; form.value = { ...maquina, activo: maquina.activo ?? true }; showModal.value = true; };
const closeModal = () => { showModal.value = false; };

const handleSubmit = async () => {
  try {
    await maquinaService.upsertMaquina(form.value);
    closeModal();
    Swal.fire({ icon: 'success', title: isEditing.value ? '¡Actualizada!' : '¡Agregada!', timer: 2000, timerProgressBar: true, showConfirmButton: false, toast: true, position: 'top-end' });
  } catch (error) {
    Swal.fire({ icon: 'error', title: 'Error al guardar', text: error.message });
  }
};

const toggleActivo = async (maquina) => {
  const nuevoEstado = !(maquina.activo ?? true);
  try {
    await updateDoc(doc(db, 'maquinas', maquina.id), { activo: nuevoEstado });
    const idx = maquinas.value.findIndex(m => m.id === maquina.id);
    if (idx !== -1) maquinas.value[idx].activo = nuevoEstado;
  } catch (error) {
    Swal.fire({ icon: 'error', title: 'Error al actualizar', text: error.message });
  }
};

const startInlineEdit = (maquina) => { editingRowId.value = maquina.id; editingRow.value = { ...maquina, activo: maquina.activo ?? true }; };
const cancelInlineEdit = () => { editingRowId.value = null; editingRow.value = {}; };

const saveInlineEdit = async () => {
  try {
    await maquinaService.upsertMaquina(editingRow.value);
    cancelInlineEdit();
    Swal.fire({ icon: 'success', title: '¡Guardado!', timer: 1500, showConfirmButton: false, toast: true, position: 'top-end' });
  } catch (error) {
    Swal.fire({ icon: 'error', title: 'Error al guardar', text: error.message });
  }
};

const deleteMaquina = async (id) => {
  const result = await Swal.fire({
    icon: 'warning', title: '¿Eliminar máquina?', text: 'Esta acción no se puede deshacer.',
    showCancelButton: true, confirmButtonColor: '#dc2626',
    cancelButtonText: 'Cancelar', confirmButtonText: 'Sí, eliminar'
  });
  if (result.isConfirmed) {
    try {
      await maquinaService.eliminarMaquina(id);
      Swal.fire({ icon: 'success', title: 'Eliminada', timer: 1500, showConfirmButton: false, toast: true, position: 'top-end' });
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Error al eliminar', text: error.message });
    }
  }
};

const tiposOptions = [
  'APERTURA', 'CARDA', 'MANUAR', 'OPEN END', 'FILTRO',
  'URDIDORA', 'INDIGO', 'TELAR', 'REVISADORA', 'MERCERIZADORA', 'INTEGRADA',
  'OTRO'
];

const exportToExcel = async () => {
  if (filteredMaquinas.value.length === 0) return;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Catálogo de Máquinas');

  // Configurar Columnas
  worksheet.columns = [
    { header: 'SECTOR', key: 'sector', width: 18 },
    { header: 'TIPO', key: 'tipo', width: 15 },
    { header: 'ID MÁQ', key: 'maquina', width: 10 },
    { header: 'NOMBRE', key: 'nombre_maquina', width: 30 },
    { header: 'LOCAL', key: 'local_fisico', width: 10 },
    { header: 'LADO', key: 'lado', width: 8 },
    { header: 'MODELO', key: 'modelo', width: 20 },
    { header: 'SERIE', key: 'nro_serie', width: 20 },
    { header: 'ACTIVO', key: 'activo', width: 10 },
    { header: 'ADQUISICION', key: 'adquisicion', width: 15 },
    { header: 'EXCEL_ID', key: 'excel_id', width: 12 },
  ];

  // Agregar Datos
  filteredMaquinas.value.forEach(m => {
    worksheet.addRow({
      sector: m.sector || DEFAULT_SECTOR,
      tipo: m.tipo,
      maquina: m.maquina,
      nombre_maquina: m.nombre_maquina || '---',
      local_fisico: m.local_fisico,
      lado: m.lado,
      modelo: m.modelo || '---',
      nro_serie: m.nro_serie || '---',
      activo: (m.activo ?? true) ? 'SI' : 'NO',
      adquisicion: m.adquisicion?.toDate?.()?.toLocaleDateString('es-AR') || '---',
      excel_id: m.excel_id || '---',
    });
  });

  // Estilo de Encabezado
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2563EB' } // Blue-600 logic consistent with App theme
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  // Bordes y Zebra Stripes
  worksheet.eachRow((row, rowNumber) => {
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
      };
      if (rowNumber > 1) {
        cell.font = { size: 10 };
        cell.alignment = { vertical: 'middle' };
        if (rowNumber % 2 === 0) {
          row.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF9FAFB' }
          };
        }
      }
    });
  });

  // Filtros Automáticos
  worksheet.autoFilter = 'A1:K1';

  // Generar y Descargar
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `Catalogo_Maquinas_${new Date().toISOString().split('T')[0]}.xlsx`);
};
</script>

<template>
  <div class="h-[calc(100vh-64px)] bg-gray-50 flex flex-col overflow-hidden">
    <main class="flex-1 max-w-7xl mx-auto w-full px-2 pt-0 lg:pt-4 pb-2 flex flex-col space-y-1 lg:space-y-3 overflow-hidden">

      <!-- Portal para Navbar (Desktop) -->
      <Teleport to="#navbar-actions">
        <div class="flex items-center w-full gap-4">
          <!-- Título y Subtítulo (Desktop) -->
          <div class="flex items-center space-x-3 shrink-0">
            <div class="bg-indigo-500 p-1.5 rounded-lg text-white">
              <Settings2 class="w-4 h-4" />
            </div>
            <div class="hidden xl:block">
              <h1 class="text-sm font-black text-white tracking-tight leading-none">Gestión de máquinas</h1>
              <p class="text-[8px] text-gray-400 font-bold tracking-widest mt-0.5">Catálogo</p>
            </div>
          </div>

          <!-- Buscador (Desktop) -->
          <div class="relative flex-1 max-w-md mx-auto">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input 
              v-model="searchQuery" 
              type="text" 
              placeholder="Buscar por ID, Tipo o Nombre..." 
              class="w-full pl-9 pr-4 py-1.5 bg-gray-800 border border-gray-700 focus:bg-gray-700 focus:border-indigo-500 rounded-lg text-xs text-gray-200 outline-none transition-all placeholder:text-gray-500" 
            />
          </div>

          <!-- Controles y Botón (Desktop) -->
          <div class="flex items-center gap-3 shrink-0">

            <!-- Filtro Activo/Inactivo -->
            <div class="flex border border-gray-700 rounded-md overflow-hidden bg-gray-800 text-[10px] font-bold">
              <button @click="activoFilter = 'all'" :class="activoFilter === 'all' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-700'" class="px-2.5 py-1.5 transition-colors">Todos</button>
              <button @click="activoFilter = 'activas'" :class="activoFilter === 'activas' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:bg-gray-700'" class="px-2.5 py-1.5 transition-colors border-l border-gray-700">Activas</button>
              <button @click="activoFilter = 'inactivas'" :class="activoFilter === 'inactivas' ? 'bg-red-600 text-white' : 'text-gray-400 hover:bg-gray-700'" class="px-2.5 py-1.5 transition-colors border-l border-gray-700">Inactivas</button>
            </div>

            <div class="flex border border-gray-700 rounded-md overflow-hidden bg-gray-800">
              <button @click="viewMode = 'cards'" :class="viewMode === 'cards' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-700'" class="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold transition-colors">
                <LayoutGrid class="w-3.5 h-3.5" /><span>Tarjetas</span>
              </button>
              <button @click="viewMode = 'table'" :class="viewMode === 'table' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-700'" class="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold transition-colors border-l border-gray-700">
                <Table2 class="w-3.5 h-3.5" /><span>Tabla</span>
              </button>
            </div>
            <button 
              v-if="userRole === 'admin'"
              @click="openAddModal" 
              class="flex items-center space-x-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-bold shadow-lg shadow-indigo-900/40 transition-all active:scale-95 text-[11px]"
            >
              <Plus class="w-3.5 h-3.5" /><span>Agregar</span>
            </button>
            <button 
              @click="exportToExcel"
              data-tippy-content="Exportar a Excel"
              class="p-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-lg shadow-emerald-900/40 transition-all active:scale-95"
            >
              <FileSpreadsheet class="w-4 h-4" />
            </button>
          </div>
        </div>
      </Teleport>

      <!-- Portal para Navbar (Mobile) - Maximizar espacio vertical -->
      <Teleport to="#navbar-mobile-portal">
        <div class="flex items-center gap-2">
          <h1 class="text-xs font-black text-white tracking-tighter shrink-0">Gestión</h1>
          <div class="flex items-center gap-1">
            <button @click="exportToExcel" class="bg-emerald-600 text-white p-1 rounded-md active:scale-90 transition-all"><FileSpreadsheet class="w-3.5 h-3.5" /></button>
            <button v-if="userRole === 'admin'" @click="openAddModal" class="bg-indigo-600 text-white p-1 rounded-md active:scale-90 transition-all"><Plus class="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </Teleport>

      <!-- Header Local (Solo Móvil) - Muy compacto -->
      <div class="lg:hidden bg-white/95 backdrop-blur-sm p-1.5 rounded-xl shadow-md border border-gray-100 shrink-0 sticky top-0 z-20">
        <div class="flex items-center gap-2">
          <div class="relative flex-1">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input v-model="searchQuery" type="text" placeholder="Buscar..." class="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-100 rounded-lg text-xs outline-none focus:ring-1 focus:ring-indigo-500/20" />
          </div>
          <!-- Filtro activo mobile (T=Todos, A=Activas, I=Inactivas) -->
          <div class="flex border border-gray-200 rounded-lg overflow-hidden shrink-0 text-[9px] font-bold">
            <button @click="activoFilter = 'all'" :class="activoFilter === 'all' ? 'bg-gray-500 text-white' : 'bg-gray-50 text-gray-400'" class="px-1.5 py-1.5 transition-all">T</button>
            <button @click="activoFilter = 'activas'" :class="activoFilter === 'activas' ? 'bg-emerald-500 text-white' : 'bg-gray-50 text-gray-400'" class="px-1.5 py-1.5 border-l border-gray-200 transition-all">A</button>
            <button @click="activoFilter = 'inactivas'" :class="activoFilter === 'inactivas' ? 'bg-red-500 text-white' : 'bg-gray-50 text-gray-400'" class="px-1.5 py-1.5 border-l border-gray-200 transition-all">I</button>
          </div>
          <div class="flex border border-gray-200 rounded-lg overflow-hidden shrink-0">
            <button @click="viewMode = 'cards'" :class="viewMode === 'cards' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-50 text-gray-400'" class="p-1.5 transition-all"><LayoutGrid class="w-3.5 h-3.5" /></button>
            <button @click="viewMode = 'table'" :class="viewMode === 'table' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-50 text-gray-400'" class="p-1.5 border-l border-gray-200 transition-all"><Table2 class="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </div>

      <div v-if="isLoading" class="flex-1 flex flex-col items-center justify-center text-gray-400">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>
        <p class="font-bold text-xs tracking-widest">Cargando catálogo...</p>
      </div>

      <template v-else>
        <div v-if="viewMode === 'cards'" class="flex-1 overflow-y-auto pr-1">
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            <div
              v-for="m in paginatedMaquinas" :key="m.id"
              :class="!(m.activo ?? true) ? 'opacity-60 border-dashed' : 'hover:border-indigo-300'"
              class="relative bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col group transition-all min-h-27.5"
            >
              <!-- Cuerpo Principal -->
              <div class="space-y-2 flex-1 pr-14">
                <div class="flex items-center space-x-2 flex-wrap gap-y-1">
                  <span class="px-2 py-1 bg-emerald-50 text-[10px] font-black text-emerald-700 rounded shrink-0 border border-emerald-100">{{ m.sector || DEFAULT_SECTOR }}</span>
                  <span class="px-2 py-1 bg-gray-100 text-xs font-black text-gray-500 rounded shrink-0">{{ m.tipo }}</span>
                  <span class="text-xl font-black text-gray-800 truncate">{{ m.maquina }}</span>
                </div>
                <p class="text-sm font-bold text-gray-600 line-clamp-1 italic">{{ m.nombre_maquina || 'Sin nombre' }}</p>
                <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400 font-bold uppercase tracking-tight mt-1">
                  <span class="shrink-0">Loc: {{ m.local_fisico }}</span>
                  <span class="shrink-0">Lado: {{ m.lado }}</span>
                </div>
                <!-- Badge Activo -->
                <div class="pt-1">
                  <span
                    :class="(m.activo ?? true)
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-red-50 text-red-500 border-red-200'"
                    class="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border"
                  >{{ (m.activo ?? true) ? 'En producción' : 'Fuera de producción' }}</span>
                </div>
              </div>

              <!-- Botones de Acción (Admin) -->
              <div v-if="userRole === 'admin'" class="absolute top-3 right-3 flex flex-col space-y-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                <!-- Toggle Activo estilo "Crítico" -->
                <button
                  @click="toggleActivo(m)"
                  :data-tippy-content="(m.activo ?? true) ? 'Marcar inactiva' : 'Marcar activa'"
                  class="flex items-center gap-1 px-1.5 py-1.5 rounded-lg border transition-all shadow-sm"
                  :class="(m.activo ?? true)
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-gray-100 border-gray-200 text-gray-400 hover:bg-gray-200'"
                >
                  <span
                    class="relative inline-flex h-4 w-7 items-center rounded-full transition-colors"
                    :class="(m.activo ?? true) ? 'bg-red-500' : 'bg-gray-300'"
                  >
                    <span
                      class="inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform"
                      :class="(m.activo ?? true) ? 'translate-x-3.5' : 'translate-x-0.5'"
                    ></span>
                  </span>
                </button>
                <button @click="openEditModal(m)" class="p-2 text-indigo-600 bg-gray-50 hover:bg-indigo-50 border border-gray-100 rounded-lg transition-colors shadow-sm"><Edit3 class="w-4 h-4" /></button>
                <button @click="deleteMaquina(m.id)" class="p-2 text-red-500 bg-gray-50 hover:bg-red-50 border border-gray-100 rounded-lg transition-colors shadow-sm"><Trash2 class="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        </div>

        <!-- TABLA INLINE (Ocupa todo el alto) -->
        <div v-else class="flex-1 bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-0">
          <div class="overflow-auto flex-1 min-h-0">
            <table class="w-full text-sm text-left border-collapse">
              <thead class="sticky top-0 z-20 bg-gray-50 border-b border-gray-100 text-xs font-black text-gray-500 tracking-widest shadow-sm">
                <tr>
                  <th class="px-4 py-4 bg-gray-50 w-30">Tipo</th>
                  <th class="px-4 py-4 bg-gray-50 w-30">Sector</th>
                  <th class="px-4 py-4 bg-gray-50 w-25">ID Máq.</th>
                  <th class="px-4 py-4 bg-gray-50 min-w-50">Nombre</th>
                  <th class="px-4 py-4 bg-gray-50 w-20">Local</th>
                  <th class="px-4 py-4 bg-gray-50 w-20">Lado</th>
                  <th class="px-4 py-4 bg-gray-50 w-30">Modelo</th>
                  <th class="px-4 py-4 bg-gray-50 w-30">Serie</th>
                  <th class="px-4 py-4 bg-gray-50 w-28 text-center">Activo</th>
                  <th v-if="userRole === 'admin'" class="px-4 py-4 text-center bg-gray-50 w-25">Acciones</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <tr
                  v-for="m in paginatedMaquinas" :key="m.id"
                  :class="[
                    editingRowId === m.id ? 'bg-indigo-50' : 'hover:bg-gray-50/50',
                    !(m.activo ?? true) ? 'opacity-60' : ''
                  ]"
                  class="transition-colors"
                >
                  <template v-if="editingRowId === m.id">
                    <td class="px-4 py-3"><select v-model="editingRow.tipo" class="w-full bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none"><option v-for="t in tiposOptions" :key="t">{{ t }}</option></select></td>
                    <td class="px-4 py-3"><select v-model="editingRow.sector" class="w-full bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none"><option v-for="s in SECTOR_OPTIONS" :key="s" :value="s">{{ s }}</option></select></td>
                    <td class="px-4 py-3"><input v-model="editingRow.maquina" type="number" class="w-24 bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none" /></td>
                    <td class="px-4 py-3"><input v-model="editingRow.nombre_maquina" type="text" class="w-full min-w-40 bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none" /></td>
                    <td class="px-4 py-3"><input v-model="editingRow.local_fisico" type="text" class="w-16 bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none" /></td>
                    <td class="px-4 py-3"><select v-model="editingRow.lado" class="bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none"><option value="U">U</option><option value="A">A</option><option value="B">B</option></select></td>
                    <td class="px-4 py-3"><input v-model="editingRow.modelo" type="text" class="w-full bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none" /></td>
                    <td class="px-4 py-3"><input v-model="editingRow.nro_serie" type="text" class="w-full bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none" /></td>
                    <!-- Toggle activo edición inline -->
                    <td class="px-4 py-3 text-center">
                      <button type="button" @click="editingRow.activo = !editingRow.activo" class="flex items-center gap-2 mx-auto">
                        <span class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors" :class="editingRow.activo ? 'bg-red-500' : 'bg-gray-300'">
                          <span class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform" :class="editingRow.activo ? 'translate-x-4.5' : 'translate-x-0.5'"></span>
                        </span>
                        <span class="text-xs font-bold" :class="editingRow.activo ? 'text-emerald-600' : 'text-gray-400'">{{ editingRow.activo ? 'Activa' : 'Inactiva' }}</span>
                      </button>
                    </td>
                    <td v-if="userRole === 'admin'" class="px-4 py-3">
                      <div class="flex justify-center space-x-2">
                        <button @click="saveInlineEdit" class="p-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"><Save class="w-4 h-4" /></button>
                        <button @click="cancelInlineEdit" class="p-2 bg-gray-200 text-gray-600 rounded-md hover:bg-gray-300 transition-colors"><X class="w-4 h-4" /></button>
                      </div>
                    </td>
                  </template>
                  <template v-else>
                    <td class="px-4 py-4"><span class="px-2.5 py-1 bg-gray-100 text-xs font-black text-gray-600 rounded-md">{{ m.tipo }}</span></td>
                    <td class="px-4 py-4"><span class="px-2.5 py-1 bg-emerald-50 text-xs font-black text-emerald-700 rounded-md border border-emerald-100">{{ m.sector || DEFAULT_SECTOR }}</span></td>
                    <td class="px-4 py-4 font-black text-gray-800 text-base">{{ m.maquina }}</td>
                    <td class="px-4 py-4 text-gray-700 font-medium text-sm">{{ m.nombre_maquina }}</td>
                    <td class="px-4 py-4 text-gray-600 font-bold text-sm">{{ m.local_fisico }}</td>
                    <td class="px-4 py-4 text-gray-600 font-bold text-sm">{{ m.lado }}</td>
                    <td class="px-4 py-4 text-gray-500 text-sm">{{ m.modelo || '—' }}</td>
                    <td class="px-4 py-4 text-gray-500 text-sm">{{ m.nro_serie || '—' }}</td>
                    <!-- Columna Activo (solo lectura / toggle admin) -->
                    <td class="px-4 py-4 text-center">
                      <button
                        v-if="userRole === 'admin'"
                        type="button"
                        @click="toggleActivo(m)"
                        :data-tippy-content="(m.activo ?? true) ? 'En producción — clic para desactivar' : 'Fuera de producción — clic para activar'"
                        class="flex items-center gap-2 mx-auto"
                      >
                        <span class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors" :class="(m.activo ?? true) ? 'bg-red-500' : 'bg-gray-300'">
                          <span class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform" :class="(m.activo ?? true) ? 'translate-x-4.5' : 'translate-x-0.5'"></span>
                        </span>
                        <span class="text-[10px] font-black" :class="(m.activo ?? true) ? 'text-emerald-600' : 'text-gray-400'">{{ (m.activo ?? true) ? 'Activa' : 'Inactiva' }}</span>
                      </button>
                      <span v-else :class="(m.activo ?? true) ? 'text-emerald-600' : 'text-gray-400'" class="text-[10px] font-black">{{ (m.activo ?? true) ? 'Activa' : 'Inactiva' }}</span>
                    </td>
                    <td v-if="userRole === 'admin'" class="px-4 py-4">
                      <div class="flex justify-center space-x-2">
                        <button @click="startInlineEdit(m)" class="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"><Edit3 class="w-4 h-4" /></button>
                        <button @click="deleteMaquina(m.id)" class="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 class="w-4 h-4" /></button>
                      </div>
                    </td>
                  </template>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="px-4 py-3 border-t border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div class="text-[11px] text-gray-400 font-bold uppercase tracking-widest">
              {{ filteredMaquinas.length }} máquinas encontradas
            </div>
            
            <!-- Controles de Paginación -->
            <div class="flex items-center space-x-1">
              <button 
                @click="goToFirst" 
                :disabled="currentPage === 1"
                class="p-2 rounded-md hover:bg-white border border-transparent hover:border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-gray-500"
              >
                <ChevronsLeft class="w-4 h-4" />
              </button>
              <button 
                @click="goToPrev" 
                :disabled="currentPage === 1"
                class="p-2 rounded-md hover:bg-white border border-transparent hover:border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-gray-500"
              >
                <ChevronLeft class="w-4 h-4" />
              </button>
              
              <div class="bg-white border border-gray-200 px-3 py-1.5 rounded-lg text-xs font-bold text-gray-600">
                Página {{ currentPage }} de {{ totalPages }}
              </div>

              <button 
                @click="goToNext" 
                :disabled="currentPage === totalPages"
                class="p-2 rounded-md hover:bg-white border border-transparent hover:border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-gray-500"
              >
                <ChevronRight class="w-4 h-4" />
              </button>
              <button 
                @click="goToLast" 
                :disabled="currentPage === totalPages"
                class="p-2 rounded-md hover:bg-white border border-transparent hover:border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-gray-500"
              >
                <ChevronsRight class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        
        <!-- Paginación para Modo Tarjetas -->
        <div v-if="viewMode === 'cards'" class="flex flex-col sm:flex-row items-center justify-between bg-white p-4 rounded-lg shadow-sm border border-gray-100 gap-4 mt-2">
          <div class="text-[11px] text-gray-400 font-bold uppercase tracking-widest">
            {{ filteredMaquinas.length }} máquinas
          </div>
          <div class="flex items-center space-x-1">
            <button @click="goToFirst" :disabled="currentPage === 1" class="p-2 rounded-md hover:bg-gray-50 disabled:opacity-30 text-gray-500 transition-colors border border-gray-100"><ChevronsLeft class="w-4 h-4" /></button>
            <button @click="goToPrev" :disabled="currentPage === 1" class="p-2 rounded-lg hover:bg-gray-50 disabled:opacity-30 text-gray-500 transition-colors border border-gray-100"><ChevronLeft class="w-4 h-4" /></button>
            <div class="px-3 py-1.5 text-xs font-bold text-gray-600">Pág {{ currentPage }} / {{ totalPages }}</div>
            <button @click="goToNext" :disabled="currentPage === totalPages" class="p-2 rounded-lg hover:bg-gray-50 disabled:opacity-30 text-gray-500 transition-colors border border-gray-100"><ChevronRight class="w-4 h-4" /></button>
            <button @click="goToLast" :disabled="currentPage === totalPages" class="p-2 rounded-lg hover:bg-gray-50 disabled:opacity-30 text-gray-500 transition-colors border border-gray-100"><ChevronsRight class="w-4 h-4" /></button>
          </div>
        </div>
      </template>
    </main>

    <!-- Modal -->
    <div v-if="showModal" class="fixed inset-0 z-100 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm overflow-y-auto">
      <div class="bg-white rounded-lg w-full max-w-lg shadow-2xl overflow-hidden my-auto">
        <div class="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div>
            <h3 class="text-xl font-black text-gray-800 tracking-tight">{{ isEditing ? 'Editar máquina' : 'Nueva máquina' }}</h3>
            <p class="text-xs text-gray-500 font-bold tracking-widest mt-1">Completa los campos técnicos</p>
          </div>
          <button @click="closeModal" class="p-2 hover:bg-gray-200 rounded-lg transition-colors"><X class="w-6 h-6 text-gray-500" /></button>
        </div>
        <form @submit.prevent="handleSubmit" class="p-5 space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-gray-500 ml-1">Tipo</label>
              <select v-model="form.tipo" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 outline-none">
                <option v-for="t in tiposOptions" :key="t">{{ t }}</option>
              </select>
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-gray-500 ml-1">Sector</label>
              <select v-model="form.sector" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 outline-none">
                <option v-for="s in SECTOR_OPTIONS" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-bold text-gray-500 ml-1">ID Máquina</label>
            <input v-model="form.maquina" type="number" required class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-bold text-gray-500 ml-1">Nombre descriptivo</label>
            <input v-model="form.nombre_maquina" type="text" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-gray-500 ml-1">Local físico</label>
              <input v-model="form.local_fisico" type="text" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 outline-none" />
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-gray-500 ml-1">Lado</label>
              <select v-model="form.lado" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 outline-none">
                <option value="U">Único (U)</option><option value="A">Lado A</option><option value="B">Lado B</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-gray-400 ml-1">Modelo (Opcional)</label>
              <input v-model="form.modelo" type="text" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-base outline-none" />
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-gray-400 ml-1">Serie (Opcional)</label>
              <input v-model="form.nro_serie" type="text" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-base outline-none" />
            </div>
          </div>
          <!-- Toggle Activo en Modal (estilo "Crítico") -->
          <div class="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-200">
            <div>
              <p class="text-sm font-bold text-gray-700">Estado en producción</p>
              <p class="text-xs text-gray-400 font-medium">Define si la máquina está operativa</p>
            </div>
            <button type="button" @click="form.activo = !form.activo" class="flex items-center gap-2">
              <span class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200" :class="form.activo ? 'bg-red-500' : 'bg-gray-300'">
                <span class="inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200" :class="form.activo ? 'translate-x-5.5' : 'translate-x-0.5'"></span>
              </span>
              <span class="text-sm font-black min-w-16" :class="form.activo ? 'text-emerald-600' : 'text-gray-400'">{{ form.activo ? 'Activa' : 'Inactiva' }}</span>
            </button>
          </div>

          <div class="pt-4 flex space-x-3">
            <button @click="closeModal" type="button" class="flex-1 py-3.5 border border-gray-200 rounded-xl font-bold text-base text-gray-500 hover:bg-gray-50 transition-colors">Cancelar</button>
            <button type="submit" class="flex-2 py-3.5 bg-indigo-600 text-white rounded-xl font-bold text-base shadow-md hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center space-x-2">
              <Check class="w-6 h-6" /><span>Guardar cambios</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
