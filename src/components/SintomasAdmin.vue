<script setup>
import { ref, computed, onMounted } from 'vue';
import {
  collection, getDocs, doc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  Search, Plus, Trash2, CheckCircle2, Loader2, FileDown,
  ToggleLeft, ToggleRight, LayoutGrid, Table2,
  ChevronUp, ChevronDown,
} from 'lucide-vue-next';
import Swal from 'sweetalert2';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { userRole } from '../services/authService';

const COL = 'sintomas';

// ── Configuración por sector ──────────────────────────────────────────────────
const TIPOS_POR_SECTOR = {
  TEJEDURIA:  ['TELAR'],
  HILANDERIA: ['CARDA', 'OPEN-END', 'PASADOR', 'APERTURA'],
};

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
const sectorActivo      = ref('TEJEDURIA');
const tipoMaquinaActivo = ref('TELAR');

const sintomas       = ref([]);
const cargando       = ref(true);
const busqueda       = ref('');
const soloActivos    = ref(false);
const estadoGuardado = ref({});
const vistaCards     = ref(false);

const mostrarForm = ref(false);
const nuevo = ref({
  nombre: '', categoria: 'TRAMA', derivaA: 'MECANICO',
  descripcion: '', destacado: false, activo: true,
});

// ── Carga ─────────────────────────────────────────────────────────────────────
async function cargar() {
  cargando.value = true;
  try {
    const snap = await getDocs(collection(db, COL));
    sintomas.value = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(s => s.sector === sectorActivo.value && s.tipoMaquina === tipoMaquinaActivo.value)
      .sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99));
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  } finally {
    cargando.value = false;
  }
}
onMounted(cargar);

async function seleccionarSector(sec) {
  sectorActivo.value = sec;
  tipoMaquinaActivo.value = TIPOS_POR_SECTOR[sec]?.[0] || '';
  busqueda.value = '';
  await cargar();
}

async function seleccionarTipo(tipo) {
  tipoMaquinaActivo.value = tipo;
  busqueda.value = '';
  await cargar();
}

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

const filtrosActivos = computed(() => !!(busqueda.value.trim() || soloActivos.value));

// ── Reordenamiento ────────────────────────────────────────────────────────────
async function moverOrden(row, dir) {
  const lista = sintomas.value;
  const idx = lista.indexOf(row);
  const targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= lista.length) return;

  const other = lista[targetIdx];
  const ordA = row.orden ?? idx + 1;
  const ordB = other.orden ?? targetIdx + 1;

  row.orden = ordB;
  other.orden = ordA;
  lista.splice(Math.min(idx, targetIdx), 2, dir < 0 ? row : other, dir < 0 ? other : row);

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, COL, row.id),   { orden: ordB });
    batch.update(doc(db, COL, other.id), { orden: ordA });
    await batch.commit();
  } catch {
    row.orden = ordA;
    other.orden = ordB;
    await cargar();
  }
}

// ── Guardado con debounce ─────────────────────────────────────────────────────
const timers = {};
function marcarGuardando(id) { estadoGuardado.value[id] = 'saving'; }
function marcarGuardado(id) {
  estadoGuardado.value[id] = 'saved';
  setTimeout(() => { delete estadoGuardado.value[id]; }, 2000);
}
function marcarError(id) { estadoGuardado.value[id] = 'error'; }

function autoGuardar(row, campos) {
  clearTimeout(timers[row.id]);
  timers[row.id] = setTimeout(async () => {
    marcarGuardando(row.id);
    try {
      await updateDoc(doc(db, COL, row.id), campos);
      marcarGuardado(row.id);
    } catch { marcarError(row.id); }
  }, 600);
}

function onNombreChange(row)      { autoGuardar(row, { nombre: row.nombre }); }
function onDescripcionChange(row) { autoGuardar(row, { descripcion: row.descripcion }); }
function onCategoriaChange(row)   { autoGuardar(row, { categoria: row.categoria }); }
function onDerivaChange(row)      { autoGuardar(row, { derivaA: row.derivaA }); }
function toggleDestacado(row)     { row.destacado = !row.destacado; autoGuardar(row, { destacado: row.destacado }); }
function toggleActivo(row)        { row.activo = !row.activo; autoGuardar(row, { activo: row.activo }); }

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
  const base = slugify(nuevo.value.nombre);
  const tipoSlug = tipoMaquinaActivo.value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const id = `${sectorActivo.value.toLowerCase()}_${tipoSlug}_${base}`;
  const siguiente = Math.max(0, ...sintomas.value.map(s => s.orden ?? 0)) + 1;
  const data = {
    ...nuevo.value,
    nombre:      nuevo.value.nombre.trim(),
    orden:       siguiente,
    sector:      sectorActivo.value,
    tipoMaquina: tipoMaquinaActivo.value,
    creadoEn:    serverTimestamp(),
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
  const ws = wb.addWorksheet(`Síntomas ${sectorActivo.value} ${tipoMaquinaActivo.value}`);

  ws.columns = [
    { header: 'ID',           key: 'id',           width: 32 },
    { header: 'NOMBRE',       key: 'nombre',        width: 28 },
    { header: 'CATEGORÍA',    key: 'categoria',     width: 14 },
    { header: 'DERIVA A',     key: 'derivaA',       width: 13 },
    { header: 'DESCRIPCIÓN',  key: 'descripcion',   width: 50 },
    { header: 'DESTACADO',    key: 'destacado',     width: 12 },
    { header: 'ACTIVO',       key: 'activo',        width: 10 },
    { header: 'ORDEN',        key: 'orden',         width: 8  },
    { header: 'SECTOR',       key: 'sector',        width: 14 },
    { header: 'TIPO MÁQUINA', key: 'tipoMaquina',   width: 14 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.eachCell(cell => {
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  headerRow.height = 22;

  sintomas.value.forEach((s, i) => {
    const row = ws.addRow({
      id: s.id, nombre: s.nombre, categoria: s.categoria, derivaA: s.derivaA,
      descripcion: s.descripcion || '', destacado: s.destacado ? 'Sí' : 'No',
      activo: s.activo ? 'Sí' : 'No', orden: s.orden ?? '',
      sector: s.sector || '', tipoMaquina: s.tipoMaquina || '',
    });
    if (i % 2 === 1) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
      });
    }
    row.alignment = { vertical: 'middle' };
  });

  ws.autoFilter = { from: 'A1', to: 'J1' };
  const buf = await wb.xlsx.writeBuffer();
  saveAs(
    new Blob([buf]),
    `Sintomas_${sectorActivo.value}_${tipoMaquinaActivo.value}_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 pt-4 pb-8">

    <!-- ═══ ENCABEZADO FIJO ════════════════════════════════════════════════════ -->
    <div class="sticky top-0 z-10 bg-white -mx-4 px-4 pt-2 pb-3 border-b border-gray-100 shadow-sm">

      <!-- Descripción + botones de acción -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <p class="text-sm text-gray-500">
          Términos colloquiales que usan operadores e inspectores al reportar problemas.
          <span class="font-semibold text-gray-700">{{ sintomas.length }} síntomas</span>
        </p>
        <div v-if="userRole === 'admin'" class="flex gap-2 shrink-0">
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

      <!-- Selector de Sector -->
      <div class="flex flex-wrap gap-1.5 mb-2">
        <button
          v-for="sec in Object.keys(TIPOS_POR_SECTOR)"
          :key="sec"
          @click="seleccionarSector(sec)"
          class="px-3 py-1 text-xs font-black tracking-wide rounded-full border-2 transition"
          :class="sectorActivo === sec
            ? 'bg-gray-900 border-gray-900 text-white'
            : 'bg-white border-gray-200 text-gray-500 hover:border-gray-500'">
          {{ sec }}
        </button>
      </div>

      <!-- Selector de Tipo de Máquina -->
      <div class="flex flex-wrap gap-1.5 mb-3">
        <button
          v-for="tipo in TIPOS_POR_SECTOR[sectorActivo] || []"
          :key="tipo"
          @click="seleccionarTipo(tipo)"
          class="px-3 py-1 text-xs font-bold rounded-full border-2 transition"
          :class="tipoMaquinaActivo === tipo
            ? 'bg-orange-600 border-orange-600 text-white'
            : 'bg-white border-gray-200 text-gray-400 hover:border-orange-300'">
          {{ tipo }}
        </button>
      </div>

      <!-- Filtros -->
      <div class="flex flex-wrap gap-2">
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
        <button @click="vistaCards = !vistaCards"
          class="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold rounded-lg border transition bg-white border-gray-200 text-gray-600 hover:bg-gray-50">
          <component :is="vistaCards ? Table2 : LayoutGrid" class="w-4 h-4" />
          {{ vistaCards ? 'Tabla' : 'Tarjetas' }}
        </button>
      </div>
    </div>
    <!-- ═══ FIN ENCABEZADO FIJO ═══════════════════════════════════════════════ -->

    <!-- Formulario nuevo síntoma -->
    <div v-if="mostrarForm && userRole === 'admin'" class="mt-4 mb-5 p-4 bg-orange-50 border border-orange-200 rounded-xl shadow-sm">
      <p class="text-xs font-extrabold text-orange-600 tracking-widest mb-0.5">NUEVO SÍNTOMA</p>
      <p class="text-[11px] text-orange-400 font-bold mb-3">{{ sectorActivo }} · {{ tipoMaquinaActivo }}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="sm:col-span-2">
          <label class="text-[10px] font-extrabold text-gray-400 tracking-widest">NOMBRE (término colloquial)</label>
          <input v-model="nuevo.nombre" type="text" placeholder="Ej: Plegador flojo"
            class="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-orange-400 focus:outline-none" />
        </div>
        <div>
          <label class="text-[10px] font-extrabold text-gray-400 tracking-widests">CATEGORÍA</label>
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

    <!-- Loading -->
    <div v-if="cargando" class="flex justify-center py-20">
      <Loader2 class="w-8 h-8 animate-spin text-orange-500" />
    </div>

    <template v-else>

      <!-- ═══ TABLA (desktop, cuando vistaCards=false) ════════════════════════ -->
      <div v-if="!vistaCards" class="hidden sm:block mt-4 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th v-if="userRole === 'admin'" class="px-2 py-2.5 w-12 text-[10px] font-extrabold text-gray-300 tracking-widest text-center">↕</th>
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
              <td :colspan="userRole === 'admin' ? 9 : 8" class="text-center py-12 text-gray-400 text-sm">
                No hay síntomas que coincidan
              </td>
            </tr>
            <tr v-for="(row, i) in filasFiltradas" :key="row.id"
              class="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">

              <!-- Flechas reorden -->
              <td v-if="userRole === 'admin'" class="px-2 py-2 text-center">
                <div v-if="!filtrosActivos" class="flex flex-col items-center gap-0.5">
                  <button @click="moverOrden(row, -1)" :disabled="i === 0"
                    class="p-0.5 rounded text-gray-300 hover:text-gray-700 disabled:opacity-20 transition">
                    <ChevronUp class="w-3.5 h-3.5" />
                  </button>
                  <button @click="moverOrden(row, 1)" :disabled="i === filasFiltradas.length - 1"
                    class="p-0.5 rounded text-gray-300 hover:text-gray-700 disabled:opacity-20 transition">
                    <ChevronDown class="w-3.5 h-3.5" />
                  </button>
                </div>
                <span v-else class="text-[10px] text-gray-200">—</span>
              </td>

              <td class="px-3 py-2 text-center text-[10px] text-gray-400 font-bold">{{ row.orden ?? i+1 }}</td>
              <td class="px-3 py-2 min-w-[160px]">
                <input v-if="userRole === 'admin'" v-model="row.nombre" @input="onNombreChange(row)" type="text"
                  class="w-full bg-transparent text-sm font-bold text-gray-800 focus:outline-none focus:bg-white focus:border-b-2 focus:border-orange-400 rounded px-1 -ml-1" />
                <span v-else class="text-sm font-bold text-gray-800 px-1">{{ row.nombre }}</span>
              </td>
              <td class="px-3 py-2">
                <input v-if="userRole === 'admin'" v-model="row.descripcion" @input="onDescripcionChange(row)" type="text" placeholder="—"
                  class="w-full bg-transparent text-xs text-gray-500 focus:outline-none focus:bg-white focus:border-b focus:border-gray-300 rounded px-1 -ml-1" />
                <span v-else class="text-xs text-gray-500 px-1">{{ row.descripcion || '—' }}</span>
              </td>
              <td class="px-3 py-2 text-center">
                <select v-if="userRole === 'admin'" v-model="row.categoria" @change="onCategoriaChange(row)"
                  class="text-[10px] font-black px-2 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-orange-300"
                  :class="CAT_LABEL[row.categoria] || 'bg-gray-100 text-gray-600'">
                  <option v-for="c in CATEGORIAS" :key="c" :value="c">{{ c }}</option>
                </select>
                <span v-else class="text-[10px] font-black px-2 py-0.5 rounded-full"
                  :class="CAT_LABEL[row.categoria] || 'bg-gray-100 text-gray-600'">{{ row.categoria }}</span>
              </td>
              <td class="px-3 py-2 text-center">
                <select v-if="userRole === 'admin'" v-model="row.derivaA" @change="onDerivaChange(row)"
                  class="text-[10px] font-black px-2 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-orange-300"
                  :class="[DERIVA_LABEL[row.derivaA]?.bg, DERIVA_LABEL[row.derivaA]?.text]">
                  <option v-for="d in DERIVA_A" :key="d" :value="d">{{ DERIVA_LABEL[d]?.label || d }}</option>
                </select>
                <span v-else class="text-[10px] font-black px-2 py-0.5 rounded-full"
                  :class="[DERIVA_LABEL[row.derivaA]?.bg, DERIVA_LABEL[row.derivaA]?.text]">
                  {{ DERIVA_LABEL[row.derivaA]?.label || row.derivaA }}
                </span>
              </td>
              <td class="px-3 py-2 text-center">
                <button v-if="userRole === 'admin'" @click="toggleDestacado(row)" class="text-lg transition"
                  :class="row.destacado ? 'text-amber-400' : 'text-gray-200 hover:text-amber-300'">★</button>
                <span v-else class="text-lg" :class="row.destacado ? 'text-amber-400' : 'text-gray-200'">★</span>
              </td>
              <td class="px-3 py-2 text-center">
                <template v-if="userRole === 'admin'">
                  <button @click="toggleActivo(row)" class="transition">
                    <ToggleRight v-if="row.activo" class="w-6 h-6 text-orange-500" />
                    <ToggleLeft  v-else             class="w-6 h-6 text-gray-300" />
                  </button>
                </template>
                <template v-else>
                  <ToggleRight v-if="row.activo" class="w-6 h-6 text-orange-500 opacity-50" />
                  <ToggleLeft  v-else             class="w-6 h-6 text-gray-300 opacity-50" />
                </template>
              </td>
              <td class="px-3 py-2 text-center">
                <div class="flex items-center justify-center gap-1.5">
                  <Loader2      v-if="estadoGuardado[row.id] === 'saving'"      class="w-3.5 h-3.5 text-orange-400 animate-spin" />
                  <CheckCircle2 v-else-if="estadoGuardado[row.id] === 'saved'"  class="w-3.5 h-3.5 text-green-500" />
                  <button v-if="userRole === 'admin'" @click="eliminar(row)"
                    class="p-1 text-gray-300 hover:text-red-500 transition rounded">
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="px-4 py-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400 font-bold tracking-widest">
          {{ filasFiltradas.length }} de {{ sintomas.length }} síntomas
        </div>
      </div>

      <!-- ═══ TARJETAS (siempre en mobile, en desktop si vistaCards=true) ════ -->
      <div :class="vistaCards ? 'block mt-4' : 'sm:hidden mt-4'">
        <p v-if="!filasFiltradas.length" class="text-center py-12 text-gray-400 text-sm">No hay síntomas que coincidan</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div v-for="(row, i) in filasFiltradas" :key="row.id"
            class="bg-white border rounded-xl p-4 shadow-sm transition-all relative"
            :class="row.activo ? 'border-gray-200' : 'border-gray-100 opacity-60'">

            <!-- Top row: orden + badges + acciones -->
            <div class="flex items-start justify-between gap-2 mb-2">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[10px] font-bold text-gray-400 bg-gray-100 w-6 h-6 rounded-full flex items-center justify-center shrink-0">{{ row.orden ?? i+1 }}</span>
                <span class="text-[10px] font-black px-2 py-0.5 rounded-full"
                  :class="CAT_LABEL[row.categoria] || 'bg-gray-100 text-gray-600'">{{ row.categoria }}</span>
                <span class="text-[10px] font-black px-2 py-0.5 rounded-full"
                  :class="[DERIVA_LABEL[row.derivaA]?.bg, DERIVA_LABEL[row.derivaA]?.text]">
                  {{ DERIVA_LABEL[row.derivaA]?.label || row.derivaA }}
                </span>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <template v-if="userRole === 'admin' && !filtrosActivos">
                  <button @click="moverOrden(row, -1)" :disabled="i === 0"
                    class="p-0.5 text-gray-300 hover:text-gray-700 disabled:opacity-20 transition">
                    <ChevronUp class="w-4 h-4" />
                  </button>
                  <button @click="moverOrden(row, 1)" :disabled="i === filasFiltradas.length - 1"
                    class="p-0.5 text-gray-300 hover:text-gray-700 disabled:opacity-20 transition">
                    <ChevronDown class="w-4 h-4" />
                  </button>
                </template>
                <Loader2      v-if="estadoGuardado[row.id] === 'saving'"      class="w-3.5 h-3.5 text-orange-400 animate-spin" />
                <CheckCircle2 v-else-if="estadoGuardado[row.id] === 'saved'"  class="w-3.5 h-3.5 text-green-500" />
                <template v-if="userRole === 'admin'">
                  <button @click="toggleDestacado(row)" class="text-base transition"
                    :class="row.destacado ? 'text-amber-400' : 'text-gray-200'">★</button>
                  <button @click="toggleActivo(row)" class="transition">
                    <ToggleRight v-if="row.activo" class="w-5 h-5 text-orange-500" />
                    <ToggleLeft  v-else             class="w-5 h-5 text-gray-300" />
                  </button>
                  <button @click="eliminar(row)" class="p-0.5 text-gray-300 hover:text-red-500 transition">
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </template>
                <template v-else>
                  <span class="text-base" :class="row.destacado ? 'text-amber-400' : 'text-gray-200'">★</span>
                  <ToggleRight v-if="row.activo" class="w-5 h-5 text-orange-500 opacity-50" />
                  <ToggleLeft  v-else             class="w-5 h-5 text-gray-300 opacity-50" />
                </template>
              </div>
            </div>

            <!-- Nombre editable (solo admin) -->
            <input v-if="userRole === 'admin'" v-model="row.nombre" @input="onNombreChange(row)" type="text"
              class="w-full bg-transparent text-base font-bold text-gray-800 focus:outline-none focus:bg-gray-50 focus:border-b-2 focus:border-orange-400 rounded px-1 -ml-1 mb-1" />
            <p v-else class="text-base font-bold text-gray-800 px-1 mb-1">{{ row.nombre }}</p>

            <!-- Descripción editable (solo admin) -->
            <input v-if="userRole === 'admin'" v-model="row.descripcion" @input="onDescripcionChange(row)" type="text" placeholder="Sin descripción"
              class="w-full bg-transparent text-xs text-gray-400 focus:outline-none focus:bg-gray-50 focus:border-b focus:border-gray-300 rounded px-1 -ml-1 mb-2" />
            <p v-else class="text-xs text-gray-400 px-1 mb-2">{{ row.descripcion || 'Sin descripción' }}</p>

            <!-- Selectores inline en mobile -->
            <div class="flex items-center gap-2">
              <template v-if="userRole === 'admin'">
                <select v-model="row.categoria" @change="onCategoriaChange(row)"
                  class="text-[10px] font-black px-2 py-1 rounded-full border border-gray-100 cursor-pointer focus:outline-none focus:ring-1 focus:ring-orange-300 bg-white"
                  :class="CAT_LABEL[row.categoria] || 'bg-gray-100 text-gray-600'">
                  <option v-for="c in CATEGORIAS" :key="c" :value="c">{{ c }}</option>
                </select>
                <select v-model="row.derivaA" @change="onDerivaChange(row)"
                  class="text-[10px] font-black px-2 py-1 rounded-full border border-gray-100 cursor-pointer focus:outline-none focus:ring-1 focus:ring-orange-300 bg-white"
                  :class="[DERIVA_LABEL[row.derivaA]?.bg, DERIVA_LABEL[row.derivaA]?.text]">
                  <option v-for="d in DERIVA_A" :key="d" :value="d">{{ DERIVA_LABEL[d]?.label || d }}</option>
                </select>
              </template>
              <template v-else>
                <span class="text-[10px] font-black px-2 py-0.5 rounded-full"
                  :class="CAT_LABEL[row.categoria] || 'bg-gray-100 text-gray-600'">{{ row.categoria }}</span>
                <span class="text-[10px] font-black px-2 py-0.5 rounded-full"
                  :class="[DERIVA_LABEL[row.derivaA]?.bg, DERIVA_LABEL[row.derivaA]?.text]">
                  {{ DERIVA_LABEL[row.derivaA]?.label || row.derivaA }}
                </span>
              </template>
            </div>
          </div>
        </div>
        <div v-if="filasFiltradas.length" class="mt-3 text-center text-[10px] text-gray-400 font-bold tracking-widest">
          {{ filasFiltradas.length }} de {{ sintomas.length }} síntomas
        </div>
      </div>
    </template>

    <!-- Leyenda de colores -->
    <div class="mt-5 flex flex-wrap gap-2">
      <span v-for="(d, key) in DERIVA_LABEL" :key="key"
        class="text-[10px] font-bold px-2 py-1 rounded-full"
        :class="[d.bg, d.text]">
        {{ d.label }}
      </span>
    </div>

  </div>
</template>
