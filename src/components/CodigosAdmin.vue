<script setup>
import { ref, computed, onMounted } from 'vue';
import { codigosService } from '../services/codigosService';
import { Search, ToggleLeft, ToggleRight, CheckCircle2, Loader2, AlertCircle, Star, FileDown } from 'lucide-vue-next';
import Swal from 'sweetalert2';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

// ── Constantes ────────────────────────────────────────────────────────────────
// Tipos sugeridos (se pueden escribir libremente en el input)
const TIPOS_DEFECTO = ['TRAMA', 'URDIMBRE'];
const TIPOS_PARADA  = [];   // se definen cuando corresponda

const COL_DEFECTOS = 'codigos_defectos';
const COL_PARADAS  = 'codigos_paradas';

// ── Estado ────────────────────────────────────────────────────────────────────
const tabActiva   = ref('defectos');   // 'defectos' | 'paradas'
const defectos    = ref([]);
const paradas     = ref([]);
const cargando    = ref(true);
const soloActivos = ref(true);
const busqueda    = ref('');
const filtroGrupo = ref('');           // filtro por local/grupo

// Estado de guardado por doc id: 'idle' | 'saving' | 'saved' | 'error'
const estadoGuardado = ref({});

// ── Carga inicial ─────────────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const [d, p] = await Promise.all([
      codigosService.getDefectos(false),
      codigosService.getParadas(false),
    ]);
    defectos.value = d;
    paradas.value  = p;
  } catch (err) {
    Swal.fire({ icon: 'error', title: 'Error de carga', text: err.message });
  } finally {
    cargando.value = false;
  }
});

// ── Computed ──────────────────────────────────────────────────────────────────
const listaActual = computed(() => tabActiva.value === 'defectos' ? defectos.value : paradas.value);

const gruposDisponibles = computed(() => {
  const campo = tabActiva.value === 'defectos' ? 'local' : 'grupo_nombre';
  const vals = listaActual.value.map(r => r[campo]).filter(Boolean);
  return [...new Set(vals)].sort();
});

const filasFiltradas = computed(() => {
  let lista = listaActual.value;
  if (soloActivos.value) lista = lista.filter(r => r.activo);
  if (filtroGrupo.value) {
    const campo = tabActiva.value === 'defectos' ? 'local' : 'grupo_nombre';
    lista = lista.filter(r => r[campo] === filtroGrupo.value);
  }
  if (busqueda.value.trim()) {
    const q = busqueda.value.toLowerCase();
    lista = lista.filter(r =>
      String(r.codigo || '').includes(q) ||
      (r.descripcion_es || r.motivo_es || '').toLowerCase().includes(q) ||
      (r.descripcion_pt || r.motivo_pt || '').toLowerCase().includes(q) ||
      (r.tipoDeFalla || '').toLowerCase().includes(q) ||
      (r.alias || '').toLowerCase().includes(q)
    );
  }
  return lista;
});

const sugerenciasTipos = computed(() =>
  tabActiva.value === 'defectos' ? TIPOS_DEFECTO : TIPOS_PARADA
);

const coleccionActual = computed(() =>
  tabActiva.value === 'defectos' ? COL_DEFECTOS : COL_PARADAS
);

// Normaliza ambos schemas: snake_case (nuestro import) y camelCase (legado)
const descripcionFila = (row) =>
  tabActiva.value === 'defectos'
    ? {
        es:    row.descripcion_es    || row.descripcionEs  || '',
        pt:    row.descripcion_pt    || row.descripcionPt  || '',
        grupo: row.local             || '',
      }
    : {
        es:    row.motivo_es         || row.motivoEs       || '',
        pt:    row.motivo_pt         || row.motivoPt       || '',
        grupo: row.grupo_nombre      || (row.grupoCodigo === 2 ? 'MECANICA' : row.grupoCodigo === 4 ? 'ELECTRICA' : ''),
      };

// ── Auto-guardado ─────────────────────────────────────────────────────────────
const timers = {};

function autoGuardar(row, campo) {
  const key = `${row.id}_${campo}`;
  clearTimeout(timers[key]);
  estadoGuardado.value[row.id] = 'saving';
  timers[key] = setTimeout(async () => {
    try {
      await codigosService.actualizarCodigo(coleccionActual.value, row.id, {
        [campo]: row[campo] ?? null,
      });
      estadoGuardado.value[row.id] = 'saved';
      setTimeout(() => { delete estadoGuardado.value[row.id]; }, 2000);
    } catch {
      estadoGuardado.value[row.id] = 'error';
    }
  }, 600);
}

function toggleActivo(row) {
  row.activo = !row.activo;
  autoGuardar(row, 'activo');
}

function toggleDestacado(row) {
  row.destacado = !row.destacado;
  autoGuardar(row, 'destacado');
}

// ── Export a Excel ────────────────────────────────────────────────────────────
const exportando = ref(false);

async function exportarExcel() {
  exportando.value = true;
  try {
    const wb    = new ExcelJS.Workbook();
    const esDefectos = tabActiva.value === 'defectos';
    const ws    = wb.addWorksheet(esDefectos ? 'Defectos de Calidad' : 'Motivos de Parada');

    // Columnas
    ws.columns = esDefectos
      ? [
          { header: 'COD',          key: 'codigo',     width: 8  },
          { header: 'PORTUGUÉS',     key: 'pt',         width: 40 },
          { header: 'ESPAÑOL',       key: 'es',         width: 40 },
          { header: 'ALIAS (coloquial)', key: 'alias',  width: 30 },
          { header: 'GRUPO',         key: 'grupo',      width: 14 },
          { header: 'TIPO DE FALLA', key: 'tipoDeFalla', width: 16 },
          { header: 'DESTACADO',     key: 'destacado',  width: 12 },
          { header: 'ACTIVO',        key: 'activo',     width: 10 },
        ]
      : [
          { header: 'COD',          key: 'codigo',     width: 8  },
          { header: 'PORTUGUÉS',     key: 'pt',         width: 40 },
          { header: 'ESPAÑOL',       key: 'es',         width: 40 },
          { header: 'ALIAS (coloquial)', key: 'alias',  width: 30 },
          { header: 'GRUPO',         key: 'grupo',      width: 14 },
          { header: 'TIPO DE FALLA', key: 'tipoDeFalla', width: 16 },
          { header: 'DESTACADO',     key: 'destacado',  width: 12 },
          { header: 'ACTIVO',        key: 'activo',     width: 10 },
        ];

    // Estilo cabecera
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 20;

    // Datos (usa la lista ya filtrada)
    filasFiltradas.value.forEach(row => {
      const desc = descripcionFila(row);
      ws.addRow({
        codigo:      row.codigo,
        pt:          desc.pt  || '',
        es:          desc.es  || '',
        alias:       row.alias || '',
        grupo:       desc.grupo || '',
        tipoDeFalla: row.tipoDeFalla || '',
        destacado:   row.destacado  ? 'SÍ' : 'NO',
        activo:      row.activo     ? 'SÍ' : 'NO',
      });
    });

    // Estilo filas alternadas
    ws.eachRow((row, num) => {
      if (num < 2) return;
      row.alignment = { vertical: 'middle' };
      if (num % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3FF' } };
      }
    });

    const buf  = await wb.xlsx.writeBuffer();
    const nombre = esDefectos ? 'Defectos_Calidad' : 'Motivos_Parada';
    const fecha  = new Date().toISOString().slice(0, 10);
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${nombre}_${fecha}.xlsx`);
  } catch (err) {
    Swal.fire({ icon: 'error', title: 'Error al exportar', text: err.message });
  } finally {
    exportando.value = false;
  }
}

// Devuelve el nombre del campo ES según el schema del doc
function campoEs(row) {
  if (tabActiva.value === 'defectos') {
    return row.descripcion_es !== undefined ? 'descripcion_es' : 'descripcionEs';
  }
  return row.motivo_es !== undefined ? 'motivo_es' : 'motivoEs';
}

function guardarEs(row) {
  const campo = campoEs(row);
  autoGuardar(row, campo);
}

// ── Tab switch ────────────────────────────────────────────────────────────────
function cambiarTab(tab) {
  tabActiva.value = tab;
  busqueda.value  = '';
  filtroGrupo.value = '';
}
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <div class="bg-white border-b border-gray-200 sticky top-16 z-30">
      <div class="max-w-7xl mx-auto px-4 py-3 space-y-3">

        <!-- Tabs -->
        <div class="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          <button
            v-for="tab in [{ id: 'defectos', label: 'Defectos de Calidad', count: defectos.length }, { id: 'paradas', label: 'Motivos de Parada', count: paradas.length }]"
            :key="tab.id"
            @click="cambiarTab(tab.id)"
            class="px-4 py-1.5 rounded-md text-sm font-bold transition-all"
            :class="tabActiva === tab.id
              ? 'bg-white shadow text-gray-900'
              : 'text-gray-500 hover:text-gray-700'"
          >
            {{ tab.label }}
            <span class="ml-1.5 text-[10px] font-black px-1.5 py-0.5 rounded-full"
              :class="tabActiva === tab.id ? 'bg-gray-100 text-gray-600' : 'bg-gray-200/70 text-gray-400'"
            >{{ tab.count }}</span>
          </button>
        </div>

        <!-- Filtros -->
        <div class="flex flex-wrap gap-2 items-center">

          <!-- Buscar -->
          <div class="relative">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              v-model="busqueda"
              type="text"
              placeholder="Buscar código o descripción…"
              class="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none w-56"
            />
          </div>

          <!-- Filtro grupo -->
          <select
            v-model="filtroGrupo"
            class="py-1.5 px-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 outline-none"
          >
            <option value="">Todos los grupos</option>
            <option v-for="g in gruposDisponibles" :key="g" :value="g">{{ g }}</option>
          </select>

          <!-- Toggle solo activos -->
          <button
            @click="soloActivos = !soloActivos"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-semibold transition-all"
            :class="soloActivos ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-gray-200 text-gray-500'"
          >
            <component :is="soloActivos ? ToggleRight : ToggleLeft" class="w-4 h-4" />
            Solo activos
          </button>

          <!-- Contador -->
          <span class="text-xs text-gray-400 font-semibold ml-1">
            {{ filasFiltradas.length }} registros
          </span>

          <!-- Exportar -->
          <button
            @click="exportarExcel"
            :disabled="exportando"
            class="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-semibold transition-all bg-white border-gray-200 text-gray-600 hover:bg-green-50 hover:border-green-300 hover:text-green-700 disabled:opacity-50"
          >
            <Loader2 v-if="exportando" class="w-4 h-4 animate-spin" />
            <FileDown v-else class="w-4 h-4" />
            Exportar Excel
          </button>
        </div>

      </div>
    </div>

    <!-- ── Cuerpo ───────────────────────────────────────────────────────────── -->
    <div class="max-w-7xl mx-auto px-4 py-4">

      <!-- Cargando -->
      <div v-if="cargando" class="flex items-center justify-center py-20 gap-3 text-gray-400">
        <Loader2 class="w-6 h-6 animate-spin" />
        <span class="text-sm font-semibold">Cargando códigos…</span>
      </div>

      <!-- Tabla -->
      <div v-else class="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-200">
                <th class="px-3 py-2.5 text-left text-[10px] font-extrabold text-gray-400 tracking-widest w-14">COD</th>
                <th class="px-3 py-2.5 text-left text-[10px] font-extrabold text-gray-400 tracking-widest">PORTUGUÉS</th>
                <th class="px-3 py-2.5 text-left text-[10px] font-extrabold text-gray-400 tracking-widest">
                  ESPAÑOL
                  <span class="ml-1 text-[9px] text-green-500 font-bold normal-case">(editable)</span>
                </th>
                <th class="px-3 py-2.5 text-left text-[10px] font-extrabold text-gray-400 tracking-widest w-24">GRUPO</th>
                <th class="px-3 py-2.5 text-left text-[10px] font-extrabold text-gray-400 tracking-widest w-36">
                  TIPO DE FALLA
                  <span class="ml-1 text-[9px] text-indigo-400 font-bold normal-case">(editable)</span>
                </th>
                <th class="px-3 py-2.5 text-left text-[10px] font-extrabold text-gray-400 tracking-widest w-40">
                  ALIAS
                  <span class="ml-1 text-[9px] text-violet-400 font-bold normal-case">(término coloquial)</span>
                </th>
                <th class="px-3 py-2.5 text-center text-[10px] font-extrabold text-gray-400 tracking-widest w-20">
                  DESTACADO
                  <span class="block text-[8px] text-amber-400 font-bold normal-case">★ visible por defecto</span>
                </th>
                <th class="px-3 py-2.5 text-center text-[10px] font-extrabold text-gray-400 tracking-widest w-16">ACTIVO</th>
                <th class="px-3 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr
                v-for="row in filasFiltradas"
                :key="row.id"
                class="hover:bg-gray-50/70 transition-colors"
                :class="!row.activo ? 'opacity-40' : ''"
              >
                <!-- Código -->
                <td class="px-3 py-2.5">
                  <span class="font-black text-gray-800 text-sm">{{ row.codigo }}</span>
                </td>

                <!-- PT -->
                <td class="px-3 py-2.5 max-w-48">
                  <span class="text-gray-400 text-xs truncate block" :title="descripcionFila(row).pt">
                    {{ descripcionFila(row).pt || '—' }}
                  </span>
                </td>

                <!-- ES (editable) -->
                <td class="px-3 py-2.5 max-w-64">
                  <div class="relative group">
                    <input
                      :value="descripcionFila(row).es"
                      @change="e => { const campo = campoEs(row); row[campo] = e.target.value; guardarEs(row); }"
                      :placeholder="descripcionFila(row).pt || 'Sin traducción'"
                      class="w-full border-0 border-b border-dashed border-gray-200 focus:border-green-400 focus:ring-0 bg-transparent text-sm outline-none py-0.5 transition-colors"
                      :class="descripcionFila(row).es ? 'text-gray-800 font-semibold' : 'text-amber-500 italic font-normal'"
                    />
                    <span v-if="!descripcionFila(row).es"
                      class="absolute right-0 top-0.5 text-[9px] text-amber-400 font-black pointer-events-none">PT</span>
                  </div>
                </td>

                <!-- Grupo -->
                <td class="px-3 py-2.5">
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-black tracking-wide"
                    :class="{
                      'bg-blue-50 text-blue-700':   descripcionFila(row).grupo === 'MECANICA'   || descripcionFila(row).grupo === 'TEJEDURIA',
                      'bg-amber-50 text-amber-700':  descripcionFila(row).grupo === 'ELECTRICA',
                      'bg-violet-50 text-violet-700':descripcionFila(row).grupo === 'HILANDERIA',
                      'bg-gray-100 text-gray-500':   !descripcionFila(row).grupo,
                    }"
                  >{{ descripcionFila(row).grupo || '—' }}</span>
                </td>

                <!-- Tipo de falla (editable) -->
                <td class="px-3 py-2.5">
                  <select
                    v-model="row.tipoDeFalla"
                    @change="autoGuardar(row, 'tipoDeFalla')"
                    class="w-full border-0 border-b border-dashed border-gray-200 focus:border-indigo-400 focus:ring-0 bg-transparent text-xs font-bold outline-none py-0.5 uppercase transition-colors cursor-pointer"
                    :class="row.tipoDeFalla ? 'text-indigo-700' : 'text-gray-400'"
                  >
                    <option :value="null">Sin clasificar</option>
                    <option v-for="t in sugerenciasTipos" :key="t" :value="t">{{ t }}</option>
                  </select>
                </td>

                <!-- Alias (editable) -->
                <td class="px-3 py-2.5">
                  <input
                    v-model="row.alias"
                    @change="autoGuardar(row, 'alias')"
                    placeholder="ej: tijerita, colita…"
                    class="w-full border-0 border-b border-dashed border-gray-200 focus:border-violet-400 focus:ring-0 bg-transparent text-xs font-bold text-violet-700 placeholder-gray-300 outline-none py-0.5 transition-colors"
                    :class="row.alias ? 'text-violet-700' : 'text-gray-300'"
                  />
                </td>

                <!-- Destacado (checkbox) -->
                <td class="px-3 py-2.5 text-center">
                  <button
                    type="button"
                    @click="toggleDestacado(row)"
                    :title="row.destacado ? 'Quitar de destacados' : 'Marcar como destacado'"
                    class="transition-all active:scale-90"
                    :class="row.destacado ? 'text-amber-400 hover:text-amber-500' : 'text-gray-200 hover:text-gray-300'"
                  >
                    <Star class="w-5 h-5 mx-auto" :fill="row.destacado ? 'currentColor' : 'none'" />
                  </button>
                </td>

                <!-- Activo -->
                <td class="px-3 py-2.5 text-center">
                  <button
                    type="button"
                    @click="toggleActivo(row)"
                    class="w-10 h-5 rounded-full transition-all relative"
                    :class="row.activo ? 'bg-emerald-500' : 'bg-gray-200'"
                  >
                    <span
                      class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all"
                      :class="row.activo ? 'left-[calc(100%-1.25rem)]' : 'left-0.5'"
                    ></span>
                  </button>
                </td>

                <!-- Estado de guardado -->
                <td class="px-2 py-2.5 text-center">
                  <Loader2
                    v-if="estadoGuardado[row.id] === 'saving'"
                    class="w-3.5 h-3.5 text-indigo-400 animate-spin mx-auto"
                  />
                  <CheckCircle2
                    v-else-if="estadoGuardado[row.id] === 'saved'"
                    class="w-3.5 h-3.5 text-emerald-500 mx-auto"
                  />
                  <AlertCircle
                    v-else-if="estadoGuardado[row.id] === 'error'"
                    class="w-3.5 h-3.5 text-red-500 mx-auto"
                  />
                </td>
              </tr>

              <!-- Vacío -->
              <tr v-if="filasFiltradas.length === 0">
                <td colspan="8" class="px-4 py-10 text-center text-sm text-gray-400 font-semibold">
                  No hay registros que coincidan con los filtros.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Leyenda -->
      <p class="text-[11px] text-gray-400 mt-3 ml-1">
        · <strong>Tipo de falla</strong>: TRAMA, URDIMBRE… — define el grupo en los pills del formulario.
        · <strong>Alias 🗨</strong>: término coloquial del operario (ej: "tijerita", "colita tejida"). Se muestra como texto principal en el listbox.
        · <strong>Destacado ★</strong>: los marcados aparecen directamente sin expandir la lista.
      </p>
    </div>
  </div>
</template>
