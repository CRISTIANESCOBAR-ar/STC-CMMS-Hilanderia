<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Search, Users, Filter, Camera, Loader2, XCircle, Calendar, ChevronLeft, ChevronRight, UserPlus, Pencil, Trash2, Save, X, LayoutGrid, Table2 } from 'lucide-vue-next';
import CameraCapture from './CameraCapture.vue';
import Swal from 'sweetalert2';

// ── Estado general ──
const searchQuery = ref('');
const showCamera = ref(false);
const isProcessing = ref(false);
const isLoading = ref(false);
const showGestion = ref(false);

const turnos = ['A', 'B', 'C'];

// Determina el turno activo según la hora local:
// A: 06:00–13:59 | B: 14:00–21:59 | C: 22:00–05:59
const turnoDeHora = () => {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return 'A';
  if (h >= 14 && h < 22) return 'B';
  return 'C';
};
const turnoActivo = ref(turnoDeHora());
const vistaCards = ref(typeof window !== 'undefined' && window.innerWidth < 640);

// ── Tabla maestra de operarios (Firestore: config/operarios_tejeduria) ──
const maestroOperarios = ref([]);

const cargarMaestro = async () => {
  try {
    const snap = await getDoc(doc(db, 'config', 'operarios_tejeduria'));
    if (snap.exists() && snap.data().operarios?.length) {
      maestroOperarios.value = snap.data().operarios;
    }
  } catch (e) {
    console.error('Error cargando maestro:', e);
  }
};

const guardarMaestro = async () => {
  try {
    await setDoc(doc(db, 'config', 'operarios_tejeduria'), {
      operarios: maestroOperarios.value,
      updatedAt: new Date(),
    });
  } catch (e) {
    console.error('Error guardando maestro:', e);
  }
};

// ── Datos del día: operarios del turno + extras escaneados ──
const registroDia = ref([]);
// Extras: operarios que aparecieron en el escaneo pero no están en el turno
const extrasEscaneados = ref([]);

const operariosTurno = computed(() =>
  maestroOperarios.value.filter(op => op.turno === turnoActivo.value)
);

// Lista combinada: turno asignado + extras del escaneo
const listaCompleta = computed(() => {
  const asignados = operariosTurno.value.map(op => {
    const reg = registroDia.value.find(r => r.legajo === op.legajo);
    return {
      ...op,
      ingreso: reg?.ingreso || '',
      salida: reg?.salida || '',
      inicio: reg?.inicio || '',
      final: reg?.final || '',
      estado: 'asignado', // pertenece al turno
    };
  });
  const extras = extrasEscaneados.value.map(ex => {
    const maestro = maestroOperarios.value.find(m => m.legajo === ex.legajo);
    return {
      legajo: ex.legajo,
      nombre: ex.nombre || maestro?.nombre || `Legajo ${ex.legajo}`,
      puesto: maestro?.puesto || '',
      turnoOriginal: maestro?.turno || null,
      ingreso: ex.ingreso || '',
      salida: ex.salida || '',
      inicio: ex.inicio || '',
      final: ex.final || '',
      estado: maestro ? 'otro_turno' : 'desconocido',
    };
  });
  return [...asignados, ...extras];
});

const operariosFiltrados = computed(() => {
  const lista = listaCompleta.value;
  if (!searchQuery.value.trim()) return lista;
  const q = searchQuery.value.trim().toLowerCase();
  return lista.filter(op =>
    op.nombre.toLowerCase().includes(q) ||
    String(op.legajo).includes(q) ||
    (op.puesto || '').toLowerCase().includes(q)
  );
});

const totalTurno = computed(() => listaCompleta.value.length);
const totalAsignados = computed(() => operariosTurno.value.length);
const tieneHorarios = computed(() =>
  listaCompleta.value.some(op => op.ingreso || op.salida || op.inicio || op.final)
);

// ── Fecha ──
const fechaHoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const fechaSeleccionada = ref(fechaHoy());
const esHoy = computed(() => fechaSeleccionada.value === fechaHoy());
const cambiarFecha = (delta) => {
  const [y, m, d] = fechaSeleccionada.value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  fechaSeleccionada.value = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
};
const docId = (turno) => `${fechaSeleccionada.value}_${turno}`;

// ── Firestore: guardar/cargar horarios del día ──
const guardarHorarios = async (turno) => {
  const lista = listaCompleta.value;
  const horarios = {};
  const extras = [];
  lista.forEach(op => {
    if (op.ingreso || op.salida || op.inicio || op.final) {
      horarios[op.legajo] = {
        ingreso: op.ingreso || '',
        salida: op.salida || '',
        inicio: op.inicio || '',
        final: op.final || '',
        nombre: op.nombre,
        estado: op.estado,
      };
    }
    if (op.estado !== 'asignado') {
      extras.push({ legajo: op.legajo, nombre: op.nombre, estado: op.estado, turnoOriginal: op.turnoOriginal || null });
    }
  });
  try {
    await setDoc(doc(db, 'operarios_horarios', docId(turno)), {
      turno,
      fecha: fechaSeleccionada.value,
      horarios,
      extras,
      updatedAt: new Date(),
    }, { merge: true });
  } catch (e) {
    console.error('Error guardando horarios:', e);
  }
};

const cargarHorarios = async (turno) => {
  registroDia.value = [];
  extrasEscaneados.value = [];
  isLoading.value = true;
  try {
    const snap = await getDoc(doc(db, 'operarios_horarios', docId(turno)));
    if (snap.exists()) {
      const data = snap.data();
      const horarios = data.horarios || {};
      // Cargar horarios en registroDia
      registroDia.value = Object.entries(horarios).map(([legajo, h]) => ({
        legajo: Number(legajo),
        ingreso: h.ingreso || '',
        salida: h.salida || '',
        inicio: h.inicio || '',
        final: h.final || '',
        nombre: h.nombre || '',
      }));
      // Cargar extras
      if (data.extras?.length) {
        extrasEscaneados.value = data.extras.map(ex => {
          const h = horarios[ex.legajo] || {};
          return {
            legajo: ex.legajo,
            nombre: ex.nombre,
            ingreso: h.ingreso || '',
            salida: h.salida || '',
            inicio: h.inicio || '',
            final: h.final || '',
          };
        });
      }
    }
  } catch (e) {
    console.error('Error cargando horarios:', e);
  } finally {
    isLoading.value = false;
  }
};

onMounted(async () => {
  await cargarMaestro();
  await cargarHorarios(turnoActivo.value);
});
watch(turnoActivo, (t) => cargarHorarios(t));
watch(fechaSeleccionada, () => cargarHorarios(turnoActivo.value));

// ── OCR Libre con Gemini Vision ──
const blobToBase64 = (blob) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result.split(',')[1]);
  reader.readAsDataURL(blob);
});

const handleCapture = async (blob) => {
  showCamera.value = false;
  isProcessing.value = true;

  try {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      Swal.fire('Error', 'Configura VITE_GEMINI_API_KEY en .env para habilitar OCR con IA.', 'error');
      return;
    }

    const base64 = await blobToBase64(blob);

    // Lista COMPLETA de todos los operarios conocidos (todos los turnos) para mejorar matching
    const todosConocidos = maestroOperarios.value.map(op => `${op.legajo} - ${op.nombre} (Turno ${op.turno})`).join('\n');

    const prompt = `Eres un sistema OCR industrial. Analiza esta foto de una planilla de control de operarios de tejeduría.

LISTA COMPLETA DE OPERARIOS CONOCIDOS (todos los turnos):
${todosConocidos}

TAREA:
1. Extrae la FECHA de la planilla (generalmente arriba a la derecha).
2. Extrae el TURNO de la planilla (generalmente en el encabezado, centro o arriba).
3. Extrae TODOS los operarios y horarios que puedas leer de la imagen.

Los campos de horario posibles son:
- INGRESO: hora de ingreso/entrada al turno
- SALIDA: hora de salida del turno  
- INICIO: hora de inicio de actividad/trabajo efectivo
- FINAL: hora de fin de actividad/trabajo efectivo

RESPONDE ÚNICAMENTE con un JSON válido (sin markdown, sin backticks). Formato:
{
  "fecha": "2026-03-31",
  "turno": "B",
  "operarios": [
    { "legajo": 352, "nombre": "MAIDANA JORGE", "ingreso": "06:00", "salida": "14:00", "inicio": "06:15", "final": "13:45" }
  ]
}

REGLAS:
- "fecha" en formato YYYY-MM-DD. Si no es legible, usa "" (string vacío).
- "turno" es una letra: A, B, C o D. Si no es legible, usa "" (string vacío).
- Extrae TODOS los operarios visibles, no solo los de la lista.
- Si reconoces un nombre que está en la lista, usa el legajo de la lista.
- Si NO reconoces al operario, intenta leer su legajo de la planilla. Si no es legible, usa 0.
- Si un campo horario no es legible, usa "" (string vacío).
- Horarios en formato HH:MM (24h).
- Incluye el nombre tal como lo leas de la planilla.
- Si no puedes leer nada, responde: { "fecha": "", "turno": "", "operarios": [] }`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: 'image/jpeg', data: base64 } }
            ]
          }]
        })
      }
    );

    if (!response.ok) throw new Error(`Error API: ${response.status}`);

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);

    // Soportar formato nuevo { fecha, turno, operarios } y legacy array
    const fechaLeida = parsed.fecha || '';
    const turnoLeido = parsed.turno || '';
    const resultados = Array.isArray(parsed) ? parsed : (parsed.operarios || []);

    if (!Array.isArray(resultados) || resultados.length === 0) {
      Swal.fire({ icon: 'warning', title: 'Sin datos detectados', text: 'Intentá con una foto más nítida.', confirmButtonColor: '#4f46e5' });
      return;
    }

    // Aplicar fecha y turno leídos de la planilla
    let cambios = [];
    if (fechaLeida && /^\d{4}-\d{2}-\d{2}$/.test(fechaLeida) && fechaLeida !== fechaSeleccionada.value) {
      fechaSeleccionada.value = fechaLeida;
      cambios.push(`Fecha → ${fechaLeida}`);
    }
    if (turnoLeido && turnos.includes(turnoLeido) && turnoLeido !== turnoActivo.value) {
      turnoActivo.value = turnoLeido;
      cambios.push(`Turno → ${turnoLeido}`);
      // Esperar a que se carguen los datos del nuevo turno
      await cargarHorarios(turnoLeido);
    }

    // Clasificar resultados
    const turno = turnoActivo.value;
    const asignadosTurno = operariosTurno.value;
    let actualizados = 0;
    let nuevosExtras = [];

    resultados.forEach(r => {
      const esDelTurno = asignadosTurno.some(op => op.legajo === r.legajo);
      if (esDelTurno) {
        // Actualizar registro del día
        const existente = registroDia.value.find(rd => rd.legajo === r.legajo);
        if (existente) {
          if (r.ingreso) existente.ingreso = r.ingreso;
          if (r.salida) existente.salida = r.salida;
          if (r.inicio) existente.inicio = r.inicio;
          if (r.final) existente.final = r.final;
        } else {
          registroDia.value.push({
            legajo: r.legajo,
            nombre: r.nombre || '',
            ingreso: r.ingreso || '',
            salida: r.salida || '',
            inicio: r.inicio || '',
            final: r.final || '',
          });
        }
        actualizados++;
      } else {
        // Es de otro turno o desconocido
        const yaExtra = extrasEscaneados.value.find(e => e.legajo === r.legajo);
        if (!yaExtra) {
          nuevosExtras.push({
            legajo: r.legajo,
            nombre: r.nombre || '',
            ingreso: r.ingreso || '',
            salida: r.salida || '',
            inicio: r.inicio || '',
            final: r.final || '',
          });
        } else {
          if (r.ingreso) yaExtra.ingreso = r.ingreso;
          if (r.salida) yaExtra.salida = r.salida;
          if (r.inicio) yaExtra.inicio = r.inicio;
          if (r.final) yaExtra.final = r.final;
        }
      }
    });

    extrasEscaneados.value.push(...nuevosExtras);
    await guardarHorarios(turno);

    const totalExtras = nuevosExtras.length;
    let msg = `${actualizados} del turno ${turno}`;
    if (totalExtras > 0) msg += ` + ${totalExtras} de otros turnos/nuevos`;
    if (cambios.length > 0) msg += ` | ${cambios.join(', ')}`;

    Swal.fire({
      icon: 'success',
      title: `${resultados.length} operarios detectados`,
      text: msg,
      timer: 4000,
      showConfirmButton: false,
      toast: true,
      position: 'top-end',
    });

    // Identificar operarios desconocidos (no están en la tabla maestra)
    const desconocidos = nuevosExtras.filter(ex => {
      return !maestroOperarios.value.some(m => m.legajo === ex.legajo);
    }).filter(ex => ex.legajo > 0 && ex.nombre);

    if (desconocidos.length > 0) {
      await ofrecerAgregarDesconocidos(desconocidos);
    }

  } catch (err) {
    console.error('Error OCR:', err);
    Swal.fire({ icon: 'error', title: 'Error al procesar imagen', text: err.message, confirmButtonColor: '#4f46e5' });
  } finally {
    isProcessing.value = false;
  }
};

const limpiarHorarios = async () => {
  registroDia.value = [];
  extrasEscaneados.value = [];
  await guardarHorarios(turnoActivo.value);
};

// ── Ofrecer agregar operarios desconocidos al maestro ──
const ofrecerAgregarDesconocidos = async (desconocidos) => {
  const listHtml = desconocidos.map((op, i) => `
    <label class="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50 cursor-pointer text-left">
      <input type="checkbox" checked data-idx="${i}" class="swal-chk rounded" style="width:16px;height:16px;accent-color:#4f46e5" />
      <span class="font-mono font-bold text-indigo-600 text-sm">${op.legajo}</span>
      <span class="font-semibold text-gray-700 text-sm">${op.nombre}</span>
    </label>
  `).join('');

  const turnoHtml = ['A','B','C','D'].map(t =>
    `<option value="${t}" ${t === turnoActivo.value ? 'selected' : ''}>Turno ${t}</option>`
  ).join('');

  const result = await Swal.fire({
    title: 'Operarios nuevos detectados',
    html: `
      <p class="text-sm text-gray-500 mb-3">Se encontraron <strong>${desconocidos.length}</strong> operario${desconocidos.length > 1 ? 's' : ''} que no están en la tabla maestra. ¿Querés agregarlos?</p>
      <div class="max-h-48 overflow-y-auto border rounded-lg divide-y divide-gray-100 mb-3 text-left">${listHtml}</div>
      <div class="flex items-center gap-2 justify-center">
        <span class="text-xs font-bold text-gray-500">Asignar a:</span>
        <select id="swal-turno-select" class="px-2 py-1 border rounded text-sm">${turnoHtml}</select>
      </div>
    `,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Agregar seleccionados',
    cancelButtonText: 'No agregar',
    confirmButtonColor: '#16a34a',
    width: 480,
    preConfirm: () => {
      const checks = document.querySelectorAll('.swal-chk');
      const seleccionados = [];
      checks.forEach(chk => {
        if (chk.checked) seleccionados.push(Number(chk.dataset.idx));
      });
      const turnoSel = document.getElementById('swal-turno-select').value;
      return { seleccionados, turnoSel };
    },
  });

  if (result.isConfirmed && result.value.seleccionados.length > 0) {
    const { seleccionados, turnoSel } = result.value;
    let agregados = 0;
    seleccionados.forEach(idx => {
      const op = desconocidos[idx];
      if (!maestroOperarios.value.some(m => m.legajo === op.legajo)) {
        maestroOperarios.value.push({
          legajo: op.legajo,
          nombre: op.nombre.toUpperCase(),
          turno: turnoSel,
          puesto: '',
        });
        agregados++;
      }
    });
    if (agregados > 0) {
      await guardarMaestro();
      // Reclasificar extras: los recién agregados ya no son desconocidos
      extrasEscaneados.value = extrasEscaneados.value.map(ex => ({ ...ex }));
      await guardarHorarios(turnoActivo.value);
      Swal.fire({
        icon: 'success',
        title: `${agregados} operario${agregados > 1 ? 's' : ''} agregado${agregados > 1 ? 's' : ''}`,
        text: `Asignados al Turno ${turnoSel}`,
        timer: 3000,
        showConfirmButton: false,
        toast: true,
        position: 'top-end',
      });
    }
  }
};

// ── Gestión de operarios (ABM) ──
const nuevoLegajo = ref('');
const nuevoNombre = ref('');
const nuevoTurno = ref('B');
const nuevoPuesto = ref('');
const editandoIdx = ref(-1);

const maestroFiltrado = computed(() => {
  if (!showGestion.value) return [];
  const filtro = turnoActivo.value;
  return maestroOperarios.value
    .filter(op => op.turno === filtro)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
});

const agregarOperario = async () => {
  const legajo = Number(nuevoLegajo.value);
  const nombre = nuevoNombre.value.trim().toUpperCase();
  if (!legajo || !nombre) return;
  if (maestroOperarios.value.some(o => o.legajo === legajo)) {
    Swal.fire({ icon: 'warning', title: 'Legajo duplicado', text: `El legajo ${legajo} ya existe.`, confirmButtonColor: '#4f46e5' });
    return;
  }
  maestroOperarios.value.push({ legajo, nombre, turno: nuevoTurno.value, puesto: nuevoPuesto.value.trim().toUpperCase() });
  nuevoLegajo.value = '';
  nuevoNombre.value = '';
  nuevoPuesto.value = '';
  await guardarMaestro();
};

const eliminarOperario = async (legajo) => {
  const result = await Swal.fire({
    title: '¿Eliminar operario?',
    text: 'Se quitará de la tabla maestra.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Eliminar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#ef4444',
  });
  if (!result.isConfirmed) return;
  maestroOperarios.value = maestroOperarios.value.filter(o => o.legajo !== legajo);
  await guardarMaestro();
};

const cambiarTurnoOperario = async (legajo, nuevoT) => {
  const op = maestroOperarios.value.find(o => o.legajo === legajo);
  if (op) {
    op.turno = nuevoT;
    await guardarMaestro();
  }
};

// Color de fila según estado
const rowClass = (estado) => {
  if (estado === 'otro_turno') return 'bg-amber-50/60 border-l-3 border-l-amber-400';
  if (estado === 'desconocido') return 'bg-red-50/60 border-l-3 border-l-red-400';
  return '';
};
const estadoBadge = (op) => {
  if (op.estado === 'otro_turno') return { text: `Turno ${op.turnoOriginal}`, class: 'bg-amber-100 text-amber-700' };
  if (op.estado === 'desconocido') return { text: 'No registrado', class: 'bg-red-100 text-red-600' };
  return null;
};
</script>

<template>
  <CameraCapture v-if="showCamera" @capture="handleCapture" @cancel="showCamera = false" />

  <div class="max-w-5xl mx-auto px-4 py-6 space-y-5">
    <!-- Encabezado -->
    <div class="flex items-center gap-3">
      <div class="bg-indigo-100 text-indigo-600 p-2 rounded-lg">
        <Users class="w-6 h-6" />
      </div>
      <p class="text-xs text-gray-400 font-medium">Escaneá la planilla papel — el sistema digitaliza y valida automáticamente</p>
    </div>

    <!-- Selector de Fecha -->
    <div class="flex items-center gap-2 justify-center">
      <button @click="cambiarFecha(-1)" class="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm transition-colors">
        <ChevronLeft class="w-4 h-4" />
      </button>
      <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white shadow-sm min-w-[180px] justify-center">
        <Calendar class="w-4 h-4 text-indigo-500" />
        <input type="date" v-model="fechaSeleccionada" class="text-sm font-bold text-slate-700 bg-transparent border-none outline-none cursor-pointer" />
      </div>
      <button @click="cambiarFecha(1)" :disabled="esHoy" class="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
        <ChevronRight class="w-4 h-4" />
      </button>
      <button v-if="!esHoy" @click="fechaSeleccionada = fechaHoy()" class="text-xs font-bold text-indigo-600 hover:underline ml-1">Hoy</button>
    </div>

    <!-- Filtro de Turno + Acciones -->
    <div class="flex items-center gap-2 flex-wrap">
      <Filter class="w-4 h-4 text-gray-400" />
      <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Turno</span>
      <div class="flex gap-1 ml-1">
        <button
          v-for="t in turnos" :key="t" @click="turnoActivo = t"
          class="px-3 py-1.5 text-sm font-bold rounded-lg border transition-all duration-150"
          :class="turnoActivo === t ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 shadow-sm hover:shadow-md'"
        >{{ t }}</button>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <span class="text-xs font-semibold text-gray-400">
          {{ totalAsignados }} asignados
          <span v-if="extrasEscaneados.length" class="text-amber-500"> + {{ extrasEscaneados.length }} extra{{ extrasEscaneados.length !== 1 ? 's' : '' }}</span>
        </span>

        <!-- Gestionar operarios -->
        <button
          @click="showGestion = !showGestion"
          class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
        >
          <Pencil class="w-3.5 h-3.5" />
          {{ showGestion ? 'Cerrar' : 'Gestionar' }}
        </button>

        <button v-if="tieneHorarios" @click="limpiarHorarios"
          class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border border-red-200 bg-white text-red-500 hover:bg-red-50 transition-colors shadow-sm">
          <XCircle class="w-3.5 h-3.5" /> Limpiar
        </button>

        <button v-if="!isProcessing" @click="showCamera = true"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold rounded-lg border transition-all duration-150 shadow-sm hover:shadow-md bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 active:scale-95">
          <Camera class="w-4 h-4" /> Escanear planilla
        </button>
        <div v-if="isProcessing" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200">
          <Loader2 class="w-4 h-4 animate-spin" /> Procesando...
        </div>
      </div>
    </div>

    <!-- Panel de Gestión de Operarios -->
    <div v-if="showGestion" class="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
      <p class="text-xs font-black text-slate-500 uppercase tracking-widest">Tabla Maestra — Turno {{ turnoActivo }}</p>

      <!-- Agregar nuevo -->
      <div class="flex gap-2 flex-wrap items-end">
        <div>
          <label class="text-[10px] font-bold text-slate-400 uppercase">Legajo</label>
          <input v-model="nuevoLegajo" type="number" placeholder="Nro" class="block w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-100" />
        </div>
        <div class="flex-1 min-w-[140px]">
          <label class="text-[10px] font-bold text-slate-400 uppercase">Nombre</label>
          <input v-model="nuevoNombre" type="text" placeholder="APELLIDO NOMBRE" class="block w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-100" />
        </div>
        <div class="w-24">
          <label class="text-[10px] font-bold text-slate-400 uppercase">Puesto</label>
          <input v-model="nuevoPuesto" type="text" placeholder="Puesto" class="block w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-100" />
        </div>
        <div>
          <label class="text-[10px] font-bold text-slate-400 uppercase">Turno</label>
          <select v-model="nuevoTurno" class="block px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none cursor-pointer">
            <option v-for="t in turnos" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <button @click="agregarOperario" class="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700 active:scale-95 transition-all">
          <UserPlus class="w-4 h-4" /> Agregar
        </button>
      </div>

      <!-- Lista editable -->
      <div class="max-h-60 overflow-y-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-slate-200">
              <th class="text-left px-2 py-1 font-bold text-slate-400">Legajo</th>
              <th class="text-left px-2 py-1 font-bold text-slate-400">Nombre</th>
              <th class="text-left px-2 py-1 font-bold text-slate-400">Puesto</th>
              <th class="text-center px-2 py-1 font-bold text-slate-400">Turno</th>
              <th class="px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="op in maestroFiltrado" :key="op.legajo" class="border-b border-slate-100 hover:bg-white">
              <td class="px-2 py-1.5 font-mono font-bold text-indigo-600">{{ op.legajo }}</td>
              <td class="px-2 py-1.5 font-semibold text-slate-700">{{ op.nombre }}</td>
              <td class="px-2 py-1.5 text-slate-500">{{ op.puesto || '—' }}</td>
              <td class="px-2 py-1.5 text-center">
                <select :value="op.turno" @change="cambiarTurnoOperario(op.legajo, $event.target.value)" class="px-1 py-0.5 border border-slate-200 rounded text-xs bg-white cursor-pointer">
                  <option v-for="t in turnos" :key="t" :value="t">{{ t }}</option>
                </select>
              </td>
              <td class="px-2 py-1.5 text-center">
                <button @click="eliminarOperario(op.legajo)" class="text-red-400 hover:text-red-600 transition-colors"><Trash2 class="w-3.5 h-3.5" /></button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="maestroFiltrado.length === 0" class="text-center py-4 text-xs text-slate-400">Sin operarios en Turno {{ turnoActivo }}</p>
      </div>
    </div>

    <!-- Búsqueda + Toggle vista -->
    <div class="flex gap-2">
      <div class="relative flex-1">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input v-model="searchQuery" type="text" placeholder="Buscar por legajo, nombre o puesto..."
          class="w-full pl-9 pr-4 py-2.5 border border-slate-200 bg-white rounded-lg text-sm text-slate-700 placeholder-gray-400 focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none shadow-sm transition-colors duration-150" />
      </div>
      <button @click="vistaCards = !vistaCards"
        class="shrink-0 p-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm transition-colors"
        :title="vistaCards ? 'Ver como tabla' : 'Ver como tarjetas'">
        <Table2 v-if="vistaCards" class="w-4 h-4" />
        <LayoutGrid v-else class="w-4 h-4" />
      </button>
    </div>

    <!-- Leyenda de colores (si hay extras) -->
    <div v-if="extrasEscaneados.length" class="flex gap-4 text-[10px] font-bold uppercase tracking-wider">
      <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-white border border-slate-200"></span> Turno asignado</span>
      <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-amber-100 border border-amber-300"></span> Otro turno</span>
      <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-red-100 border border-red-300"></span> No registrado</span>
    </div>

    <!-- Loader -->
    <div v-if="isLoading" class="flex justify-center py-8">
      <Loader2 class="w-6 h-6 animate-spin text-indigo-400" />
    </div>

    <template v-else>
      <!-- Estado vacío -->
      <div v-if="operariosFiltrados.length === 0" class="bg-white border border-slate-200 rounded-lg shadow-sm px-6 py-12 text-center">
        <Users class="w-10 h-10 text-gray-300 mx-auto mb-2" />
        <p class="text-sm text-gray-400 font-medium">
          {{ totalAsignados === 0 && !searchQuery ? 'Escaneá una planilla para cargar operarios del Turno ' + turnoActivo : 'Sin resultados' }}
        </p>
      </div>

      <!-- ── VISTA TARJETAS ── -->
      <div v-else-if="vistaCards" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div
          v-for="op in operariosFiltrados" :key="op.legajo"
          class="bg-white border rounded-xl shadow-sm overflow-hidden"
          :class="{
            'border-amber-300 bg-amber-50/40': op.estado === 'otro_turno',
            'border-red-300 bg-red-50/40': op.estado === 'desconocido',
            'border-slate-200': op.estado === 'asignado',
          }"
        >
          <!-- Cabecera tarjeta -->
          <div class="flex items-start justify-between px-4 pt-3 pb-2 border-b"
            :class="{
              'border-amber-100': op.estado === 'otro_turno',
              'border-red-100': op.estado === 'desconocido',
              'border-slate-100': op.estado === 'asignado',
            }"
          >
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-mono font-black text-indigo-600 text-base">{{ op.legajo }}</span>
                <span v-if="estadoBadge(op)" :class="estadoBadge(op).class" class="text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0">
                  {{ estadoBadge(op).text }}
                </span>
              </div>
              <p class="font-bold text-gray-800 text-sm leading-tight truncate">{{ op.nombre }}</p>
              <p v-if="op.puesto" class="text-xs text-gray-400 mt-0.5">{{ op.puesto }}</p>
            </div>
            <button
              v-if="op.estado === 'desconocido' && op.legajo > 0"
              @click="ofrecerAgregarDesconocidos([{ legajo: op.legajo, nombre: op.nombre }])"
              title="Agregar a tabla maestra"
              class="text-emerald-500 hover:text-emerald-700 transition-colors ml-2 shrink-0">
              <UserPlus class="w-4 h-4" />
            </button>
          </div>

          <!-- Horarios tarjeta: grid 2×2 -->
          <div class="grid grid-cols-2 gap-px bg-slate-100 text-center text-xs">
            <div class="bg-white py-2">
              <p class="font-black text-emerald-600 uppercase tracking-wider text-[9px] mb-0.5">Ingreso</p>
              <span v-if="op.ingreso" class="font-mono font-bold text-emerald-700 text-base">{{ op.ingreso }}</span>
              <span v-else class="text-gray-300">—</span>
            </div>
            <div class="bg-white py-2">
              <p class="font-black text-red-500 uppercase tracking-wider text-[9px] mb-0.5">Salida</p>
              <span v-if="op.salida" class="font-mono font-bold text-red-600 text-base">{{ op.salida }}</span>
              <span v-else class="text-gray-300">—</span>
            </div>
            <div class="bg-white py-2">
              <p class="font-black text-blue-500 uppercase tracking-wider text-[9px] mb-0.5">Inicio</p>
              <span v-if="op.inicio" class="font-mono font-bold text-blue-700 text-base">{{ op.inicio }}</span>
              <span v-else class="text-gray-300">—</span>
            </div>
            <div class="bg-white py-2">
              <p class="font-black text-orange-500 uppercase tracking-wider text-[9px] mb-0.5">Final</p>
              <span v-if="op.final" class="font-mono font-bold text-orange-600 text-base">{{ op.final }}</span>
              <span v-else class="text-gray-300">—</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ── VISTA TABLA ── -->
      <div v-else class="bg-white border border-slate-200 rounded-lg shadow-sm overflow-x-auto">
        <table class="w-full text-sm min-w-[640px]">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-200">
              <th class="text-left px-3 py-2.5 text-xs font-black text-slate-500 uppercase tracking-wider w-20">Legajo</th>
              <th class="text-left px-3 py-2.5 text-xs font-black text-slate-500 uppercase tracking-wider">Nombre</th>
              <th class="text-left px-3 py-2.5 text-xs font-black text-slate-500 uppercase tracking-wider w-24">Puesto</th>
              <th class="text-center px-2 py-2.5 text-xs font-black text-emerald-600 uppercase tracking-wider w-[70px]">Ingreso</th>
              <th class="text-center px-2 py-2.5 text-xs font-black text-red-500 uppercase tracking-wider w-[70px]">Salida</th>
              <th class="text-center px-2 py-2.5 text-xs font-black text-blue-600 uppercase tracking-wider w-[70px]">Inicio</th>
              <th class="text-center px-2 py-2.5 text-xs font-black text-orange-600 uppercase tracking-wider w-[70px]">Final</th>
              <th class="w-10"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="op in operariosFiltrados" :key="op.legajo"
              class="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors duration-100"
              :class="rowClass(op.estado)">
              <td class="px-3 py-2 font-mono font-bold text-indigo-600">{{ op.legajo }}</td>
              <td class="px-3 py-2 font-semibold text-slate-700">
                {{ op.nombre }}
                <span v-if="estadoBadge(op)" :class="estadoBadge(op).class" class="ml-1.5 text-[10px] font-black px-1.5 py-0.5 rounded-full">{{ estadoBadge(op).text }}</span>
              </td>
              <td class="px-3 py-2 text-slate-500 text-xs">{{ op.puesto || '—' }}</td>
              <td class="px-2 py-2 text-center">
                <span v-if="op.ingreso" class="inline-block px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono font-bold text-xs">{{ op.ingreso }}</span>
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="px-2 py-2 text-center">
                <span v-if="op.salida" class="inline-block px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-mono font-bold text-xs">{{ op.salida }}</span>
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="px-2 py-2 text-center">
                <span v-if="op.inicio" class="inline-block px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono font-bold text-xs">{{ op.inicio }}</span>
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="px-2 py-2 text-center">
                <span v-if="op.final" class="inline-block px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 font-mono font-bold text-xs">{{ op.final }}</span>
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="px-2 py-2">
                <button
                  v-if="op.estado === 'desconocido' && op.legajo > 0"
                  @click="ofrecerAgregarDesconocidos([{ legajo: op.legajo, nombre: op.nombre }])"
                  title="Agregar a tabla maestra"
                  class="text-emerald-500 hover:text-emerald-700 transition-colors">
                  <UserPlus class="w-4 h-4" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
