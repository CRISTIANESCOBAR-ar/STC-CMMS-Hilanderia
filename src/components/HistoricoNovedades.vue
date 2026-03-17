<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { mantenimientoService } from '../services/mantenimientoService';
import { 
  Clock, 
  AlertTriangle, 
  CheckCircle, 
  ChevronLeft, 
  ChevronRight, 
  Search,
  Filter,
  Image as ImageIcon,
  History
} from 'lucide-vue-next';

const novedades = ref([]);
const isLoading = ref(true);
const errorCarga = ref(false);
let unsubscribe = null;

// Paginación y Filtros
const itemsPerPage = ref(10);
const currentPage = ref(1);
const searchQuery = ref('');
const statusFilter = ref('todos');

let timeoutId = null;

const cargarDatos = () => {
  isLoading.value = true;
  errorCarga.value = false;

  if (unsubscribe) unsubscribe();
  if (timeoutId) clearTimeout(timeoutId);

  // Timeout de seguridad: if in 10s no data arrives, show error
  timeoutId = setTimeout(() => {
    if (isLoading.value) {
      console.warn('Timeout alcanzado en Histórico');
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
      console.error("Error al cargar historial:", err);
      errorCarga.value = true;
      isLoading.value = false;
    }
  );
};

onMounted(() => {
  cargarDatos();
});

onUnmounted(() => {
  if (unsubscribe) unsubscribe();
  if (timeoutId) clearTimeout(timeoutId);
});

// Lógica de Filtrado
const novedadesFiltradas = computed(() => {
  const search = searchQuery.value.toLowerCase();
  
  return novedades.value.filter(n => {
    // Aseguramos que los valores sean strings para evitar errores de tipo
    const numMaq = String(n.numeroMaquina || '').toLowerCase();
    const tipoMaq = String(n.tipoMaquina || '').toLowerCase();
    const obs = String(n.observaciones || '').toLowerCase();

    const matchesSearch = 
      numMaq.includes(search) ||
      tipoMaq.includes(search) ||
      obs.includes(search);
    
    const matchesStatus = statusFilter.value === 'todos' || n.estado === statusFilter.value;
    
    return matchesSearch && matchesStatus;
  });
});

// Resetear a página 1 al filtrar
watch([searchQuery, statusFilter], () => {
  currentPage.value = 1;
});

// Lógica de Paginación
const totalPages = computed(() => Math.ceil(novedadesFiltradas.value.length / itemsPerPage.value));
const paginatedNovedades = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  const end = start + itemsPerPage.value;
  return novedadesFiltradas.value.slice(start, end);
});

const nextPage = () => {
  if (currentPage.value < totalPages.value) currentPage.value++;
};

const prevPage = () => {
  if (currentPage.value > 1) currentPage.value--;
};

const formatDate = (val) => {
  if (!val) return '---';
  
  let date;
  if (typeof val.toDate === 'function') {
    date = val.toDate();
  } else if (val instanceof Date) {
    date = val;
  } else if (typeof val === 'number' || typeof val === 'string') {
    date = new Date(val);
  } else {
    return 'Fecha inválida';
  }

  return date.toLocaleString('es-AR', { 
    day: '2-digit', 
    month: '2-digit', 
    year: '2-digit', 
    hour: '2-digit', 
    minute: '2-digit' 
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
  <div class="min-h-screen bg-gray-50 pb-20">
    <main class="max-w-7xl mx-auto px-4 pt-6 space-y-6">
      
      <!-- Encabezado con Filtros -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <div class="flex items-center space-x-3">
          <div class="bg-blue-600 p-2.5 rounded-xl shadow-lg shadow-blue-200 text-white">
            <History class="w-6 h-6" />
          </div>
          <div>
            <h1 class="text-xl font-black text-gray-800 uppercase tracking-tight leading-none">Histórico</h1>
            <p class="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Novedades Mecánicas</p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!-- Buscador -->
          <div class="relative flex-1 min-w-[200px]">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input 
              v-model="searchQuery"
              type="text" 
              placeholder="Buscar máquina o falla..."
              class="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
            />
          </div>

          <!-- Filtro de Estado -->
          <select 
            v-model="statusFilter"
            class="bg-gray-50 border border-gray-200 text-gray-700 text-sm rounded-xl px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
          >
            <option value="todos">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="en proceso">En proceso</option>
            <option value="resuelto">Resuelto</option>
          </select>
        </div>
      </div>

      <!-- Estado de Carga / Error -->
      <div v-if="isLoading" class="flex flex-col items-center justify-center py-20">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <p class="text-gray-500 font-medium">Cargando registros...</p>
      </div>

      <div v-else-if="errorCarga" class="bg-red-50 text-red-700 p-8 rounded-2xl border border-red-100 text-center">
        <AlertTriangle class="w-12 h-12 mx-auto mb-3 opacity-50" />
        <h2 class="font-bold text-lg">No se pudo cargar el historial</h2>
        <button @click="cargarDatos" class="mt-4 px-6 py-2 bg-red-600 text-white rounded-xl font-bold shadow-md">REINTENTAR</button>
      </div>

      <div v-else-if="novedadesFiltradas.length === 0" class="bg-white p-20 rounded-2xl border border-gray-100 text-center shadow-sm">
        <CheckCircle class="w-12 h-12 mx-auto mb-3 text-green-300" />
        <p class="text-gray-500 font-medium">No se encontraron registros que coincidan con la búsqueda.</p>
      </div>

      <!-- Contenido Principal -->
      <div v-else class="space-y-4">
        
        <!-- VISTA DESKTOP (Tabla con Header Fijo) -->
        <div class="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div class="max-h-[65vh] overflow-y-auto relative custom-scrollbar">
            <table class="w-full text-left border-collapse">
              <thead class="sticky top-0 bg-gray-50 z-10 shadow-sm">
                <tr class="text-[11px] font-bold text-gray-500 uppercase tracking-widest border-b border-gray-100">
                  <th class="px-6 py-4">Fecha</th>
                  <th class="px-6 py-4">Máquina</th>
                  <th class="px-6 py-4">Lado</th>
                  <th class="px-6 py-4">Observaciones</th>
                  <th class="px-6 py-4">Estado</th>
                  <th class="px-6 py-4">Imagen</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <tr v-for="n in paginatedNovedades" :key="n.id" class="hover:bg-blue-50/30 transition-colors group">
                  <td class="px-6 py-4 text-xs font-medium text-gray-500 whitespace-nowrap">
                    {{ formatDate(n.createdAt) }}
                  </td>
                  <td class="px-6 py-4">
                    <div class="flex flex-col">
                      <span class="text-sm font-bold text-gray-800">{{ n.numeroMaquina }}</span>
                      <span class="text-[10px] text-gray-400 font-bold uppercase">{{ n.tipoMaquina }}</span>
                    </div>
                  </td>
                  <td class="px-6 py-4 text-sm font-bold text-gray-600">
                    {{ n.lado }}
                  </td>
                  <td class="px-6 py-4">
                    <p class="text-sm text-gray-600 line-clamp-2 max-w-xs group-hover:line-clamp-none transition-all">
                      {{ n.observaciones }}
                    </p>
                  </td>
                  <td class="px-6 py-4">
                    <span 
                      class="px-3 py-1 text-[10px] font-black uppercase rounded-full border"
                      :class="getStatusClass(n.estado)"
                    >
                      {{ n.estado }}
                    </span>
                  </td>
                  <td class="px-6 py-4">
                    <a 
                      v-if="n.fotoUrl" 
                      :href="n.fotoUrl" 
                      target="_blank"
                      class="p-2 bg-gray-100 text-gray-500 hover:bg-blue-600 hover:text-white rounded-lg inline-flex transition-all"
                    >
                      <ImageIcon class="w-4 h-4" />
                    </a>
                    <span v-else class="text-[10px] text-gray-300 font-bold uppercase">Sin foto</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- VISTA MÓVIL (Tarjetas) -->
        <div class="md:hidden space-y-4">
          <div v-for="n in paginatedNovedades" :key="n.id" 
            class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-3 active:scale-[0.98] transition-all"
          >
            <div class="flex justify-between items-start">
              <div class="flex items-center space-x-2">
                <div class="w-2 h-2 rounded-full" :class="n.estado === 'resuelto' ? 'bg-green-500' : (n.estado === 'en proceso' ? 'bg-yellow-500' : 'bg-red-500')"></div>
                <span class="text-xs font-black text-gray-800 uppercase tracking-tight">{{ n.numeroMaquina }} ({{ n.lado }})</span>
              </div>
              <span class="text-[9px] font-bold text-gray-400 uppercase">{{ formatDate(n.createdAt) }}</span>
            </div>
            
            <p class="text-sm text-gray-600 bg-gray-50 p-3 rounded-xl border border-gray-100 italic">
              "{{ n.observaciones }}"
            </p>

            <div class="flex items-center justify-between pt-2">
              <span 
                class="px-3 py-1 text-[9px] font-black uppercase rounded-full border"
                :class="getStatusClass(n.estado)"
              >
                {{ n.estado }}
              </span>
              <a v-if="n.fotoUrl" :href="n.fotoUrl" target="_blank" class="flex items-center text-[10px] font-bold text-blue-600 uppercase tracking-widest">
                <ImageIcon class="w-3 h-3 mr-1" /> FOTO
              </a>
            </div>
          </div>
        </div>

        <!-- Paginación -->
        <div class="flex items-center justify-between bg-white px-4 py-4 rounded-2xl shadow-sm border border-gray-100">
          <p class="text-xs font-bold text-gray-400 uppercase">
            {{ (currentPage - 1) * itemsPerPage + 1 }}-{{ Math.min(currentPage * itemsPerPage, novedadesFiltradas.length) }} de {{ novedadesFiltradas.length }}
          </p>
          <div class="flex space-x-2">
            <button 
              @click="prevPage" 
              :disabled="currentPage === 1"
              class="p-2 border border-gray-100 rounded-xl disabled:opacity-20 hover:bg-gray-50 transition"
            >
              <ChevronLeft class="w-5 h-5 text-gray-600" />
            </button>
            <div class="flex items-center px-4 font-black text-sm text-gray-800">
              {{ currentPage }} / {{ totalPages || 1 }}
            </div>
            <button 
              @click="nextPage" 
              :disabled="currentPage === totalPages"
              class="p-2 border border-gray-100 rounded-xl disabled:opacity-20 hover:bg-gray-50 transition"
            >
              <ChevronRight class="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

      </div>
    </main>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #e2e8f0;
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #cbd5e1;
}
</style>
