<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { authService, userRole } from '../services/authService';
import { mantenimientoService } from '../services/mantenimientoService';
import { 
  Clock, 
  AlertTriangle, 
  CheckCircle, 
  ChevronLeft, 
  ChevronRight, 
  ChevronsLeft,
  ChevronsRight,
  Search,
  Filter,
  Image as ImageIcon,
  History,
  FileSpreadsheet
} from 'lucide-vue-next';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/shift-away.css';

const novedades = ref([]);
const isLoading = ref(true);
const errorCarga = ref(false);
let unsubscribe = null;

// Paginación y Filtros
const itemsPerPage = ref(25);
const currentPage = ref(1);
const searchQuery = ref('');
const statusFilter = ref('todos');

let timeoutId = null;

const cargarDatos = () => {
  isLoading.value = true;
  errorCarga.value = false;

  if (unsubscribe) unsubscribe();
  if (timeoutId) clearTimeout(timeoutId);

  timeoutId = setTimeout(() => {
    if (isLoading.value) {
      errorCarga.value = true;
      isLoading.value = false;
    }
  }, 10000);

  unsubscribe = mantenimientoService.obtenerHistorico(
    (data) => {
      if (timeoutId) clearTimeout(timeoutId);
      novedades.value = data;
      isLoading.value = false;
    },
    (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      errorCarga.value = true;
      isLoading.value = false;
    }
  );
};

onMounted(() => {
  cargarDatos();
  // Inicializar tooltips con un pequeño delay para asegurar que los elementos Teleport estén listos
  setTimeout(() => {
    tippy('[data-tippy-content]', {
      animation: 'shift-away',
      theme: 'translucent',
      duration: [200, 150]
    });
  }, 500);
});

onUnmounted(() => {
  if (unsubscribe) unsubscribe();
  if (timeoutId) clearTimeout(timeoutId);
});

const novedadesFiltradas = computed(() => {
  const search = searchQuery.value.toLowerCase();
  return novedades.value.filter(n => {
    const numMaq = String(n.numeroMaquina || '').toLowerCase();
    const tipoMaq = String(n.tipoMaquina || '').toLowerCase();
    const obs = String(n.observaciones || '').toLowerCase();
    const matchesSearch = numMaq.includes(search) || tipoMaq.includes(search) || obs.includes(search);
    const matchesStatus = statusFilter.value === 'todos' || n.estado === statusFilter.value;
    return matchesSearch && matchesStatus;
  });
});

watch([searchQuery, statusFilter], () => {
  currentPage.value = 1;
});

const totalPages = computed(() => Math.ceil(novedadesFiltradas.value.length / itemsPerPage.value) || 1);
const paginatedNovedades = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  return novedadesFiltradas.value.slice(start, start + itemsPerPage.value);
});

const goToFirst = () => { currentPage.value = 1; };
const goToPrev = () => { if (currentPage.value > 1) currentPage.value--; };
const goToNext = () => { if (currentPage.value < totalPages.value) currentPage.value++; };
const goToLast = () => { currentPage.value = totalPages.value; };

const exportToExcel = async () => {
  if (novedadesFiltradas.value.length === 0) return;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Historial Novedades');

  // Configurar Columnas
  worksheet.columns = [
    { header: 'FECHA', key: 'fecha', width: 22 },
    { header: 'TIPO', key: 'tipo', width: 15 },
    { header: 'MÁQUINA', key: 'maquina', width: 12 },
    { header: 'LADO', key: 'lado', width: 8 },
    { header: 'OBSERVACIONES', key: 'observaciones', width: 60 },
    { header: 'ESTADO', key: 'estado', width: 15 }
  ];

  // Agregar Datos
  novedadesFiltradas.value.forEach(n => {
    worksheet.addRow({
      fecha: formatDate(n.createdAt),
      tipo: n.tipoMaquina,
      maquina: n.numeroMaquina,
      lado: n.lado,
      observaciones: n.observaciones,
      estado: n.estado.toUpperCase()
    });
  });

  // Estilo de Encabezado
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2563EB' } // Blue-600
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
        cell.alignment = { wrapText: true, vertical: 'middle' };
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
  worksheet.autoFilter = 'A1:F1';

  // Generar y Descargar
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `Historial_STC_${new Date().toISOString().split('T')[0]}.xlsx`);
};

const formatDate = (val) => {
  if (!val) return '---';
  let date;
  if (typeof val.toDate === 'function') date = val.toDate();
  else if (val instanceof Date) date = val;
  else if (typeof val === 'number' || typeof val === 'string') date = new Date(val);
  else return '---';

  return date.toLocaleString('es-AR', { 
    day: '2-digit', month: '2-digit', year: '2-digit', 
    hour: '2-digit', minute: '2-digit' 
  });
};

const getStatusClass = (estado) => {
  switch (estado) {
    case 'pendiente': return 'bg-red-100 text-red-700 border-red-200';
    case 'en proceso': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    case 'resuelto': return 'bg-green-100 text-green-700 border-green-200';
    default: return 'bg-gray-100 text-gray-700';
  }
};
</script>

<template>
  <div class="h-[calc(100vh-64px)] bg-gray-50 flex flex-col overflow-hidden">
    <main class="flex-1 max-w-7xl mx-auto w-full px-2 pt-0 lg:pt-4 pb-2 flex flex-col space-y-1 lg:space-y-3 overflow-hidden">
      
      <!-- Portal para Navbar (Desktop) -->
      <Teleport to="#navbar-actions">
        <div class="flex items-center w-full gap-4">
          <!-- Título (Desktop) -->
          <div class="flex items-center space-x-3 shrink-0">
            <div class="bg-blue-600 p-1.5 rounded-lg text-white">
              <History class="w-4 h-4" />
            </div>
            <div class="hidden xl:block text-white">
              <h1 class="text-sm font-black uppercase tracking-tight leading-none">Histórico</h1>
              <p class="text-[8px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">Novedades</p>
            </div>
          </div>

          <!-- Buscador (Desktop) -->
          <div class="relative flex-1 max-w-md mx-auto">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input 
              v-model="searchQuery" 
              type="text" 
              placeholder="Buscar máquina o falla..." 
              class="w-full pl-9 pr-4 py-1.5 bg-gray-800 border border-gray-700 focus:bg-gray-700 focus:border-blue-500 rounded-lg text-xs text-gray-200 outline-none transition-all placeholder:text-gray-500" 
            />
          </div>

          <!-- Filtro (Desktop) -->
          <div class="flex items-center gap-2 shrink-0">
            <select 
              v-model="statusFilter"
              class="bg-gray-800 border border-gray-700 text-gray-300 text-[10px] font-bold uppercase rounded-lg px-3 py-1.5 focus:border-blue-500 outline-none transition-all"
            >
              <option value="todos">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="en proceso">En proceso</option>
              <option value="resuelto">Resuelto</option>
            </select>
            
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
      
      <!-- Portal para Navbar (Mobile) -->
      <Teleport to="#navbar-mobile-portal">
        <div class="flex items-center gap-2">
          <h1 class="text-xs font-black text-white uppercase tracking-tighter shrink-0">Histórico</h1>
          <div class="flex items-center gap-1">
             <button @click="exportToExcel" class="bg-emerald-600 text-white p-1 rounded-md active:scale-90 transition-all"><FileSpreadsheet class="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </Teleport>

      <!-- Header Local (Solo Móvil) - Compacto -->
      <div class="lg:hidden bg-white/95 backdrop-blur-sm p-1.5 rounded-xl shadow-md border border-gray-100 shrink-0 sticky top-0 z-20">
        <div class="flex items-center gap-2">
          <div class="relative flex-1">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input v-model="searchQuery" type="text" placeholder="Buscar..." class="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-100 rounded-lg text-xs outline-none focus:ring-1 focus:ring-blue-500/20" />
          </div>
          <select v-model="statusFilter" class="bg-gray-50 border border-gray-100 text-[10px] font-black uppercase rounded-lg px-2 py-1.5 outline-none focus:border-blue-500">
            <option value="todos">Todos</option>
            <option value="pendiente">Pendiente</option>
            <option value="en proceso">En proceso</option>
            <option value="resuelto">Resuelto</option>
          </select>
        </div>
      </div>

      <!-- Contenido Principal -->
      <div v-if="isLoading" class="flex-1 flex flex-col items-center justify-center text-gray-400">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
        <p class="font-bold text-xs uppercase tracking-widest text-gray-400">Cargando historial...</p>
      </div>

      <div v-else-if="errorCarga" class="flex-1 flex flex-col items-center justify-center text-center p-8">
        <AlertTriangle class="w-12 h-12 text-red-300 mb-3" />
        <h2 class="font-black text-gray-800 uppercase text-sm">Error de conexión</h2>
        <button @click="cargarDatos" class="mt-4 px-6 py-2 bg-red-600 text-white rounded-lg text-xs font-black shadow-lg">REINTENTAR</button>
      </div>

      <div v-else-if="novedadesFiltradas.length === 0" class="flex-1 flex flex-col items-center justify-center text-center p-8 bg-white rounded-lg border border-gray-100">
        <CheckCircle class="w-12 h-12 text-gray-200 mb-3" />
        <p class="text-xs font-bold text-gray-400 uppercase tracking-widest">Sin resultados</p>
      </div>

      <template v-else>
        <!-- TABLA DESKTOP -->
        <div class="hidden md:flex flex-1 flex-col bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden min-h-0">
          <div class="overflow-auto flex-1 min-h-0">
            <table class="w-full text-left border-collapse">
              <thead class="sticky top-0 bg-gray-50 z-20 shadow-sm border-b border-gray-100">
                <tr class="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  <th class="px-4 py-3 bg-gray-50">Fecha</th>
                  <th class="px-4 py-3 bg-gray-50">Máquina</th>
                  <th class="px-4 py-3 bg-gray-50">Lado</th>
                  <th class="px-4 py-3 bg-gray-50">Observaciones</th>
                  <th class="px-4 py-3 bg-gray-50">Estado</th>
                  <th class="px-4 py-3 bg-gray-50 text-center">Foto</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <tr v-for="n in paginatedNovedades" :key="n.id" class="hover:bg-blue-50/50 transition-colors group">
                  <td class="px-4 py-3 text-[10px] font-bold text-gray-400 whitespace-nowrap">{{ formatDate(n.createdAt) }}</td>
                  <td class="px-4 py-3">
                    <div class="flex flex-col">
                      <span class="text-sm font-black text-gray-800">{{ n.numeroMaquina }}</span>
                      <span class="text-[9px] text-gray-400 font-bold uppercase tracking-tighter">{{ n.tipoMaquina }}</span>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-xs font-black text-gray-600">{{ n.lado }}</td>
                  <td class="px-4 py-3">
                    <p class="text-xs text-gray-600 line-clamp-2 max-w-sm group-hover:line-clamp-none transition-all">{{ n.observaciones }}</p>
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center space-x-1">
                      <span 
                        :class="getStatusClass(n.estado)"
                        class="px-2.5 py-1 rounded text-[9px] font-black uppercase border whitespace-nowrap"
                      >
                        {{ n.estado }}
                      </span>
                      <!-- Solo Admin puede cambiar estado (Mecánico solo lee) -->
                      <button 
                        v-if="userRole === 'admin'"
                        @click="cambiarEstado(n)" 
                        class="p-1 hover:bg-gray-100 rounded-md transition-colors"
                      >
                        <RefreshCw class="w-3 h-3 text-gray-400" />
                      </button>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-center">
                    <a v-if="n.fotoUrl" :href="n.fotoUrl" target="_blank" class="p-1.5 bg-gray-100 text-gray-500 hover:bg-blue-600 hover:text-white rounded-md inline-flex transition-all">
                      <ImageIcon class="w-3.5 h-3.5" />
                    </a>
                    <span v-else class="text-[9px] text-gray-300 font-bold uppercase">---</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <!-- Paginación Desktop -->
          <div class="px-4 py-2 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between shrink-0">
            <span class="text-[10px] text-gray-400 font-black uppercase tracking-widest">{{ novedadesFiltradas.length }} registros</span>
            <div class="flex items-center space-x-1">
              <button @click="goToFirst" :disabled="currentPage === 1" class="p-1.5 rounded-md hover:bg-white disabled:opacity-30 text-gray-500 border border-transparent hover:border-gray-200 transition-all"><ChevronsLeft class="w-4 h-4" /></button>
              <button @click="goToPrev" :disabled="currentPage === 1" class="p-1.5 rounded-md hover:bg-white disabled:opacity-30 text-gray-500 border border-transparent hover:border-gray-200 transition-all"><ChevronLeft class="w-4 h-4" /></button>
              <div class="px-3 text-xs font-black text-gray-600">Pág {{ currentPage }} / {{ totalPages }}</div>
              <button @click="goToNext" :disabled="currentPage === totalPages" class="p-1.5 rounded-md hover:bg-white disabled:opacity-30 text-gray-500 border border-transparent hover:border-gray-200 transition-all"><ChevronRight class="w-4 h-4" /></button>
              <button @click="goToLast" :disabled="currentPage === totalPages" class="p-1.5 rounded-md hover:bg-white disabled:opacity-30 text-gray-500 border border-transparent hover:border-gray-200 transition-all"><ChevronsRight class="w-4 h-4" /></button>
            </div>
          </div>
        </div>

        <!-- TARJETAS MÓVIL (Con Scroll) -->
        <div class="md:hidden flex-1 overflow-y-auto pr-1 space-y-3">
          <div v-for="n in paginatedNovedades" :key="n.id" class="bg-white p-3 rounded-xl shadow-sm border border-gray-100 space-y-2">
            <div class="flex justify-between items-start">
              <span class="text-xs font-black text-gray-800 uppercase">{{ n.numeroMaquina }} ({{ n.lado }})</span>
              <span class="text-[9px] font-bold text-gray-400 uppercase">{{ formatDate(n.createdAt) }}</span>
            </div>
            <p class="text-xs text-gray-600 bg-gray-50 p-2 rounded-lg border border-gray-100 italic">"{{ n.observaciones }}"</p>
            <div class="flex items-center justify-between pt-1">
              <span class="px-2 py-0.5 text-[8px] font-black uppercase rounded-md border" :class="getStatusClass(n.estado)">{{ n.estado }}</span>
              <a v-if="n.fotoUrl" :href="n.fotoUrl" target="_blank" class="flex items-center text-[9px] font-black text-blue-600 uppercase tracking-widest">
                <ImageIcon class="w-3 h-3 mr-1" /> FOTO
              </a>
            </div>
          </div>
          
          <!-- Paginación Móvil -->
          <div class="flex items-center justify-center space-x-2 py-2">
            <button @click="goToPrev" :disabled="currentPage === 1" class="p-2 bg-white rounded-lg border border-gray-200 disabled:opacity-30"><ChevronLeft class="w-4 h-4" /></button>
            <span class="text-xs font-black text-gray-600">{{ currentPage }} / {{ totalPages }}</span>
            <button @click="goToNext" :disabled="currentPage === totalPages" class="p-2 bg-white rounded-lg border border-gray-200 disabled:opacity-30"><ChevronRight class="w-4 h-4" /></button>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
/* Elimina scrollbars pero permite scroll si es necesario (o deja el nativo moderno) */
main {
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
}
</style>
