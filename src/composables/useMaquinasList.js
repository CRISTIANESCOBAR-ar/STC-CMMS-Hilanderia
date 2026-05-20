import { ref, computed, watch } from 'vue';
import { collection, getDocs, query } from 'firebase/firestore';
import { db } from '../firebase/config';
import { DEFAULT_SECTOR, normalizeSectorValue } from '../constants/organization';

export function normalizeMachineRecord(maquina = {}) {
  return {
    ...maquina,
    sector: normalizeSectorValue(maquina.sector || DEFAULT_SECTOR),
    activo: maquina.activo ?? true,
    grp_tear: maquina.grp_tear ?? '',
    g_cmest: maquina.g_cmest ?? '',
    orden_patrulla: maquina.orden_patrulla ?? null,
  };
}

/**
 * Lista de máquinas con carga, filtros y paginación (extraído de GestionMaquinas).
 */
export function useMaquinasList(options = {}) {
  const { itemsPerPageDefault = 25, loadTimeoutMs = 10000 } = options;

  const maquinas = ref([]);
  const isLoading = ref(true);
  const searchQuery = ref('');
  const activoFilter = ref('all');
  const tipoFilter = ref('');
  const currentPage = ref(1);
  const itemsPerPage = ref(itemsPerPageDefault);

  const filteredMaquinas = computed(() => {
    const q = searchQuery.value.toLowerCase();
    return maquinas.value.filter((m) => {
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

  const totalPages = computed(
    () => Math.ceil(filteredMaquinas.value.length / itemsPerPage.value) || 1
  );

  const paginatedMaquinas = computed(() => {
    const start = (currentPage.value - 1) * itemsPerPage.value;
    return filteredMaquinas.value.slice(start, start + itemsPerPage.value);
  });

  watch([searchQuery, activoFilter, tipoFilter], () => {
    currentPage.value = 1;
  });

  const goToFirst = () => { currentPage.value = 1; };
  const goToPrev = () => { if (currentPage.value > 1) currentPage.value--; };
  const goToNext = () => { if (currentPage.value < totalPages.value) currentPage.value++; };
  const goToLast = () => { currentPage.value = totalPages.value; };

  async function loadMaquinas({ onTimeout, onError } = {}) {
    isLoading.value = true;
    const timeoutId = setTimeout(() => {
      if (isLoading.value && onTimeout) onTimeout();
    }, loadTimeoutMs);

    try {
      const snapshot = await getDocs(query(collection(db, 'maquinas')));
      clearTimeout(timeoutId);
      const data = snapshot.docs.map((d) =>
        normalizeMachineRecord({ id: d.id, ...d.data() })
      );
      maquinas.value = data.sort((a, b) => {
        if ((a.nro_tipo || 0) !== (b.nro_tipo || 0)) return (a.nro_tipo || 0) - (b.nro_tipo || 0);
        return (a.local_fisico || 0) - (b.local_fisico || 0);
      });
      isLoading.value = false;
      return maquinas.value;
    } catch (error) {
      clearTimeout(timeoutId);
      isLoading.value = false;
      if (onError) onError(error);
      throw error;
    }
  }

  return {
    maquinas,
    isLoading,
    searchQuery,
    activoFilter,
    tipoFilter,
    currentPage,
    itemsPerPage,
    filteredMaquinas,
    tipoFilterOptions,
    totalPages,
    paginatedMaquinas,
    goToFirst,
    goToPrev,
    goToNext,
    goToLast,
    loadMaquinas,
    normalizeMachineRecord,
  };
}
