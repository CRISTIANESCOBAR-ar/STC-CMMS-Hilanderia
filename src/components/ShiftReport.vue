<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { collection, getDocs, query, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { parseShiftReportCSV, transformRows, generarReportePRD } from '../services/shiftReportService';
import { guardarReporteCSV, guardarRegistro, suscribirReporte } from '../services/shiftReportFirestore';
import { Upload, Download, Cloud, X, Save, ChevronLeft, ChevronRight, FolderOpen } from 'lucide-vue-next';
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

const fechaAyer = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
};
const fechaReporte = ref(fechaAyer());

const fechaInput = computed({
  get: () => fechaReporte.value.replace(/\//g, '-'),
  set: (v) => { fechaReporte.value = v.replace(/-/g, '/'); }
});

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
    if (data) {
      const incoming = data.registros || {};
      const merged = { ...incoming };
      for (const key of pendingSaves) {
        if (registros.value[key]) merged[key] = registros.value[key];
      }
      registros.value = merged;
      csvMeta.value = data.csvMeta || null;
      csvLoaded.value = Object.values(incoming).some(r => r.source === 'csv');
    } else if (pendingSaves.size === 0) {
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

function setVal(loom, turno, field, value) {
  const key = `${loom}_${turno}`;
  if (!registros.value[key]) {
    registros.value[key] = { loom, turno, rpm: null, picks: null, weftCount: null, warpCount: null, otherCount: null, style: '', beam: '', source: 'manual' };
  }
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

function onInput(ev, loom, turno, field, maxLen) {
  // Solo dígitos, limitar a maxLen
  const cleaned = ev.target.value.replace(/\D/g, '').slice(0, maxLen);
  ev.target.value = cleaned;
  setVal(loom, turno, field, cleaned);

  if (cleaned.length >= maxLen) {
    const curIdx = fieldOrder.findIndex(f => f.turno === turno && f.field === field);
    if (curIdx === -1) return;

    for (let i = curIdx + 1; i < fieldOrder.length; i++) {
      const next = fieldOrder[i];
      const val = getVal(loom, next.turno, next.field);
      if (val == null) {
        nextTick(() => {
          const el = document.querySelector(`[data-sr="${next.turno}_${next.field}"]`);
          if (el) el.focus();
        });
        return;
      }
    }
    // Todos completos → foco en Guardar
    nextTick(() => {
      const btn = document.querySelector('[data-sr-save]');
      if (btn) btn.focus();
    });
  }
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

  isSaving.value = true;

  // Capturar y proteger TODOS los turnos con datos antes de cualquier await,
  // para que el onSnapshot que dispara cada guardado no los sobreescriba.
  const keysToSave = [];
  for (const turno of ['A', 'B', 'C']) {
    const key = `${loom}_${turno}`;
    if (registros.value[key]) {
      keysToSave.push({ key, turno, data: { ...registros.value[key] } });
      pendingSaves.add(key);
    }
  }

  try {
    for (const { key, turno, data } of keysToSave) {
      await guardarRegistro(fechaReporte.value, loom, turno, data);
      pendingSaves.delete(key);
    }
    showToast('Guardado ✓');
    // Saltar al siguiente telar o cerrar si es el último
    const nextIdx = telarAbiertoIdx.value + 1;
    if (nextIdx < telaresMaquinas.value.length) {
      telarAbiertoIdx.value = nextIdx;
    } else {
      telarAbiertoIdx.value = null;
    }
  } catch (e) {
    for (const { key } of keysToSave) pendingSaves.delete(key);
    console.error(e);
    Swal.fire('Error', 'No se pudo guardar', 'error');
  } finally {
    isSaving.value = false;
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
</script>

<template>
  <div class="min-h-[calc(100vh-110px)] bg-gray-50 flex flex-col">
    <!-- Toast de guardado -->
    <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0 translate-y-2" enter-to-class="opacity-100 translate-y-0" leave-active-class="transition duration-150 ease-in" leave-from-class="opacity-100 translate-y-0" leave-to-class="opacity-0 translate-y-2">
      <div v-if="toast.visible" class="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-gray-800 text-white text-sm font-semibold rounded-full shadow-lg pointer-events-none">
        {{ toast.message }}
      </div>
    </Transition>
    <main class="flex-1 max-w-4xl mx-auto w-full px-3 pt-3 pb-6 flex flex-col space-y-3 overflow-y-auto">

      <!-- Header compacto -->
      <div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div class="px-3 py-2 flex items-center gap-2">
          <input type="date" v-model="fechaInput" class="px-2 py-1.5 rounded-lg border border-gray-300 text-sm font-bold text-gray-700 focus:outline-none focus:border-blue-500" />
          <Cloud class="w-4 h-4 shrink-0 transition-colors" :class="isSaving ? 'text-amber-500 animate-pulse' : 'text-emerald-500'" />
          <div class="flex-1" />
          <!-- Badge de carpeta guardada o botón para elegir carpeta -->
          <div v-if="savedDirName" class="flex items-center gap-1 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-bold text-emerald-700 max-w-[140px]">
            <FolderOpen class="w-3.5 h-3.5 shrink-0" />
            <span class="truncate">{{ savedDirName }}</span>
            <button @click.stop="limpiarCarpeta" title="Quitar carpeta guardada" class="ml-0.5 text-gray-400 hover:text-red-500 shrink-0 transition-colors"><X class="w-3 h-3" /></button>
          </div>
          <button v-else-if="soportaFSA" @click="elegirCarpeta" :disabled="isLoading" title="Elegir carpeta de CSVs (se recordará)" class="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-gray-200 text-xs font-bold text-gray-500 hover:bg-gray-50 active:scale-95 disabled:opacity-50 transition-all">
            <FolderOpen class="w-3.5 h-3.5" /> Carpeta
          </button>
          <button @click="cargarCSV" :disabled="isLoading" class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 active:scale-95 disabled:opacity-50">
            <Upload class="w-4 h-4" /> CSV
          </button>
        </div>

        <div v-if="csvMeta" class="px-3 py-1.5 bg-blue-50/50 border-t border-blue-100 text-xs font-bold text-blue-700 flex flex-wrap gap-3">
          <span>{{ csvMeta.generatedAt }}</span>
          <span>{{ csvMeta.rangoDesde }} → {{ csvMeta.rangoHasta }}</span>
        </div>

        <!-- Stats -->
        <div class="px-3 py-2 border-t border-gray-100">
          <div class="grid grid-cols-4 gap-1.5">
            <div class="bg-gray-50 border border-gray-200 rounded-lg p-2 text-center">
              <p class="text-lg font-black text-gray-800">{{ stats.total }}</p>
              <p class="text-[10px] font-bold text-gray-400 uppercase">Telares</p>
            </div>
            <div class="border rounded-lg p-2 text-center" :class="stats.sinCSV ? 'bg-orange-50 border-orange-200' : 'bg-emerald-50 border-emerald-200'">
              <p class="text-lg font-black" :class="stats.sinCSV ? 'text-orange-700' : 'text-emerald-700'">{{ stats.sinCSV }}</p>
              <p class="text-[10px] font-bold uppercase" :class="stats.sinCSV ? 'text-orange-500' : 'text-emerald-500'">Sin CSV</p>
            </div>
            <div class="border rounded-lg p-2 text-center" :class="stats.sinRpm ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'">
              <p class="text-lg font-black" :class="stats.sinRpm ? 'text-amber-700' : 'text-emerald-700'">{{ stats.sinRpm }}</p>
              <p class="text-[10px] font-bold uppercase" :class="stats.sinRpm ? 'text-amber-500' : 'text-emerald-500'">Sin RPM</p>
            </div>
            <div class="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
              <p class="text-lg font-black text-red-700">{{ stats.rotTotal }}</p>
              <p class="text-[10px] font-bold text-red-400 uppercase">Roturas</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Lista de telares con tarjeta expandible -->
      <div class="space-y-1">
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
                    <input v-else :data-sr="`${row.turno}_picks`" type="text" inputmode="numeric" maxlength="3" :value="getVal(telarAbierto.loom, row.turno, 'picks') ?? ''" @input="onInput($event, telarAbierto.loom, row.turno, 'picks', 3)" class="w-full text-center text-sm font-bold border border-amber-300 bg-amber-50 rounded px-1 py-1 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-300" />
                  </td>

                  <td class="px-0.5 py-0.5 text-center">
                    <span v-if="row.tieneCSV" class="text-sm font-bold" :class="row.weftCount > 10 ? 'text-red-600' : 'text-gray-700'">{{ row.weftCount }}</span>
                    <input v-else :data-sr="`${row.turno}_weftCount`" type="text" inputmode="numeric" maxlength="2" :value="getVal(telarAbierto.loom, row.turno, 'weftCount') ?? ''" @input="onInput($event, telarAbierto.loom, row.turno, 'weftCount', 2)" class="w-full text-center text-sm font-bold border border-amber-300 bg-amber-50 rounded px-1 py-1 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-300" />
                  </td>

                  <td class="px-0.5 py-0.5 text-center">
                    <span v-if="row.tieneCSV" class="text-sm font-bold" :class="row.warpCount > 5 ? 'text-red-600' : 'text-gray-700'">{{ row.warpCount }}</span>
                    <input v-else :data-sr="`${row.turno}_warpCount`" type="text" inputmode="numeric" maxlength="2" :value="getVal(telarAbierto.loom, row.turno, 'warpCount') ?? ''" @input="onInput($event, telarAbierto.loom, row.turno, 'warpCount', 2)" class="w-full text-center text-sm font-bold border border-amber-300 bg-amber-50 rounded px-1 py-1 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-300" />
                  </td>

                  <td class="px-0.5 py-0.5 text-center">
                    <span v-if="row.tieneCSV" class="text-sm font-bold text-gray-700">{{ row.otherCount }}</span>
                    <input v-else :data-sr="`${row.turno}_otherCount`" type="text" inputmode="numeric" maxlength="2" :value="getVal(telarAbierto.loom, row.turno, 'otherCount') ?? ''" @input="onInput($event, telarAbierto.loom, row.turno, 'otherCount', 2)" class="w-full text-center text-sm font-bold border border-amber-300 bg-amber-50 rounded px-1 py-1 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-300" />
                  </td>

                  <td class="px-0.5 py-0.5 text-center">
                    <span v-if="row.tieneCSV" class="text-sm font-bold text-gray-700">{{ row.rpm }}</span>
                    <input v-else :data-sr="`${row.turno}_rpm`" type="text" inputmode="numeric" maxlength="3" :value="getVal(telarAbierto.loom, row.turno, 'rpm') ?? ''" @input="onInput($event, telarAbierto.loom, row.turno, 'rpm', 3)" class="w-full text-center text-sm font-bold border border-amber-300 bg-amber-50 rounded px-1 py-1 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-300" />
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- Botón guardar siempre visible -->
            <div class="px-3 py-2 border-t border-gray-100">
              <button data-sr-save @click="guardarTelar" :disabled="isSaving" class="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50">
                <Save class="w-4 h-4" /> Guardar
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Botón exportar -->
      <div class="pb-4 pt-2">
        <button @click="exportarPRD" class="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-md active:scale-[0.98]">
          <Download class="w-5 h-5" /> Exportar TXT para PRD
        </button>
      </div>

    </main>
  </div>
</template>
