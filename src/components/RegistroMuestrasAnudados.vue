<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import {
  collection, addDoc, getDocs, getDoc, query,
  where, orderBy, deleteDoc, doc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { getAuth } from 'firebase/auth';
import { getTurnoActual, getTurnoLabel } from '../constants/organization';

// ── Defectos de Anudado ───────────────────────────────────────────────────────
const DEFECTOS_ANUDADO = [
  { id: 'nudo_visible',       label: 'Nudo visible' },
  { id: 'hilo_cortado',       label: 'Hilo cortado' },
  { id: 'hilo_doble',         label: 'Hilo doble' },
  { id: 'hilo_flojo',         label: 'Hilo flojo' },
  { id: 'pasamiento_errado',  label: 'Pasamiento errado' },
  { id: 'marca_inicio',       label: 'Marca de inicio' },
  { id: 'barnizado',          label: 'Barnizado / Rotura' },
  { id: 'mancha_grasa',       label: 'Mancha de grasa' },
  { id: 'trama_floja',        label: 'Trama floja' },
  { id: 'correcciones',       label: 'Correcciones' },
  { id: 'falta_hilo',         label: 'Falta de hilo' },
  { id: 'otro',               label: 'Otro' },
];
import { userRole } from '../services/authService';
import { Plus, X, Save, Loader2, Trash2, AlertTriangle, Scissors } from 'lucide-vue-next';
import Swal from 'sweetalert2';

// ── Constantes de sesión ──────────────────────────────────────────────────────
const TURNO = getTurnoActual();
const FECHA = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

// ── Máscara Partida: 7 dígitos "1542301" → "1-5423.01" ────────────────────────
const maskPartida = (raw) => {
  const s = String(raw).replace(/\D/g, '');
  if (s.length < 7) return s;
  return `${s[0]}-${s.slice(1, 5)}.${s.slice(5, 7)}`;
};

// ── Datos maestros ────────────────────────────────────────────────────────────
const telaresMap = ref({});  // { local_fisico → grp_tear }
const operarios  = ref([]);  // [{ legajo, nombre, turno, puesto }]
const muestras   = ref([]);
const cargando   = ref(true);

// ── Estado formulario ─────────────────────────────────────────────────────────
const showForm       = ref(false);
const guardando      = ref(false);
const partidaFocused = ref(false);

// Refs para auto-jump entre inputs
const telarRef    = ref(null);
const partidaRef  = ref(null);
const articuloRef = ref(null);
const mecanicoRef = ref(null);
const inspectorRef = ref(null);

const emptyForm = () => ({
  telar: '', grpTear: '', partida: '', articulo: '',
  defecto: false, defectosList: [],
  mecanico: '', mecanicoNombre: '',
  inspector: '', inspectorNombre: '',
  observaciones: '',
});

const toggleDefecto = (id) => {
  const idx = form.value.defectosList.indexOf(id);
  if (idx >= 0) form.value.defectosList.splice(idx, 1);
  else form.value.defectosList.push(id);
};
const form = ref(emptyForm());
const resetForm = () => { form.value = emptyForm(); partidaFocused.value = false; };

// ── Valor displayable de Partida ──────────────────────────────────────────────
// Muestra dígitos crudos cuando está enfocado, máscara cuando no
const partidaDisplay = computed(() =>
  !partidaFocused.value && form.value.partida.length === 7
    ? maskPartida(form.value.partida)
    : form.value.partida
);

// ── Auto-lookup: Telar → Grupo ────────────────────────────────────────────────
watch(() => form.value.telar, (val) => {
  const n = parseInt(val);
  form.value.grpTear = (!isNaN(n) && val !== '') ? (telaresMap.value[n] ?? '') : '';
});

// ── Auto-lookup: Legajo → Nombre operario ─────────────────────────────────────
const resolveOp = (legajo) => {
  if (!legajo) return '';
  const op = operarios.value.find(o => String(o.legajo) === String(legajo));
  return op?.nombre ?? '';
};
watch(() => form.value.mecanico,  (v) => { form.value.mecanicoNombre  = resolveOp(v); });
watch(() => form.value.inspector, (v) => { form.value.inspectorNombre = resolveOp(v); });

// ── Carga de datos ────────────────────────────────────────────────────────────
onMounted(async () => {
  // Operarios Tejeduría
  try {
    const snap = await getDoc(doc(db, 'config', 'operarios_tejeduria'));
    if (snap.exists()) operarios.value = snap.data().operarios || [];
  } catch { /* fallback: nombre no disponible */ }

  // Máquinas Telar → mapa (maquina - 35000) → grp_tear
  // El número operativo de telar es maquina - 35000 (35001→1, 35064→64, etc.)
  try {
    const snap = await getDocs(query(collection(db, 'maquinas'), where('tipo', '==', 'TELAR')));
    snap.docs.forEach(d => {
      const m = d.data();
      if (m.maquina != null) telaresMap.value[Number(m.maquina) - 35000] = m.grp_tear || '';
    });
  } catch { /* fallback: sin grupo */ }

  await cargarMuestras();
  cargando.value = false;
});

const cargarMuestras = async () => {
  // Intento con orderBy (requiere índice compuesto en Firestore)
  const cargar = async (conOrden) => {
    const constraints = [
      where('fecha', '==', FECHA),
      where('turno', '==', TURNO),
    ];
    if (conOrden) constraints.push(orderBy('createdAt', 'asc'));
    const snap = await getDocs(query(collection(db, 'muestras_anudados'), ...constraints));
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!conOrden) {
      docs.sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? 0;
        const tb = b.createdAt?.toMillis?.() ?? 0;
        return ta - tb;
      });
    }
    return docs;
  };
  try {
    muestras.value = await cargar(true);
  } catch {
    // Índice compuesto todavía no existe → fallback con orden client-side
    try { muestras.value = await cargar(false); } catch (e2) { console.error('Error cargando muestras:', e2); }
  }
};

// ── Handlers del input Partida ────────────────────────────────────────────────
const onPartidaFocus = (e) => {
  partidaFocused.value = true;
  e.target.value = form.value.partida;
};
const onPartidaBlur = (e) => {
  form.value.partida = e.target.value.replace(/\D/g, '').slice(0, 7);
  partidaFocused.value = false;
  if (form.value.partida.length === 7) {
    e.target.value = maskPartida(form.value.partida);
  }
};
const onPartidaInput = (e) => {
  const digits = e.target.value.replace(/\D/g, '').slice(0, 7);
  form.value.partida = digits;
  if (e.target.value !== digits) e.target.value = digits;
  if (digits.length === 7) articuloRef.value?.focus();
};

// ── Handler del input Artículo (solo A-Z0-9, siempre mayúsculas) ──────────────
const onArticuloInput = (e) => {
  const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14);
  form.value.articulo = v;
  if (e.target.value !== v) e.target.value = v;
  if (v.length === 14) mecanicoRef.value?.focus();
};

// ── Handlers Mecánico / Inspector (auto-jump al límite de 4) ─────────────────
const onMecanicoInput = (e) => {
  const v = e.target.value.replace(/\D/g, '').slice(0, 4);
  form.value.mecanico = v;
  e.target.value = v;
  if (v.length === 4) inspectorRef.value?.focus();
};
const onInspectorInput = (e) => {
  const v = e.target.value.replace(/\D/g, '').slice(0, 4);
  form.value.inspector = v;
  e.target.value = v;
};

// ── Guardar ───────────────────────────────────────────────────────────────────
// keepOpen=true → limpia el form para el siguiente; keepOpen=false → cierra el modal
const guardar = async (keepOpen = false) => {
  const f = form.value;
  if (!f.telar.trim()) {
    Swal.fire({ icon: 'warning', title: 'Telar requerido', confirmButtonColor: '#e11d48' });
    return;
  }
  if (f.partida.length !== 7) {
    Swal.fire({ icon: 'warning', title: 'Partida incompleta', text: 'Debe tener exactamente 7 dígitos.', confirmButtonColor: '#e11d48' });
    return;
  }
  if (!f.articulo.trim()) {
    Swal.fire({ icon: 'warning', title: 'Artículo requerido', confirmButtonColor: '#e11d48' });
    return;
  }
  guardando.value = true;
  try {
    await addDoc(collection(db, 'muestras_anudados'), {
      fecha:           FECHA,
      turno:           TURNO,
      telar:           f.telar.trim(),
      grpTear:         f.grpTear || null,
      partida:         parseInt(f.partida),
      partidaFormato:  maskPartida(f.partida),
      articulo:        f.articulo.toUpperCase().slice(0, 14),
      defecto:         f.defecto,
      defectosList:    f.defecto ? f.defectosList : [],
      mecanico:        f.mecanico ? parseInt(f.mecanico) : null,
      mecanicoNombre:  f.mecanicoNombre || null,
      inspector:       f.inspector ? parseInt(f.inspector) : null,
      inspectorNombre: f.inspectorNombre || null,
      observaciones:   f.observaciones.trim() || null,
      creadoPor:       getAuth().currentUser?.uid,
      createdAt:       new Date(),
    });
    await cargarMuestras();
    if (keepOpen) {
      resetForm();
      Swal.fire({ icon: 'success', title: 'Guardado', toast: true, position: 'top-end', timer: 1400, showConfirmButton: false });
    } else {
      showForm.value = false;
      resetForm();
      Swal.fire({ icon: 'success', title: 'Guardado', toast: true, position: 'top-end', timer: 1800, showConfirmButton: false });
    }
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error al guardar', text: e.message });
  } finally {
    guardando.value = false;
  }
};

// ── Eliminar (solo admin) ─────────────────────────────────────────────────────
const eliminar = async (muestra) => {
  const r = await Swal.fire({
    icon: 'warning', title: '¿Eliminar registro?',
    html: `Telar <b>${muestra.telar}</b> · ${muestra.partidaFormato}`,
    showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc2626',
  });
  if (!r.isConfirmed) return;
  await deleteDoc(doc(db, 'muestras_anudados', muestra.id));
  muestras.value = muestras.value.filter(m => m.id !== muestra.id);
};

// ── Stats ─────────────────────────────────────────────────────────────────────
const cntDefecto = computed(() => muestras.value.filter(m => m.defecto).length);
</script>

<template>
  <div class="flex flex-col gap-3 pb-4">

    <!-- ── Header: título + stats + botón agregar ── -->
    <div class="flex items-center justify-between">
      <div>
        <p class="text-xs font-bold text-gray-600">Muestras de Anudados</p>
        <p class="text-[10px] text-gray-400">
          {{ FECHA.split('-').reverse().join('/') }} · Turno {{ getTurnoLabel(TURNO) }}
          <template v-if="muestras.length">
            · {{ muestras.length }} reg.
            <span v-if="cntDefecto" class="text-red-500 font-bold"> · {{ cntDefecto }} con defecto</span>
          </template>
        </p>
      </div>
      <button
        @click="showForm = true"
        class="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-black rounded-xl shadow-sm active:scale-95 transition-all"
      >
        <Plus class="w-4 h-4" />
        Agregar
      </button>
    </div>

    <!-- ── Cargando ── -->
    <div v-if="cargando" class="flex justify-center py-10">
      <Loader2 class="w-6 h-6 text-rose-400 animate-spin" />
    </div>

    <!-- ── Sin registros ── -->
    <div v-else-if="!muestras.length" class="flex flex-col items-center justify-center py-14 gap-2 text-gray-300">
      <Scissors class="w-10 h-10" />
      <p class="text-sm text-gray-400 font-medium">Sin registros para este turno</p>
      <p class="text-[11px] text-gray-400">Turno {{ getTurnoLabel(TURNO) }} · {{ FECHA.split('-').reverse().join('/') }}</p>
    </div>

    <template v-else>

      <!-- ── DESKTOP: Tabla ── -->
      <div class="hidden sm:block overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
        <table class="min-w-full text-xs divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-3 py-2.5 text-left font-bold text-gray-500 uppercase tracking-wide w-6">#</th>
              <th class="px-3 py-2.5 text-left font-bold text-gray-500 uppercase tracking-wide">Telar</th>
              <th class="px-3 py-2.5 text-left font-bold text-gray-500 uppercase tracking-wide">Grp.</th>
              <th class="px-3 py-2.5 text-left font-bold text-gray-500 uppercase tracking-wide">Partida</th>
              <th class="px-3 py-2.5 text-left font-bold text-gray-500 uppercase tracking-wide">Artículo</th>
              <th class="px-3 py-2.5 text-left font-bold text-gray-500 uppercase tracking-wide">Defecto</th>
              <th class="px-3 py-2.5 text-left font-bold text-gray-500 uppercase tracking-wide">Mecánico</th>
              <th class="px-3 py-2.5 text-left font-bold text-gray-500 uppercase tracking-wide">Inspector</th>
              <th class="px-3 py-2.5 text-left font-bold text-gray-500 uppercase tracking-wide">Observaciones</th>
              <th v-if="userRole === 'admin'" class="w-8"></th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-100">
            <tr
              v-for="(m, i) in muestras" :key="m.id"
              class="hover:bg-gray-50 transition-colors"
              :class="m.defecto ? 'bg-red-50/40' : ''"
            >
              <td class="px-3 py-2 text-gray-400 font-mono">{{ i + 1 }}</td>
              <td class="px-3 py-2 font-mono font-black text-gray-800 text-center">{{ m.telar }}</td>
              <td class="px-3 py-2 text-gray-500 font-medium">{{ m.grpTear || '—' }}</td>
              <td class="px-3 py-2 font-mono text-gray-700">{{ m.partidaFormato }}</td>
              <td class="px-3 py-2 font-mono font-medium text-gray-700">{{ m.articulo }}</td>
              <td class="px-3 py-2">
                <span
                  v-if="m.defecto"
                  class="inline-flex items-center gap-1 text-[10px] font-black text-red-600 bg-red-100 rounded-full px-2 py-0.5 whitespace-nowrap"
                >
                  <AlertTriangle class="w-3 h-3" />Defecto
                </span>
                <span v-else class="text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">OK</span>
              </td>
              <td class="px-3 py-2">
                <template v-if="m.mecanico">
                  <span class="font-mono font-bold text-gray-700">{{ m.mecanico }}</span>
                  <span v-if="m.mecanicoNombre" class="block text-[10px] text-gray-400 leading-tight max-w-[110px] truncate">{{ m.mecanicoNombre }}</span>
                </template>
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="px-3 py-2">
                <template v-if="m.inspector">
                  <span class="font-mono font-bold text-gray-700">{{ m.inspector }}</span>
                  <span v-if="m.inspectorNombre" class="block text-[10px] text-gray-400 leading-tight max-w-[110px] truncate">{{ m.inspectorNombre }}</span>
                </template>
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="px-3 py-2 text-gray-500 max-w-[200px] truncate">{{ m.observaciones || '—' }}</td>
              <td v-if="userRole === 'admin'" class="px-2 py-2">
                <button @click="eliminar(m)" class="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-all">
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ── MOBILE: Cards ── -->
      <div class="sm:hidden space-y-2.5">
        <div
          v-for="(m, i) in muestras" :key="m.id"
          class="bg-white rounded-xl border shadow-sm overflow-hidden"
          :class="m.defecto ? 'border-red-200' : 'border-gray-200'"
        >
          <!-- Cabecera de la card -->
          <div
            class="flex items-center justify-between px-4 py-2.5 gap-2"
            :class="m.defecto ? 'bg-red-50' : 'bg-gray-50'"
          >
            <div class="flex items-center gap-2 flex-wrap min-w-0">
              <span class="text-[10px] font-bold text-gray-400">#{{ i + 1 }}</span>
              <span class="font-mono font-black text-gray-800 text-sm">T-{{ m.telar }}</span>
              <span v-if="m.grpTear" class="text-[10px] font-bold text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5 shrink-0">{{ m.grpTear }}</span>
              <span class="font-mono text-xs text-gray-600 bg-white rounded px-1.5 py-0.5 border border-gray-200 shrink-0">{{ m.partidaFormato }}</span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <span
                v-if="m.defecto"
                class="inline-flex items-center gap-0.5 text-[10px] font-black text-red-600 bg-red-100 rounded-full px-2 py-0.5 whitespace-nowrap"
              >
                <AlertTriangle class="w-3 h-3" />Defecto
              </span>
              <span v-else class="text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">OK</span>
              <button
                v-if="userRole === 'admin'"
                @click="eliminar(m)"
                class="p-1 text-gray-300 hover:text-red-500 rounded transition-all ml-0.5"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <!-- Cuerpo de la card -->
          <div class="px-4 py-2.5 space-y-1.5">
            <p class="font-mono font-bold text-gray-700 text-sm">{{ m.articulo }}</p>
            <div class="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-500">
              <span v-if="m.mecanico">
                🔧 <span class="font-mono font-bold">{{ m.mecanico }}</span>
                <span v-if="m.mecanicoNombre"> · {{ m.mecanicoNombre }}</span>
              </span>
              <span v-if="m.inspector">
                👁 <span class="font-mono font-bold">{{ m.inspector }}</span>
                <span v-if="m.inspectorNombre"> · {{ m.inspectorNombre }}</span>
              </span>
            </div>
            <p
              v-if="m.observaciones"
              class="text-[11px] text-gray-600 italic bg-amber-50 rounded-lg px-2.5 py-1.5 leading-snug"
            >{{ m.observaciones }}</p>
          </div>
        </div>
      </div>

    </template>

    <!-- ── Modal: Formulario de carga ── -->
    <Teleport to="body">
      <div
        v-if="showForm"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      >
        <div class="w-full max-w-lg bg-white rounded-2xl shadow-2xl flex flex-col" style="max-height:92dvh;">

          <!-- Header del form -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <p class="text-sm font-black text-gray-800">Nueva Muestra de Anudado</p>
              <p class="text-[10px] text-gray-400">
                {{ FECHA.split('-').reverse().join('/') }} · Turno {{ getTurnoLabel(TURNO) }}
              </p>
            </div>
            <button
              @click="showForm = false; resetForm()"
              class="p-2 rounded-lg hover:bg-gray-100 transition-all"
            >
              <X class="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <!-- Body del form (scrollable) -->
          <div class="px-5 pt-4 pb-2 space-y-4 overflow-y-auto flex-1">

            <!-- Fila 1: Telar · Grupo (auto) · Partida -->
            <div class="flex gap-3 items-end">
              <!-- Telar: ancho fijo para 2 chars -->
              <div class="shrink-0" style="width:72px">
                <label class="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">Telar *</label>
                <input
                  ref="telarRef"
                  :value="form.telar"
                  @input="form.telar = $event.target.value.replace(/\D/g,'').slice(0,2); $event.target.value = form.telar; if(form.telar.length===2) partidaRef?.focus()"
                  type="text" inputmode="numeric"
                  placeholder="64"
                  class="w-full border border-gray-200 rounded-lg px-2 py-2.5 text-base font-mono font-black text-center focus:ring-2 focus:ring-rose-400 focus:border-rose-400 outline-none"
                />
              </div>
              <!-- Grupo: auto readonly -->
              <div class="shrink-0" style="width:90px">
                <label class="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">Grupo</label>
                <input
                  :value="form.grpTear || ''"
                  readonly
                  placeholder="—"
                  class="w-full border border-gray-100 rounded-lg px-2 py-2.5 text-base font-mono font-bold text-gray-600 bg-gray-50 text-center outline-none cursor-not-allowed"
                />
              </div>
              <!-- Partida -->
              <div class="flex-1">
                <label class="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">Partida *</label>
                <input
                  ref="partidaRef"
                  :value="partidaDisplay"
                  @focus="onPartidaFocus"
                  @blur="onPartidaBlur"
                  @input="onPartidaInput"
                  type="text" inputmode="numeric"
                  placeholder="1-5423.01"
                  class="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-base font-mono font-bold focus:ring-2 focus:ring-rose-400 focus:border-rose-400 outline-none"
                />
              </div>
            </div>

            <!-- Fila 2: Artículo + Defecto toggle -->
            <div class="flex gap-3 items-end">
              <div class="flex-1">
                <label class="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">
                  Artículo * <span class="normal-case font-normal text-gray-400 text-[10px]">(máx 14)</span>
                </label>
                <input
                  ref="articuloRef"
                  :value="form.articulo"
                  @input="onArticuloInput"
                  type="text"
                  placeholder="AF3100GES561"
                  class="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-base font-mono font-bold uppercase tracking-wider focus:ring-2 focus:ring-rose-400 focus:border-rose-400 outline-none"
                />
              </div>
              <div class="shrink-0" style="width:100px">
                <label class="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">Defecto</label>
                <button
                  type="button"
                  @click="form.defecto = !form.defecto; if(!form.defecto) form.defectosList=[]"
                  class="w-full py-2.5 rounded-lg border text-sm font-black transition-all"
                  :class="form.defecto
                    ? 'bg-red-500 border-red-500 text-white'
                    : 'bg-white border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-500'"
                >
                  {{ form.defecto ? '⚠ Def.' : '✓ OK' }}
                </button>
              </div>
            </div>

            <!-- Panel de defectos (visible solo cuando defecto=true) -->
            <div v-if="form.defecto" class="rounded-xl border border-red-200 bg-red-50 p-3">
              <p class="text-[10px] font-black text-red-500 uppercase tracking-wide mb-2">Tipo de defecto</p>
              <div class="grid grid-cols-3 gap-1.5">
                <button
                  v-for="d in DEFECTOS_ANUDADO" :key="d.id"
                  type="button"
                  @click="toggleDefecto(d.id)"
                  class="py-1.5 px-1 rounded-lg border text-[11px] font-bold text-center transition-all leading-tight"
                  :class="form.defectosList.includes(d.id)
                    ? 'bg-red-600 border-red-600 text-white shadow-sm'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-red-300'"
                >
                  {{ d.label }}
                </button>
              </div>
            </div>

            <!-- Mecánico: label + legajo + nombre en una línea -->
            <div>
              <label class="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">Mecánico</label>
              <div class="flex items-center gap-3">
                <input
                  ref="mecanicoRef"
                  :value="form.mecanico"
                  @input="onMecanicoInput"
                  type="text" inputmode="numeric"
                  placeholder="Leg."
                  class="border border-gray-200 rounded-lg px-2 py-2.5 text-base font-mono font-bold text-center focus:ring-2 focus:ring-rose-400 focus:border-rose-400 outline-none shrink-0"
                  style="width:68px"
                />
                <p class="text-base font-black truncate" :class="form.mecanicoNombre ? 'text-gray-800' : 'text-gray-300 italic text-sm font-normal'">
                  {{ form.mecanicoNombre || '—' }}
                </p>
              </div>
            </div>

            <!-- Inspector: label + legajo + nombre en una línea -->
            <div>
              <label class="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">Inspector</label>
              <div class="flex items-center gap-3">
                <input
                  ref="inspectorRef"
                  :value="form.inspector"
                  @input="onInspectorInput"
                  type="text" inputmode="numeric"
                  placeholder="Leg."
                  class="border border-gray-200 rounded-lg px-2 py-2.5 text-base font-mono font-bold text-center focus:ring-2 focus:ring-rose-400 focus:border-rose-400 outline-none shrink-0"
                  style="width:68px"
                />
                <p class="text-base font-black truncate" :class="form.inspectorNombre ? 'text-gray-800' : 'text-gray-300 italic text-sm font-normal'">
                  {{ form.inspectorNombre || '—' }}
                </p>
              </div>
            </div>

            <!-- Observaciones -->
            <div>
              <label class="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">Observaciones</label>
              <textarea
                v-model="form.observaciones"
                rows="2"
                placeholder="Describí el defecto o novedad encontrada..."
                class="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-base font-bold focus:ring-2 focus:ring-rose-400 focus:border-rose-400 outline-none resize-none"
              />
            </div>

          </div>

          <!-- Footer del form -->
          <div class="px-5 pb-5 pt-3 border-t border-gray-100 flex gap-2">
            <button
              @click="showForm = false; resetForm()"
              class="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all shrink-0"
            >
              Cerrar
            </button>
            <button
              @click="guardar(false)"
              :disabled="guardando"
              class="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-black transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Loader2 v-if="guardando" class="w-4 h-4 animate-spin" />
              <Save v-else class="w-4 h-4" />
              Guardar
            </button>
            <button
              @click="guardar(true)"
              :disabled="guardando"
              class="flex-1 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-900 text-white text-sm font-black transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              Siguiente
              <span class="text-base leading-none">→</span>
            </button>
          </div>

        </div>
      </div>
    </Teleport>

  </div>
</template>
