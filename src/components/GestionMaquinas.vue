<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { authService, userRole } from '../services/authService';
import { db, storage } from '../firebase/config';
import { collection, getDocs, query, doc, updateDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { catalogoService } from '../services/catalogoService';
import { compressImage } from '../utils/imageCompressor';
import { Search, Edit3, Trash2, X, Check, Settings2, LayoutGrid, Table2, Save, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, BookOpen, Camera } from 'lucide-vue-next';
import Swal from 'sweetalert2';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/themes/light-border.css';
import { DEFAULT_SECTOR, SECTOR_OPTIONS, normalizeSectorValue } from '../constants/organization';
import { maquinaService } from '../services/maquinaService';
import catalogDataR60 from '../data/catalogo_full_r60.json';


const maquinas = ref([]);
const catalogoData = ref(catalogDataR60);
const showCatalogModal = ref(false);
const catalogoSearchQuery = ref('');
const catalogoSectionFilter = ref('');
const catalogoGroupFilter = ref('');
const editingCatalogRowId = ref(null);
const editingCatalogRow = ref({});
const isLoading = ref(true);

// Procedimiento editor
const showProcedimientoModal = ref(false);
const procedimientoItem = ref(null);
const procedimientoPasos = ref([]);
const isSavingProcedimiento = ref(false);
const uploadingPasoIndex = ref(null);
const searchQuery = ref('');
const showModal = ref(false);
const isEditing = ref(false);
const viewMode = ref('cards');

// 'all' | 'activas' | 'inactivas'
const activoFilter = ref('all');
// '' = todos los tipos, o el nombre del tipo seleccionado
const tipoFilter = ref('');

const editingRowId = ref(null);
const editingRow = ref({});

const normalizeMachineRecord = (maquina = {}) => ({
  ...maquina,
  sector: normalizeSectorValue(maquina.sector || DEFAULT_SECTOR),
  activo: maquina.activo ?? true,
  grp_tear: maquina.grp_tear ?? '',
  g_cmest: maquina.g_cmest ?? ''
});

const initialForm = { id: null, unidad: 5, maquina: '', local_fisico: '', nro_tipo: '', tipo: 'CARDA', nombre_maquina: '', lado: 'U', modelo: '', nro_serie: '', sector: DEFAULT_SECTOR, activo: true, grp_tear: '', g_cmest: '' };
const form = ref({ ...initialForm });

// Paginación
const currentPage = ref(1);
const itemsPerPage = ref(25);

const totalPages = computed(() => Math.ceil(filteredMaquinas.value.length / itemsPerPage.value) || 1);

const paginatedMaquinas = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  return filteredMaquinas.value.slice(start, start + itemsPerPage.value);
});

const goToFirst = () => { currentPage.value = 1; };
const goToPrev = () => { if (currentPage.value > 1) currentPage.value--; };
const goToNext = () => { if (currentPage.value < totalPages.value) currentPage.value++; };
const goToLast = () => { currentPage.value = totalPages.value; };

// Resetear página al buscar o cambiar filtros
watch([searchQuery, activoFilter, tipoFilter], () => { currentPage.value = 1; });

// Resetear filtros del catálogo cuando cambia la sección
watch(catalogoSectionFilter, () => { catalogoGroupFilter.value = ''; });

onMounted(async () => {
  const timeoutId = setTimeout(() => {
    if (isLoading.value) {
      isLoading.value = false;
      Swal.fire({ 
        icon: 'warning', 
        title: 'Tiempo excedido', 
        text: 'La base de datos tarda demasiado en responder. Intenta recargar la página.' 
      });
    }
  }, 10000);

  try {
    const q = query(collection(db, 'maquinas'));
    const snapshot = await getDocs(q);
    clearTimeout(timeoutId);

    const data = snapshot.docs.map(doc => normalizeMachineRecord({ id: doc.id, ...doc.data() }));
    
    // Ordenar manualmente para asegurar consistencia
    maquinas.value = data.sort((a, b) => {
      if ((a.nro_tipo || 0) !== (b.nro_tipo || 0)) return (a.nro_tipo || 0) - (b.nro_tipo || 0);
      return (a.local_fisico || 0) - (b.local_fisico || 0);
    });

    isLoading.value = false;

    // Cargar catálogo desde Firestore en segundo plano (para obtener IDs de documentos)
    catalogoService.obtenerPuntosPorModelo('R-60').then(fsData => {
      if (fsData.length > 0) {
        catalogoData.value = fsData;
      }
    }).catch(err => {
      console.warn('No se pudo cargar catálogo desde Firestore, usando datos locales:', err);
    });
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("Error cargando máquinas:", error);
    isLoading.value = false;
    Swal.fire({ icon: 'error', title: 'Error de conexión', text: 'No se pudo cargar el catálogo de máquinas.' });
  }
  // Inicializar tooltips con un pequeño delay
  setTimeout(() => {
    tippy('[data-tippy-content]', {
      theme: 'light-border',
      duration: [120, 100]
    });
  }, 500);
});

const filteredMaquinas = computed(() => {
  const q = searchQuery.value.toLowerCase();
  return maquinas.value.filter(m => {
    const estaActivo = m.activo ?? true;
    if (activoFilter.value === 'activas' && !estaActivo) return false;
    if (activoFilter.value === 'inactivas' && estaActivo) return false;
    if (tipoFilter.value && m.tipo !== tipoFilter.value) return false;
    return (
      String(m.maquina).toLowerCase().includes(q) ||
      m.tipo.toLowerCase().includes(q) ||
      m.nombre_maquina?.toLowerCase().includes(q) ||
      String(m.sector || '').toLowerCase().includes(q) ||
      String(m.grp_tear || '').toLowerCase().includes(q) ||
      String(m.g_cmest || '').toLowerCase().includes(q)
    );
  });
});

const tipoFilterOptions = computed(() => {
  const tipos = new Set();
  maquinas.value.forEach((m) => {
    if (m.tipo) tipos.add(m.tipo);
  });
  return Array.from(tipos).sort((a, b) => a.localeCompare(b));
});

const openAddModal = () => { isEditing.value = false; form.value = { ...initialForm }; showModal.value = true; };
const openEditModal = (maquina) => { isEditing.value = true; form.value = normalizeMachineRecord(maquina); showModal.value = true; };
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

const toggleActivo = async (maquina) => {
  const nuevoEstado = !(maquina.activo ?? true);
  try {
    await updateDoc(doc(db, 'maquinas', maquina.id), { activo: nuevoEstado });
    const idx = maquinas.value.findIndex(m => m.id === maquina.id);
    if (idx !== -1) maquinas.value[idx].activo = nuevoEstado;
  } catch (error) {
    Swal.fire({ icon: 'error', title: 'Error al actualizar', text: error.message });
  }
};

const startInlineEdit = (maquina) => { editingRowId.value = maquina.id; editingRow.value = normalizeMachineRecord(maquina); };
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

const tiposOptions = [
  'APERTURA', 'CARDA', 'MANUAR', 'OPEN END', 'FILTRO',
  'URDIDORA', 'INDIGO', 'TELAR', 'REVISADORA', 'MERCERIZADORA', 'INTEGRADA',
  'OTRO'
];

// Propiedades computadas para el catálogo R-60
const catalogoSectionsDisponibles = computed(() => {
  const sets = new Set(catalogoData.value.map(c => c.seccion));
  return Array.from(sets).sort();
});

const catalogoGroupsDisponibles = computed(() => {
  if (!catalogoSectionFilter.value) return [];
  const filtrados = catalogoData.value.filter(c => c.seccion === catalogoSectionFilter.value);
  const sets = new Set(filtrados.map(c => c.grupo));
  return Array.from(sets).sort((a, b) => Number(a) - Number(b));
});

const filteredCatalogo = computed(() => {
  let result = catalogoData.value;
  if (catalogoSectionFilter.value) {
    result = result.filter(c => c.seccion === catalogoSectionFilter.value);
  }
  if (catalogoGroupFilter.value) {
    result = result.filter(c => c.grupo === catalogoGroupFilter.value);
  }
  if (catalogoSearchQuery.value) {
    const q = catalogoSearchQuery.value.toLowerCase();
    result = result.filter(c => 
      c.denominacion.toLowerCase().includes(q) ||
      c.numeroCatalogo.toLowerCase().includes(q) ||
      c.numeroArticulo.toLowerCase().includes(q) ||
      c.subGrupo.toLowerCase().includes(q)
    );
  }
  return result;
});

const isR60Machine = (maquina = {}) => {
  const modelo = String(maquina.modelo || '').toUpperCase().replace(/\s+/g, '');
  const nombre = String(maquina.nombre_maquina || '').toUpperCase().replace(/\s+/g, '');
  return maquina.tipo === 'OPEN END' && (
    modelo === 'R-60' ||
    modelo === 'R60' ||
    nombre.includes('R-60') ||
    nombre.includes('R60')
  );
};

const inferBrand = (maquina = {}) => {
  if (maquina.marca) return String(maquina.marca).trim();

  const nombre = String(maquina.nombre_maquina || '').toUpperCase();
  if (nombre.includes('RIETER')) return 'RIETER';
  if (isR60Machine(maquina)) return 'RIETER';

  return '';
};

const inferModel = (maquina = {}) => {
  if (maquina.modelo) return String(maquina.modelo).trim();
  return isR60Machine(maquina) ? 'R-60' : '';
};

const formatAcquisitionYear = (value) => {
  if (!value) return '';

  if (typeof value?.toDate === 'function') {
    return String(value.toDate().getFullYear());
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return String(value.getFullYear());
  }

  const raw = String(value).trim();
  if (!raw) return '';

  const yearMatch = raw.match(/(19|20)\d{2}/);
  if (yearMatch) return yearMatch[0];

  return raw;
};

const buildCatalogExportRows = (catalogItems) => {
  const maquinasR60 = filteredMaquinas.value.filter(isR60Machine);

  return maquinasR60.flatMap((maquina) => {
    const marca = inferBrand(maquina);
    const modelo = inferModel(maquina);

    return catalogItems.map((item) => ({
      marca,
      modelo,
      asignacion: '',
      seccion: item.seccion || '',
      abreviado: item.abreviado || '',
      grupo: item.grupo || '',
      subGrupo: item.subGrupo || '',
      denominacion: item.denominacion || '',
      numeroCatalogo: item.numeroCatalogo || '',
      numeroArticulo: item.numeroArticulo || '',
      tiempo: '',
      observacion: ''
    }));
  });
};

const exportMaquinasToExcel = async () => {
  if (filteredMaquinas.value.length === 0) return;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Máquinas');

  worksheet.columns = [
    { header: 'SECTOR', key: 'sector', width: 18 },
    { header: 'TIPO', key: 'tipo', width: 15 },
    { header: 'ID MÁQ', key: 'maquina', width: 10 },
    { header: 'NOMBRE', key: 'nombre_maquina', width: 30 },
    { header: 'LOCAL', key: 'local_fisico', width: 10 },
    { header: 'LADO', key: 'lado', width: 8 },
    { header: 'MODELO', key: 'modelo', width: 20 },
    { header: 'SERIE', key: 'nro_serie', width: 20 },
    { header: 'ACTIVO', key: 'activo', width: 10 },
    { header: 'ADQUISICION', key: 'adquisicion', width: 15 },
    { header: 'GRP_TEAR', key: 'grp_tear', width: 12 },
    { header: 'G_CMEST', key: 'g_cmest', width: 12 },
  ];

  filteredMaquinas.value.forEach(m => {
    worksheet.addRow({
      sector: m.sector || DEFAULT_SECTOR,
      tipo: m.tipo,
      maquina: m.maquina,
      nombre_maquina: m.nombre_maquina || '---',
      local_fisico: m.local_fisico,
      lado: m.lado,
      modelo: m.modelo || '---',
      nro_serie: m.nro_serie || '---',
      activo: (m.activo ?? true) ? 'SI' : 'NO',
      adquisicion: m.adquisicion?.toDate?.()?.toLocaleDateString('es-AR') || '---',
      grp_tear: m.grp_tear || '---',
      g_cmest: m.g_cmest || '---',
    });
  });

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
      };
      if (rowNumber > 1) {
        cell.font = { size: 10 };
        cell.alignment = { vertical: 'middle' };
        if (rowNumber % 2 === 0) {
          row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
        }
      }
    });
  });

  worksheet.autoFilter = 'A1:L1';
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `Maquinas_${new Date().toISOString().split('T')[0]}.xlsx`);
};

const exportToExcel = async () => {
  const rows = buildCatalogExportRows(catalogoData.value);

  if (rows.length === 0) {
    Swal.fire({
      icon: 'info',
      title: 'Sin máquinas R-60',
      text: 'No hay máquinas OPEN END R-60 visibles para exportar el catálogo.'
    });
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Catalogo Open End R-60');

  worksheet.columns = [
    { header: 'Marca', key: 'marca', width: 16 },
    { header: 'Modelo', key: 'modelo', width: 14 },
    { header: 'Asignación', key: 'asignacion', width: 20 },
    { header: 'Sección', key: 'seccion', width: 28 },
    { header: 'Abreviado', key: 'abreviado', width: 14 },
    { header: 'Grupo', key: 'grupo', width: 12 },
    { header: 'Sub Grupo', key: 'subGrupo', width: 14 },
    { header: 'Denominación', key: 'denominacion', width: 44 },
    { header: 'Numero Catalogo', key: 'numeroCatalogo', width: 18 },
    { header: 'Numero Articulo', key: 'numeroArticulo', width: 18 },
    { header: 'Tiempo', key: 'tiempo', width: 12 },
    { header: 'Observación', key: 'observacion', width: 30 },
  ];

  rows.forEach((row) => {
    worksheet.addRow(row);
  });

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2563EB' } // Blue-600 logic consistent with App theme
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
      };
      if (rowNumber > 1) {
        cell.font = { size: 10 };
        cell.alignment = { vertical: 'middle' };
        if (rowNumber % 2 === 0) {
          row.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF9FAFB' }
          };
        }
      }
    });
  });

  worksheet.autoFilter = 'A1:L1';

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `Catalogo_Open_End_R60_${new Date().toISOString().split('T')[0]}.xlsx`);
};

const openCatalogModal = () => {
  showCatalogModal.value = true;
  catalogoSearchQuery.value = '';
  catalogoSectionFilter.value = '';
  catalogoGroupFilter.value = '';
};

const closeCatalogModal = () => {
  showCatalogModal.value = false;
  editingCatalogRowId.value = null;
  editingCatalogRow.value = {};
};

const startCatalogEdit = (item) => {
  editingCatalogRowId.value = item.denominacion;
  editingCatalogRow.value = JSON.parse(JSON.stringify(item));
};

const cancelCatalogEdit = () => {
  editingCatalogRowId.value = null;
  editingCatalogRow.value = {};
};

const saveCatalogEdit = () => {
  const idx = catalogoData.value.findIndex(item => item.denominacion === editingCatalogRowId.value);
  if (idx !== -1) {
    catalogoData.value[idx] = editingCatalogRow.value;
    Swal.fire({ icon: 'success', title: '¡Guardado!', timer: 1500, showConfirmButton: false, toast: true, position: 'top-end' });
    cancelCatalogEdit();
  }
};

const openProcedimientoEditor = (item) => {
  procedimientoItem.value = item;
  procedimientoPasos.value = JSON.parse(JSON.stringify(item.procedimiento || []));
  showProcedimientoModal.value = true;
};

const closeProcedimientoEditor = () => {
  showProcedimientoModal.value = false;
  procedimientoItem.value = null;
  procedimientoPasos.value = [];
};

const agregarPaso = () => {
  procedimientoPasos.value.push({ texto: '', imagenUrl: null });
};

const eliminarPaso = (index) => {
  procedimientoPasos.value.splice(index, 1);
};

const onPasoImagenChange = async (index, event) => {
  const file = event.target.files[0];
  if (!file || !procedimientoItem.value?.id) return;
  uploadingPasoIndex.value = index;
  try {
    const compressed = await compressImage(file, { maxWidth: 1024, quality: 0.75 });
    const path = `catalogo/procedimientos/${procedimientoItem.value.id}/paso_${index}_${Date.now()}.jpg`;
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, compressed);
    const url = await getDownloadURL(fileRef);
    procedimientoPasos.value[index].imagenUrl = url;
  } catch (err) {
    console.error('Error subiendo imagen de paso:', err);
    Swal.fire({ icon: 'error', title: 'Error al subir imagen', text: err.message, toast: true, position: 'top-end', timer: 3000, showConfirmButton: false });
  } finally {
    uploadingPasoIndex.value = null;
  }
};

const guardarProcedimiento = async () => {
  if (!procedimientoItem.value?.id) return;
  isSavingProcedimiento.value = true;
  try {
    await catalogoService.actualizarProcedimiento(procedimientoItem.value.id, procedimientoPasos.value);
    // Actualizar dato local para que el visor en CargaNovedad lo tenga en la próxima carga
    const idx = catalogoData.value.findIndex(c => c.id === procedimientoItem.value.id);
    if (idx !== -1) {
      catalogoData.value[idx].procedimiento = JSON.parse(JSON.stringify(procedimientoPasos.value));
    }
    Swal.fire({ icon: 'success', title: 'Procedimiento guardado', timer: 1500, showConfirmButton: false, toast: true, position: 'top-end' });
    closeProcedimientoEditor();
  } catch (err) {
    console.error('Error guardando procedimiento:', err);
    Swal.fire({ icon: 'error', title: 'Error al guardar', text: err.message });
  } finally {
    isSavingProcedimiento.value = false;
  }
};

const exportCatalogToExcel = async () => {
  const rows = buildCatalogExportRows(filteredCatalogo.value);

  if (rows.length === 0) {
    Swal.fire({ icon: 'info', title: 'Sin datos', text: 'No hay registros R-60 para exportar con los filtros actuales.' });
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Catálogo R-60');
  worksheet.columns = [
    { header: 'Marca', key: 'marca', width: 16 },
    { header: 'Modelo', key: 'modelo', width: 14 },
    { header: 'Asignación', key: 'asignacion', width: 20 },
    { header: 'Sección', key: 'seccion', width: 28 },
    { header: 'Abreviado', key: 'abreviado', width: 14 },
    { header: 'Grupo', key: 'grupo', width: 12 },
    { header: 'Sub Grupo', key: 'subGrupo', width: 14 },
    { header: 'Denominación', key: 'denominacion', width: 44 },
    { header: 'Numero Catalogo', key: 'numeroCatalogo', width: 18 },
    { header: 'Numero Articulo', key: 'numeroArticulo', width: 18 },
    { header: 'Tiempo', key: 'tiempo', width: 12 },
    { header: 'Observación', key: 'observacion', width: 30 }
  ];

  rows.forEach((row) => {
    worksheet.addRow(row);
  });

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
      };
      if (rowNumber > 1) {
        cell.font = { size: 9 };
        cell.alignment = { vertical: 'middle', wrapText: true };
        if (rowNumber % 2 === 0) {
          row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
        }
      }
    });
  });

  worksheet.autoFilter = 'A1:L1';
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `Catalogo_R60_${new Date().toISOString().split('T')[0]}.xlsx`);
};
</script>

<template>
  <div class="h-[calc(100vh-64px)] bg-gray-50 flex flex-col overflow-hidden">
    <main class="flex-1 max-w-7xl mx-auto w-full px-2 pt-0 lg:pt-4 pb-2 flex flex-col space-y-1 lg:space-y-3 overflow-hidden">

      <!-- Portal para Navbar (Desktop) -->
      <Teleport to="#navbar-actions">
        <div class="hidden lg:flex items-center w-full gap-2">
          <div class="flex items-center gap-2 shrink-0">
            <div class="bg-indigo-500 p-1 rounded-md text-white shadow-sm">
              <Settings2 class="w-4 h-4" />
            </div>
            <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">Catálogo</span>
          </div>

          <div class="relative flex-1 min-w-0 max-w-52">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Buscar..."
              class="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-100 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 rounded-md text-xs text-gray-700 outline-none transition-all placeholder:text-gray-400 shadow-sm"
            />
          </div>

          <div class="flex items-center gap-1 shrink-0">
            <label class="text-[10px] font-black text-gray-400 uppercase tracking-widest">Tipo</label>
            <select
              v-model="tipoFilter"
              class="h-8 w-28 px-2 bg-white border border-slate-100 text-gray-700 text-xs font-bold rounded-md outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 shadow-sm"
            >
              <option value="">Todos</option>
              <option v-for="tipo in tipoFilterOptions" :key="tipo" :value="tipo">{{ tipo }}</option>
            </select>
          </div>

          <div class="flex border border-slate-200 rounded-lg overflow-hidden bg-white text-sm font-medium shrink-0 shadow-sm">
            <button @click="activoFilter = 'all'" :class="activoFilter === 'all' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'" class="px-2 py-1 transition-colors duration-150">Todas</button>
            <button @click="activoFilter = 'activas'" :class="activoFilter === 'activas' ? 'bg-green-50 text-green-700' : 'text-slate-700 hover:bg-slate-50'" class="px-2 py-1 transition-colors duration-150 border-l border-slate-200">Activas</button>
            <button @click="activoFilter = 'inactivas'" :class="activoFilter === 'inactivas' ? 'bg-red-50 text-red-700' : 'text-slate-700 hover:bg-slate-50'" class="px-2 py-1 transition-colors duration-150 border-l border-slate-200">Inactivas</button>
          </div>

          <div class="flex border border-slate-200 rounded-lg overflow-hidden bg-white shrink-0 shadow-sm">
            <button @click="viewMode = 'cards'" :class="viewMode === 'cards' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'" class="inline-flex items-center gap-1 px-2 py-1 text-sm font-medium transition-colors duration-150">
              <LayoutGrid class="w-4 h-4" /><span>Tarjetas</span>
            </button>
            <button @click="viewMode = 'table'" :class="viewMode === 'table' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'" class="inline-flex items-center gap-1 px-2 py-1 text-sm font-medium transition-colors duration-150 border-l border-slate-200">
              <Table2 class="w-4 h-4" /><span>Tabla</span>
            </button>
          </div>

          <div class="flex items-center gap-1 shrink-0 ml-auto">
            <button
              v-if="userRole === 'admin'"
              @click="openAddModal"
              data-tippy-content="Agregar máquina"
              class="inline-flex items-center gap-1 px-2 py-1 border border-slate-200 bg-white text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors duration-150 shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" stroke-linecap="round" stroke-linejoin="round"></line><line x1="5" y1="12" x2="19" y2="12" stroke-linecap="round" stroke-linejoin="round"></line></svg>
              <span>Agregar</span>
            </button>
            <button
              @click="exportMaquinasToExcel"
              data-tippy-content="Exportar listado de máquinas (XLSX)"
              class="inline-flex items-center gap-1 px-2 py-1 border border-slate-200 bg-white text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors duration-150 shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke-linecap="round" stroke-linejoin="round"></path><polyline points="7 10 12 15 17 10" stroke-linecap="round" stroke-linejoin="round"></polyline><line x1="12" y1="15" x2="12" y2="3" stroke-linecap="round" stroke-linejoin="round"></line></svg>
              <span>Máquinas</span>
            </button>
            <button
              @click="exportToExcel"
              data-tippy-content="Exportar catálogo R-60 (XLSX)"
              class="inline-flex items-center gap-1 px-2 py-1 border border-slate-200 bg-white text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors duration-150 shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke-linecap="round" stroke-linejoin="round"></path><polyline points="7 10 12 15 17 10" stroke-linecap="round" stroke-linejoin="round"></polyline><line x1="12" y1="15" x2="12" y2="3" stroke-linecap="round" stroke-linejoin="round"></line></svg>
              <span>Catálogo</span>
            </button>
            <button
              @click="openCatalogModal"
              data-tippy-content="Ver/gestionar catálogo R-60"
              class="inline-flex items-center gap-1 px-2 py-1 border border-slate-200 bg-white text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors duration-150 shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke-linecap="round" stroke-linejoin="round"></path><path d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.375-9.375z" stroke-linecap="round" stroke-linejoin="round"></path></svg>
              <span>Ver</span>
            </button>
          </div>
        </div>
      </Teleport>

      <!-- Portal para Navbar (Mobile) -->
      <Teleport to="#navbar-mobile-portal">
        <div class="lg:hidden flex items-center gap-1">
          <label class="text-[10px] font-black text-gray-300 uppercase">Tipo</label>
          <select v-model="tipoFilter" class="h-7 max-w-26 bg-white border border-slate-100 text-gray-700 text-[10px] px-1.5 rounded-md shadow-sm">
            <option value="">Todos</option>
            <option v-for="tipo in tipoFilterOptions" :key="tipo" :value="tipo">{{ tipo }}</option>
          </select>
          <button @click="exportMaquinasToExcel" data-tippy-content="Exportar máquinas" class="inline-flex items-center gap-1 px-2 py-1 border border-slate-200 bg-white text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors duration-150 shadow-sm"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke-linecap="round" stroke-linejoin="round"></path><polyline points="7 10 12 15 17 10" stroke-linecap="round" stroke-linejoin="round"></polyline><line x1="12" y1="15" x2="12" y2="3" stroke-linecap="round" stroke-linejoin="round"></line></svg></button>
          <button @click="exportToExcel" data-tippy-content="Exportar catálogo R-60" class="inline-flex items-center gap-1 px-2 py-1 border border-slate-200 bg-white text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors duration-150 shadow-sm"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke-linecap="round" stroke-linejoin="round"></path><path d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.375-9.375z" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>
          <button @click="openCatalogModal" class="inline-flex items-center gap-1 px-2 py-1 border border-slate-200 bg-white text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors duration-150 shadow-sm hover:shadow-md"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke-linecap="round" stroke-linejoin="round"></path><path d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.375-9.375z" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>
          <button v-if="userRole === 'admin'" @click="openAddModal" data-tippy-content="Agregar máquina" class="inline-flex items-center gap-1 px-2 py-1 border border-slate-200 bg-white text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors duration-150 shadow-sm hover:shadow-md"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" stroke-linecap="round" stroke-linejoin="round"></line><line x1="5" y1="12" x2="19" y2="12" stroke-linecap="round" stroke-linejoin="round"></line></svg></button>
        </div>
      </Teleport>

      <div class="lg:hidden bg-white border border-slate-100 rounded-md p-2 flex flex-col gap-2 shrink-0">
        <div class="relative">
          <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input v-model="searchQuery" type="text" placeholder="Buscar..." class="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-slate-100 rounded-md text-xs outline-none" />
        </div>
        <div class="flex items-center justify-between gap-2">
          <div class="flex border border-slate-100 rounded-md overflow-hidden text-[10px] font-bold">
            <button @click="activoFilter = 'all'" :class="activoFilter === 'all' ? 'bg-gray-600 text-white' : 'bg-gray-50 text-gray-500'" class="px-2 py-1">Todas</button>
            <button @click="activoFilter = 'activas'" :class="activoFilter === 'activas' ? 'bg-emerald-600 text-white' : 'bg-gray-50 text-gray-500'" class="px-2 py-1 border-l border-slate-100">Activas</button>
            <button @click="activoFilter = 'inactivas'" :class="activoFilter === 'inactivas' ? 'bg-red-500 text-white' : 'bg-gray-50 text-gray-500'" class="px-2 py-1 border-l border-slate-100">Inactivas</button>
          </div>
          <div class="flex border border-slate-100 rounded-md overflow-hidden bg-gray-50">
            <button @click="viewMode = 'cards'" :class="viewMode === 'cards' ? 'bg-indigo-600 text-white' : 'text-gray-500'" class="p-1.5"><LayoutGrid class="w-3.5 h-3.5" /></button>
            <button @click="viewMode = 'table'" :class="viewMode === 'table' ? 'bg-indigo-600 text-white' : 'text-gray-500'" class="p-1.5 border-l border-slate-100"><Table2 class="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </div>


      <div v-if="isLoading" class="flex-1 flex flex-col items-center justify-center text-gray-400">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>
        <p class="font-bold text-xs tracking-widest">Cargando catálogo...</p>
      </div>

      <template v-else>
        <div v-if="viewMode === 'cards'" class="flex-1 overflow-y-auto pr-1">
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            <div
              v-for="m in paginatedMaquinas" :key="m.id"
              :class="!(m.activo ?? true) ? 'opacity-60 border-dashed' : 'hover:border-indigo-300'"
              class="relative bg-white p-4 rounded-md shadow-sm border border-gray-200 flex flex-col group transition-all min-h-27.5"
            >
              <!-- Cuerpo Principal -->
              <div class="space-y-2 flex-1 pr-14">
                <div class="flex items-center space-x-2 flex-wrap gap-y-1">
                  <span class="px-2 py-1 bg-emerald-50 text-[10px] font-black text-emerald-700 rounded shrink-0 border border-emerald-100">{{ m.sector || DEFAULT_SECTOR }}</span>
                  <span class="px-2 py-1 bg-gray-100 text-xs font-black text-gray-500 rounded shrink-0">{{ m.tipo }}</span>
                  <span class="text-xl font-black text-gray-800 truncate">{{ m.maquina }}</span>
                </div>
                <p class="text-sm font-bold text-gray-600 line-clamp-1 italic">{{ m.nombre_maquina || 'Sin nombre' }}</p>
                <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400 font-bold uppercase tracking-tight mt-1">
                  <span class="shrink-0">Loc: {{ m.local_fisico }}</span>
                  <span class="shrink-0">Lado: {{ m.lado }}</span>
                </div>
                <div class="flex flex-wrap gap-1.5 pt-0.5">
                  <span class="px-2 py-0.5 text-[10px] font-black rounded border bg-sky-50 text-sky-700 border-sky-200">
                    GRP: {{ m.grp_tear || '---' }}
                  </span>
                  <span class="px-2 py-0.5 text-[10px] font-black rounded border bg-amber-50 text-amber-700 border-amber-200">
                    CMEST: {{ m.g_cmest || '---' }}
                  </span>
                </div>
                <!-- Badge Activo -->
                <div class="pt-1">
                  <span
                    :class="(m.activo ?? true)
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-red-50 text-red-500 border-red-200'"
                    class="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border"
                  >{{ (m.activo ?? true) ? 'En producción' : 'Fuera de producción' }}</span>
                </div>
              </div>

              <!-- Botones de Acción (Admin) -->
              <div v-if="userRole === 'admin'" class="absolute top-3 right-3 flex flex-col space-y-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                <!-- Toggle Activo estilo "Crítico" -->
                <button
                  @click="toggleActivo(m)"
                  :data-tippy-content="(m.activo ?? true) ? 'Marcar inactiva' : 'Marcar activa'"
                  class="flex items-center gap-1 px-1.5 py-1.5 rounded-md border transition-all shadow-sm"
                  :class="(m.activo ?? true)
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-gray-100 border-gray-200 text-gray-400 hover:bg-gray-200'"
                >
                  <span
                    class="relative inline-flex h-4 w-7 items-center rounded-full transition-colors"
                    :class="(m.activo ?? true) ? 'bg-red-500' : 'bg-gray-300'"
                  >
                    <span
                      class="inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform"
                      :class="(m.activo ?? true) ? 'translate-x-3.5' : 'translate-x-0.5'"
                    ></span>
                  </span>
                </button>
                <button @click="openEditModal(m)" class="p-2 text-indigo-600 bg-gray-50 hover:bg-indigo-50 border border-gray-100 rounded-md transition-colors shadow-sm"><Edit3 class="w-4 h-4" /></button>
                <button @click="deleteMaquina(m.id)" class="p-2 text-red-500 bg-gray-50 hover:bg-red-50 border border-gray-100 rounded-md transition-colors shadow-sm"><Trash2 class="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        </div>

        <!-- TABLA INLINE (Ocupa todo el alto) -->
        <div v-else class="flex-1 bg-white rounded-md shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-0">
          <div class="overflow-auto flex-1 min-h-0">
            <table class="w-full text-sm text-left border-collapse">
              <thead class="sticky top-0 z-20 bg-gray-50 border-b border-gray-100 text-xs font-black text-gray-500 tracking-widest shadow-sm">
                <tr>
                  <th class="px-4 py-4 bg-gray-50 w-30">Tipo</th>
                  <th class="px-4 py-4 bg-gray-50 w-30">Sector</th>
                  <th class="px-4 py-4 bg-gray-50 w-25">ID Máq.</th>
                  <th class="px-4 py-4 bg-gray-50 min-w-50">Nombre</th>
                  <th class="px-4 py-4 bg-gray-50 w-20">Local</th>
                  <th class="px-4 py-4 bg-gray-50 w-20">Lado</th>
                  <th class="px-4 py-4 bg-gray-50 w-30">Modelo</th>
                  <th class="px-4 py-4 bg-gray-50 w-30">Serie</th>
                  <th class="px-4 py-4 bg-gray-50 w-24">GRP_TEAR</th>
                  <th class="px-4 py-4 bg-gray-50 w-24">G_CMEST</th>
                  <th class="px-4 py-4 bg-gray-50 w-28 text-center">Activo</th>
                  <th v-if="userRole === 'admin'" class="px-4 py-4 text-center bg-gray-50 w-25">Acciones</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <tr
                  v-for="m in paginatedMaquinas" :key="m.id"
                  :class="[
                    editingRowId === m.id ? 'bg-indigo-50' : 'hover:bg-gray-50/50',
                    !(m.activo ?? true) ? 'opacity-60' : ''
                  ]"
                  class="transition-colors"
                >
                  <template v-if="editingRowId === m.id">
                    <td class="px-4 py-3"><select v-model="editingRow.tipo" class="w-full bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none"><option v-for="t in tiposOptions" :key="t">{{ t }}</option></select></td>
                    <td class="px-4 py-3"><select v-model="editingRow.sector" class="w-full bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none"><option v-for="s in SECTOR_OPTIONS" :key="s" :value="s">{{ s }}</option></select></td>
                    <td class="px-4 py-3"><input v-model="editingRow.maquina" type="number" class="w-24 bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none" /></td>
                    <td class="px-4 py-3"><input v-model="editingRow.nombre_maquina" type="text" class="w-full min-w-40 bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none" /></td>
                    <td class="px-4 py-3"><input v-model="editingRow.local_fisico" type="text" class="w-16 bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none" /></td>
                    <td class="px-4 py-3"><select v-model="editingRow.lado" class="bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none"><option value="U">U</option><option value="A">A</option><option value="B">B</option></select></td>
                    <td class="px-4 py-3"><input v-model="editingRow.modelo" type="text" class="w-full bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none" /></td>
                    <td class="px-4 py-3"><input v-model="editingRow.nro_serie" type="text" class="w-full bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none" /></td>
                    <td class="px-4 py-3"><input v-model="editingRow.grp_tear" type="text" class="w-20 bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none" /></td>
                    <td class="px-4 py-3"><input v-model="editingRow.g_cmest" type="text" class="w-20 bg-white border border-indigo-300 rounded-md px-3 py-2 text-sm outline-none" /></td>
                    <!-- Toggle activo edición inline -->
                    <td class="px-4 py-3 text-center">
                      <button type="button" @click="editingRow.activo = !editingRow.activo" class="flex items-center gap-2 mx-auto">
                        <span class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors" :class="editingRow.activo ? 'bg-red-500' : 'bg-gray-300'">
                          <span class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform" :class="editingRow.activo ? 'translate-x-4.5' : 'translate-x-0.5'"></span>
                        </span>
                        <span class="text-xs font-bold" :class="editingRow.activo ? 'text-emerald-600' : 'text-gray-400'">{{ editingRow.activo ? 'Activa' : 'Inactiva' }}</span>
                      </button>
                    </td>
                    <td v-if="userRole === 'admin'" class="px-4 py-3">
                      <div class="flex justify-center space-x-2">
                        <button @click="saveInlineEdit" class="p-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"><Save class="w-4 h-4" /></button>
                        <button @click="cancelInlineEdit" class="p-2 bg-gray-200 text-gray-600 rounded-md hover:bg-gray-300 transition-colors"><X class="w-4 h-4" /></button>
                      </div>
                    </td>
                  </template>
                  <template v-else>
                    <td class="px-4 py-4"><span class="px-2.5 py-1 bg-gray-100 text-xs font-black text-gray-600 rounded-md">{{ m.tipo }}</span></td>
                    <td class="px-4 py-4"><span class="px-2.5 py-1 bg-emerald-50 text-xs font-black text-emerald-700 rounded-md border border-emerald-100">{{ m.sector || DEFAULT_SECTOR }}</span></td>
                    <td class="px-4 py-4 font-black text-gray-800 text-base">{{ m.maquina }}</td>
                    <td class="px-4 py-4 text-gray-700 font-medium text-sm">{{ m.nombre_maquina }}</td>
                    <td class="px-4 py-4 text-gray-600 font-bold text-sm">{{ m.local_fisico }}</td>
                    <td class="px-4 py-4 text-gray-600 font-bold text-sm">{{ m.lado }}</td>
                    <td class="px-4 py-4 text-gray-500 text-sm">{{ m.modelo || '—' }}</td>
                    <td class="px-4 py-4 text-gray-500 text-sm">{{ m.nro_serie || '—' }}</td>
                    <td class="px-4 py-4 text-gray-500 text-sm font-semibold">{{ m.grp_tear || '—' }}</td>
                    <td class="px-4 py-4 text-gray-500 text-sm font-semibold">{{ m.g_cmest || '—' }}</td>
                    <!-- Columna Activo (solo lectura / toggle admin) -->
                    <td class="px-4 py-4 text-center">
                      <button
                        v-if="userRole === 'admin'"
                        type="button"
                        @click="toggleActivo(m)"
                        :data-tippy-content="(m.activo ?? true) ? 'En producción — clic para desactivar' : 'Fuera de producción — clic para activar'"
                        class="flex items-center gap-2 mx-auto"
                      >
                        <span class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors" :class="(m.activo ?? true) ? 'bg-red-500' : 'bg-gray-300'">
                          <span class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform" :class="(m.activo ?? true) ? 'translate-x-4.5' : 'translate-x-0.5'"></span>
                        </span>
                        <span class="text-[10px] font-black" :class="(m.activo ?? true) ? 'text-emerald-600' : 'text-gray-400'">{{ (m.activo ?? true) ? 'Activa' : 'Inactiva' }}</span>
                      </button>
                      <span v-else :class="(m.activo ?? true) ? 'text-emerald-600' : 'text-gray-400'" class="text-[10px] font-black">{{ (m.activo ?? true) ? 'Activa' : 'Inactiva' }}</span>
                    </td>
                    <td v-if="userRole === 'admin'" class="px-4 py-4">
                      <div class="flex justify-center space-x-2">
                        <button @click="startInlineEdit(m)" class="p-2 text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"><Edit3 class="w-4 h-4" /></button>
                        <button @click="deleteMaquina(m.id)" class="p-2 text-red-500 hover:bg-red-50 rounded-md transition-colors"><Trash2 class="w-4 h-4" /></button>
                      </div>
                    </td>
                  </template>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="px-4 py-3 border-t border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div class="text-[11px] text-gray-400 font-bold uppercase tracking-widest">
              {{ filteredMaquinas.length }} máquinas encontradas
            </div>
            
            <!-- Controles de Paginación -->
            <div class="flex items-center space-x-1">
              <button 
                @click="goToFirst" 
                :disabled="currentPage === 1"
                class="p-2 rounded-md hover:bg-white border border-transparent hover:border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-gray-500"
              >
                <ChevronsLeft class="w-4 h-4" />
              </button>
              <button 
                @click="goToPrev" 
                :disabled="currentPage === 1"
                class="p-2 rounded-md hover:bg-white border border-transparent hover:border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-gray-500"
              >
                <ChevronLeft class="w-4 h-4" />
              </button>
              
              <div class="bg-white border border-gray-200 px-3 py-1.5 rounded-md text-xs font-bold text-gray-600">
                Página {{ currentPage }} de {{ totalPages }}
              </div>

              <button 
                @click="goToNext" 
                :disabled="currentPage === totalPages"
                class="p-2 rounded-md hover:bg-white border border-transparent hover:border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-gray-500"
              >
                <ChevronRight class="w-4 h-4" />
              </button>
              <button 
                @click="goToLast" 
                :disabled="currentPage === totalPages"
                class="p-2 rounded-md hover:bg-white border border-transparent hover:border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-gray-500"
              >
                <ChevronsRight class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        
        <!-- Paginación para Modo Tarjetas -->
        <div v-if="viewMode === 'cards'" class="flex flex-col sm:flex-row items-center justify-between bg-white p-4 rounded-md shadow-sm border border-gray-100 gap-4 mt-2">
          <div class="text-[11px] text-gray-400 font-bold uppercase tracking-widest">
            {{ filteredMaquinas.length }} máquinas
          </div>
          <div class="flex items-center space-x-1">
            <button @click="goToFirst" :disabled="currentPage === 1" class="p-2 rounded-md hover:bg-gray-50 disabled:opacity-30 text-gray-500 transition-colors border border-gray-100"><ChevronsLeft class="w-4 h-4" /></button>
            <button @click="goToPrev" :disabled="currentPage === 1" class="p-2 rounded-md hover:bg-gray-50 disabled:opacity-30 text-gray-500 transition-colors border border-gray-100"><ChevronLeft class="w-4 h-4" /></button>
            <div class="px-3 py-1.5 text-xs font-bold text-gray-600">Pág {{ currentPage }} / {{ totalPages }}</div>
            <button @click="goToNext" :disabled="currentPage === totalPages" class="p-2 rounded-md hover:bg-gray-50 disabled:opacity-30 text-gray-500 transition-colors border border-gray-100"><ChevronRight class="w-4 h-4" /></button>
            <button @click="goToLast" :disabled="currentPage === totalPages" class="p-2 rounded-md hover:bg-gray-50 disabled:opacity-30 text-gray-500 transition-colors border border-gray-100"><ChevronsRight class="w-4 h-4" /></button>
          </div>
        </div>
      </template>
    </main>

    <!-- Modal -->
    <div v-if="showModal" class="fixed inset-0 z-100 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm overflow-y-auto">
      <div class="bg-white rounded-md w-full max-w-lg shadow-2xl overflow-hidden my-auto">
        <div class="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div>
            <h3 class="text-xl font-black text-gray-800 tracking-tight">{{ isEditing ? 'Editar máquina' : 'Nueva máquina' }}</h3>
            <p class="text-xs text-gray-500 font-bold tracking-widest mt-1">Completa los campos técnicos</p>
          </div>
          <button @click="closeModal" class="p-2 hover:bg-gray-200 rounded-md transition-colors"><X class="w-6 h-6 text-gray-500" /></button>
        </div>
        <form @submit.prevent="handleSubmit" class="p-5 space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-gray-500 ml-1">Tipo</label>
              <select v-model="form.tipo" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-md text-base focus:ring-2 focus:ring-indigo-500 outline-none">
                <option v-for="t in tiposOptions" :key="t">{{ t }}</option>
              </select>
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-gray-500 ml-1">Sector</label>
              <select v-model="form.sector" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-md text-base focus:ring-2 focus:ring-indigo-500 outline-none">
                <option v-for="s in SECTOR_OPTIONS" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-bold text-gray-500 ml-1">ID Máquina</label>
            <input v-model="form.maquina" type="number" required class="w-full bg-gray-50 border border-gray-200 p-3 rounded-md text-base focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-bold text-gray-500 ml-1">Nombre descriptivo</label>
            <input v-model="form.nombre_maquina" type="text" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-md text-base focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-gray-500 ml-1">Local físico</label>
              <input v-model="form.local_fisico" type="text" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-md text-base focus:ring-2 focus:ring-indigo-500 outline-none" />
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-gray-500 ml-1">Lado</label>
              <select v-model="form.lado" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-md text-base focus:ring-2 focus:ring-indigo-500 outline-none">
                <option value="U">Único (U)</option><option value="A">Lado A</option><option value="B">Lado B</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-gray-400 ml-1">Modelo (Opcional)</label>
              <input v-model="form.modelo" type="text" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-md text-base outline-none" />
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-gray-400 ml-1">Serie (Opcional)</label>
              <input v-model="form.nro_serie" type="text" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-md text-base outline-none" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-gray-400 ml-1">GRP_TEAR</label>
              <input v-model="form.grp_tear" type="text" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-md text-base outline-none" />
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-gray-400 ml-1">G_CMEST</label>
              <input v-model="form.g_cmest" type="text" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-md text-base outline-none" />
            </div>
          </div>
          <!-- Toggle Activo en Modal (estilo "Crítico") -->
          <div class="flex items-center justify-between p-3 bg-gray-50 rounded-md border border-gray-200">
            <div>
              <p class="text-sm font-bold text-gray-700">Estado en producción</p>
              <p class="text-xs text-gray-400 font-medium">Define si la máquina está operativa</p>
            </div>
            <button type="button" @click="form.activo = !form.activo" class="flex items-center gap-2">
              <span class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200" :class="form.activo ? 'bg-red-500' : 'bg-gray-300'">
                <span class="inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200" :class="form.activo ? 'translate-x-5.5' : 'translate-x-0.5'"></span>
              </span>
              <span class="text-sm font-black min-w-16" :class="form.activo ? 'text-emerald-600' : 'text-gray-400'">{{ form.activo ? 'Activa' : 'Inactiva' }}</span>
            </button>
          </div>

          <div class="pt-4 flex space-x-3">
            <button @click="closeModal" type="button" class="flex-1 py-3.5 border border-gray-200 rounded-md font-bold text-base text-gray-500 hover:bg-gray-50 transition-colors">Cancelar</button>
            <button type="submit" class="flex-2 py-3.5 bg-indigo-600 text-white rounded-md font-bold text-base shadow-md hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center space-x-2">
              <Check class="w-6 h-6" /><span>Guardar cambios</span>
            </button>
          </div>
        </form>
  </div>
    </div>

    <!-- Modal Catálogo R-60 -->
          <div v-if="showCatalogModal" class="fixed inset-0 z-100 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm overflow-y-auto">
            <div class="bg-white rounded-lg w-full max-w-6xl shadow-2xl overflow-hidden my-4">
              <div class="p-4 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-emerald-50 to-teal-50">
                <div>
                  <h3 class="text-2xl font-black text-gray-800 tracking-tight">Catálogo R-60</h3>
                  <p class="text-xs text-gray-500 font-bold tracking-widest mt-1">{{ filteredCatalogo.length }} registros encontrados</p>
                </div>
                <button @click="closeCatalogModal" class="p-2 hover:bg-white rounded-md transition-colors"><X class="w-6 h-6 text-gray-500" /></button>
              </div>
              <div class="p-4 bg-gray-50 border-b border-gray-100 flex flex-col sm:flex-row gap-3 items-stretch">
                <div class="flex-1">
                  <label class="text-xs font-bold text-gray-500 block mb-1">Buscar</label>
                  <input v-model="catalogoSearchQuery" type="text" placeholder="Denominación, artículo, catálogo..." class="w-full bg-white border border-gray-200 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div class="flex-1">
                  <label class="text-xs font-bold text-gray-500 block mb-1">Sección</label>
                  <select v-model="catalogoSectionFilter" class="w-full bg-white border border-gray-200 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
                    <option value="">Todos</option>
                    <option v-for="s in catalogoSectionsDisponibles" :key="s" :value="s">{{ s }}</option>
                  </select>
                </div>
                <div class="flex-1">
                  <label class="text-xs font-bold text-gray-500 block mb-1" :class="{ 'opacity-50': !catalogoSectionFilter }">Grupo</label>
                  <select v-model="catalogoGroupFilter" :disabled="!catalogoSectionFilter" class="w-full bg-white border border-gray-200 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-emerald-500 outline-none disabled:opacity-50 disabled:cursor-not-allowed">
                    <option value="">Todos</option>
                    <option v-for="g in catalogoGroupsDisponibles" :key="g" :value="g">{{ g }}</option>
                  </select>
                </div>
                <div class="flex items-end gap-2">
                  <button @click="exportCatalogToExcel" class="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-bold text-sm transition-colors shadow-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 inline mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke-linecap="round" stroke-linejoin="round"></path><polyline points="7 10 12 15 17 10" stroke-linecap="round" stroke-linejoin="round"></polyline><line x1="12" y1="15" x2="12" y2="3" stroke-linecap="round" stroke-linejoin="round"></line></svg>
                    Excel
                  </button>
                </div>
              </div>
              <div class="overflow-x-auto max-h-96">
                <table class="w-full text-sm text-left border-collapse">
                  <thead class="sticky top-0 z-20 bg-gray-50 border-b border-gray-100 text-xs font-black text-gray-500 tracking-widest shadow-sm">
                    <tr>
                      <th class="px-3 py-3 bg-gray-50 w-20">Sección</th>
                      <th class="px-3 py-3 bg-gray-50 w-16">Grupo</th>
                      <th class="px-3 py-3 bg-gray-50 w-16">Sub-G</th>
                      <th class="px-3 py-3 bg-gray-50 min-w-48">Denominación</th>
                      <th class="px-3 py-3 bg-gray-50 w-20">Catálogo</th>
                      <th class="px-3 py-3 bg-gray-50 w-20">Artículo</th>
                      <th v-if="userRole === 'admin' || userRole === 'jefe_sector'" class="px-3 py-3 text-center bg-gray-50 w-28">Acciones</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-50">
                    <tr v-for="item in filteredCatalogo" :key="item.denominacion" :class="[editingCatalogRowId === item.denominacion ? 'bg-blue-50' : 'hover:bg-gray-50/50']" class="transition-colors">
                      <template v-if="editingCatalogRowId === item.denominacion">
                        <td class="px-3 py-2"><input v-model="editingCatalogRow.seccion" type="text" class="w-full bg-white border border-blue-300 rounded px-2 py-1 text-xs outline-none" /></td>
                        <td class="px-3 py-2"><input v-model="editingCatalogRow.grupo" type="text" class="w-full bg-white border border-blue-300 rounded px-2 py-1 text-xs outline-none" /></td>
                        <td class="px-3 py-2"><input v-model="editingCatalogRow.subGrupo" type="text" class="w-full bg-white border border-blue-300 rounded px-2 py-1 text-xs outline-none" /></td>
                        <td class="px-3 py-2"><input v-model="editingCatalogRow.denominacion" type="text" class="w-full bg-white border border-blue-300 rounded px-2 py-1 text-xs outline-none" /></td>
                        <td class="px-3 py-2"><input v-model="editingCatalogRow.numeroCatalogo" type="text" class="w-full bg-white border border-blue-300 rounded px-2 py-1 text-xs outline-none" /></td>
                        <td class="px-3 py-2"><input v-model="editingCatalogRow.numeroArticulo" type="text" class="w-full bg-white border border-blue-300 rounded px-2 py-1 text-xs outline-none" /></td>
                        <td v-if="userRole === 'admin' || userRole === 'jefe_sector'" class="px-3 py-2"><div class="flex justify-center gap-1">
                          <button v-if="userRole === 'admin'" @click="saveCatalogEdit" class="p-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"><Check class="w-3 h-3" /></button>
                          <button v-if="userRole === 'admin'" @click="cancelCatalogEdit" class="p-1.5 bg-gray-200 text-gray-600 rounded hover:bg-gray-300 transition-colors"><X class="w-3 h-3" /></button>
                        </div></td>
                      </template>
                      <template v-else>
                        <td class="px-3 py-2 text-xs text-gray-600 font-medium">{{ item.seccion }}</td>
                        <td class="px-3 py-2 text-xs text-gray-600 font-medium">{{ item.grupo }}</td>
                        <td class="px-3 py-2 text-xs text-gray-600 font-medium">{{ item.subGrupo }}</td>
                        <td class="px-3 py-2 text-xs text-gray-700 font-medium">{{ item.denominacion }}</td>
                        <td class="px-3 py-2 text-xs text-gray-500">{{ item.numeroCatalogo }}</td>
                        <td class="px-3 py-2 text-xs text-gray-500">{{ item.numeroArticulo }}</td>
                        <td v-if="userRole === 'admin' || userRole === 'jefe_sector'" class="px-3 py-2"><div class="flex justify-center gap-1">
                          <button v-if="userRole === 'admin'" @click="startCatalogEdit(item)" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Editar fila"><Edit3 class="w-3 h-3" /></button>
                          <button v-if="item.id" @click="openProcedimientoEditor(item)" class="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded transition-colors" :title="item.procedimiento?.length ? 'Editar procedimiento (' + item.procedimiento.length + ' pasos)' : 'Agregar procedimiento'"><BookOpen class="w-3 h-3" /></button>
                        </div></td>
                      </template>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                <button @click="closeCatalogModal" class="py-2.5 px-4 border border-gray-200 rounded-md font-bold text-gray-700 hover:bg-white transition-colors">Cerrar</button>
              </div>
            </div>
          </div>
    <!-- Modal Editor de Procedimiento -->
    <div v-if="showProcedimientoModal" class="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-gray-900/70 backdrop-blur-sm overflow-y-auto">
      <div class="bg-white rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden my-4">
        <div class="p-4 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-indigo-50 to-violet-50">
          <div>
            <h3 class="text-lg font-black text-gray-800 tracking-tight">Procedimiento</h3>
            <p class="text-xs text-gray-500 font-bold mt-0.5 max-w-sm truncate">{{ procedimientoItem?.denominacion }}</p>
          </div>
          <button @click="closeProcedimientoEditor" class="p-2 hover:bg-white rounded-md transition-colors"><X class="w-5 h-5 text-gray-500" /></button>
        </div>

        <div class="p-4 space-y-3 max-h-[55vh] overflow-y-auto">
          <div v-if="procedimientoPasos.length === 0" class="text-center py-10 text-gray-400">
            <BookOpen class="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p class="font-bold text-sm">Sin pasos definidos</p>
            <p class="text-xs mt-1">Haga clic en "Agregar paso" para comenzar.</p>
          </div>

          <div v-for="(paso, i) in procedimientoPasos" :key="i" class="flex gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
            <div class="flex-none w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-black flex items-center justify-center shrink-0 mt-0.5">{{ i + 1 }}</div>
            <div class="flex-1 space-y-2 min-w-0">
              <textarea
                v-model="paso.texto"
                rows="2"
                placeholder="Descripción del paso..."
                class="w-full bg-white border border-gray-200 text-sm text-gray-800 rounded-md p-2 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none resize-none"
              ></textarea>
              <div v-if="paso.imagenUrl" class="relative rounded-md overflow-hidden border border-gray-200">
                <img :src="paso.imagenUrl" class="w-full max-h-48 object-contain bg-gray-900" />
                <button @click="paso.imagenUrl = null" type="button" class="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 hover:bg-red-700 transition">
                  <X class="w-3 h-3" />
                </button>
              </div>
              <div v-else>
                <label class="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-md text-xs font-bold text-gray-500 hover:bg-gray-100 transition" :class="{ 'opacity-50 cursor-not-allowed': uploadingPasoIndex !== null }">
                  <Camera class="w-3.5 h-3.5" />
                  <span>{{ uploadingPasoIndex === i ? 'Subiendo...' : 'Agregar imagen' }}</span>
                  <input type="file" accept="image/*" class="hidden" :disabled="uploadingPasoIndex !== null" @change="onPasoImagenChange(i, $event)" />
                </label>
              </div>
            </div>
            <button @click="eliminarPaso(i)" type="button" class="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition shrink-0 self-start">
              <Trash2 class="w-4 h-4" />
            </button>
          </div>
        </div>

        <div class="p-4 border-t border-gray-100 bg-gray-50 flex justify-between items-center">
          <button @click="agregarPaso" type="button" class="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-sm font-bold hover:bg-indigo-100 transition">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" stroke-linecap="round" stroke-linejoin="round"/><line x1="5" y1="12" x2="19" y2="12" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Agregar paso
          </button>
          <div class="flex gap-2">
            <button @click="closeProcedimientoEditor" type="button" class="px-4 py-2 border border-gray-200 rounded-lg text-sm font-bold text-gray-600 hover:bg-white transition">Cancelar</button>
            <button @click="guardarProcedimiento" type="button" :disabled="isSavingProcedimiento" class="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition disabled:opacity-60 flex items-center gap-1.5">
              <Save class="w-4 h-4" />
              {{ isSavingProcedimiento ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>


