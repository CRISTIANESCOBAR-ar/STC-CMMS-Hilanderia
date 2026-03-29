<script setup>
import { ref, computed, onMounted } from 'vue';
import {
  collection, getDocs, doc, setDoc, updateDoc, deleteDoc, serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { Search, Plus, Trash2, CheckCircle2, Loader2, FileDown, ToggleLeft, ToggleRight } from 'lucide-vue-next';
import Swal from 'sweetalert2';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const COL = 'sintomas_tejeduria';

const CATEGORIAS = ['TRAMA', 'URDIMBRE', 'VISUAL', 'MECANICO', 'ELECTRICO', 'PROCESO'];
const DERIVA_A   = ['MECANICO', 'ELECTRICO', 'AMBOS', 'TEJEDOR', 'CALIDAD'];

const DERIVA_LABEL = {
  MECANICO:  { label: 'Mecánico',  bg: 'bg-blue-100',   text: 'text-blue-700'   },
  ELECTRICO: { label: 'Eléctrico', bg: 'bg-amber-100',   text: 'text-amber-700'  },
  AMBOS:     { label: 'Ambos',     bg: 'bg-purple-100',  text: 'text-purple-700' },
  TEJEDOR:   { label: 'Tejedor',   bg: 'bg-green-100',   text: 'text-green-700'  },
  CALIDAD:   { label: 'Calidad',   bg: 'bg-red-100',     text: 'text-red-700'    },
};

const CAT_LABEL = {
  TRAMA:     'bg-blue-50 text-blue-600',
  URDIMBRE:  'bg-indigo-50 text-indigo-600',
  VISUAL:    'bg-rose-50 text-rose-600',
  MECANICO:  'bg-orange-50 text-orange-600',
  ELECTRICO: 'bg-yellow-50 text-yellow-700',
  PROCESO:   'bg-gray-100 text-gray-600',
};

// ── Estado ────────────────────────────────────────────────────────────────────
const sintomas    = ref([]);
const cargando    = ref(true);
const busqueda    = ref('');
const soloActivos = ref(false);
const estadoGuardado = ref({});   // id → 'saving' | 'saved' | 'error'

// Form nuevo síntoma
const mostrarForm = ref(false);
const nuevo = ref({ nombre: '', categoria: 'TRAMA', derivaA: 'MECANICO', descripcion: '', destacado: false, activo: true });

// ── Carga ─────────────────────────────────────────────────────────────────────
async function cargar() {
  cargando.value = true;
  try {
    const snap = await getDocs(collection(db, COL));
    sintomas.value = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99));
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  } finally {
    cargando.value = false;
  }
}
onMounted(cargar);

// ── Filtrado ──────────────────────────────────────────────────────────────────
const filasFiltradas = computed(() => {
  let lista = sintomas.value;
  if (soloActivos.value) lista = lista.filter(r => r.activo);
  const q = busqueda.value.trim().toLowerCase();
  if (q) lista = lista.filter(r =>
    r.nombre.toLowerCase().includes(q) ||
    (r.descripcion || '').toLowerCase().includes(q) ||
    r.categoria.toLowerCase().includes(q) ||
    r.derivaA.toLowerCase().includes(q)
  );
  return lista;
});

// ── Guardado con debounce ─────────────────────────────────────────────────────
const timers = {};
function marcarGuardando(id) { estadoGuardado.value[id] = 'saving'; }
function marcarGuardado(id)  {
  estadoGuardado.value[id] = 'saved';
  setTimeout(() => { delete estadoGuardado.value[id]; }, 2000);
}
function marcarError(id)     { estadoGuardado.value[id] = 'error'; }

function autoGuardar(row, campos) {
  clearTimeout(timers[row.id]);
  timers[row.id] = setTimeout(async () => {
    marcarGuardando(row.id);
    try {
      await updateDoc(doc(db, COL, row.id), campos);
      marcarGuardado(row.id);
    } catch (e) { marcarError(row.id); }
  }, 600);
}

function onNombreChange(row)       { autoGuardar(row, { nombre: row.nombre }); }
function onDescripcionChange(row)  { autoGuardar(row, { descripcion: row.descripcion }); }
function onCategoriaChange(row)    { autoGuardar(row, { categoria: row.categoria }); }
function onDerivaChange(row)       { autoGuardar(row, { derivaA: row.derivaA }); }
function toggleDestacado(row)      { row.destacado = !row.destacado; autoGuardar(row, { destacado: row.destacado }); }
function toggleActivo(row)         { row.activo = !row.activo; autoGuardar(row, { activo: row.activo }); }

// ── Agregar nuevo ─────────────────────────────────────────────────────────────
function slugify(nombre) {
  return nombre.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function guardarNuevo() {
  if (!nuevo.value.nombre.trim()) {
    Swal.fire({ icon: 'warning', title: 'Falta el nombre', confirmButtonColor: '#ea580c' });
    return;
  }
  const id = slugify(nuevo.value.nombre);
  const siguiente = Math.max(0, ...sintomas.value.map(s => s.orden ?? 0)) + 1;
  const data = {
    ...nuevo.value,
    nombre: nuevo.value.nombre.trim(),
    orden: siguiente,
    creadoEn: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, COL, id), data);
    sintomas.value.push({ id, ...data });
    sintomas.value.sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99));
    nuevo.value = { nombre: '', categoria: 'TRAMA', derivaA: 'MECANICO', descripcion: '', destacado: false, activo: true };
    mostrarForm.value = false;
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error al guardar', text: e.message });
  }
}

// ── Eliminar ──────────────────────────────────────────────────────────────────
async function eliminar(row) {
  const { isConfirmed } = await Swal.fire({
    icon: 'warning',
    title: '¿Eliminar síntoma?',
    html: `<b>${row.nombre}</b><br>Esta acción no se puede deshacer.`,
    showCancelButton: true,
    confirmButtonText: 'Eliminar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc2626',
  });
  if (!isConfirmed) return;
  await deleteDoc(doc(db, COL, row.id));
  sintomas.value = sintomas.value.filter(s => s.id !== row.id);
}

// ── Exportar XLSX ─────────────────────────────────────────────────────────────
async function exportarExcel() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'STC-CMMS';
  const ws = wb.addWorksheet('Síntomas Tejeduría');

  ws.columns = [
    { header: 'ID',          key: 'id',          width: 28 },
    { header: 'NOMBRE',      key: 'nombre',       width: 28 },
    { header: 'CATEGORÍA',   key: 'categoria',    width: 14 },
    { header: 'DERIVA A',    key: 'derivaA',      width: 13 },
    { header: 'DESCRIPCIÓN', key: 'descripcion',  width: 50 },
    { header: 'DESTACADO',   key: 'destacado',    width: 12 },
    { header: 'ACTIVO',      key: 'activo',       width: 10 },
    { header: 'ORDEN',       key: 'orden',        width: 8  },
  ];

  // Encabezado
  const headerRow = ws.getRow(1);
  headerRow.eachCell(cell => {
    cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.font   = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  headerRow.height = 22;

  // Datos
  sintomas.value.forEach((s, i) => {
    const row = ws.addRow({
      id:          s.id,
      nombre:      s.nombre,
      categoria:   s.categoria,
      derivaA:     s.derivaA,
      descripcion: s.descripcion || '',
      destacado:   s.destacado ? 'Sí' : 'No',
      activo:      s.activo    ? 'Sí' : 'No',
      orden:       s.orden ?? '',
    });
    if (i % 2 === 1) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
      });
    }
    row.alignment = { vertical: 'middle' };
  });

  ws.autoFilter = { from: 'A1', to: 'H1' };

  const buf = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buf]), `Sintomas_Tejeduria_${new Date().toISOString().slice(0,10)}.xlsx`);
}
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 py-6">

    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-xl font-black text-gray-900">Síntomas de Tejeduría</h1>
        <p class="text-sm text-gray-500 mt-0.5">
          Términos colloquiales que usan operadores e inspectores al reportar problemas.
          <span class="font-semibold text-gray-700">{{ sintomas.length }} síntomas</span>
        </p>
      </div>
      <div class="flex gap-2 shrink-0">
        <button @click="exportarExcel"
          class="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-lg transition shadow-sm">
          <FileDown class="w-4 h-4" /> Exportar XLSX
        </button>
        <button @click="mostrarForm = !mostrarForm"
          class="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-bold rounded-lg transition shadow-sm">
          <Plus class="w-4 h-4" /> Nuevo síntoma
        </button>
      </div>
    </div>

    <!-- Formulario nuevo síntoma -->
    <div v-if="mostrarForm" class="mb-5 p-4 bg-orange-50 border border-orange-200 rounded-xl shadow-sm">
      <p class="text-xs font-extrabold text-orange-600 tracking-widest mb-3">NUEVO SÍNTOMA</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="sm:col-span-2">
          <label class="text-[10px] font-extrabold text-gray-400 tracking-widest">NOMBRE (término colloquial)</label>
          <input v-model="nuevo.nombre" type="text" placeholder="Ej: Plegador flojo"
            class="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-orange-400 focus:outline-none" />
        </div>
        <div>
          <label class="text-[10px] font-extrabold text-gray-400 tracking-widest">CATEGORÍA</label>
          <select v-model="nuevo.categoria"
            class="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-orange-400 focus:outline-none bg-white">
            <option v-for="c in CATEGORIAS" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div>
          <label class="text-[10px] font-extrabold text-gray-400 tracking-widest">DERIVA A</label>
          <select v-model="nuevo.derivaA"
            class="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-orange-400 focus:outline-none bg-white">
            <option v-for="d in DERIVA_A" :key="d" :value="d">{{ DERIVA_LABEL[d]?.label || d }}</option>
          </select>
        </div>
        <div class="sm:col-span-2">
          <label class="text-[10px] font-extrabold text-gray-400 tracking-widest">DESCRIPCIÓN INTERNA (opcional)</label>
          <input v-model="nuevo.descripcion" type="text" placeholder="Descripción para el equipo de mantenimiento..."
            class="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-400 focus:outline-none" />
        </div>
        <div class="flex items-center gap-4">
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" v-model="nuevo.destacado" class="w-4 h-4 accent-orange-500" />
            <span class="text-sm font-bold text-gray-700">Destacado ★</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" v-model="nuevo.activo" class="w-4 h-4 accent-orange-500" />
            <span class="text-sm font-bold text-gray-700">Activo</span>
          </label>
        </div>
        <div class="flex justify-end gap-2">
          <button @click="mostrarForm = false"
            class="px-4 py-2 text-sm font-bold text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button @click="guardarNuevo"
            class="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-bold rounded-lg transition">
            Guardar
          </button>
        </div>
      </div>
    </div>

    <!-- Filtros -->
    <div class="flex flex-wrap gap-2 mb-4">
      <div class="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 flex-1 min-w-48">
        <Search class="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <input v-model="busqueda" type="text" placeholder="Buscar síntoma..."
          class="flex-1 text-sm bg-transparent focus:outline-none" />
      </div>
      <button @click="soloActivos = !soloActivos"
        class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold rounded-lg border transition"
        :class="soloActivos ? 'bg-orange-600 border-orange-600 text-white' : 'bg-white border-gray-200 text-gray-600'">
        <component :is="soloActivos ? ToggleRight : ToggleLeft" class="w-4 h-4" />
        Solo activos
      </button>
    </div>

    <!-- Tabla -->
    <div v-if="cargando" class="flex justify-center py-20">
      <Loader2 class="w-8 h-8 animate-spin text-orange-500" />
    </div>

    <div v-else class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-gray-50 border-b border-gray-100">
            <th class="px-3 py-2.5 text-left text-[10px] font-extrabold text-gray-400 tracking-widest w-6">#</th>
            <th class="px-3 py-2.5 text-left text-[10px] font-extrabold text-gray-400 tracking-widest">NOMBRE</th>
            <th class="px-3 py-2.5 text-left text-[10px] font-extrabold text-gray-400 tracking-widest">DESCRIPCIÓN</th>
            <th class="px-3 py-2.5 text-center text-[10px] font-extrabold text-gray-400 tracking-widest w-28">CATEGORÍA</th>
            <th class="px-3 py-2.5 text-center text-[10px] font-extrabold text-gray-400 tracking-widest w-28">DERIVA A</th>
            <th class="px-3 py-2.5 text-center text-[10px] font-extrabold text-gray-400 tracking-widest w-10">★</th>
            <th class="px-3 py-2.5 text-center text-[10px] font-extrabold text-gray-400 tracking-widest w-14">ACTIVO</th>
            <th class="px-3 py-2.5 text-center text-[10px] font-extrabold text-gray-400 tracking-widest w-12"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!filasFiltradas.length">
            <td colspan="8" class="text-center py-12 text-gray-400 text-sm">No hay síntomas que coincidan</td>
          </tr>
          <tr v-for="(row, i) in filasFiltradas" :key="row.id"
            class="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">

            <!-- Orden -->
            <td class="px-3 py-2 text-center text-[10px] text-gray-400 font-bold">{{ row.orden ?? i+1 }}</td>

            <!-- Nombre editable -->
            <td class="px-3 py-2 min-w-[160px]">
              <input v-model="row.nombre" @input="onNombreChange(row)" type="text"
                class="w-full bg-transparent text-sm font-bold text-gray-800 focus:outline-none focus:bg-white focus:border-b-2 focus:border-orange-400 rounded px-1 -ml-1" />
            </td>

            <!-- Descripción editable -->
            <td class="px-3 py-2">
              <input v-model="row.descripcion" @input="onDescripcionChange(row)" type="text"
                placeholder="—"
                class="w-full bg-transparent text-xs text-gray-500 focus:outline-none focus:bg-white focus:border-b focus:border-gray-300 rounded px-1 -ml-1" />
            </td>

            <!-- Categoría -->
            <td class="px-3 py-2 text-center">
              <select v-model="row.categoria" @change="onCategoriaChange(row)"
                class="text-[10px] font-black px-2 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-orange-300"
                :class="CAT_LABEL[row.categoria] || 'bg-gray-100 text-gray-600'">
                <option v-for="c in CATEGORIAS" :key="c" :value="c">{{ c }}</option>
              </select>
            </td>

            <!-- Deriva a -->
            <td class="px-3 py-2 text-center">
              <select v-model="row.derivaA" @change="onDerivaChange(row)"
                class="text-[10px] font-black px-2 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-orange-300"
                :class="[DERIVA_LABEL[row.derivaA]?.bg, DERIVA_LABEL[row.derivaA]?.text]">
                <option v-for="d in DERIVA_A" :key="d" :value="d">{{ DERIVA_LABEL[d]?.label || d }}</option>
              </select>
            </td>

            <!-- Destacado -->
            <td class="px-3 py-2 text-center">
              <button @click="toggleDestacado(row)"
                class="text-lg transition"
                :class="row.destacado ? 'text-amber-400' : 'text-gray-200 hover:text-amber-300'">★</button>
            </td>

            <!-- Activo toggle -->
            <td class="px-3 py-2 text-center">
              <button @click="toggleActivo(row)" class="transition">
                <ToggleRight v-if="row.activo" class="w-6 h-6 text-orange-500" />
                <ToggleLeft  v-else             class="w-6 h-6 text-gray-300" />
              </button>
            </td>

            <!-- Acciones -->
            <td class="px-3 py-2 text-center">
              <div class="flex items-center justify-center gap-1.5">
                <!-- Indicador de guardado -->
                <span v-if="estadoGuardado[row.id] === 'saving'">
                  <Loader2 class="w-3.5 h-3.5 text-orange-400 animate-spin" />
                </span>
                <span v-else-if="estadoGuardado[row.id] === 'saved'">
                  <CheckCircle2 class="w-3.5 h-3.5 text-green-500" />
                </span>
                <button @click="eliminar(row)"
                  class="p-1 text-gray-300 hover:text-red-500 transition rounded">
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Footer con total -->
      <div class="px-4 py-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400 font-bold tracking-widest">
        {{ filasFiltradas.length }} de {{ sintomas.length }} síntomas
      </div>
    </div>

    <!-- Leyenda de colores -->
    <div class="mt-4 flex flex-wrap gap-2">
      <span v-for="(d, key) in DERIVA_LABEL" :key="key"
        class="text-[10px] font-bold px-2 py-1 rounded-full"
        :class="[d.bg, d.text]">
        {{ d.label }}
      </span>
    </div>

  </div>
</template>
