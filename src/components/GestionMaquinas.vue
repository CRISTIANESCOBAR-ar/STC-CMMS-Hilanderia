```
<script setup>
import { ref, onMounted, computed } from 'vue';
import { maquinaService } from '../services/maquinaService';
import { authService, userRole } from '../services/authService';
import { Plus, Search, Edit3, Trash2, X, Check, Settings2, LayoutGrid, Table2, Save, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileSpreadsheet } from 'lucide-vue-next';
import Swal from 'sweetalert2';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/shift-away.css';

const maquinas = ref([]);
const isLoading = ref(true);
const searchQuery = ref('');
const showModal = ref(false);
const isEditing = ref(false);
const viewMode = ref('cards');

const editingRowId = ref(null);
const editingRow = ref({});

const initialForm = { id: null, unidad: 5, maquina: '', local_fisico: '', nro_tipo: '', tipo: 'CARDA', nombre_maquina: '', lado: 'U', modelo: '', nro_serie: '' };
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

// Resetear página al buscar
import { watch } from 'vue';
watch(searchQuery, () => { currentPage.value = 1; });

onMounted(() => {
  maquinaService.obtenerMaquinas((data) => {
    maquinas.value = data;
    isLoading.value = false;
  });
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
  const query = searchQuery.value.toLowerCase();
  return maquinas.value.filter(m =>
    String(m.maquina).toLowerCase().includes(query) ||
    m.tipo.toLowerCase().includes(query) ||
    m.nombre_maquina?.toLowerCase().includes(query)
  );
});

const openAddModal = () => { isEditing.value = false; form.value = { ...initialForm }; showModal.value = true; };
const openEditModal = (maquina) => { isEditing.value = true; form.value = { ...maquina }; showModal.value = true; };
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

const startInlineEdit = (maquina) => { editingRowId.value = maquina.id; editingRow.value = { ...maquina }; };
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

const tiposOptions = ['APERTURA', 'CARDA', 'MANUAR', 'OPEN END', 'FILTRO', 'OTRO'];

const exportToExcel = async () => {
  if (filteredMaquinas.value.length === 0) return;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Catálogo de Máquinas');

  // Configurar Columnas
  worksheet.columns = [
    { header: 'TIPO', key: 'tipo', width: 15 },
    { header: 'ID MÁQ', key: 'maquina', width: 10 },
    { header: 'NOMBRE', key: 'nombre_maquina', width: 30 },
    { header: 'LOCAL', key: 'local_fisico', width: 10 },
    { header: 'LADO', key: 'lado', width: 8 },
    { header: 'MODELO', key: 'modelo', width: 20 },
    { header: 'SERIE', key: 'nro_serie', width: 20 }
  ];

  // Agregar Datos
  filteredMaquinas.value.forEach(m => {
    worksheet.addRow({
      tipo: m.tipo,
      maquina: m.maquina,
      nombre_maquina: m.nombre_maquina || '---',
      local_fisico: m.local_fisico,
      lado: m.lado,
      modelo: m.modelo || '---',
      nro_serie: m.nro_serie || '---'
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
  worksheet.autoFilter = 'A1:G1';

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
              <h1 class="text-sm font-black text-white uppercase tracking-tight leading-none">Gestión de Máquinas</h1>
              <p class="text-[8px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">Catálogo</p>
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
            <div class="flex border border-gray-700 rounded-md overflow-hidden bg-gray-800">
              <button @click="viewMode = 'cards'" :class="viewMode === 'cards' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-700'" class="flex items-center gap-1 px-2.5 py-1.5 text-[9px] font-black transition-colors">
                <LayoutGrid class="w-3.5 h-3.5" /><span>TARJETAS</span>
              </button>
              <button @click="viewMode = 'table'" :class="viewMode === 'table' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-700'" class="flex items-center gap-1 px-2.5 py-1.5 text-[9px] font-black transition-colors border-l border-gray-700">
                <Table2 class="w-3.5 h-3.5" /><span>TABLA</span>
              </button>
            </div>
            <button 
              v-if="userRole === 'admin'"
              @click="openAddModal" 
              class="flex items-center space-x-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-black shadow-lg shadow-indigo-900/40 transition-all active:scale-95 text-[10px] uppercase"
            >
              <Plus class="w-3.5 h-3.5" /><span>AGREGAR</span>
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

      <!-- Header Local (Solo Móvil) - Sticky -->
      <div class="lg:hidden bg-white/95 backdrop-blur-sm p-2 rounded-xl shadow-md border border-gray-100 shrink-0 space-y-2 sticky top-0 z-20">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <div class="bg-indigo-600 p-1.5 rounded-lg text-white">
              <Settings2 class="w-4 h-4" />
            </div>
            <h1 class="text-sm font-black text-gray-800 uppercase tracking-tight">Gestión</h1>
          </div>
          <div class="flex items-center gap-1.5">
            <button @click="exportToExcel" class="bg-emerald-600 text-white p-1.5 rounded-lg shadow-lg shadow-emerald-900/20 active:scale-90 transition-all"><FileSpreadsheet class="w-4 h-4" /></button>
            <button v-if="userRole === 'admin'" @click="openAddModal" class="bg-indigo-600 text-white p-1.5 rounded-lg shadow-lg shadow-indigo-900/20 active:scale-90 transition-all"><Plus class="w-4 h-4" /></button>
          </div>
        </div>
        
        <div class="relative">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input v-model="searchQuery" type="text" placeholder="Buscar..." class="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-100 rounded-lg text-xs outline-none" />
        </div>

        <div class="flex border border-gray-200 rounded-md overflow-hidden h-9">
          <button @click="viewMode = 'cards'" :class="viewMode === 'cards' ? 'bg-indigo-600 text-white' : 'text-gray-500 bg-white'" class="flex-1 flex items-center justify-center gap-2 text-[10px] font-bold italic transition-colors">
            <LayoutGrid class="w-4 h-4" />TARJETAS
          </button>
          <button @click="viewMode = 'table'" :class="viewMode === 'table' ? 'bg-indigo-600 text-white' : 'text-gray-500 bg-white'" class="flex-1 flex items-center justify-center gap-2 text-[10px] font-bold italic transition-colors border-l border-gray-200">
            <Table2 class="w-4 h-4" />TABLA
          </button>
        </div>
      </div>

      <div v-if="isLoading" class="flex-1 flex flex-col items-center justify-center text-gray-400">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>
        <p class="font-bold text-xs uppercase tracking-widest">Cargando catálogo...</p>
      </div>

      <template v-else>
        <div v-if="viewMode === 'cards'" class="flex-1 overflow-y-auto pr-1">
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
            <div v-for="m in paginatedMaquinas" :key="m.id" class="bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex justify-between items-start group hover:border-indigo-200 transition-all">
              <div class="space-y-1">
                <div class="flex items-center space-x-2">
                  <span class="px-2 py-0.5 bg-gray-100 text-[10px] font-black text-gray-500 rounded uppercase">{{ m.tipo }}</span>
                  <span class="text-base font-black text-gray-800">{{ m.maquina }}</span>
                </div>
                <p class="text-sm font-bold text-gray-600">{{ m.nombre_maquina || 'Sin nombre' }}</p>
                <div class="flex space-x-3 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                  <span>Local: {{ m.local_fisico }}</span><span>Lado: {{ m.lado }}</span>
                </div>
              </div>
              <div v-if="userRole === 'admin'" class="flex space-x-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                <button @click="openEditModal(m)" class="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"><Edit3 class="w-3.5 h-3.5" /></button>
                <button @click="deleteMaquina(m.id)" class="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors"><Trash2 class="w-3.5 h-3.5" /></button>
              </div>
            </div>
          </div>
        </div>

        <!-- TABLA INLINE (Ocupa todo el alto) -->
        <div v-else class="flex-1 bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-0">
          <div class="overflow-auto flex-1 min-h-0">
            <table class="w-full text-sm text-left border-collapse">
              <thead class="sticky top-0 z-20 bg-gray-50 border-b border-gray-100 text-[11px] font-black text-gray-500 uppercase tracking-widest shadow-sm">
                <tr>
                  <th class="px-4 py-3 bg-gray-50 w-[120px]">Tipo</th>
                  <th class="px-4 py-3 bg-gray-50 w-[100px]">ID Máq.</th>
                  <th class="px-4 py-3 bg-gray-50 min-w-[200px]">Nombre</th>
                  <th class="px-4 py-3 bg-gray-50 w-[80px]">Local</th>
                  <th class="px-4 py-3 bg-gray-50 w-[80px]">Lado</th>
                  <th class="px-4 py-3 bg-gray-50 w-[120px]">Modelo</th>
                  <th class="px-4 py-3 bg-gray-50 w-[120px]">Serie</th>
                  <th v-if="userRole === 'admin'" class="px-4 py-3 text-center bg-gray-50 w-[100px]">Acciones</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <tr v-for="m in paginatedMaquinas" :key="m.id" :class="editingRowId === m.id ? 'bg-indigo-50' : 'hover:bg-gray-50/50'" class="transition-colors">
                  <template v-if="editingRowId === m.id">
                    <td class="px-2 py-1.5"><select v-model="editingRow.tipo" class="w-full bg-white border border-indigo-300 rounded px-2 py-1 text-xs outline-none"><option v-for="t in tiposOptions" :key="t">{{ t }}</option></select></td>
                    <td class="px-2 py-1.5"><input v-model="editingRow.maquina" type="number" class="w-20 bg-white border border-indigo-300 rounded px-2 py-1 text-xs outline-none" /></td>
                    <td class="px-2 py-1.5"><input v-model="editingRow.nombre_maquina" type="text" class="w-full min-w-[140px] bg-white border border-indigo-300 rounded px-2 py-1 text-xs outline-none" /></td>
                    <td class="px-2 py-1.5"><input v-model="editingRow.local_fisico" type="text" class="w-14 bg-white border border-indigo-300 rounded px-2 py-1 text-xs outline-none" /></td>
                    <td class="px-2 py-1.5"><select v-model="editingRow.lado" class="bg-white border border-indigo-300 rounded px-2 py-1 text-xs outline-none"><option value="U">U</option><option value="A">A</option><option value="B">B</option></select></td>
                    <td class="px-2 py-1.5"><input v-model="editingRow.modelo" type="text" class="w-full bg-white border border-indigo-300 rounded px-2 py-1 text-xs outline-none" /></td>
                    <td class="px-2 py-1.5"><input v-model="editingRow.nro_serie" type="text" class="w-full bg-white border border-indigo-300 rounded px-2 py-1 text-xs outline-none" /></td>
                    <td v-if="userRole === 'admin'" class="px-2 py-1.5">
                      <div class="flex justify-center space-x-1">
                        <button @click="saveInlineEdit" class="p-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"><Save class="w-3.5 h-3.5" /></button>
                        <button @click="cancelInlineEdit" class="p-1.5 bg-gray-200 text-gray-600 rounded-md hover:bg-gray-300 transition-colors"><X class="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </template>
                  <template v-else>
                    <td class="px-2 py-2"><span class="px-2 py-0.5 bg-gray-100 text-[10px] font-black text-gray-600 rounded uppercase">{{ m.tipo }}</span></td>
                    <td class="px-2 py-2 font-bold text-gray-800">{{ m.maquina }}</td>
                    <td class="px-2 py-2 text-gray-600">{{ m.nombre_maquina }}</td>
                    <td class="px-2 py-2 text-gray-500 font-bold">{{ m.local_fisico }}</td>
                    <td class="px-2 py-2 text-gray-500 font-bold">{{ m.lado }}</td>
                    <td class="px-2 py-2 text-gray-400 text-xs">{{ m.modelo || '—' }}</td>
                    <td class="px-2 py-2 text-gray-400 text-xs">{{ m.nro_serie || '—' }}</td>
                    <td v-if="userRole === 'admin'" class="px-2 py-2">
                      <div class="flex justify-center space-x-1">
                        <button @click="startInlineEdit(m)" class="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"><Edit3 class="w-3.5 h-3.5" /></button>
                        <button @click="deleteMaquina(m.id)" class="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors"><Trash2 class="w-3.5 h-3.5" /></button>
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
    <div v-if="showModal" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm overflow-y-auto">
      <div class="bg-white rounded-lg w-full max-w-lg shadow-2xl overflow-hidden my-auto">
        <div class="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div>
            <h3 class="text-base font-black text-gray-800 uppercase tracking-tight">{{ isEditing ? 'Editar Máquina' : 'Nueva Máquina' }}</h3>
            <p class="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Completa los campos técnicos</p>
          </div>
          <button @click="closeModal" class="p-1.5 hover:bg-gray-200 rounded-md transition-colors"><X class="w-5 h-5 text-gray-500" /></button>
        </div>
        <form @submit.prevent="handleSubmit" class="p-4 space-y-2">
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="text-[10px] font-bold text-gray-500 uppercase ml-1">Tipo</label>
              <select v-model="form.tipo" class="w-full bg-gray-50 border border-gray-200 p-2 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                <option v-for="t in tiposOptions" :key="t">{{ t }}</option>
              </select>
            </div>
            <div class="space-y-1">
              <label class="text-[10px] font-bold text-gray-500 uppercase ml-1">ID Máquina</label>
              <input v-model="form.maquina" type="number" required class="w-full bg-gray-50 border border-gray-200 p-2 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            </div>
          </div>
          <div class="space-y-1">
            <label class="text-[10px] font-bold text-gray-500 uppercase ml-1">Nombre Descriptivo</label>
            <input v-model="form.nombre_maquina" type="text" class="w-full bg-gray-50 border border-gray-200 p-2 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="text-[10px] font-bold text-gray-500 uppercase ml-1">Local Físico</label>
              <input v-model="form.local_fisico" type="text" class="w-full bg-gray-50 border border-gray-200 p-2 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            </div>
            <div class="space-y-1">
              <label class="text-[10px] font-bold text-gray-500 uppercase ml-1">Lado</label>
              <select v-model="form.lado" class="w-full bg-gray-50 border border-gray-200 p-2 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                <option value="U">Único (U)</option><option value="A">Lado A</option><option value="B">Lado B</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="text-[10px] font-bold text-gray-400 uppercase ml-1">Modelo (Opcional)</label>
              <input v-model="form.modelo" type="text" class="w-full bg-gray-50 border border-gray-200 p-2 rounded-lg text-sm outline-none" />
            </div>
            <div class="space-y-1">
              <label class="text-[10px] font-bold text-gray-400 uppercase ml-1">Serie (Opcional)</label>
              <input v-model="form.nro_serie" type="text" class="w-full bg-gray-50 border border-gray-200 p-2 rounded-lg text-sm outline-none" />
            </div>
          </div>
          <div class="pt-3 flex space-x-2">
            <button @click="closeModal" type="button" class="flex-1 py-2.5 border border-gray-200 rounded-md font-bold text-sm text-gray-500 hover:bg-gray-50 transition-colors">CANCELAR</button>
            <button type="submit" class="flex-[2] py-2.5 bg-indigo-600 text-white rounded-lg font-bold text-sm shadow-md hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center space-x-2">
              <Check class="w-5 h-5" /><span>GUARDAR CAMBIOS</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
