<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { authService, userRole, userProfile } from '../services/authService';
import { aiService } from '../services/aiService';
import { db } from '../firebase/config';
import { collection, getDocs, query } from 'firebase/firestore';
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
  FileSpreadsheet,
  Sparkles,
  Copy,
  ChevronUp,
  ChevronDown
} from 'lucide-vue-next';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import Swal from 'sweetalert2';
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/shift-away.css';
import { DEFAULT_SECTOR, normalizeSectorValue, sanitizeSectorList } from '../constants/organization';

const novedades = ref([]);
const isLoading = ref(true);
const errorCarga = ref(false);
let unsubscribe = null;

// Paginación y Filtros
const itemsPerPage = ref(25);
const currentPage = ref(1);
const searchQuery = ref('');
const statusFilter = ref('todos');
const filterDate = ref(''); // YYYY-MM-DD

// Estado IA
const iaSummary = ref('');
const iaSummaryRaw = ref('');
const isIaLoading = ref(false);
const iaError = ref(false);
const iaFromCache = ref(false);
const iaCollapsed = ref(false);

let timeoutId = null;

const sectoresVisibles = computed(() => {
  const perfil = userProfile.value;
  if (!perfil) return [DEFAULT_SECTOR];
  if (perfil.role === 'admin' && perfil.alcance === 'global') return null;
  if (perfil.role === 'jefe_sector') {
    const sectoresJefe = perfil.jefeDeSectores?.length ? perfil.jefeDeSectores : perfil.sectoresAsignados;
    return sanitizeSectorList(sectoresJefe, perfil.sectorDefault);
  }
  return sanitizeSectorList(perfil.sectoresAsignados, perfil.sectorDefault);
});

const cargarDatos = async () => {
  isLoading.value = true;
  errorCarga.value = false;

  timeoutId = setTimeout(() => {
    if (isLoading.value && novedades.value.length === 0) {
      errorCarga.value = true;
      isLoading.value = false;
    }
  }, 10000);

  try {
    const q = query(collection(db, 'novedades'));
    const snapshot = await getDocs(q);
    clearTimeout(timeoutId);

    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Ordenar por fecha descendente
    const ordenadas = data.sort((a, b) => {
      const getTime = (val) => {
        if (!val) return 0;
        if (typeof val.toMillis === 'function') return val.toMillis();
        return new Date(val).getTime() || 0;
      };
      return getTime(b.createdAt) - getTime(a.createdAt);
    });

    if (sectoresVisibles.value === null) {
      novedades.value = ordenadas;
    } else {
      novedades.value = ordenadas.filter((n) => sectoresVisibles.value.includes(normalizeSectorValue(n.sector || DEFAULT_SECTOR)));
    }

    isLoading.value = false;
    errorCarga.value = false;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("Error obteniendo histórico:", err);
    if (novedades.value.length === 0) {
      errorCarga.value = true;
    }
    isLoading.value = false;
  }
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
    
    let matchesDate = true;
    if (filterDate.value && n.createdAt) {
      let dateObj;
      if (typeof n.createdAt.toDate === 'function') dateObj = n.createdAt.toDate();
      else dateObj = new Date(n.createdAt);
      
      const yyyy = dateObj.getFullYear();
      const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
      const dd = String(dateObj.getDate()).padStart(2, '0');
      matchesDate = `${yyyy}-${mm}-${dd}` === filterDate.value;
    }
    
    return matchesSearch && matchesStatus && matchesDate;
  });
});

watch([searchQuery, statusFilter], () => {
  currentPage.value = 1;
});

watch(filterDate, (newVal) => {
  currentPage.value = 1;
  if (newVal) {
    cargarAnalisisIA();
  } else {
    iaSummary.value = '';
    iaSummaryRaw.value = '';
  }
});

const cargarAnalisisIA = async (forceRegenerate = false) => {
  if (!filterDate.value) return;
  isIaLoading.value = true;
  iaError.value = false;
  try {
    const response = await aiService.generarResumenDiario(forceRegenerate, filterDate.value);
    iaSummaryRaw.value = response.text;
    iaSummary.value = formatMarkdown(response.text);
    iaFromCache.value = response.fromCache;
  } catch (error) {
    console.error("No se pudo cargar análisis de IA", error);
    iaError.value = true;
  } finally {
    isIaLoading.value = false;
  }
};

const formatMarkdown = (text) => {
  if (!text) return '';
  return text.replace(/\*(.*?)\*/g, '<b>$1</b>').replace(/_(.*?)_/g, '<i>$1</i>').replace(/\n/g, '<br/>');
};

const copiarWhatsApp = () => {
  if (!iaSummaryRaw.value) return;
  navigator.clipboard.writeText(iaSummaryRaw.value).then(() => {
    Swal.fire({ icon: 'success', title: '¡Copiado!', text: 'El reporte está listo para pegar en WhatsApp.', timer: 2000, showConfirmButton: false, toast: true, position: 'top-end' });
  });
};

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
    let obsText = n.observaciones;
    if (n.seccion || n.denominacion) {
      obsText += ` \n[Punto: ${n.denominacion || n.seccion}`;
      if (n.numeroArticulo && n.numeroArticulo !== '-') obsText += ` | Art: ${n.numeroArticulo}`;
      if (n.numeroCatalogo && n.numeroCatalogo !== '-') obsText += ` | Cat: ${n.numeroCatalogo}`;
      obsText += `]`;
    }

    worksheet.addRow({
      fecha: formatDate(n.createdAt),
      tipo: n.tipoMaquina,
      maquina: n.numeroMaquina,
      lado: n.lado,
      observaciones: obsText,
      estado: n.estado
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
              <h1 class="text-sm font-black tracking-tight leading-none">Histórico</h1>
              <p class="text-[8px] text-gray-400 font-bold tracking-widest mt-0.5">Novedades</p>
            </div>
          </div>

          <!-- Búsqueda y Filtros (Desktop) -->
          <div class="flex-1 flex items-center gap-2 max-w-2xl mx-auto">
            <div class="relative flex-[1.5]">
              <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input 
                v-model="searchQuery" 
                type="text" 
                placeholder="Buscar máquina o falla..." 
                class="w-full pl-9 pr-4 py-1.5 bg-gray-800 border border-gray-700 focus:bg-gray-700 focus:border-blue-500 rounded-lg text-xs text-gray-200 outline-none transition-all placeholder:text-gray-500" 
              />
            </div>
            
            <div class="relative flex-[0.8] min-w-30">
              <input 
                v-model="filterDate" 
                type="date" 
                :class="{'text-transparent': !filterDate, 'text-gray-300': filterDate}"
                class="w-full bg-gray-800 border border-gray-700 text-xs font-bold rounded-lg px-2 py-1.5 focus:border-blue-500 outline-none transition-all"
                title="Filtrar por fecha y analizar IA"
              />
              <span v-if="!filterDate" class="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-[10px] pointer-events-none font-bold tracking-wider bg-gray-800 px-1">Fecha IA...</span>
            </div>
            
            <select 
              v-model="statusFilter"
              class="bg-gray-800 border border-gray-700 text-gray-300 text-[10px] font-bold rounded-lg px-2 py-1.5 focus:border-blue-500 outline-none transition-all flex-[0.7]"
            >
              <option value="todos">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="en proceso">En proceso</option>
              <option value="resuelto">Resuelto</option>
            </select>
            
            <button 
              @click="exportToExcel"
              data-tippy-content="Exportar a Excel"
              class="p-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-lg shadow-emerald-900/40 transition-all active:scale-95 shrink-0"
            >
              <FileSpreadsheet class="w-4 h-4" />
            </button>
          </div>
        </div>
      </Teleport>
      
      <!-- Portal para Navbar (Mobile) -->
      <Teleport to="#navbar-mobile-portal">
        <div class="flex items-center gap-2">
          <h1 class="text-sm font-black text-white tracking-tighter shrink-0">Histórico</h1>
          <div class="flex items-center gap-1">
             <button @click="exportToExcel" class="bg-emerald-600 text-white p-1.5 rounded-md active:scale-90 transition-all shadow-sm"><FileSpreadsheet class="w-4 h-4" /></button>
          </div>
        </div>
      </Teleport>

      <!-- Header Local (Solo Móvil) - Espacioso -->
      <div class="md:hidden bg-white/95 backdrop-blur-sm p-2 rounded-xl shadow-md border border-gray-100 shrink-0 sticky top-0 z-20 space-y-2">
        <div class="flex items-center gap-2">
          <div class="relative flex-[1.2]">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input v-model="searchQuery" type="text" placeholder="Buscar..." class="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-100 rounded-lg text-sm outline-none focus:ring-1 focus:ring-blue-500/20" />
          </div>
          <select v-model="statusFilter" class="bg-gray-50 border border-gray-100 text-xs font-black rounded-lg px-2 py-2 outline-none focus:border-blue-500 flex-[0.8] text-center">
            <option value="todos">Todos</option>
            <option value="pendiente">Pendiente</option>
            <option value="en proceso">En Proceso</option>
            <option value="resuelto">Resuelto</option>
          </select>
        </div>
        <div class="relative">
          <input v-model="filterDate" type="date" :class="{'text-transparent flex items-center': !filterDate, 'text-gray-600': filterDate}" class="w-full bg-gray-50 border border-gray-100 text-sm font-bold rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-blue-500/20" />
          <span v-if="!filterDate" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none font-bold">Seleccionar Fecha IA...</span>
        </div>
      </div>

      <!-- Contenido Principal -->
      
      <!-- Panel de Inteligencia Artificial (Aparece al seleccionar Fecha) -->
      <div v-if="filterDate && !errorCarga" class="mt-2 mb-4 bg-linear-to-r from-indigo-50 to-purple-50 rounded-2xl p-4 md:p-5 border border-indigo-100 shadow-sm relative overflow-y-auto shrink-0 max-h-[45vh] lg:max-h-[35vh]">
         <div class="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
            <Sparkles class="w-24 h-24 text-indigo-600" />
         </div>
         
         <div class="flex items-center justify-between mb-2 z-10 relative border-b border-indigo-100/50 pb-2">
           <!-- Titulo -->
           <h3 class="flex items-center text-lg md:text-xl font-black text-indigo-900 truncate pr-2" @click="iaCollapsed = !iaCollapsed">
             <Sparkles class="w-5 h-5 md:w-6 md:h-6 mr-1.5 md:mr-2 text-indigo-600 shrink-0" /> 
             <span class="truncate cursor-pointer select-none hover:opacity-80 transition-opacity">Análisis IA</span>
           </h3>
           
           <!-- Acciones -->
           <div class="flex items-center gap-1.5 shrink-0">
             <div v-if="!isIaLoading && iaSummary" class="flex items-center gap-1.5">
               <button @click="copiarWhatsApp" title="Copiar para WhatsApp" class="bg-green-500 text-white font-black px-2 md:px-3 py-1 md:py-1.5 rounded-lg md:rounded-full hover:bg-green-600 transition shadow-md border border-green-600 flex items-center shrink-0">
                 <Copy class="w-4 h-4 md:w-3.5 md:h-3.5 md:mr-1" />
                 <span class="hidden md:inline text-[10px] uppercase tracking-wider">WhatsApp</span>
               </button>
               
               <template v-if="iaFromCache">
                 <button @click="cargarAnalisisIA(true)" title="Regenerar Análisis" class="bg-white border border-indigo-200 text-indigo-600 font-black px-2 md:px-3 py-1 md:py-1.5 rounded-lg md:rounded-full hover:bg-indigo-50 transition shadow-sm shrink-0 flex items-center">
                   <Sparkles class="w-4 h-4 md:w-3.5 md:h-3.5 md:mr-1" />
                   <span class="hidden md:inline text-[10px] uppercase tracking-wider">Regenerar</span>
                 </button>
               </template>
             </div>
             
             <!-- Separador Vertical -->
             <div class="w-px h-5 bg-indigo-200 mx-0.5 md:mx-1"></div>
             
             <!-- Colapsar -->
             <button 
               @click="iaCollapsed = !iaCollapsed" 
               class="bg-indigo-100 text-indigo-700 hover:bg-indigo-200 p-1 md:p-1.5 rounded-lg transition-colors shadow-sm shrink-0 border border-indigo-200"
               title="Expandir/Contraer"
             >
               <ChevronUp v-if="!iaCollapsed" class="w-4 h-4 md:w-5 md:h-5 stroke-3" />
               <ChevronDown v-else class="w-4 h-4 md:w-5 md:h-5 stroke-3" />
             </button>
           </div>
         </div>

         <div v-show="!iaCollapsed">
           <div v-if="isIaLoading" class="flex flex-col items-center justify-center py-4 z-10 relative">
             <div class="animate-pulse flex gap-2 w-full max-w-sm">
                <div class="h-2 bg-indigo-200 rounded w-full"></div>
                <div class="h-2 bg-indigo-200 rounded w-1/2"></div>
             </div>
             <p class="text-xs text-indigo-600 font-bold mt-2 tracking-wide">Generando resumen...</p>
           </div>
           
           <div v-else-if="iaError" class="text-indigo-800 text-sm font-semibold z-10 relative">
             No se pudo generar el resumen de IA automáticamente para esta fecha.
             <button @click="cargarAnalisisIA(true)" class="underline ml-2">Reintentar</button>
           </div>

           <div v-else class="text-indigo-950 text-base md:text-lg leading-relaxed z-10 relative font-medium space-y-2 bg-white/70 p-3 rounded-2xl border border-white max-w-none" v-html="iaSummary">
           </div>
         </div>
      </div>

      <!-- Estado Carga Lista (Solo si está vacío) -->
      <div v-if="isLoading && novedades.length === 0" class="flex-1 flex flex-col items-center justify-center text-gray-400">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
        <p class="font-bold text-xs tracking-widest text-gray-400">Cargando historial...</p>
      </div>

      <div v-else-if="errorCarga && novedades.length === 0" class="flex-1 flex flex-col items-center justify-center text-center p-8">
        <AlertTriangle class="w-12 h-12 text-red-300 mb-3" />
        <h2 class="font-black text-gray-800 text-sm">Error de conexión</h2>
        <button @click="cargarDatos" class="mt-4 px-6 py-2 bg-red-600 text-white rounded-lg text-xs font-black shadow-lg">Reintentar</button>
      </div>

      <div v-else-if="novedadesFiltradas.length === 0" class="flex-1 flex flex-col items-center justify-center text-center p-8 bg-white rounded-lg border border-gray-100">
        <CheckCircle class="w-12 h-12 text-gray-200 mb-3" />
        <p class="text-xs font-bold text-gray-400 tracking-widest">Sin resultados</p>
      </div>

      <template v-else>
        <!-- TABLA DESKTOP -->
        <div class="hidden md:flex flex-1 flex-col bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden min-h-0">
          <div class="overflow-auto flex-1 min-h-0">
            <table class="w-full text-left border-collapse">
              <thead class="sticky top-0 bg-gray-50 z-20 shadow-sm border-b border-gray-100">
                <tr class="text-xs font-black text-gray-500 tracking-widest">
                  <th class="px-5 py-4 bg-gray-50">Fecha</th>
                  <th class="px-5 py-4 bg-gray-50">Máquina</th>
                  <th class="px-5 py-4 bg-gray-50">Lado</th>
                  <th class="px-5 py-4 bg-gray-50">Observaciones</th>
                  <th class="px-5 py-4 bg-gray-50">Estado</th>
                  <th class="px-5 py-4 bg-gray-50 text-center">Foto</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <tr v-for="n in paginatedNovedades" :key="n.id" class="hover:bg-blue-50/50 transition-colors group">
                  <td class="px-5 py-4 text-xs font-bold text-gray-500 whitespace-nowrap">{{ formatDate(n.createdAt) }}</td>
                  <td class="px-5 py-4">
                    <div class="flex flex-col">
                      <span class="text-base font-black text-gray-800">{{ n.numeroMaquina }}</span>
                      <span class="text-[10px] text-gray-400 font-bold tracking-tighter">{{ n.tipoMaquina }}</span>
                      <span v-if="n.motivo" class="mt-1 text-[9px] font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 self-start uppercase tracking-widest">{{ n.motivo }}</span>
                    </div>
                  </td>
                  <td class="px-5 py-4 text-sm font-black text-gray-600">{{ n.lado }}</td>
                  <td class="px-5 py-4 max-w-sm">
                    <div v-if="n.seccion || n.denominacion" class="mb-2 bg-indigo-50 border border-indigo-100 p-2 rounded-lg inline-block w-full">
                       <span class="block text-[9px] font-black text-indigo-400 tracking-widest leading-none mb-0.5">Punto de control afectado</span>
                       <div class="flex justify-between items-center gap-2">
                         <span class="text-xs font-bold text-indigo-900 truncate">{{ n.denominacion || n.seccion }} <span v-if="n.grupo" class="text-indigo-400 font-normal">({{ n.grupo }})</span></span>
                         <span v-if="n.numeroArticulo && n.numeroArticulo !== '-'" class="shrink-0 bg-indigo-100 text-indigo-800 text-[9px] font-black px-1.5 py-0.5 rounded border border-indigo-200">
                           Art: {{ n.numeroArticulo }}
                         </span>
                       </div>
                    </div>
                    <p class="text-sm text-gray-700 font-medium whitespace-normal">{{ n.observaciones }}</p>
                  </td>
                  <td class="px-5 py-4">
                    <div class="flex items-center space-x-2">
                      <span 
                        :class="getStatusClass(n.estado)"
                        class="px-2.5 py-1 rounded text-[10px] font-black border whitespace-nowrap"
                      >
                        {{ n.estado }}
                      </span>
                      <!-- Solo Admin puede cambiar estado (Mecánico solo lee) -->
                      <button 
                        v-if="userRole === 'admin'"
                        @click="cambiarEstado(n)" 
                        class="p-1.5 hover:bg-gray-100 rounded-md transition-colors"
                      >
                        <RefreshCw class="w-4 h-4 text-gray-400" />
                      </button>
                    </div>
                  </td>
                  <td class="px-5 py-4 text-center">
                    <a v-if="n.fotoUrl" :href="n.fotoUrl" target="_blank" class="p-2 bg-gray-100 text-gray-500 hover:bg-blue-600 hover:text-white rounded-lg inline-flex transition-all">
                      <ImageIcon class="w-4 h-4" />
                    </a>
                    <span v-else class="text-xs text-gray-300 font-bold">---</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <!-- Paginación Desktop -->
          <div class="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between shrink-0">
            <span class="text-xs text-gray-400 font-black tracking-widest">{{ novedadesFiltradas.length }} registros</span>
            <div class="flex items-center space-x-1.5">
              <button @click="goToFirst" :disabled="currentPage === 1" class="p-2 rounded-lg hover:bg-white disabled:opacity-30 text-gray-500 border border-transparent hover:border-gray-200 transition-all shadow-sm"><ChevronsLeft class="w-4 h-4" /></button>
              <button @click="goToPrev" :disabled="currentPage === 1" class="p-2 rounded-lg hover:bg-white disabled:opacity-30 text-gray-500 border border-transparent hover:border-gray-200 transition-all shadow-sm"><ChevronLeft class="w-4 h-4" /></button>
              <div class="px-4 py-1.5 text-sm font-black text-gray-700 bg-white rounded-lg border border-gray-200">Pág {{ currentPage }} / {{ totalPages }}</div>
              <button @click="goToNext" :disabled="currentPage === totalPages" class="p-2 rounded-lg hover:bg-white disabled:opacity-30 text-gray-500 border border-transparent hover:border-gray-200 transition-all shadow-sm"><ChevronRight class="w-4 h-4" /></button>
              <button @click="goToLast" :disabled="currentPage === totalPages" class="p-2 rounded-lg hover:bg-white disabled:opacity-30 text-gray-500 border border-transparent hover:border-gray-200 transition-all shadow-sm"><ChevronsRight class="w-4 h-4" /></button>
            </div>
          </div>
        </div>

        <!-- TARJETAS MÓVIL (Con Scroll) -->
        <div class="md:hidden flex-1 overflow-y-auto pr-1 space-y-4">
          <div v-for="n in paginatedNovedades" :key="n.id" class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-3">
            <div class="flex justify-between items-start">
              <span class="text-sm font-black text-gray-800">{{ n.numeroMaquina }} ({{ n.lado }})</span>
              <span class="text-xs font-bold text-gray-400 mt-0.5">{{ formatDate(n.createdAt) }}</span>
            </div>
            
            <div v-if="n.seccion || n.denominacion" class="bg-indigo-50 border border-indigo-100 p-2.5 rounded-lg space-y-1">
               <div class="flex flex-col">
                  <span class="text-[9px] font-black text-indigo-400 uppercase tracking-widest leading-none">Punto de Control</span>
                  <span class="text-xs font-bold text-indigo-900 leading-tight mt-0.5">{{ n.denominacion || n.seccion }}</span>
               </div>
               <div v-if="n.numeroArticulo && n.numeroArticulo !== '-'" class="flex gap-2">
                 <span class="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-1.5 py-0.5 rounded">Art: {{ n.numeroArticulo }}</span>
                 <span v-if="n.numeroCatalogo && n.numeroCatalogo !== '-'" class="bg-indigo-100 border border-indigo-200 text-indigo-700 text-[10px] font-bold px-1.5 py-0.5 rounded">Cat: {{ n.numeroCatalogo }}</span>
               </div>
            </div>

            <p class="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg border border-gray-100 italic">"{{ n.observaciones }}"</p>
            <div class="flex items-center justify-between pt-2">
              <span class="px-2.5 py-1 text-[10px] font-black rounded-md border" :class="getStatusClass(n.estado)">{{ n.estado }}</span>
              <a v-if="n.fotoUrl" :href="n.fotoUrl" target="_blank" class="flex items-center text-xs font-black text-blue-600 tracking-widest bg-blue-50 py-1.5 px-3 rounded-lg hover:bg-blue-100 transition-colors">
                <ImageIcon class="w-4 h-4 mr-1.5" /> Foto
              </a>
            </div>
          </div>
          
          <!-- Paginación Móvil -->
          <div class="flex items-center justify-center space-x-3 py-3">
            <button @click="goToPrev" :disabled="currentPage === 1" class="p-3 bg-white rounded-lg border border-gray-200 disabled:opacity-30 shadow-sm active:scale-95"><ChevronLeft class="w-5 h-5" /></button>
            <span class="text-sm font-black text-gray-600 bg-white px-4 py-2.5 rounded-lg border border-gray-100">{{ currentPage }} / {{ totalPages }}</span>
            <button @click="goToNext" :disabled="currentPage === totalPages" class="p-3 bg-white rounded-lg border border-gray-200 disabled:opacity-30 shadow-sm active:scale-95"><ChevronRight class="w-5 h-5" /></button>
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
