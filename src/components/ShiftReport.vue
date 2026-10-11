<script setup>
import { plantDate, addDays } from '../utils/plantTime';
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { collection, getDocs, query, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { parseShiftReportCSV, transformRows, generarReportePRD } from '../services/shiftReportService';
import { guardarReporteCSV, guardarCambiosManual, suscribirReporte } from '../services/shiftReportFirestore';
import { onBeforeRouteLeave } from 'vue-router';
import { SHIFT_GRID_FIELDS, shiftGridTarget, cleanShiftDigits } from '../utils/shiftGrid';
import { Upload, Download, Cloud, CalendarDays, X, Save, ChevronLeft, ChevronRight, FolderOpen } from 'lucide-vue-next';
import Swal from 'sweetalert2';

const isLoading = ref(false);
const isSaving = ref(false);
const toast = ref({ visible: false, message: '', timer: null });
function showToast(message) {
  if (toast.value.timer) clearTimeout(toast.value.timer);
  toast.value.message = message;
  toast.value.visible = true;
  toast.value.timer = setTimeout(() => { toast.value.visible = false; }, 1800);
}
const csvMeta = ref(null);
const csvLoaded = ref(false);
const telaresMaquinas = ref([]);
const telarAbiertoIdx = ref(null); // null = ninguno abierto

const registros = ref({});
const dirtyRecords = ref({});
const inputDrafts = ref({});
const remoteRecords = ref({});
const dirtyCount = computed(() => Object.keys(dirtyRecords.value).length);
const gridElement = ref(null);
const calendarOpen = ref(false);
const calendarMonth = ref('');
const calendarLabel = computed(() => calendarMonth.value ? new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(calendarMonth.value + '-01T12:00:00Z')) : '');
const calendarDays = computed(() => {
  if (!calendarMonth.value) return [];
  const first = new Date(calendarMonth.value + '-01T12:00:00Z');
  const offset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(calendarMonth.value + '-01', i - offset);
    return { date, day: Number(date.slice(-2)), outside: !date.startsWith(calendarMonth.value) };
  });
});
function toggleCalendar() {
  calendarMonth.value = fechaInput.value.slice(0, 7);
  calendarOpen.value = !calendarOpen.value;
}
function moveCalendarMonth(delta) {
  const date = new Date(calendarMonth.value + '-01T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + delta);
  calendarMonth.value = date.toISOString().slice(0, 7);
}
function selectReportDate(date) {
  if (isSaving.value || isLoading.value || hasUnsavedChanges()) return;
  fechaReporte.value = date.replaceAll('-', '/');
  calendarOpen.value = false;
}
const gridFields = SHIFT_GRID_FIELDS;
const gridTurnos = ['A', 'B', 'C'];
const gridCount = computed(() => telaresMaquinas.value.length * 15);
function focusGrid(index) {
  nextTick(() => {
    const input = gridElement.value?.querySelector('[data-grid-index="' + index + '"]');
    if (input) { input.focus(); input.select(); }
  });
}
function gridKeydown(event, index) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const target = shiftGridTarget(index, event.key, gridCount.value);
  if (target !== null) { event.preventDefault(); focusGrid(target); }
}
function gridInput(event, loom, turno, field, index) {
  const cleaned = cleanShiftDigits(event.target.value, field.max);
  event.target.value = cleaned;
  setVal(loom, turno, field.field, cleaned);
  if (cleaned.length === field.max) {
    let next = index + 1;
    while (next < gridCount.value && gridElement.value?.querySelector('[data-grid-index="' + next + '"]')?.readOnly) next++;
    if (next < gridCount.value) focusGrid(next);
    else nextTick(() => gridElement.value?.querySelector('[data-grid-save]')?.focus());
  }
}
function hasUnsavedChanges() {
  if (!dirtyCount.value && !isSaving.value) return false;
  Swal.fire({ icon: 'info', title: 'Cambios sin guardar', text: 'Guardá los cambios antes de cambiar la fecha, importar o exportar.' });
  return true;
}
async function guardarPlanilla(loom = null) {
  if (isSaving.value) return false;
  const changes = Object.entries(dirtyRecords.value).filter(([key]) => !loom || registros.value[key]?.loom === loom)
    .map(([key, base]) => ({ key, base, data: { ...registros.value[key] } }));
  if (!changes.length) return true;
  const date = fechaReporte.value;
  isSaving.value = true;
  for (const change of changes) pendingSaves.add(change.key);
  try {
    await guardarCambiosManual(date, changes);
    for (const change of changes) {
      delete dirtyRecords.value[change.key];
      for (const field of gridFields) delete inputDrafts.value[change.key + '_' + field.field];
    }
    showToast('Cambios guardados ✓');
    return true;
  } catch (error) {
    Swal.fire({ icon: 'error', title: error.code === 'shiftreport/conflict' ? 'Otro usuario modificó estos datos' : 'No se pudo guardar', text: error.code === 'shiftreport/conflict' ? error.message + ' Tus cambios siguen en pantalla; revisá el conflicto antes de continuar.' : 'Tus cambios siguen pendientes. Revisá la conexión y reintentá.' });
    return false;
  } finally {
    for (const change of changes) pendingSaves.delete(change.key);
    isSaving.value = false;
  }
}
async function descartarCambios() {
  if (isSaving.value) return;
  const answer = await Swal.fire({ icon: 'warning', title: 'Descartar cambios pendientes', text: 'Se recuperarán los últimos datos recibidos del servidor.', showCancelButton: true, confirmButtonText: 'Descartar', cancelButtonText: 'Seguir cargando' });
  if (!answer.isConfirmed) return;
  dirtyRecords.value = {};
  inputDrafts.value = {};
  registros.value = { ...remoteRecords.value };
}
function protectUnload(event) {
  if (dirtyCount.value) { event.preventDefault(); event.returnValue = ''; }
}
onMounted(() => window.addEventListener('beforeunload', protectUnload));
onUnmounted(() => { window.removeEventListener('beforeunload', protectUnload); if (toast.value.timer) clearTimeout(toast.value.timer); });
onBeforeRouteLeave(async () => {
  if (isSaving.value) return false;
  if (!dirtyCount.value) return true;
  const answer = await Swal.fire({ icon: 'warning', title: 'Cambios sin guardar', text: '¿Salir y descartar los cambios pendientes?', showCancelButton: true, confirmButtonText: 'Descartar y salir', cancelButtonText: 'Seguir cargando' });
  return answer.isConfirmed;
});

const fechaAyer = () => addDays(plantDate(), -1).replaceAll('-', '/');
const fechaReporte = ref(fechaAyer());

const fechaInput = computed(() => fechaReporte.value.replaceAll('/', '-'));

let unsubscribeFn = null;
const pendingSaves = new Set();

// --- File System Access API: persistir carpeta de CSVs en IndexedDB ---
const soportaFSA = 'showDirectoryPicker' in window;
const savedDirHandle = ref(null);
const savedDirName = ref('');

function idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('shift-report-prefs', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
    req.onsuccess = e => res(e.target.result);
    req.onerror = rej;
  });
}
async function idbPut(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('handles', 'readwrite');
    if (val !== null && val !== undefined) {
      tx.objectStore('handles').put(val, key);
    } else {
      tx.objectStore('handles').delete(key);
    }
    tx.oncomplete = res; tx.onerror = rej;
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const req = db.transaction('handles', 'readonly').objectStore('handles').get(key);
    req.onsuccess = e => res(e.target.result ?? null);
    req.onerror = rej;
  });
}

/** "2026/04/05" → "SR050426.csv" */
function csvNombreDesde(fecha) {
  const [yyyy, mm, dd] = (fecha || '').split('/');
  if (!yyyy || !mm || !dd) return null;
  return `SR${dd}${mm}${yyyy.slice(2)}.csv`;
}

async function limpiarCarpeta() {
  savedDirHandle.value = null;
  savedDirName.value = '';
  try { await idbPut('csvFolder', null); } catch { /* ignorar */ }
}

async function writeBackupToFolder(text, fecha) {
  if (!savedDirHandle.value) return;
  let wroteRoot = false;
  let wroteBackup = false;
  let srName = null;
  let abbr = null;
  let yyyy = null;
  try {
    let perm = await savedDirHandle.value.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await savedDirHandle.value.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return;
    const blob = new Blob([text], { type: 'text/csv' });
    // Escribir shiftreport.csv en la raíz (si posible)
    try {
      const rootFh = await savedDirHandle.value.getFileHandle('shiftreport.csv', { create: true });
      const rootWritable = await rootFh.createWritable();
      await rootWritable.write(blob);
      await rootWritable.close();
      wroteRoot = true;
    } catch (e) {
      console.warn('No se pudo escribir shiftreport.csv en la raíz:', e);
    }

    // Escribir backup renombrado en Backup/{mesAbrev}-{YYYY}/SRDDMMYY.csv
    try {
      const parts = (fecha || '').split('/');
      yyyy = parts[0];
      const mm = parts[1];
      const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
      abbr = months[Number(mm) - 1] || mm;
      srName = csvNombreDesde(fecha);
      const backupRoot = await savedDirHandle.value.getDirectoryHandle('Backup', { create: true });
      const monthly = await backupRoot.getDirectoryHandle(`${abbr}-${yyyy}`, { create: true });
      if (srName) {
        const fh = await monthly.getFileHandle(srName, { create: true });
        const writable = await fh.createWritable();
        await writable.write(blob);
        await writable.close();
        wroteBackup = true;
      }
    } catch (e) {
      console.warn('No se pudo escribir backup en subcarpeta:', e);
    }

    if (wroteRoot || wroteBackup) {
      const lines = [];
      if (wroteRoot) lines.push('shiftreport.csv en la raíz');
      if (wroteBackup) lines.push(`Backup/${abbr}-${yyyy}/${srName}`);
      Swal.fire({ icon: 'success', title: 'Backup guardado', html: lines.join('<br/>'), timer: 2200, showConfirmButton: false });
    }
  } catch (e) {
    console.warn('No se pudo escribir backup:', e);
  }
}

async function elegirCarpeta() {
  if (!soportaFSA) return;
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    savedDirHandle.value = dirHandle;
    savedDirName.value = dirHandle.name;
    try { await idbPut('csvFolder', dirHandle); } catch { /* no crítico */ }
    // Intentar leer el CSV de la fecha activa desde la carpeta recién elegida
    isLoading.value = true;
    try {
      const candidatos = [csvNombreDesde(fechaReporte.value), 'shiftreport.csv', 'ShiftReport.csv'];
      let file = null;
      for (const nombre of candidatos) {
        try {
          const fh = await dirHandle.getFileHandle(nombre);
          file = await fh.getFile();
          break;
        } catch {}
      }
      if (file) {
        await procesarArchivoCSV(file);
      } else {
        Swal.fire({ icon: 'success', title: 'Carpeta guardada', text: `"${dirHandle.name}" se recordará para próximas lecturas`, timer: 2200, showConfirmButton: false });
      }
    } finally {
      isLoading.value = false;
    }
  } catch (err) {
    if (err.name !== 'AbortError') Swal.fire('Error', err.message, 'error');
  }
}

function suscribir() {
  if (unsubscribeFn) unsubscribeFn();
  unsubscribeFn = suscribirReporte(fechaReporte.value, (data) => {
    remoteRecords.value = { ...(data?.registros || {}) };
    if (data) {
      const incoming = data.registros || {};
      const merged = { ...incoming };
      for (const key of new Set([...pendingSaves, ...Object.keys(dirtyRecords.value)])) {
        if (registros.value[key]) merged[key] = registros.value[key];
      }
      registros.value = merged;
      csvMeta.value = data.csvMeta || null;
      csvLoaded.value = Object.values(incoming).some(r => r.source === 'csv');
    } else if (pendingSaves.size === 0 && !dirtyCount.value) {
      registros.value = {};
      csvMeta.value = null;
      csvLoaded.value = false;
    }
  });
}

onMounted(async () => {
  // Recuperar carpeta guardada del IDB
  try {
    const h = await idbGet('csvFolder');
    if (h) { savedDirHandle.value = h; savedDirName.value = h.name; }
  } catch { /* IDB no disponible en este entorno */ }

  try {
    const snap = await getDocs(query(collection(db, 'maquinas')));
    telaresMaquinas.value = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(m => m.tipo === 'TELAR' && (m.activo ?? true))
      .sort((a, b) => (a.orden_patrulla || 999) - (b.orden_patrulla || 999));
  } catch (e) {
    console.error('Error cargando telares:', e);
  }
  suscribir();
});

watch(fechaReporte, () => {
  inputDrafts.value = {};
  registros.value = {};
  csvMeta.value = null;
  csvLoaded.value = false;
  telarAbiertoIdx.value = null;
  suscribir();
});

onUnmounted(() => { if (unsubscribeFn) unsubscribeFn(); });

// Telar abierto
const telarAbierto = computed(() => {
  if (telarAbiertoIdx.value == null) return null;
  const m = telaresMaquinas.value[telarAbiertoIdx.value];
  if (!m) return null;
  const loom = String(m.maquina);
  return {
    loom,
    label: loom.slice(-2).replace(/^0/, ''),
    turnos: ['A', 'B', 'C'].map(turno => {
      const key = `${loom}_${turno}`;
      const r = registros.value[key] || {};
      return {
        turno,
        tieneCSV: r.source === 'csv',
        rpm: r.rpm ?? null,
        picks: r.picks ?? null,
        weftCount: r.weftCount ?? null,
        warpCount: r.warpCount ?? null,
        otherCount: r.otherCount ?? null,
      };
    })
  };
});

function toggleTelar(idx) {
  telarAbiertoIdx.value = telarAbiertoIdx.value === idx ? null : idx;
}
function cerrarTelar() {
  telarAbiertoIdx.value = null;
}
function navTelar(dir) {
  const next = telarAbiertoIdx.value + dir;
  if (next >= 0 && next < telaresMaquinas.value.length) telarAbiertoIdx.value = next;
}

// Resumen para lista
const telaresResumen = computed(() => {
  return telaresMaquinas.value.map((m, idx) => {
    const loom = String(m.maquina);
    let tieneData = false;
    let csvCount = 0;
    let datosCount = 0;
    for (const turno of ['A', 'B', 'C']) {
      const r = registros.value[`${loom}_${turno}`];
      const tieneDatos = r && (r.picks != null || r.rpm != null || r.weftCount != null);
      if (tieneDatos) { tieneData = true; datosCount++; }
      if (r && r.source === 'csv') { csvCount++; }
    }
    const datosCompleto = datosCount === 3;
    const datosParcial = datosCount > 0 && datosCount < 3;
    return { idx, loom, label: loom.slice(-2).replace(/^0/, ''), ordenPatrulla: m.orden_patrulla || idx + 1, tieneData, csvCount, datosCount, datosCompleto, datosParcial };
  });
});

// PRD export
const todosRegistrosMerged = computed(() => {
  const result = [];
  for (const turno of ['A', 'B', 'C']) {
    telaresMaquinas.value.forEach(m => {
      const loom = String(m.maquina);
      const r = registros.value[`${loom}_${turno}`] || {};
      result.push({ loom, turno, fecha: fechaReporte.value, rpm: r.rpm ?? null, picks: r.picks ?? 0, weftCount: r.weftCount ?? 0, warpCount: r.warpCount ?? 0, otherCount: r.otherCount ?? 0 });
    });
  }
  return result;
});

// Stats
const stats = computed(() => {
  const total = telaresMaquinas.value.length;
  let conCSV = 0, conRpm = 0, rotTotal = 0;
  for (const m of telaresMaquinas.value) {
    const loom = String(m.maquina);
    let loomCSV = false, loomRpm = false;
    for (const turno of ['A', 'B', 'C']) {
      const r = registros.value[`${loom}_${turno}`];
      if (r?.source === 'csv') loomCSV = true;
      if (r?.rpm) loomRpm = true;
      rotTotal += (r?.weftCount || 0) + (r?.warpCount || 0) + (r?.otherCount || 0);
    }
    if (loomCSV) conCSV++;
    if (loomRpm) conRpm++;
  }
  return { total, sinCSV: total - conCSV, sinRpm: total - conRpm, rotTotal };
});

// Input manual — sin debounce, guardado explícito con botón
function getVal(loom, turno, field) {
  const key = `${loom}_${turno}`;
  return registros.value[key]?.[field] ?? null;
}

function getInputVal(loom, turno, field) {
  const key = loom + '_' + turno + '_' + field;
  return inputDrafts.value[key] ?? getVal(loom, turno, field) ?? '';
}
function setVal(loom, turno, field, value) {
  if (isSaving.value || isLoading.value) return;
  const key = `${loom}_${turno}`;
  if (!(key in dirtyRecords.value)) dirtyRecords.value[key] = registros.value[key] ? { ...registros.value[key] } : null;
  if (!registros.value[key]) {
    registros.value[key] = { loom, turno, rpm: null, picks: null, weftCount: null, warpCount: null, otherCount: null, style: '', beam: '', source: 'manual' };
  }
  inputDrafts.value[key + '_' + field] = String(value);
  const num = parseInt(value, 10);
  registros.value[key] = { ...registros.value[key], [field]: isNaN(num) ? null : num };
}

// Auto-advance: salta al próximo input cuando se completa maxlength
// Orden de campos por turno: picks(3), weftCount(2), warpCount(2), otherCount(2), rpm(3)
// Flujo: A_picks → A_weft → A_warp → A_other → A_rpm → B_picks → ... → C_rpm → Guardar
const fieldOrder = [
  { turno: 'A', field: 'picks', max: 3 }, { turno: 'A', field: 'weftCount', max: 2 }, { turno: 'A', field: 'warpCount', max: 2 }, { turno: 'A', field: 'otherCount', max: 2 }, { turno: 'A', field: 'rpm', max: 3 },
  { turno: 'B', field: 'picks', max: 3 }, { turno: 'B', field: 'weftCount', max: 2 }, { turno: 'B', field: 'warpCount', max: 2 }, { turno: 'B', field: 'otherCount', max: 2 }, { turno: 'B', field: 'rpm', max: 3 },
  { turno: 'C', field: 'picks', max: 3 }, { turno: 'C', field: 'weftCount', max: 2 }, { turno: 'C', field: 'warpCount', max: 2 }, { turno: 'C', field: 'otherCount', max: 2 }, { turno: 'C', field: 'rpm', max: 3 },
];

function focusMobile(index) {
  nextTick(() => {
    const next = fieldOrder[index];
    const input = next && document.querySelector('[data-sr="' + next.turno + '_' + next.field + '"]');
    if (input) { input.focus(); input.select(); }
  });
}
function mobileKeydown(event, turno, field) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const index = fieldOrder.findIndex(item => item.turno === turno && item.field === field);
  const target = shiftGridTarget(index, event.key, fieldOrder.length, 5);
  if (target !== null) { event.preventDefault(); focusMobile(target); }
}
function onInput(ev, loom, turno, field, maxLen) {
  const cleaned = cleanShiftDigits(ev.target.value, maxLen);
  ev.target.value = cleaned;
  setVal(loom, turno, field, cleaned);
  if (cleaned.length < maxLen) return;
  const index = fieldOrder.findIndex(item => item.turno === turno && item.field === field);
  for (let i = index + 1; i < fieldOrder.length; i++) {
    const next = fieldOrder[i];
    if (document.querySelector('[data-sr="' + next.turno + '_' + next.field + '"]')) { focusMobile(i); return; }
  }
  nextTick(() => document.querySelector('[data-sr-save]')?.focus());
}

async function guardarTelar() {
  if (!telarAbierto.value) return;
  const loom = telarAbierto.value.loom;

  // Validar completitud antes de guardar
  const turnosConDatos = ['A', 'B', 'C'].filter(turno => {
    const r = registros.value[`${loom}_${turno}`];
    return r && (r.picks != null || r.rpm != null || r.weftCount != null);
  });

  if (turnosConDatos.length === 0) {
    const res = await Swal.fire({
      icon: 'warning',
      title: 'Sin datos',
      text: 'No se ingresó ningún dato en ningún turno. ¿Guardar de todos modos?',
      showCancelButton: true,
      confirmButtonText: 'Guardar igual',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d97706',
    });
    if (!res.isConfirmed) return;
  } else if (turnosConDatos.length < 3) {
    const faltantes = ['A', 'B', 'C'].filter(t => !turnosConDatos.includes(t));
    const res = await Swal.fire({
      icon: 'info',
      title: 'Datos parciales',
      html: `Solo se cargaron los turnos <b>${turnosConDatos.join(', ')}</b>.<br>Faltan: <b>${faltantes.join(', ')}</b>.<br>¿Guardar de todas formas?`,
      showCancelButton: true,
      confirmButtonText: 'Guardar igual',
      cancelButtonText: 'Completar primero',
      confirmButtonColor: '#2563eb',
    });
    if (!res.isConfirmed) return;
  }

  if (await guardarPlanilla(loom)) {
    const nextIdx = telarAbiertoIdx.value + 1;
    telarAbiertoIdx.value = nextIdx < telaresMaquinas.value.length ? nextIdx : null;
  }
}

// CSV
function pickCSVFile() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = e => resolve(e.target.files[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

async function procesarArchivoCSV(file) {
  if (hasUnsavedChanges()) return;
  const text = await file.text();
  const { meta, rows } = parseShiftReportCSV(text);
  const records = transformRows(rows);
  const fecha = records[0]?.fecha || fechaReporte.value;

  // Verificar si ya hay datos en Firestore para esta fecha
  const docSnap = await getDoc(doc(db, 'shift_reports', fecha.replace(/\//g, '-')));
  if (docSnap.exists() && Object.keys(docSnap.data().registros || {}).length > 0) {
    const res = await Swal.fire({
      title: '¿Qué deseas hacer?',
      html: `Ya hay datos guardados para <b>${fecha}</b>.`,
      icon: 'question',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Ver datos de Firestore',
      denyButtonText: 'Sobreescribir con CSV',
      cancelButtonText: 'Cancelar',
      denyButtonColor: '#dc2626',
      confirmButtonColor: '#2563eb',
    });
    if (res.isConfirmed) {
      if (fecha !== fechaReporte.value) fechaReporte.value = fecha;
      return;
    }
    if (!res.isDenied) return; // cancelado
  }

  // Intentar escribir backups locales si hay carpeta guardada
  try {
    await writeBackupToFolder(text, fecha);
  } catch (e) {
    console.warn('Backup local falló', e);
  }

  await guardarReporteCSV(fecha, meta, records);
  if (fecha !== fechaReporte.value) fechaReporte.value = fecha;
  const telaresCSV = new Set(records.map(r => r.loom));
  const telaresMatch = telaresMaquinas.value.filter(m => telaresCSV.has(String(m.maquina))).length;
  Swal.fire({ icon: 'success', title: 'CSV cargado', text: `${telaresMatch} telar(es) con datos`, timer: 2500, showConfirmButton: false });
}

async function cargarCSV() {
  isLoading.value = true;
  try {
    // Si hay carpeta guardada, intentar leer el CSV por nombre automáticamente (archivado o genérico)
    if (savedDirHandle.value) {
      let perm = await savedDirHandle.value.queryPermission({ mode: 'read' });
      if (perm !== 'granted') perm = await savedDirHandle.value.requestPermission({ mode: 'read' });
      if (perm === 'granted') {
        const candidatos = [csvNombreDesde(fechaReporte.value), 'shiftreport.csv', 'ShiftReport.csv'];
        for (const nombre of candidatos) {
          try {
            const fh = await savedDirHandle.value.getFileHandle(nombre);
            const file = await fh.getFile();
            await procesarArchivoCSV(file);
            return;
          } catch {}
        }
        Swal.fire({ icon: 'info', title: `${csvNombreDesde(fechaReporte.value)} no encontrado`, text: 'Selecciona el archivo CSV manualmente.', timer: 2500, showConfirmButton: false });
      } else {
        await limpiarCarpeta();
      }
    }
    // Fallback: selector de archivo clásico
    const file = await pickCSVFile();
    if (file) await procesarArchivoCSV(file);
  } catch (err) {
    if (err.name !== 'AbortError') Swal.fire('Error', err.message, 'error');
  } finally {
    isLoading.value = false;
  }
}

function exportarPRD() {
  if (hasUnsavedChanges()) return;
  const merged = todosRegistrosMerged.value;
  const incompletos = merged.filter(r => !r.rpm);
  if (incompletos.length > 0) {
    Swal.fire({ icon: 'warning', title: 'Datos incompletos', html: `<b>${incompletos.length}</b> telar(es) sin RPM.<br>¿Exportar?`, showCancelButton: true, confirmButtonText: 'Exportar', cancelButtonText: 'Cancelar', confirmButtonColor: '#2563eb' }).then(res => { if (res.isConfirmed) descargarTXT(merged); });
    return;
  }
  descargarTXT(merged);
}

function descargarTXT(records) {
  const contenido = generarReportePRD(records);
  const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const parts = (fechaReporte.value || '').split('/');
  const nombre = parts.length === 3 ? `TD${parts[2]}${parts[1]}${parts[0].slice(2)}.txt` : 'TD_reporte.txt';
  a.href = url; a.download = nombre; a.click();
  URL.revokeObjectURL(url);
}

const isExporting = ref(false);

async function exportarXLSX() {
  if (hasUnsavedChanges()) return;
  if (isExporting.value) return;
  isExporting.value = true;
  try {
    const { default: ExcelJS } = await import('exceljs');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Resumen');

    // Anchos de columna (A–Q = 17 cols)
    ws.columns = [
      { width: 6.3 },  // A - vacía
      { width: 5.4 },  // B - Telar
      { width: 6.7 },  // C - A Pts
      { width: 6.7 },  // D - A Rot T
      { width: 6.7 },  // E - A Rot U
      { width: 6.7 },  // F - A Rot O
      { width: 6.7 },  // G - A RPM
      { width: 6.7 },  // H - B Pts
      { width: 6.7 },  // I - B Rot T
      { width: 6.7 },  // J - B Rot U
      { width: 6.7 },  // K - B Rot O
      { width: 6.7 },  // L - B RPM
      { width: 6.7 },  // M - C Pts
      { width: 6.7 },  // N - C Rot T
      { width: 6.7 },  // O - C Rot U
      { width: 6.7 },  // P - C Rot O
      { width: 6.7 },  // Q - C RPM
    ];

    // Fecha del reporte
    const [yyyy, mm, dd] = (fechaReporte.value || '').split('/');
    const fechaDate = new Date(Number(yyyy), Number(mm) - 1, Number(dd));

    // Estilos reutilizables
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    const turnoFills = {
      A: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } },
      B: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } },
      C: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } },
    };
    const boldWhite = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const boldDark = { bold: true, size: 11 };
    const centerAlign = { horizontal: 'center', vertical: 'middle' };
    const thinBorder = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' },
    };

    // --- Fila 2: Empresa + Fecha ---
    ws.mergeCells('B2:C3');
    ws.mergeCells('D2:M2');
    ws.mergeCells('N2:Q3');

    const cEmpresa = ws.getCell('D2');
    cEmpresa.value = 'SANTANA TEXTIL CHACO S.A. - UNIDAD V';
    cEmpresa.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    cEmpresa.fill = headerFill;
    cEmpresa.alignment = centerAlign;

    const cFecha = ws.getCell('N2');
    cFecha.value = fechaDate;
    cFecha.numFmt = 'DD/MM/YYYY';
    cFecha.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cFecha.fill = headerFill;
    cFecha.alignment = centerAlign;

    // --- Fila 3: Título ---
    ws.mergeCells('D3:M3');
    const cTitulo = ws.getCell('D3');
    cTitulo.value = '"PUNTOS Y ROTURAS"';
    cTitulo.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    cTitulo.fill = headerFill;
    cTitulo.alignment = centerAlign;

    // Row heights
    ws.getRow(2).height = 18;
    ws.getRow(3).height = 18;

    // --- Fila 5: Encabezados de turno ---
    ws.mergeCells('C5:G5');
    ws.mergeCells('H5:L5');
    ws.mergeCells('M5:Q5');
    [['C5', 'Turno "A"', 'FFBDD7EE'], ['H5', 'Turno "B"', 'FFFFE699'], ['M5', 'Turno "C"', 'FFC6EFCE']].forEach(([addr, val, argb]) => {
      const c = ws.getCell(addr);
      c.value = val;
      c.font = boldDark;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
      c.alignment = centerAlign;
      c.border = thinBorder;
    });
    ws.getRow(5).height = 16;

    // --- Fila 6: Encabezados de columna ---
    const headers6 = [
      [2, 'Telar'], [3, 'Pts'], [4, 'Rot T'], [5, 'Rot U'], [6, 'Rot O'], [7, 'RPM'],
      [8, 'Pts'], [9, 'Rot T'], [10, 'Rot U'], [11, 'Rot O'], [12, 'RPM'],
      [13, 'Pts'], [14, 'Rot T'], [15, 'Rot U'], [16, 'Rot O'], [17, 'RPM'],
    ];
    const colTurnoFill = (cn) => {
      if (cn >= 3 && cn <= 7) return turnoFills.A;
      if (cn >= 8 && cn <= 12) return turnoFills.B;
      return turnoFills.C;
    };
    headers6.forEach(([cn, label]) => {
      const c = ws.getRow(6).getCell(cn);
      c.value = label;
      c.font = boldDark;
      c.fill = colTurnoFill(cn);
      c.alignment = centerAlign;
      c.border = thinBorder;
    });
    ws.getRow(6).height = 15;

    // --- Filas de datos (desde fila 7) ---
    telaresMaquinas.value.forEach((m, idx) => {
      const rowNum = 7 + idx;
      const loom = String(m.maquina);
      const label = parseInt(loom.slice(-2), 10) || (idx + 1);

      const ra = registros.value[`${loom}_A`] || {};
      const rb = registros.value[`${loom}_B`] || {};
      const rc = registros.value[`${loom}_C`] || {};

      const rowData = [
        [2, label],
        [3, ra.picks ?? null],    [4, ra.weftCount ?? null], [5, ra.warpCount ?? null],
        [6, ra.otherCount ?? null], [7, ra.rpm ?? null],
        [8, rb.picks ?? null],    [9, rb.weftCount ?? null], [10, rb.warpCount ?? null],
        [11, rb.otherCount ?? null], [12, rb.rpm ?? null],
        [13, rc.picks ?? null],   [14, rc.weftCount ?? null], [15, rc.warpCount ?? null],
        [16, rc.otherCount ?? null], [17, rc.rpm ?? null],
      ];

      const row = ws.getRow(rowNum);
      rowData.forEach(([cn, val]) => {
        const c = row.getCell(cn);
        c.value = val;
        c.alignment = centerAlign;
        c.border = thinBorder;
        if (cn === 2) c.font = boldDark;
        // Resaltar valores altos de roturas
        if ((cn === 4 || cn === 9 || cn === 14) && val > 10) {
          c.font = { bold: true, color: { argb: 'FF9C0006' } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
        } else if ((cn === 5 || cn === 10 || cn === 15) && val > 5) {
          c.font = { bold: true, color: { argb: 'FF9C0006' } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
        }
      });
      row.height = 14;
      row.commit();
    });

    // Generar y descargar
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const parts2 = (fechaReporte.value || '').split('/');
    const nombre = parts2.length === 3 ? `SR${parts2[2]}${parts2[1]}${parts2[0].slice(2)}.xlsx` : 'ShiftReport.xlsx';
    a.href = url; a.download = nombre; a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Error exportando xlsx:', e);
    Swal.fire('Error', 'No se pudo generar el Excel', 'error');
  } finally {
    isExporting.value = false;
  }
}
</script>

<template>
  <div class="shift-page">
    <!-- Toast de guardado -->
    <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0 translate-y-2" enter-to-class="opacity-100 translate-y-0" leave-active-class="transition duration-150 ease-in" leave-from-class="opacity-100 translate-y-0" leave-to-class="opacity-0 translate-y-2">
      <div v-if="toast.visible" class="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-gray-800 text-white text-sm font-semibold rounded-full shadow-lg pointer-events-none">
        {{ toast.message }}
      </div>
    </Transition>
    <main class="shift-workspace">


      <header class="shift-report-header">
        <div class="shift-report-controls">
          <div class="shift-calendar" @keydown.esc="calendarOpen = false">
            <button class="shift-button" :disabled="isSaving || isLoading" :aria-expanded="calendarOpen" aria-haspopup="dialog" @click="toggleCalendar"><CalendarDays :size="17" />{{ fechaReporte.split('/').reverse().join('/') }}</button>
            <template v-if="calendarOpen">
              <button class="shift-calendar-dismiss" aria-label="Cerrar calendario" @click="calendarOpen = false" tabindex="-1"></button>
              <div class="shift-calendar-panel" role="dialog" aria-label="Elegir fecha del reporte">
                <div class="shift-calendar-heading"><button class="shift-button" aria-label="Mes anterior" @click="moveCalendarMonth(-1)"><ChevronLeft :size="16" /></button><strong>{{ calendarLabel }}</strong><button class="shift-button" aria-label="Mes siguiente" @click="moveCalendarMonth(1)"><ChevronRight :size="16" /></button></div>
                <div class="shift-calendar-days"><span v-for="day in ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do']" :key="day" class="shift-calendar-weekday">{{ day }}</span><button v-for="day in calendarDays" :key="day.date" :aria-label="day.date.split('-').reverse().join('/')" :aria-pressed="day.date === fechaInput" :class="{ 'is-outside': day.outside, 'is-selected': day.date === fechaInput, 'is-today': day.date === plantDate() }" @click="selectReportDate(day.date)">{{ day.day }}</button></div>
                <div class="shift-calendar-shortcuts"><button class="shift-button" @click="selectReportDate(plantDate())">Hoy</button><button class="shift-button" @click="selectReportDate(addDays(plantDate(), -1))">Ayer</button><button class="shift-button" @click="calendarOpen = false">Cerrar</button></div>
              </div>
            </template>
          </div>
          <span class="shift-sync" :class="{ 'is-pending': dirtyCount || isSaving }" role="status" :title="isSaving ? 'Guardando cambios' : dirtyCount ? 'Cambios pendientes de guardar' : 'Sin cambios pendientes'"><Cloud :size="17" /><span>{{ isSaving ? 'Guardando…' : dirtyCount ? 'Pendiente' : 'Sin pendientes' }}</span></span>
          <div class="shift-import-actions">
            <div v-if="savedDirName" class="shift-folder"><button class="shift-button" :disabled="isLoading || isSaving" :title="'Carpeta: ' + savedDirName" @click="elegirCarpeta"><FolderOpen :size="16" /><span>{{ savedDirName }}</span></button><button class="shift-button" :disabled="isLoading || isSaving" aria-label="Quitar carpeta guardada" @click="limpiarCarpeta"><X :size="14" /></button></div>
            <button v-else-if="soportaFSA" class="shift-button" :disabled="isLoading || isSaving" title="Elegir carpeta de CSVs" @click="elegirCarpeta"><FolderOpen :size="16" />Carpeta</button>
            <button class="shift-button shift-button-primary" :disabled="isLoading || isSaving" @click="cargarCSV"><Upload :size="16" />{{ isLoading ? 'Cargando…' : 'Subir CSV' }}</button>
          </div>
        </div>
        <div class="shift-summary" aria-label="Resumen de producción"><span><strong>{{ stats.total }}</strong> telares</span><span :class="{ 'summary-warning': stats.sinCSV }"><strong>{{ stats.sinCSV }}</strong> sin CSV</span><span :class="{ 'summary-warning': stats.sinRpm }"><strong>{{ stats.sinRpm }}</strong> sin RPM</span><span :class="{ 'summary-alert': stats.rotTotal }"><strong>{{ stats.rotTotal }}</strong> roturas</span><span v-if="csvMeta" class="shift-csv-meta" :title="csvMeta.generatedAt">CSV: {{ csvMeta.rangoDesde }} → {{ csvMeta.rangoHasta }}</span></div>
      </header>

      <section ref="gridElement" class="shift-desktop">
        <header class="shift-grid-toolbar"><div><h1>Producción por turno</h1><p>Pts × 1.000 · tres dígitos para avanzar · flechas para navegar</p></div><div class="shift-grid-actions"><span aria-live="polite">{{ dirtyCount ? dirtyCount + ' registros pendientes' : 'Sin cambios pendientes' }}</span><button data-grid-save class="shift-button shift-button-primary" :disabled="!dirtyCount || isSaving" @click="guardarPlanilla()"><Save :size="16" />{{ isSaving ? 'Guardando…' : 'Guardar cambios' }}</button><button v-if="dirtyCount" class="shift-button" :disabled="isSaving" @click="descartarCambios">Descartar</button><button class="shift-button" :disabled="!!dirtyCount || isSaving" @click="exportarPRD"><Download :size="16" />TXT PRD</button><button class="shift-button" :disabled="!!dirtyCount || isSaving || isExporting" @click="exportarXLSX"><Download :size="16" />Excel</button></div></header>
        <div class="shift-grid-scroll"><table class="shift-grid"><caption class="sr-only">Puntos en miles, paradas de trama, urdimbre y otras, y RPM por telar y turno</caption><thead><tr><th rowspan="2" class="shift-loom">Telar</th><th v-for="turno in gridTurnos" :key="turno" colspan="5" :class="'shift-turn-' + turno">Turno {{ turno }}</th></tr><tr><template v-for="turno in gridTurnos" :key="turno"><th v-for="field in gridFields" :key="field.field" :class="'shift-turn-' + turno">{{ field.label }}</th></template></tr></thead><tbody><tr v-for="(telar, row) in telaresResumen" :key="telar.loom"><th class="shift-loom" scope="row" :title="'Máquina ' + telar.loom">{{ telar.label }}</th><template v-for="(turno, ti) in gridTurnos" :key="turno"><td v-for="(field, fi) in gridFields" :key="field.field" :class="[{ 'shift-dirty': (telar.loom + '_' + turno) in dirtyRecords, 'shift-imported': registros[telar.loom + '_' + turno]?.source === 'csv' }, { 'shift-turn-start': fi === 0, 'shift-attention': field.alertAbove != null && getVal(telar.loom, turno, field.field) > field.alertAbove }]"><input type="text" inputmode="numeric" :maxlength="field.max" :value="getInputVal(telar.loom, turno, field.field)" :readonly="registros[telar.loom + '_' + turno]?.source === 'csv'" :disabled="isSaving || isLoading" :data-grid-index="row * 15 + ti * 5 + fi" :aria-label="'Telar ' + telar.label + ', turno ' + turno + ', ' + field.label" :title="registros[telar.loom + '_' + turno]?.source === 'csv' ? 'Importado de CSV; solo lectura' : field.field === 'picks' ? 'Miles de picks: 261 = 261.000 picks' : field.label" @focus="$event.target.select()" @keydown="gridKeydown($event, row * 15 + ti * 5 + fi)" @input="gridInput($event, telar.loom, turno, field, row * 15 + ti * 5 + fi)" /></td></template></tr><tr v-if="!telaresResumen.length"><td colspan="16" class="shift-grid-empty">No hay telares activos para mostrar.</td></tr></tbody></table></div>
        <footer class="shift-grid-help">Amarillo: cambios pendientes · Gris: datos importados de CSV · Enter, Tab y ←/→ recorren los campos · ↑/↓ recorren la columna</footer>
      </section>
      <!-- Lista de telares con tarjeta expandible -->
      <div class="shift-mobile space-y-1">
        <div v-for="t in telaresResumen" :key="t.loom">
          <!-- Fila del telar -->
          <button
            @click="toggleTelar(t.idx)"
            class="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all active:scale-[0.98]"
            :class="telarAbiertoIdx === t.idx
              ? 'bg-blue-600 text-white shadow-md'
              : t.datosCompleto
                ? 'bg-emerald-50 border border-emerald-200 text-gray-800'
                : t.datosParcial
                  ? 'bg-amber-50 border border-amber-300 text-gray-800'
                  : 'bg-white border border-gray-200 text-gray-800 hover:bg-gray-50'"
          >
            <div class="flex items-center gap-3">
              <span class="text-lg font-black" :class="telarAbiertoIdx === t.idx ? 'text-white' : ''">Toyota {{ t.label }}</span>
              <span v-if="t.datosCompleto && telarAbiertoIdx !== t.idx" class="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span v-if="t.datosParcial && telarAbiertoIdx !== t.idx" class="w-2 h-2 rounded-full bg-amber-400"></span>
            </div>
            <span class="text-xs font-bold" :class="telarAbiertoIdx === t.idx ? 'text-blue-200' : 'text-gray-400'">#{{ t.ordenPatrulla }}</span>
          </button>

          <!-- Tarjeta de carga (expandida, centrada) -->
          <div v-if="telarAbiertoIdx === t.idx && telarAbierto" class="mt-1 bg-white rounded-2xl border border-blue-200 shadow-lg overflow-hidden mx-auto max-w-md">
            <!-- Cabecera tarjeta -->
            <div class="flex items-center justify-between px-4 py-2 bg-blue-50 border-b border-blue-100">
              <button @click="navTelar(-1)" :disabled="telarAbiertoIdx === 0" class="w-7 h-7 flex items-center justify-center rounded-lg transition-all active:scale-90" :class="telarAbiertoIdx === 0 ? 'text-gray-300' : 'text-blue-600 hover:bg-blue-100'">
                <ChevronLeft class="w-5 h-5" />
              </button>
              <span class="text-sm font-black text-blue-800">Telar {{ telarAbierto.label }}</span>
              <div class="flex items-center gap-1">
                <button @click="navTelar(1)" :disabled="telarAbiertoIdx === telaresMaquinas.length - 1" class="w-7 h-7 flex items-center justify-center rounded-lg transition-all active:scale-90" :class="telarAbiertoIdx === telaresMaquinas.length - 1 ? 'text-gray-300' : 'text-blue-600 hover:bg-blue-100'">
                  <ChevronRight class="w-5 h-5" />
                </button>
                <button @click="cerrarTelar" class="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 active:scale-90">
                  <X class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Tabla compacta -->
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-200">
                  <th class="px-2 py-1.5 text-center text-[10px] font-black text-gray-400 uppercase w-9">Tur</th>
                  <th class="px-1 py-1.5 text-center text-[10px] font-black text-gray-400 uppercase">Pts</th>
                  <th class="px-1 py-1.5 text-center text-[10px] font-black text-gray-400 uppercase">RoT</th>
                  <th class="px-1 py-1.5 text-center text-[10px] font-black text-gray-400 uppercase">RoU</th>
                  <th class="px-1 py-1.5 text-center text-[10px] font-black text-gray-400 uppercase">RoO</th>
                  <th class="px-1 py-1.5 text-center text-[10px] font-black text-gray-400 uppercase">RPM</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <tr v-for="row in telarAbierto.turnos" :key="row.turno">
                  <td class="px-2 py-1 text-center">
                    <span class="text-xs font-black" :class="row.tieneCSV ? 'text-emerald-600' : 'text-gray-400'">{{ row.turno }}</span>
                  </td>

                  <td class="px-0.5 py-0.5 text-center">
                    <span v-if="row.tieneCSV" class="text-sm font-bold text-gray-700">{{ row.picks }}</span>
                    <input v-else :data-sr="`${row.turno}_picks`" @keydown="mobileKeydown($event, row.turno, 'picks')" type="text" :disabled="isSaving || isLoading" @focus="$event.target.select()" inputmode="numeric" maxlength="3" :value="getInputVal(telarAbierto.loom, row.turno, 'picks')" @input="onInput($event, telarAbierto.loom, row.turno, 'picks', 3)" class="w-full text-center text-sm font-bold border border-amber-300 bg-amber-50 rounded px-1 py-1 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-300" />
                  </td>

                  <td class="px-0.5 py-0.5 text-center">
                    <span v-if="row.tieneCSV" class="text-sm font-bold" :class="row.weftCount > 10 ? 'text-red-600' : 'text-gray-700'">{{ row.weftCount }}</span>
                    <input v-else :data-sr="`${row.turno}_weftCount`" @keydown="mobileKeydown($event, row.turno, 'weftCount')" type="text" :disabled="isSaving || isLoading" @focus="$event.target.select()" inputmode="numeric" maxlength="2" :value="getInputVal(telarAbierto.loom, row.turno, 'weftCount')" @input="onInput($event, telarAbierto.loom, row.turno, 'weftCount', 2)" class="w-full text-center text-sm font-bold border border-amber-300 bg-amber-50 rounded px-1 py-1 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-300" />
                  </td>

                  <td class="px-0.5 py-0.5 text-center">
                    <span v-if="row.tieneCSV" class="text-sm font-bold" :class="row.warpCount > 5 ? 'text-red-600' : 'text-gray-700'">{{ row.warpCount }}</span>
                    <input v-else :data-sr="`${row.turno}_warpCount`" @keydown="mobileKeydown($event, row.turno, 'warpCount')" type="text" :disabled="isSaving || isLoading" @focus="$event.target.select()" inputmode="numeric" maxlength="2" :value="getInputVal(telarAbierto.loom, row.turno, 'warpCount')" @input="onInput($event, telarAbierto.loom, row.turno, 'warpCount', 2)" class="w-full text-center text-sm font-bold border border-amber-300 bg-amber-50 rounded px-1 py-1 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-300" />
                  </td>

                  <td class="px-0.5 py-0.5 text-center">
                    <span v-if="row.tieneCSV" class="text-sm font-bold text-gray-700">{{ row.otherCount }}</span>
                    <input v-else :data-sr="`${row.turno}_otherCount`" @keydown="mobileKeydown($event, row.turno, 'otherCount')" type="text" :disabled="isSaving || isLoading" @focus="$event.target.select()" inputmode="numeric" maxlength="2" :value="getInputVal(telarAbierto.loom, row.turno, 'otherCount')" @input="onInput($event, telarAbierto.loom, row.turno, 'otherCount', 2)" class="w-full text-center text-sm font-bold border border-amber-300 bg-amber-50 rounded px-1 py-1 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-300" />
                  </td>

                  <td class="px-0.5 py-0.5 text-center">
                    <span v-if="row.tieneCSV" class="text-sm font-bold text-gray-700">{{ row.rpm }}</span>
                    <input v-else :data-sr="`${row.turno}_rpm`" @keydown="mobileKeydown($event, row.turno, 'rpm')" type="text" :disabled="isSaving || isLoading" @focus="$event.target.select()" inputmode="numeric" maxlength="3" :value="getInputVal(telarAbierto.loom, row.turno, 'rpm')" @input="onInput($event, telarAbierto.loom, row.turno, 'rpm', 3)" class="w-full text-center text-sm font-bold border border-amber-300 bg-amber-50 rounded px-1 py-1 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-300" />
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- Botón guardar siempre visible -->
            <div class="px-3 py-2 border-t border-gray-100">
              <button data-sr-save @click="guardarTelar" :disabled="isSaving || isLoading" class="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50">
                <Save class="w-4 h-4" /> Guardar
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Botones exportar -->
      <div class="shift-mobile pb-4 pt-2 flex flex-col gap-2">
        <button @click="exportarPRD" class="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-md active:scale-[0.98]">
          <Download class="w-5 h-5" /> Exportar TXT para PRD
        </button>
        <button @click="exportarXLSX" :disabled="isExporting" class="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-md active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed">
          <Download class="w-5 h-5" />
          <span v-if="isExporting">Generando Excel…</span>
          <span v-else>Exportar Excel (Puntos y Roturas)</span>
        </button>
      </div>

    </main>
  </div>
</template>
<style scoped>
.shift-page { height:100%; min-height:0; background:#f5f7fa; display:flex; flex-direction:column; font-family:Inter,ui-sans-serif,system-ui,sans-serif; color:#334155; }
.shift-workspace { flex:1; min-height:0; width:100%; display:flex; flex-direction:column; gap:12px; padding:12px 20px; overflow:auto; }
.shift-workspace > :first-child { flex-shrink:0; }
.shift-desktop { display:none; }
.shift-report-header { position:relative; z-index:5; background:white; border:1px solid #dce3ec; border-radius:8px; }
.shift-report-controls { display:flex; align-items:center; flex-wrap:wrap; gap:10px; padding:10px 12px; }
.shift-import-actions { display:flex; align-items:center; gap:8px; margin-left:auto; }
.shift-sync { display:inline-flex; align-items:center; gap:6px; color:#64748b; font-size:12px; }
.shift-sync.is-pending { color:#b45309; }
.shift-folder { display:flex; align-items:center; gap:4px; }
.shift-folder span { max-width:150px; overflow:hidden; text-overflow:ellipsis; }
.shift-summary { display:flex; align-items:center; flex-wrap:wrap; gap:6px 18px; padding:6px 12px; border-top:1px solid #edf1f6; font-size:12px; color:#64748b; font-variant-numeric:tabular-nums; }
.shift-summary strong { color:#334155; font-weight:600; }
.shift-summary .summary-warning,.shift-summary .summary-warning strong { color:#a16207; }
.shift-summary .summary-alert,.shift-summary .summary-alert strong { color:#b91c1c; }
.shift-csv-meta { margin-left:auto; font-size:11px; }
.shift-calendar { position:relative; }
.shift-calendar-dismiss { position:fixed; inset:0; z-index:10; cursor:default; }
.shift-calendar-panel { position:absolute; z-index:11; top:calc(100% + 8px); left:0; width:288px; max-width:calc(100vw - 48px); padding:12px; border:1px solid #dce3ec; border-radius:10px; background:white; box-shadow:0 12px 32px #0f172a26; }
.shift-calendar-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
.shift-calendar-heading strong { font-size:13px; font-weight:600; text-transform:capitalize; }
.shift-calendar-heading .shift-button { padding:6px; min-height:30px; }
.shift-calendar-days { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:3px; }
.shift-calendar-weekday { text-align:center; color:#64748b; font-size:11px; padding:5px 0; }
.shift-calendar-days button { height:30px; border-radius:5px; font-size:12px; cursor:pointer; color:#334155; }
.shift-calendar-days button:hover { background:#eef2ff; }
.shift-calendar-days button.is-outside { color:#94a3b8; }
.shift-calendar-days button.is-today { box-shadow:inset 0 0 0 1px #a5b4fc; }
.shift-calendar-days button.is-selected { background:#4f46e5; color:white; }
.shift-calendar-days button:focus-visible { outline:2px solid #6366f1; outline-offset:1px; }
.shift-calendar-shortcuts { display:flex; gap:6px; margin-top:10px; padding-top:10px; border-top:1px solid #edf1f6; }
.shift-calendar-shortcuts .shift-button { flex:1; min-height:30px; font-size:12px; padding:5px; }
@media (max-width:900px) { .shift-sync span { display:none; } .shift-report-controls { gap:6px; padding:8px; } .shift-summary { gap:4px 12px; } }
@media (max-width:420px) { .shift-import-actions { gap:4px; } .shift-import-actions .shift-button { padding:7px; font-size:12px; } .shift-folder span { max-width:65px; } }
.shift-button { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:36px; padding:7px 11px; border:1px solid #d8e0ea; border-radius:6px; background:white; font-size:13px; font-weight:550; cursor:pointer; white-space:nowrap; }
.shift-button:hover { background:#f1f5f9; }
.shift-button:disabled { opacity:.4; cursor:default; }
.shift-button-primary { background:#4f46e5; color:white; border-color:#4f46e5; }
.shift-button-primary:hover { background:#4338ca; }
.shift-button:focus-visible { outline:2px solid #6366f1; outline-offset:2px; }
.shift-grid-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; flex-shrink:0; }
.shift-grid-toolbar h1 { color:#0f172a; font-size:20px; font-weight:600; }
.shift-grid-toolbar p,.shift-grid-actions span { font-size:12px; color:#64748b; }
.shift-grid-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.shift-grid-scroll { flex:1; min-height:0; overflow:auto; border:1px solid #dce3ec; border-radius:8px; background:white; scrollbar-gutter:stable; }
.shift-grid { width:100%; min-width:1080px; border-collapse:separate; border-spacing:0; table-layout:fixed; font-size:13px; font-variant-numeric:tabular-nums; }
.shift-grid thead { position:sticky; top:0; z-index:3; }
.shift-grid th { padding:8px 6px; text-align:center; background:#f8fafc; color:#475569; font-weight:600; border-bottom:1px solid #dce3ec; }
.shift-grid thead tr:first-child th { height:34px; }
.shift-grid thead tr:nth-child(2) th { font-size:12px; }
.shift-grid th.shift-turn-A { background:#eef2ff; color:#4338ca; }
.shift-grid th.shift-turn-B { background:#ecfdf5; color:#047857; }
.shift-grid th.shift-turn-C { background:#fff7ed; color:#9a3412; }
.shift-grid .shift-loom { position:sticky; left:0; z-index:2; width:70px; background:#f8fafc; border-right:1px solid #dce3ec; }
.shift-grid thead .shift-loom { z-index:4; }
.shift-grid td { padding:3px; height:40px; border-bottom:1px solid #edf1f6; border-right:1px solid #edf1f6; }
.shift-grid tr:nth-child(even) td { background:#fbfcfe; }
.shift-grid tr:hover td { background:#f0f4ff; }
.shift-grid td.shift-dirty { background:#fffbeb; }
.shift-grid td.shift-imported { background:#f1f5f9; }
.shift-grid .shift-turn-start { border-left:1px solid #cbd5e1; }
.shift-grid input { width:100%; min-width:0; height:32px; border:1px solid transparent; border-radius:4px; background:transparent; text-align:center; font-size:13px; color:#334155; outline:none; }
.shift-grid input:focus { border-color:#6366f1; background:white; box-shadow:0 0 0 2px #6366f130; }
.shift-grid input[readonly] { color:#64748b; }
.shift-grid .shift-attention input { color:#b91c1c; font-weight:600; }
.shift-grid-help { font-size:11px; color:#64748b; flex-shrink:0; }
.shift-grid-empty { padding:24px !important; text-align:center; color:#64748b; }
@media (min-width:768px) { .shift-workspace { overflow:hidden; } .shift-desktop { display:flex; flex:1; min-height:0; flex-direction:column; gap:10px; } .shift-mobile { display:none; } }
@media (max-width:1100px) { .shift-workspace { padding:10px; } .shift-grid-toolbar h1 { font-size:18px; } }
@media (max-width:767px) { .shift-workspace { max-width:896px; margin:0 auto; padding:12px; } }
</style>
