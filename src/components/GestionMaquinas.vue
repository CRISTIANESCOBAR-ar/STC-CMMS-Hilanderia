<script setup>
import { ref, onMounted, computed } from 'vue';
import { maquinaService } from '../services/maquinaService';
import { Plus, Search, Edit3, Trash2, X, Check, Settings2, LayoutGrid, Table2, Save } from 'lucide-vue-next';
import Swal from 'sweetalert2';

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

onMounted(() => {
  maquinaService.obtenerMaquinas((data) => {
    maquinas.value = data;
    isLoading.value = false;
  });
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
</script>

<template>
  <div class="min-h-screen bg-gray-50 pb-20">
    <main class="max-w-5xl mx-auto px-4 pt-6 space-y-4">

      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <div class="flex items-center space-x-3">
          <div class="bg-indigo-600 p-2.5 rounded-xl shadow-lg shadow-indigo-200 text-white">
            <Settings2 class="w-6 h-6" />
          </div>
          <div>
            <h1 class="text-xl font-black text-gray-800 uppercase tracking-tight leading-none">Gestión de Máquinas</h1>
            <p class="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Configuración del Catálogo</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex border border-gray-200 rounded-lg overflow-hidden shadow-sm">
            <button @click="viewMode = 'cards'" :class="viewMode === 'cards' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'" class="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-colors">
              <LayoutGrid class="w-4 h-4" /><span class="hidden sm:inline ml-1">TARJETAS</span>
            </button>
            <button @click="viewMode = 'table'" :class="viewMode === 'table' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'" class="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-colors border-l border-gray-200">
              <Table2 class="w-4 h-4" /><span class="hidden sm:inline ml-1">TABLA</span>
            </button>
          </div>
          <button @click="openAddModal" class="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold shadow-md transition-all active:scale-95 text-sm">
            <Plus class="w-4 h-4" /><span>AGREGAR</span>
          </button>
        </div>
      </div>

      <!-- Buscador -->
      <div class="relative">
        <Search class="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input v-model="searchQuery" type="text" placeholder="Buscar por ID, Tipo o Nombre..." class="w-full pl-11 pr-4 py-2.5 bg-white border border-gray-100 rounded-xl text-sm shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all" />
      </div>

      <div v-if="isLoading" class="flex flex-col items-center justify-center py-20 text-gray-400">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>
        <p class="font-bold text-xs uppercase tracking-widest">Cargando catálogo...</p>
      </div>

      <template v-else>
        <!-- TARJETAS -->
        <div v-if="viewMode === 'cards'" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div v-for="m in filteredMaquinas" :key="m.id" class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex justify-between items-start group hover:border-indigo-200 transition-all">
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
            <div class="flex space-x-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
              <button @click="openEditModal(m)" class="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"><Edit3 class="w-4 h-4" /></button>
              <button @click="deleteMaquina(m.id)" class="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 class="w-4 h-4" /></button>
            </div>
          </div>
        </div>

        <!-- TABLA INLINE -->
        <div v-else class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm text-left">
              <thead class="bg-gray-50 border-b border-gray-100 text-[11px] font-black text-gray-500 uppercase tracking-widest">
                <tr>
                  <th class="px-4 py-3">Tipo</th><th class="px-4 py-3">ID Máq.</th><th class="px-4 py-3">Nombre</th>
                  <th class="px-4 py-3">Local</th><th class="px-4 py-3">Lado</th><th class="px-4 py-3">Modelo</th>
                  <th class="px-4 py-3">Serie</th><th class="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <tr v-for="m in filteredMaquinas" :key="m.id" :class="editingRowId === m.id ? 'bg-indigo-50' : 'hover:bg-gray-50/50'" class="transition-colors">
                  <template v-if="editingRowId === m.id">
                    <td class="px-2 py-1.5"><select v-model="editingRow.tipo" class="w-full bg-white border border-indigo-300 rounded px-2 py-1 text-xs outline-none"><option v-for="t in tiposOptions" :key="t">{{ t }}</option></select></td>
                    <td class="px-2 py-1.5"><input v-model="editingRow.maquina" type="number" class="w-20 bg-white border border-indigo-300 rounded px-2 py-1 text-xs outline-none" /></td>
                    <td class="px-2 py-1.5"><input v-model="editingRow.nombre_maquina" type="text" class="w-full min-w-[140px] bg-white border border-indigo-300 rounded px-2 py-1 text-xs outline-none" /></td>
                    <td class="px-2 py-1.5"><input v-model="editingRow.local_fisico" type="text" class="w-14 bg-white border border-indigo-300 rounded px-2 py-1 text-xs outline-none" /></td>
                    <td class="px-2 py-1.5"><select v-model="editingRow.lado" class="bg-white border border-indigo-300 rounded px-2 py-1 text-xs outline-none"><option value="U">U</option><option value="A">A</option><option value="B">B</option></select></td>
                    <td class="px-2 py-1.5"><input v-model="editingRow.modelo" type="text" class="w-full bg-white border border-indigo-300 rounded px-2 py-1 text-xs outline-none" /></td>
                    <td class="px-2 py-1.5"><input v-model="editingRow.nro_serie" type="text" class="w-full bg-white border border-indigo-300 rounded px-2 py-1 text-xs outline-none" /></td>
                    <td class="px-2 py-1.5">
                      <div class="flex justify-center space-x-1">
                        <button @click="saveInlineEdit" class="p-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"><Save class="w-3.5 h-3.5" /></button>
                        <button @click="cancelInlineEdit" class="p-1.5 bg-gray-200 text-gray-600 rounded-md hover:bg-gray-300 transition-colors"><X class="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </template>
                  <template v-else>
                    <td class="px-4 py-2.5"><span class="px-2 py-0.5 bg-gray-100 text-[10px] font-black text-gray-600 rounded uppercase">{{ m.tipo }}</span></td>
                    <td class="px-4 py-2.5 font-bold text-gray-800">{{ m.maquina }}</td>
                    <td class="px-4 py-2.5 text-gray-600">{{ m.nombre_maquina }}</td>
                    <td class="px-4 py-2.5 text-gray-500 font-bold">{{ m.local_fisico }}</td>
                    <td class="px-4 py-2.5 text-gray-500 font-bold">{{ m.lado }}</td>
                    <td class="px-4 py-2.5 text-gray-400 text-xs">{{ m.modelo || '—' }}</td>
                    <td class="px-4 py-2.5 text-gray-400 text-xs">{{ m.nro_serie || '—' }}</td>
                    <td class="px-4 py-2.5">
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
          <div class="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400 font-bold uppercase tracking-widest">{{ filteredMaquinas.length }} máquinas</div>
        </div>
      </template>
    </main>

    <!-- Modal -->
    <div v-if="showModal" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm overflow-y-auto">
      <div class="bg-white rounded-xl w-full max-w-lg shadow-2xl overflow-hidden my-auto">
        <div class="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div>
            <h3 class="text-base font-black text-gray-800 uppercase tracking-tight">{{ isEditing ? 'Editar Máquina' : 'Nueva Máquina' }}</h3>
            <p class="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Completa los campos técnicos</p>
          </div>
          <button @click="closeModal" class="p-1.5 hover:bg-gray-200 rounded-lg transition-colors"><X class="w-5 h-5 text-gray-500" /></button>
        </div>
        <form @submit.prevent="handleSubmit" class="p-4 space-y-2">
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="text-[10px] font-bold text-gray-500 uppercase ml-1">Tipo</label>
              <select v-model="form.tipo" class="w-full bg-gray-50 border border-gray-200 p-2 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
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
            <button @click="closeModal" type="button" class="flex-1 py-2.5 border border-gray-200 rounded-lg font-bold text-sm text-gray-500 hover:bg-gray-50 transition-colors">CANCELAR</button>
            <button type="submit" class="flex-[2] py-2.5 bg-indigo-600 text-white rounded-lg font-bold text-sm shadow-md hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center space-x-2">
              <Check class="w-5 h-5" /><span>GUARDAR CAMBIOS</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
