<script setup>
import { shiftSlot, plantShift, addDays } from '../utils/plantTime';
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import PlantDatePicker from './PlantDatePicker.vue';
import { vTippy } from '../utils/tooltipDirective';
import { userRole, userProfile } from '../services/authService';
import { canAccessViewForUser } from '../services/profileService';
import { getSectorScope } from '../utils/sectorScope';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/themes/light-border.css';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Search, Users, Camera, Loader2, XCircle, ChevronLeft, ChevronRight, UserPlus, Pencil, Trash2, Save, X, LayoutGrid, Table2, RefreshCw, Plus } from 'lucide-vue-next';
import CameraCapture from './CameraCapture.vue';
import Swal from 'sweetalert2';
import { generateGeminiText, GEMINI_SETUP_MSG } from '../services/geminiClient';

// ── Estado general ──
const searchQuery = ref('');
const showCamera = ref(false);
const isProcessing = ref(false);
const isLoading = ref(false);
const showGestion = ref(false), gestionModal = ref(null), savingMaster = ref(false), savingSchedule = ref(false), loadError = ref(''), masterError = ref(''), statusFilter = ref(''), gestionSearch = ref(''), gestionTurno = ref(''), pendingSchedule = ref(false);
const admin = computed(() => userRole.value === 'admin');
const canOperate = computed(() => { try { const sectors=getSectorScope(userProfile.value); return (sectors===null || sectors.includes('TEJEDURIA')) && canAccessViewForUser(userRole.value,'operarios',userProfile.value?.vistasPersonalizadas); } catch { return false; } });
const blocked = computed(() => isProcessing.value || savingSchedule.value || savingMaster.value || pendingSchedule.value);
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character]));
let loadGeneration=0, suppressLoad=false, previousFocus;


const turnos = ['A', 'B', 'C'];

// Determina el turno activo según la hora de planta:
// A: 06:00–13:59 | B: 14:00–21:59 | C: 22:00–05:59
const turnoDeHora = plantShift;
const turnoActivo = ref(turnoDeHora());
const vistaCards = ref(typeof window !== 'undefined' && window.innerWidth < 640);

// ── Tabla maestra de operarios (Firestore: config/operarios_tejeduria) ──
const maestroOperarios = ref([]);
const masterReady = ref(false);

const cargarMaestro = async () => {
  try {
    const snap = await getDoc(doc(db, 'config', 'operarios_tejeduria'));
    maestroOperarios.value = snap.exists() && Array.isArray(snap.data().operarios) ? snap.data().operarios : [];
    masterReady.value = true;
  } catch (e) {
    masterReady.value = false;
    loadError.value = 'No se pudo cargar el maestro de operarios. Reintentá.'; throw e;
  }
};

const guardarMaestro = async (next = maestroOperarios.value) => {
  if (!admin.value) throw new Error('Solo administración puede modificar el maestro.');
  try {
    await setDoc(doc(db, 'config', 'operarios_tejeduria'), {
      operarios: next,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    throw e;
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
    const reg = registroDia.value.find(r => String(r.legajo) === String(op.legajo))
      || extrasEscaneados.value.find(r => String(r.legajo) === String(op.legajo));
    return {
      ...op,
      ingreso: reg?.ingreso || '',
      salida: reg?.salida || '',
      inicio: reg?.inicio || '',
      final: reg?.final || '',
      estado: 'asignado', // pertenece al turno
    };
  });
  const extras = extrasEscaneados.value.filter(ex => !operariosTurno.value.some(op => String(op.legajo) === String(ex.legajo))).map(ex => {
    const maestro = maestroOperarios.value.find(m => String(m.legajo) === String(ex.legajo));
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
  const lista = listaCompleta.value.filter(op => !statusFilter.value || op.estado===statusFilter.value);
  if (!searchQuery.value.trim()) return lista;
  const q = normalize(searchQuery.value.trim());
  return lista.filter(op =>
    normalize(op.nombre).includes(q) ||
    String(op.legajo).includes(q) ||
    normalize(op.puesto).includes(q)
  );
});

const totalTurno = computed(() => listaCompleta.value.length);
const totalAsignados = computed(() => operariosTurno.value.length);
const tieneHorarios = computed(() =>
  listaCompleta.value.some(op => op.ingreso || op.salida || op.inicio || op.final)
);

// ── Fecha ──
const fechaHoy = () => shiftSlot().fecha;
const fechaSeleccionada = ref(fechaHoy());
const esHoy = computed(() => fechaSeleccionada.value === fechaHoy());
const cambiarFecha = (delta) => { fechaSeleccionada.value = addDays(fechaSeleccionada.value, delta); };
const docId = (turno) => `${fechaSeleccionada.value}_${turno}`;

// ── Firestore: guardar/cargar horarios del día ──
const guardarHorarios = async (turno) => {
  if (!canOperate.value) throw new Error('No tenés permiso para modificar horarios.');
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
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    throw e;
  }
};

const cargarHorarios = async (turno) => {
  const token = ++loadGeneration, key = docId(turno);
  registroDia.value = [];
  extrasEscaneados.value = [];
  isLoading.value = true;
  try {
    const snap = await getDoc(doc(db, 'operarios_horarios', key));
    if (token !== loadGeneration) return;
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
    if (token === loadGeneration) loadError.value = 'No se pudieron cargar los horarios. Reintentá antes de escanear.'; throw e;
  } finally {
    if (token === loadGeneration) isLoading.value = false;
  }
};

async function reload() {
  if (blocked.value) return;
  isLoading.value=true; loadError.value='';
  try { await cargarMaestro(); await cargarHorarios(turnoActivo.value); } catch {} finally { isLoading.value=false; }
}
onMounted(reload);
watch([turnoActivo,fechaSeleccionada],async () => {
  if (suppressLoad) return;
  if (masterReady.value) loadError.value='';
  try { await cargarHorarios(turnoActivo.value); } catch {}
});
onUnmounted(() => { loadGeneration++; globalThis.window?.removeEventListener('beforeunload',beforeUnload); });
function beforeUnload(event) { if (blocked.value || (showGestion.value && gestionDirty.value)) { event.preventDefault(); event.returnValue=''; } }
globalThis.window?.addEventListener('beforeunload',beforeUnload);
onBeforeRouteLeave(async () => { if (blocked.value) return false; if (showGestion.value) { await closeGestion(); return !showGestion.value; } return true; });
// ── OCR Libre con Gemini Vision ──
const blobToBase64 = (blob) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result.split(',')[1]);
  reader.readAsDataURL(blob);
});

const handleCapture = async (blob) => {
  if (blocked.value || !canOperate.value || loadError.value || !masterReady.value) return;
  showCamera.value = false;
  isProcessing.value = true;

  try {
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

    let rawText;
    try {
      const { text } = await generateGeminiText({
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: base64 } },
        ],
      });
      rawText = text || '{}';
    } catch (e) {
      if (e.message === 'GEMINI_UNAVAILABLE') {
        Swal.fire('IA no disponible', GEMINI_SETUP_MSG, 'warning');
        return;
      }
      throw e;
    }
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

    resultados.forEach(result => {
      if (!result || typeof result !== 'object') throw new Error('La lectura contiene un operario inválido. Reintentá con una foto más nítida.');
      result.legajo = Number(result.legajo) || 0;
      result.nombre = String(result.nombre || '');
      for (const field of ['ingreso','salida','inicio','final']) {
        result[field] = String(result[field] || '');
        if (result[field] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(result[field])) throw new Error('La lectura contiene horarios inválidos. Reintentá con una foto más nítida.');
      }
    });
    if (fechaLeida) addDays(fechaLeida,0);

    // Aplicar fecha y turno leídos de la planilla
    let cambios = [];
    suppressLoad = true;
    if (fechaLeida && /^\d{4}-\d{2}-\d{2}$/.test(fechaLeida) && fechaLeida !== fechaSeleccionada.value) {
      fechaSeleccionada.value = fechaLeida;
      cambios.push(`Fecha → ${fechaLeida}`);
    }
    if (turnoLeido && turnos.includes(turnoLeido) && turnoLeido !== turnoActivo.value) {
      turnoActivo.value = turnoLeido;
      cambios.push(`Turno → ${turnoLeido}`);

    }

    await nextTick();
    if (cambios.length) await cargarHorarios(turnoActivo.value);
    suppressLoad = false;

    // Clasificar resultados
    const turno = turnoActivo.value;
    const asignadosTurno = operariosTurno.value;
    let actualizados = 0;
    let nuevosExtras = [];

    resultados.forEach(r => {
      const esDelTurno = asignadosTurno.some(op => String(op.legajo) === String(r.legajo));
      if (esDelTurno) {
        // Actualizar registro del día
        const existente = registroDia.value.find(rd => String(rd.legajo) === String(r.legajo));
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
        const yaExtra = [...extrasEscaneados.value,...nuevosExtras].find(e => String(e.legajo) === String(r.legajo));
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
    pendingSchedule.value = true;
    await guardarHorarios(turno);
    pendingSchedule.value = false;

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
      return !maestroOperarios.value.some(m => String(m.legajo) === String(ex.legajo));
    }).filter(ex => ex.legajo > 0 && ex.nombre);

    if (desconocidos.length > 0 && admin.value) {
      await ofrecerAgregarDesconocidos(desconocidos);
    }

  } catch (err) {
    console.error('Error OCR:', err);
    Swal.fire({ icon: 'error', title: 'Error al procesar imagen', text: err.message, confirmButtonColor: '#4f46e5' });
  } finally {
    suppressLoad = false;
    isProcessing.value = false;
  }
};

const limpiarHorarios = async () => {
  if (blocked.value || !canOperate.value || isLoading.value || loadError.value) return;
  savingSchedule.value=true;
  const before={ registros:registroDia.value,extras:extrasEscaneados.value };
  try {
    if (!(await Swal.fire({ title:'¿Limpiar horarios?',text:`Se quitarán los horarios y extras de ${fechaSeleccionada.value}, turno ${turnoActivo.value}.`,icon:'warning',showCancelButton:true,confirmButtonText:'Limpiar',cancelButtonText:'Cancelar' })).isConfirmed) return;
    registroDia.value=[]; extrasEscaneados.value=[];
    await guardarHorarios(turnoActivo.value);
  } catch (failure) { registroDia.value=before.registros; extrasEscaneados.value=before.extras; Swal.fire('No se pudo limpiar',failure.message,'error'); }
  finally { savingSchedule.value=false; }
};
async function retrySchedule() {
  if (savingSchedule.value || isProcessing.value || !canOperate.value) return;
  savingSchedule.value=true;
  try { await guardarHorarios(turnoActivo.value); pendingSchedule.value=false; }
  catch (failure) { Swal.fire('No se pudo guardar',failure.message,'error'); }
  finally { savingSchedule.value=false; }
}
async function discardSchedule() {
  if (savingSchedule.value || isProcessing.value) return;
  if (!(await Swal.fire({ title:'¿Descartar la lectura pendiente?',text:'Se volverán a cargar los horarios guardados.',icon:'warning',showCancelButton:true,confirmButtonText:'Descartar',cancelButtonText:'Cancelar' })).isConfirmed) return;
  pendingSchedule.value=false; await reload();
}

// ── Ofrecer agregar operarios desconocidos al maestro ──
const ofrecerAgregarDesconocidos = async (desconocidos) => {
  if (!admin.value || savingMaster.value) return;
  savingMaster.value=true;
  try {
  const listHtml = desconocidos.map((op, i) => `
    <label class="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50 cursor-pointer text-left">
      <input type="checkbox" checked data-idx="${i}" class="swal-chk rounded" style="width:16px;height:16px;accent-color:#4f46e5" />
      <span class="font-mono font-bold text-indigo-600 text-sm">${escapeHtml(op.legajo)}</span>
      <span class="font-semibold text-gray-700 text-sm">${escapeHtml(op.nombre)}</span>
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
    const nextMaestro = [...maestroOperarios.value];
    seleccionados.forEach(idx => {
      const op = desconocidos[idx];
      if (!nextMaestro.some(m => Number(m.legajo) === Number(op.legajo))) {
        nextMaestro.push({
          legajo: op.legajo,
          nombre: op.nombre.toUpperCase(),
          turno: turnoSel,
          puesto: '',
        });
        agregados++;
      }
    });
    if (agregados > 0) {
      await guardarMaestro(nextMaestro);
      maestroOperarios.value = nextMaestro;
      // Reclasificar extras: los recién agregados ya no son desconocidos
      extrasEscaneados.value = extrasEscaneados.value.map(ex => ({ ...ex }));
      pendingSchedule.value=true;
      await guardarHorarios(turnoActivo.value);
      pendingSchedule.value=false;
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
  } catch (failure) { Swal.fire('No se pudo agregar al maestro',failure.message,'error'); }
  finally { savingMaster.value=false; }
};

// ── Gestión de operarios (ABM) ──
const nuevoLegajo = ref('');
const nuevoNombre = ref('');
const nuevoTurno = ref('B');
const nuevoPuesto = ref('');
const editandoIdx = ref(-1);

const maestroFiltrado = computed(() => maestroOperarios.value.filter(op => (!gestionTurno.value || op.turno===gestionTurno.value) && (!gestionSearch.value.trim() || normalize([op.legajo,op.nombre,op.puesto].join(' ')).includes(normalize(gestionSearch.value.trim())))).sort((a,b) => String(a.nombre || '').localeCompare(String(b.nombre || ''))));
const gestionDirty = computed(() => Boolean(nuevoLegajo.value || nuevoNombre.value || nuevoPuesto.value || editandoIdx.value!==-1));
function resetForm() { nuevoLegajo.value=''; nuevoNombre.value=''; nuevoPuesto.value=''; editandoIdx.value=-1; nuevoTurno.value=turnoActivo.value; masterError.value=''; }
function openGestion() { if (!admin.value || blocked.value || isLoading.value || loadError.value) return; previousFocus=globalThis.document?.activeElement; gestionTurno.value=turnoActivo.value; gestionSearch.value=''; resetForm(); showGestion.value=true; nextTick(() => gestionModal.value?.focus?.()); }
async function closeGestion() {
  if (savingMaster.value) return;
  if (gestionDirty.value && !(await Swal.fire({ title:'¿Descartar el formulario?',text:'El operario todavía no se guardó.',icon:'warning',showCancelButton:true,confirmButtonText:'Descartar',cancelButtonText:'Seguir editando' })).isConfirmed) return;
  showGestion.value=false; resetForm(); nextTick(() => previousFocus?.isConnected && previousFocus.focus());
}
function editOperario(op) { if (savingMaster.value) return; if (gestionDirty.value) { masterError.value='Guardá o cancelá el formulario antes de editar otro operario.'; return; } editandoIdx.value=op.legajo; nuevoLegajo.value=String(op.legajo); nuevoNombre.value=op.nombre || ''; nuevoTurno.value=op.turno; nuevoPuesto.value=op.puesto || ''; masterError.value=''; }
const agregarOperario = async () => {
  if (!admin.value || savingMaster.value) return;
  const legajo=Number(nuevoLegajo.value), nombre=nuevoNombre.value.trim().toUpperCase();
  if (!Number.isInteger(legajo) || legajo<=0 || !nombre || !['A','B','C','D'].includes(nuevoTurno.value)) { masterError.value='Completá un legajo positivo, nombre y turno.'; return; }
  if (maestroOperarios.value.some(op => Number(op.legajo)===legajo && op.legajo!==editandoIdx.value)) { masterError.value=`El legajo ${legajo} ya existe.`; return; }
  const entry={ legajo,nombre,turno:nuevoTurno.value,puesto:nuevoPuesto.value.trim().toUpperCase() };
  const next=editandoIdx.value===-1 ? [...maestroOperarios.value,entry] : maestroOperarios.value.map(op => op.legajo===editandoIdx.value ? { ...op,...entry }:op);
  savingMaster.value=true; masterError.value='';
  try { await guardarMaestro(next); maestroOperarios.value=next; resetForm(); }
  catch (failure) { masterError.value=failure.message || 'No se pudo guardar. Se conserva el formulario.'; }
  finally { savingMaster.value=false; }
};
const eliminarOperario = async legajo => {
  if (!admin.value || savingMaster.value) return;
  savingMaster.value=true; masterError.value='';
  try {
    if (!(await Swal.fire({ title:'¿Eliminar operario?',text:'Se quitará del maestro; los registros de horarios existentes se conservan.',icon:'warning',showCancelButton:true,confirmButtonText:'Eliminar',cancelButtonText:'Cancelar',confirmButtonColor:'#dc2626' })).isConfirmed) return;
    const next=maestroOperarios.value.filter(op => op.legajo!==legajo); await guardarMaestro(next); maestroOperarios.value=next; if(editandoIdx.value===legajo) resetForm();
  } catch (failure) { masterError.value=failure.message; } finally { savingMaster.value=false; }
};
function gestionKeyboard(event) {
  if (event.key==='Escape') { event.stopPropagation(); closeGestion(); }
  if (event.key!=='Tab') return;
  const nodes=[...(gestionModal.value?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)') || [])].filter(node => node.getClientRects().length);
  const first=nodes[0],last=nodes.at(-1),active=globalThis.document?.activeElement;
  if(!first) { event.preventDefault(); return; }
  if(event.shiftKey && (active===first || !nodes.includes(active))) { event.preventDefault(); last.focus(); }
  else if(!event.shiftKey && (active===last || !nodes.includes(active))) { event.preventDefault(); first.focus(); }
}

const estadoBadge = (op) => {
  if (op.estado === 'otro_turno') return { text: `Turno ${op.turnoOriginal}`, class: 'bg-amber-100 text-amber-700' };
  if (op.estado === 'desconocido') return { text: 'No registrado', class: 'bg-red-100 text-red-600' };
  return null;
};
</script>

<template>
  <CameraCapture v-if="showCamera" @capture="handleCapture" @cancel="showCamera=false" />
  <section class="operators-page" :inert="showGestion || showCamera || undefined">
    <header class="page-header"><div><h1>Operarios de tejeduría</h1><p>Horarios por fecha y turno · Digitalización de planillas</p></div><div class="actions"><button class="btn" v-tippy="'Actualizar maestro y horarios guardados'" :disabled="blocked || isLoading" @click="reload"><RefreshCw :class="{ spinning:isLoading }" />Actualizar</button><button v-if="admin" class="btn" :disabled="blocked || isLoading || !!loadError" @click="openGestion"><Users />Gestionar operarios</button><button v-if="canOperate" class="btn primary" :disabled="blocked || isLoading || !!loadError" @click="showCamera=true"><Camera />{{ isProcessing ? 'Procesando…':'Escanear planilla' }}</button></div></header>
    <div class="toolbar"><div class="date-controls" :inert="blocked || isLoading || undefined"><button class="icon-btn" v-tippy="'Día anterior'" aria-label="Día anterior" :disabled="blocked || isLoading" @click="cambiarFecha(-1)"><ChevronLeft /></button><PlantDatePicker v-model="fechaSeleccionada" label="Fecha de inicio del turno" /><button class="icon-btn" v-tippy="'Día siguiente'" aria-label="Día siguiente" :disabled="blocked || isLoading || esHoy" @click="cambiarFecha(1)"><ChevronRight /></button><button v-if="!esHoy" class="btn today" :disabled="blocked || isLoading" @click="fechaSeleccionada=fechaHoy()">Hoy</button></div><div class="shift-selector" role="group" aria-label="Turno"><span>Turno</span><button v-for="turno in turnos" :key="turno" :aria-pressed="turnoActivo===turno" :class="{ selected:turnoActivo===turno }" :disabled="blocked || isLoading" v-tippy="`Turno ${turno} · ${turno==='A' ? '06:00–14:00':turno==='B' ? '14:00–22:00':'22:00–06:00 del día siguiente'}`" @click="turnoActivo=turno">{{ turno }}</button></div><div class="search"><Search /><input v-model="searchQuery" aria-label="Buscar por legajo, nombre o puesto" placeholder="Buscar legajo, nombre o puesto…" /></div><select v-model="statusFilter" aria-label="Filtrar pertenencia al turno"><option value="">Todos los operarios</option><option value="asignado">Asignados</option><option value="otro_turno">Otros turnos</option><option value="desconocido">No registrados</option></select><div class="view-switch"><button aria-label="Vista de tabla" v-tippy="'Vista de tabla'" :aria-pressed="!vistaCards" :class="{ selected:!vistaCards }" @click="vistaCards=false"><Table2 /></button><button aria-label="Vista de tarjetas" v-tippy="'Vista de tarjetas'" :aria-pressed="vistaCards" :class="{ selected:vistaCards }" @click="vistaCards=true"><LayoutGrid /></button></div><button v-if="canOperate && tieneHorarios" class="btn danger" :disabled="blocked || isLoading || !!loadError" @click="limpiarHorarios"><XCircle />Limpiar horarios</button></div>
    <div v-if="loadError" class="error" role="alert">{{ loadError }} <button :disabled="blocked" @click="reload">Reintentar</button></div>
    <div v-if="isProcessing" class="notice" role="status"><Loader2 class="spinning" />Leyendo la planilla. La fecha y el turno permanecerán bloqueados hasta completar el proceso.</div>
    <div v-if="pendingSchedule && !isProcessing" class="error" role="alert"><span>La lectura todavía no se guardó. Se conserva en pantalla para reintentar.</span><button :disabled="savingSchedule" @click="retrySchedule">{{ savingSchedule ? 'Guardando…':'Guardar lectura' }}</button><button :disabled="savingSchedule" @click="discardSchedule">Descartar</button></div>
    <div class="data-panel" :aria-busy="isLoading"><p v-if="isLoading" class="empty" role="status">Cargando operarios y horarios…</p><p v-else-if="!operariosFiltrados.length" class="empty">{{ loadError ? 'No se pudo completar la carga.':totalAsignados===0 && !searchQuery ? `No hay operarios asignados al turno ${turnoActivo}.`:'No hay resultados que coincidan con los filtros.' }}</p><div v-else class="data-scroll">
      <table v-if="!vistaCards" class="operators-table"><colgroup><col class="id-col" /><col /><col class="job-col" /><col v-for="field in ['ingreso','salida','inicio','final']" :key="field" class="time-col" /><col v-if="admin" class="action-col" /></colgroup><thead><tr><th>Legajo</th><th>Operario</th><th>Puesto</th><th class="time ingreso">Ingreso</th><th class="time salida">Salida</th><th class="time inicio">Inicio</th><th class="time final">Final</th><th v-if="admin">Acción</th></tr></thead><tbody><tr v-for="op in operariosFiltrados" :key="`${op.estado}-${op.legajo}-${op.nombre}`" :class="op.estado"><td class="employee-id">{{ op.legajo }}</td><td><strong>{{ op.nombre }}</strong><span v-if="estadoBadge(op)" class="badge" :class="op.estado">{{ estadoBadge(op).text }}</span></td><td class="muted">{{ op.puesto || '—' }}</td><td v-for="field in ['ingreso','salida','inicio','final']" :key="field" class="time"><span class="time-value" :class="[field,{ missing:!op[field] }]">{{ op[field] || '—' }}</span></td><td v-if="admin"><button v-if="op.estado==='desconocido' && op.legajo>0" class="icon-btn" v-tippy="'Agregar al maestro de operarios'" aria-label="Agregar al maestro" :disabled="blocked" @click="ofrecerAgregarDesconocidos([{ legajo:op.legajo,nombre:op.nombre }])"><UserPlus /></button></td></tr></tbody></table>
      <div v-else class="operator-cards"><article v-for="op in operariosFiltrados" :key="`${op.estado}-${op.legajo}-${op.nombre}`" :class="op.estado"><header><div><span class="employee-id">{{ op.legajo }}</span><span v-if="estadoBadge(op)" class="badge" :class="op.estado">{{ estadoBadge(op).text }}</span><h2>{{ op.nombre }}</h2><p>{{ op.puesto || 'Sin puesto informado' }}</p></div><button v-if="admin && op.estado==='desconocido' && op.legajo>0" class="icon-btn" v-tippy="'Agregar al maestro de operarios'" aria-label="Agregar al maestro" :disabled="blocked" @click="ofrecerAgregarDesconocidos([{ legajo:op.legajo,nombre:op.nombre }])"><UserPlus /></button></header><dl><div v-for="field in ['ingreso','salida','inicio','final']" :key="field"><dt>{{ { ingreso:'Ingreso',salida:'Salida',inicio:'Inicio',final:'Final' }[field] }}</dt><dd class="time-value" :class="[field,{ missing:!op[field] }]">{{ op[field] || '—' }}</dd></div></dl></article></div>
    </div><footer class="panel-footer"><span>{{ operariosFiltrados.length }} de {{ totalTurno }} operarios · {{ totalAsignados }} asignados<span v-if="extrasEscaneados.length"> · {{ extrasEscaneados.length }} extras</span></span><span>Turno C: fecha del día en que comienza a las 22:00.</span></footer></div>
  </section>
  <Teleport to="body"><div v-if="showGestion" class="modal-backdrop" @click.self="closeGestion"><section ref="gestionModal" class="management-modal" role="dialog" aria-modal="true" aria-labelledby="operators-master-title" tabindex="-1" @keydown="gestionKeyboard"><header><div><h2 id="operators-master-title">Maestro de operarios</h2><p>Asignaciones de turnos, nombres y puestos</p></div><button class="icon-btn" v-tippy="'Cerrar gestión de operarios'" aria-label="Cerrar gestión" :disabled="savingMaster" @click="closeGestion"><X /></button></header>
    <div class="management-body"><p v-if="masterError" class="error" role="alert">{{ masterError }}</p><form class="employee-form" @submit.prevent="agregarOperario"><fieldset :disabled="savingMaster"><label>Legajo<input v-model="nuevoLegajo" type="number" min="1" step="1" required :disabled="editandoIdx!==-1" placeholder="N.º" /></label><label class="name-field">Apellido y nombre<input v-model="nuevoNombre" required placeholder="APELLIDO NOMBRE" /></label><label class="job-field">Puesto<input v-model="nuevoPuesto" placeholder="Puesto" /></label><label>Turno<select v-model="nuevoTurno"><option v-for="turno in ['A','B','C','D']" :key="turno">{{ turno }}</option></select></label><div class="form-actions"><button type="submit" class="btn primary"><Save v-if="editandoIdx!==-1" /><Plus v-else />{{ savingMaster ? 'Guardando…':editandoIdx!==-1 ? 'Guardar':'Agregar' }}</button><button v-if="gestionDirty" type="button" class="btn" @click="resetForm">Cancelar</button></div></fieldset></form><div class="management-filters"><div class="search"><Search /><input v-model="gestionSearch" aria-label="Buscar en maestro" placeholder="Buscar en el maestro…" /></div><select v-model="gestionTurno" aria-label="Filtrar turno del maestro"><option value="">Todos los turnos</option><option v-for="turno in ['A','B','C','D']" :key="turno" :value="turno">Turno {{ turno }}</option></select></div><div class="master-scroll"><table class="master-table"><colgroup><col style="width:80px" /><col /><col style="width:20%" /><col style="width:65px" /><col style="width:80px" /></colgroup><thead><tr><th>Legajo</th><th>Nombre</th><th>Puesto</th><th>Turno</th><th>Acciones</th></tr></thead><tbody><tr v-for="op in maestroFiltrado" :key="op.legajo"><td class="employee-id">{{ op.legajo }}</td><td><strong>{{ op.nombre }}</strong></td><td>{{ op.puesto || '—' }}</td><td>{{ op.turno }}</td><td><div class="actions"><button class="icon-btn" v-tippy="'Editar operario'" aria-label="Editar operario" :disabled="savingMaster" @click="editOperario(op)"><Pencil /></button><button class="icon-btn danger" v-tippy="'Eliminar del maestro'" aria-label="Eliminar del maestro" :disabled="savingMaster || gestionDirty" @click="eliminarOperario(op.legajo)"><Trash2 /></button></div></td></tr></tbody></table><p v-if="!maestroFiltrado.length" class="empty">No hay operarios que coincidan.</p></div></div><footer><span>{{ maestroFiltrado.length }} de {{ maestroOperarios.length }} operarios</span><button class="btn" :disabled="savingMaster" @click="closeGestion">Cerrar</button></footer></section></div></Teleport>
</template>

<style scoped>
.operators-page{height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;padding:14px 16px;color:#334155;font-size:13px}.page-header,.actions,.toolbar,.date-controls,.shift-selector,.panel-footer{display:flex;align-items:center;gap:8px}.page-header{justify-content:space-between;flex-wrap:wrap}.page-header h1{font-size:19px;font-weight:700;color:#1e293b}.page-header p{font-size:12px;color:#64748b;margin-top:3px}.btn,.icon-btn,.view-switch button,.shift-selector button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:0 10px;border:1px solid #cbd5e1;border-radius:5px;background:white;color:#475569;font-weight:600}.btn svg,.icon-btn svg,.view-switch svg{width:16px;height:16px}.btn:hover,.icon-btn:hover,.view-switch button:hover{background:#f1f5f9}.primary{background:#2563eb;border-color:#2563eb;color:white}.primary:hover{background:#1d4ed8}.danger{color:#dc2626}.danger:hover{background:#fef2f2}.icon-btn{width:30px;min-height:30px;padding:0}.btn:disabled,button:disabled{opacity:.4;cursor:not-allowed}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}.toolbar{flex-wrap:wrap;border:1px solid #e2e8f0;padding:9px;background:white;border-radius:7px}.date-controls{gap:4px}.today{font-size:11px;padding:0 7px}.shift-selector{gap:4px}.shift-selector>span{font-size:11px;color:#64748b;margin-right:3px}.shift-selector button{width:32px;padding:0;border-radius:4px}.selected{background:#eff6ff!important;color:#2563eb!important;border-color:#93c5fd!important}.search{position:relative;flex:1;min-width:190px}.search svg{position:absolute;left:9px;top:9px;width:16px;height:16px;color:#94a3b8}.search input{width:100%;padding-left:31px!important}input:not([type=checkbox]),select{border:1px solid #cbd5e1;background:white;border-radius:5px;padding:7px 9px;font-size:13px;min-width:0;color:#334155}.view-switch{display:flex}.view-switch button{border-radius:4px;padding:0 8px}.data-panel{flex:1;min-height:0;display:flex;flex-direction:column;border:1px solid #e2e8f0;border-radius:7px;overflow:hidden;background:white}.data-scroll{flex:1;min-height:0;overflow:auto}.operators-table,.master-table{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0}th{position:sticky;top:0;z-index:1;background:#f1f5f9;color:#475569;font-size:11px;text-align:left;font-weight:700;border-bottom:1px solid #cbd5e1}th,td{padding:10px 12px;overflow-wrap:anywhere}td{border-bottom:1px solid #eef2f6;vertical-align:middle}tbody tr:nth-child(even){background:#fafbfd}tbody tr:hover{background:#eff6ff}.id-col{width:85px}.job-col{width:18%}.time-col{width:95px}.action-col{width:60px}.employee-id{font-variant-numeric:tabular-nums;color:#2563eb;font-weight:600}.operators-table strong{font-weight:600}.time{text-align:center}.time-value{font-variant-numeric:tabular-nums;font-weight:600;font-size:13px;white-space:nowrap;display:inline-block;padding:3px 6px;border-radius:4px}.ingreso{color:#047857}.salida{color:#b91c1c}.inicio{color:#1d4ed8}.final{color:#9a3412}.time-value.ingreso{background:#ecfdf5}.time-value.salida{background:#fef2f2}.time-value.inicio{background:#eff6ff}.time-value.final{background:#fff7ed}.time-value.missing{background:transparent;color:#94a3b8}.badge{display:inline-block;font-size:10px;font-weight:600;padding:3px 6px;border-radius:4px;margin-left:7px}.badge.otro_turno{background:#fffbeb;color:#92400e}.badge.desconocido{background:#fef2f2;color:#b91c1c}tr.otro_turno td:first-child{border-left:3px solid #f59e0b}tr.desconocido td:first-child{border-left:3px solid #ef4444}.muted{color:#64748b;font-size:12px}.panel-footer{justify-content:space-between;flex-wrap:wrap;border-top:1px solid #e2e8f0;background:#f8fafc;padding:8px 12px;font-size:11px;color:#64748b}.operator-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;padding:12px}.operator-cards article{border:1px solid #e2e8f0;border-radius:6px;overflow:hidden}.operator-cards article.otro_turno{border-color:#fcd34d}.operator-cards article.desconocido{border-color:#fca5a5}.operator-cards header{display:flex;justify-content:space-between;align-items:flex-start;padding:12px;gap:8px}.operator-cards h2{font-size:14px;font-weight:600;margin-top:5px;overflow-wrap:anywhere}.operator-cards p{font-size:11px;color:#64748b;margin-top:3px}.operator-cards dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid #e2e8f0;padding:10px 6px;gap:3px;text-align:center}.operator-cards dt{font-size:10px;color:#64748b;margin-bottom:3px}.operator-cards .time-value{padding:2px 3px}.empty{padding:50px 16px;text-align:center;color:#64748b;flex:1}.error,.notice{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-radius:5px;padding:9px 12px;font-size:12px;line-height:1.5}.error{background:#fef2f2;color:#b91c1c}.error button{text-decoration:underline}.notice{background:#eff6ff;color:#1d4ed8}.notice svg{width:16px;height:16px}.modal-backdrop{position:fixed;inset:0;z-index:100;background:rgba(15,23,42,.4);display:flex;align-items:center;justify-content:center;padding:16px}.management-modal{width:min(1200px,100%);height:min(850px,calc(100dvh - 32px));min-height:0;background:white;border-radius:9px;display:flex;flex-direction:column;color:#334155;box-shadow:0 20px 60px #0f172a33;font-size:13px}.management-modal>header,.management-modal>footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 18px;border-bottom:1px solid #e2e8f0;flex:none}.management-modal h2{font-size:17px;font-weight:700}.management-modal header p{font-size:12px;color:#64748b;margin-top:3px}.management-body{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:12px;padding:16px}.employee-form fieldset{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;border:0}.employee-form label{display:flex;flex-direction:column;gap:5px;font-size:11px;color:#64748b}.employee-form label:first-child{width:90px}.name-field{flex:2;min-width:180px}.job-field{flex:1;min-width:110px}.form-actions,.management-filters{display:flex;gap:8px;align-items:center}.master-scroll{flex:1;min-height:130px;overflow:auto;border:1px solid #e2e8f0;border-radius:6px}.management-modal>footer{border-top:1px solid #e2e8f0;border-bottom:0;font-size:11px;color:#64748b}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:1100px){.operators-page{padding:10px;gap:8px}.time-col{width:72px}.id-col{width:65px}.job-col{width:15%}.action-col{width:45px}th,td{padding:8px}.time-value{padding:2px 4px;font-size:12px}.toolbar{gap:7px}.toolbar select{max-width:160px}}
@media(max-width:767px){.operators-page{height:auto;min-height:100%}.data-panel{flex:none;min-height:300px}.data-scroll{max-height:65vh}.operators-table{min-width:610px}.page-header h1{font-size:17px}.actions{flex-wrap:wrap}.toolbar .search{flex-basis:100%;order:1}.panel-footer span:last-child{display:none}.operator-cards{grid-template-columns:1fr}.modal-backdrop{padding:10px}.management-modal{height:calc(100dvh - 20px)}.management-body{padding:10px}.master-scroll{flex:none;max-height:45vh}.master-table{min-width:540px}.name-field{flex-basis:calc(100% - 110px);min-width:0}.employee-form .job-field{flex:1}.employee-form .form-actions{flex-basis:100%}.management-filters select{max-width:140px}.management-filters .search{min-width:0}.management-modal>header,.management-modal>footer{padding:10px 12px}}
</style>
