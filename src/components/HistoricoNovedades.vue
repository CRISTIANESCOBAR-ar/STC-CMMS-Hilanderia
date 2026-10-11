<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { RefreshCw, Download, Sparkles, Eye, X, Copy } from 'lucide-vue-next';
import { db } from '../firebase/config';
import { userProfile } from '../services/authService';
import { aiService } from '../services/aiService';
import { getSectorScope } from '../utils/sectorScope';
import { loadFaultEventsPage } from '../services/faultEvents';
import { collectHistoryPages, updateHistoryState } from '../services/historyService';
import { eventView, filterFaultEvents, faultEventWindow } from '../utils/faultEvents';
import { plantDate, addDays, PLANT_TIME_ZONE } from '../utils/plantTime';
import { formatSummary } from '../utils/formatSummary';
import { vTippy } from '../utils/tooltipDirective';
import PlantDatePicker from './PlantDatePicker.vue';
import OperationalImage from './OperationalImage.vue';
import { saveAs } from 'file-saver';
import Swal from 'sweetalert2';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/themes/light-border.css';

const period = ref('week'), state = ref(''), category = ref(''), sector = ref(''), search = ref('');
const rangeFrom = ref(addDays(plantDate(), -6)), rangeTo = ref(plantDate());
const events = ref([]), loading = ref(true), loadingMore = ref(false), hasMore = ref(false), error = ref('');
const exporting = ref(false), exportScope = ref('loaded');
const selected = ref(null), modalType = ref(''), modal = ref(null), photoExpanded = ref(false), nextState = ref(''), saving = ref(false);
const aiDate = ref(plantDate()), aiText = ref(''), aiLoading = ref(false), aiError = ref(''), aiFromCache = ref(false);
const availableSectors = computed(() => { try { return getSectorScope(userProfile.value) || ['HILANDERIA', 'TEJEDURIA']; } catch { return []; } });
const visible = computed(() => filterFaultEvents(events.value, { category:category.value, state:state.value, search:search.value }).map(event => eventView(event)));
const aiHtml = computed(() => formatSummary(aiText.value));
onBeforeRouteLeave(() => !saving.value);
const stateLabel = value => ({ pendiente:'Pendiente', 'en proceso':'En proceso', resuelto:'Resuelto' }[value] || value || 'Sin estado');
function formatDate(value) {
  if (!value) return '—';
  const date = value?.toDate?.() || (value?.seconds != null ? new Date(value.seconds * 1000) : new Date(value));
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:PLANT_TIME_ZONE }).format(date);
}
let generation = 0, aiGeneration = 0, cursor = null, activeOptions, activeSectors, previousFocus;
async function reload() {
  const token = ++generation;
  events.value = []; cursor = null; hasMore.value = false; loading.value = true; loadingMore.value = false; error.value = '';
  try {
    activeSectors = getSectorScope(userProfile.value);
    if (sector.value) {
      if (activeSectors !== null && !activeSectors.includes(sector.value)) sector.value = '';
      else activeSectors = [sector.value];
    }
    activeOptions = { kind:'faults', period:period.value, state:state.value, category:category.value, order:'desc', now:new Date(), range:{ from:rangeFrom.value, to:rangeTo.value } };
    faultEventWindow(activeOptions.period, activeOptions.now, activeOptions.range);
    const page = await loadFaultEventsPage(db, activeSectors, activeOptions);
    if (token !== generation) return;
    events.value = page.events; cursor = page.cursor; hasMore.value = page.hasMore;
  } catch (failure) { if (token === generation) error.value = failure.code === 'failed-precondition' ? 'Los filtros se están preparando. Reintentá en unos minutos.' : failure.message || 'No se pudo cargar el histórico.'; }
  finally { if (token === generation) loading.value = false; }
}
async function more() {
  if (loading.value || loadingMore.value || !hasMore.value || !cursor) return;
  const token = generation; loadingMore.value = true;
  try {
    const page = await loadFaultEventsPage(db, activeSectors, activeOptions, cursor);
    if (token !== generation) return;
    const ids = new Set(events.value.map(event => event.id));
    events.value.push(...page.events.filter(event => !ids.has(event.id)));
    cursor = page.cursor; hasMore.value = page.hasMore; error.value = '';
  } catch { if (token === generation) error.value = 'No se pudo cargar la siguiente página. Podés reintentar.'; }
  finally { if (token === generation) loadingMore.value = false; }
}
watch([period, state, category, sector, rangeFrom, rangeTo, () => JSON.stringify(userProfile.value)], () => {
  closeModal(true); aiGeneration++; aiLoading.value = false; aiText.value = ''; reload();
}, { immediate:true });
watch(aiDate, () => { aiGeneration++; aiText.value = ''; aiError.value = ''; aiLoading.value = false; });
function clearFilters() { period.value = 'week'; state.value = ''; category.value = ''; sector.value = ''; search.value = ''; }
function openDetail(event) { previousFocus = globalThis.document?.activeElement; selected.value = event; nextState.value = event.estado; photoExpanded.value = false; modalType.value = 'detail'; }
function openAi() { previousFocus = globalThis.document?.activeElement; aiDate.value = period.value === 'range' ? rangeTo.value : plantDate(); modalType.value = 'ai'; }
function closeModal(force = false) { if (saving.value && !force) return; modalType.value = ''; selected.value = null; nextTick(() => { if (previousFocus?.isConnected) previousFocus.focus(); }); }
watch(modalType, async value => { if (value) { await nextTick(); modal.value?.focus?.(); } });
function modalKeyboard(event) {
  if (event.key === 'Escape') { event.stopPropagation(); closeModal(); }
  if (event.key !== 'Tab') return;
  const nodes = [...(modal.value?.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),textarea:not(:disabled)') || [])].filter(node => node.getClientRects().length);
  if (!nodes.length) { event.preventDefault(); return; }
  const first = nodes[0], last = nodes.at(-1), active = globalThis.document?.activeElement;
  if (event.shiftKey && (active === first || !nodes.includes(active))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (active === last || !nodes.includes(active))) { event.preventDefault(); first.focus(); }
}
async function saveState() {
  if (saving.value || userProfile.value?.role !== 'admin' || !selected.value || nextState.value === selected.value.estado) return;
  const record = selected.value, value = nextState.value;
  const confirmation = await Swal.fire({ title:'¿Cambiar el estado del reporte?', text:`Máquina ${record.numeroMaquinaDisplay}: ${stateLabel(record.estado)} → ${stateLabel(value)}`, showCancelButton:true, confirmButtonText:'Guardar estado', cancelButtonText:'Cancelar', icon:'question' });
  if (!confirmation.isConfirmed || saving.value || selected.value?.id !== record.id) return;
  saving.value = true;
  try { await updateHistoryState(record, value); closeModal(true); await reload(); }
  catch (failure) { await Swal.fire({ icon:'error', title:'No se pudo cambiar el estado', text:failure.message }); }
  finally { saving.value = false; }
}
async function generateAi(force = false) {
  if (aiLoading.value) return;
  const token = ++aiGeneration, target = aiDate.value;
  let sectors;
  try { sectors = getSectorScope(userProfile.value); if (sector.value) { if (sectors !== null && !sectors.includes(sector.value)) throw new Error('Sector no autorizado.'); sectors = [sector.value]; } }
  catch (failure) { aiError.value = failure.message; return; }
  aiLoading.value = true; aiError.value = '';
  try { const result = await aiService.generarResumenDiario(force, target, sectors); if (token === aiGeneration) { aiText.value = result.text; aiFromCache.value = result.fromCache; } }
  catch (failure) { if (token === aiGeneration) aiError.value = failure.message || 'No se pudo generar el análisis.'; }
  finally { if (token === aiGeneration) aiLoading.value = false; }
}
async function copyAi() {
  try { await navigator.clipboard.writeText(aiText.value); await Swal.fire({ toast:true, icon:'success', title:'Resumen copiado', timer:1500, showConfirmButton:false }); }
  catch { await Swal.fire({ icon:'error', title:'No se pudo copiar el resumen' }); }
}
async function exportExcel() {
  if (exporting.value || loading.value || error.value && !events.value.length) return;
  exporting.value = true;
  const token = generation, criteria = { category:category.value, state:state.value, search:search.value }, scope = exportScope.value;
  const assertCurrent = () => { if (token !== generation || criteria.search !== search.value) throw new Error('Cambiaron los filtros o el perfil durante la exportación. Reintentá con los filtros actuales.'); };
  try {
    const records = scope === 'all' ? await collectHistoryPages(activeSectors, activeOptions, assertCurrent) : [...events.value];
    const rows = filterFaultEvents(records, criteria);
    if (!rows.length) { await Swal.fire({ icon:'info', title:'Sin registros para exportar' }); return; }
    const { default:ExcelJS } = await import('exceljs'); assertCurrent();
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Historial');
    sheet.columns = [{ header:'FECHA', key:'fecha', width:22 }, { header:'MÁQUINA ID', key:'numeroMaquina', width:16 }, { header:'TIPO', key:'tipoMaquina', width:16 }, { header:'SECTOR', key:'sector', width:16 }, { header:'LADO', key:'lado', width:8 }, { header:'CATEGORÍA', key:'tipoProblema', width:16 }, { header:'MOTIVO', key:'motivo', width:30 }, { header:'OBSERVACIONES', key:'observaciones', width:60 }, { header:'ESTADO', key:'estado', width:16 }, { header:'REPORTADO POR', key:'creadoPorNombre', width:25 }, { header:'PUNTO DE CONTROL', key:'punto', width:35 }, { header:'CATÁLOGO', key:'numeroCatalogo', width:18 }, { header:'ARTÍCULO', key:'numeroArticulo', width:18 }, { header:'CRÍTICO', key:'critico', width:10 }];
    rows.forEach(row => sheet.addRow({ ...row, fecha:formatDate(row.createdAt), punto:[row.seccion,row.grupo,row.denominacion].filter(Boolean).join(' · '), critico:row.critico ? 'Sí' : 'No' }));
    sheet.getRow(1).font = { bold:true, color:{ argb:'FFFFFFFF' } }; sheet.getRow(1).fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF4F46E5' } };
    sheet.views = [{ state:'frozen', ySplit:1 }]; sheet.autoFilter = 'A1:N1';
    sheet.eachRow(row => { row.alignment = { vertical:'top', wrapText:true }; });
    const buffer = await workbook.xlsx.writeBuffer(); assertCurrent();
    saveAs(new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Historial_STC_${plantDate()}_${scope === 'all' ? 'periodo' : 'cargados'}.xlsx`);
  } catch (failure) { await Swal.fire({ icon:'error', title:'No se pudo exportar', text:failure.message }); }
  finally { exporting.value = false; }
}
onUnmounted(() => { generation++; aiGeneration++; });
</script>

<template>
  <div class="history-page" :inert="!!modalType">
    <header class="history-header"><div><h1>Histórico de novedades</h1><p>Reportes de fallas · Más recientes primero</p></div><div class="history-actions"><button class="history-button" @click="reload" :disabled="loading" v-tippy="'Actualizar los registros del período'"><RefreshCw :size="16" />Actualizar</button><button class="history-button" @click="openAi" v-tippy="'Consultar el análisis de un día, sin modificar los filtros'"><Sparkles :size="16" />Análisis IA</button></div></header>
    <div class="history-filters"><label class="history-search">Buscar en registros cargados<input v-model="search" type="search" placeholder="Máquina, motivo o persona…" /></label><label>Período<select v-model="period"><option value="week">Últimos 7 días</option><option value="today">Hoy</option><option value="range">Rango personalizado</option></select></label><label>Estado<select v-model="state"><option value="">Todos</option><option value="pendiente">Pendiente</option><option value="en proceso">En proceso</option><option value="resuelto">Resuelto</option></select></label><label>Categoría<select v-model="category"><option value="">Todas</option><option value="Mecánico">Mecánico</option><option value="Eléctrico">Eléctrico</option><option value="other">Otras / sin categoría</option></select></label><label v-if="availableSectors.length > 1">Sector<select v-model="sector"><option value="">Todos los permitidos</option><option v-for="value in availableSectors" :key="value" :value="value">{{ value }}</option></select></label><button class="history-button" @click="clearFilters">Limpiar</button><div v-if="period === 'range'" class="history-range"><label>Desde<PlantDatePicker v-model="rangeFrom" label="Desde" /></label><label>Hasta<PlantDatePicker v-model="rangeTo" label="Hasta" /></label><small>Hasta 31 días por consulta</small></div></div>
    <div class="history-export"><span>{{ visible.length }} visibles de {{ events.length }} cargados<span v-if="hasMore"> · Hay más registros</span></span><div><select v-model="exportScope" aria-label="Alcance de exportación"><option value="loaded">Exportar registros cargados</option><option value="all">Exportar todo el período filtrado</option></select><button class="history-button primary" :disabled="exporting || loading" @click="exportExcel" v-tippy="'Exportar el alcance seleccionado; incluye búsqueda y filtros'"><Download :size="16" />{{ exporting ? 'Exportando…' : 'Exportar' }}</button></div></div>
    <p v-if="error" class="history-error" role="alert">{{ error }} <button class="history-button" @click="events.length ? more() : reload()">Reintentar</button></p>
    <div v-if="loading" class="history-empty" role="status">Cargando historial…</div>
    <div v-else class="history-table-scroll"><table class="history-table"><thead><tr><th>Fecha</th><th>Máquina</th><th>Categoría</th><th>Reporte</th><th>Estado</th><th>Detalle</th></tr></thead><tbody><tr v-for="event in visible" :key="event.id" :class="{ critical:event.critico }"><td>{{ formatDate(event.createdAt) }}</td><td><strong>{{ event.numeroMaquinaDisplay }}</strong><small>{{ event.tipoMaquina }} · {{ event.sector }}<span v-if="event.lado && event.lado !== 'U'"> · Lado {{ event.lado }}</span></small></td><td>{{ event.tipoProblema || 'Sin categoría' }}<small v-if="event.critico" class="critical-label">Crítico</small></td><td class="history-description"><strong>{{ event.motivo || event.denominacion || 'Reporte de falla' }}</strong><p>{{ event.observaciones }}</p><small>{{ event.creadoPorNombre || 'Sin identificar' }}<span v-if="event.fotoUrl"> · Foto adjunta</span></small></td><td><span class="history-state" :class="event.estado?.replace(' ', '-')">{{ stateLabel(event.estado) }}</span></td><td><button class="history-button" :aria-label="'Detalle de máquina ' + event.numeroMaquinaDisplay" v-tippy="'Ver descripción completa, punto de control y foto'" @click="openDetail(event)"><Eye :size="16" /></button></td></tr><tr v-if="!visible.length"><td colspan="6" class="history-empty">Sin registros con estos filtros<span v-if="hasMore">. Podés cargar más para continuar la búsqueda.</span></td></tr></tbody></table></div>
    <footer class="history-footer"><span>Páginas de 50 · Búsqueda y Otras filtran registros cargados</span><button v-if="hasMore" class="history-button" :disabled="loadingMore || loading" @click="more">{{ loadingMore ? 'Cargando…' : 'Cargar 50 más' }}</button><span v-else-if="!loading && !error">Fin del período</span></footer>
  </div>
  <Teleport to="body"><div v-if="modalType" class="history-modal-overlay" @click.self="closeModal()"><section ref="modal" class="history-modal" role="dialog" aria-modal="true" :aria-label="modalType === 'detail' ? 'Detalle de reporte' : 'Análisis diario'" tabindex="-1" @keydown="modalKeyboard"><header><div><h2>{{ modalType === 'detail' ? 'Reporte · Máquina ' + selected?.numeroMaquinaDisplay : 'Análisis diario' }}</h2><p v-if="selected">{{ formatDate(selected.createdAt) }} · {{ selected.tipoProblema }} · {{ stateLabel(selected.estado) }}</p></div><button class="history-button" aria-label="Cerrar modal" :disabled="saving" @click="closeModal()" v-tippy="'Cerrar'"><X :size="18" /></button></header><div class="history-modal-body">
    <template v-if="modalType === 'detail' && selected"><div class="history-detail-grid"><section><h3>{{ selected.motivo || 'Descripción del reporte' }}</h3><p class="history-full-description">{{ selected.observaciones || 'Sin observaciones' }}</p><button v-if="selected.fotoUrl" class="history-photo" @click="photoExpanded = !photoExpanded" :aria-label="photoExpanded ? 'Reducir foto' : 'Ampliar foto'" v-tippy="photoExpanded ? 'Reducir foto' : 'Ampliar foto'" :class="{ expanded:photoExpanded }"><OperationalImage :src="selected.fotoUrl" /></button></section><dl><dt>Identificador completo</dt><dd>{{ selected.numeroMaquina }}</dd><dt>Tipo / sector</dt><dd>{{ selected.tipoMaquina }} / {{ selected.sector }}</dd><dt>Lado</dt><dd>{{ selected.lado || '—' }}</dd><dt>Reportado por</dt><dd>{{ selected.creadoPorNombre || 'Sin identificar' }}</dd><dt>Prioridad</dt><dd>{{ selected.critico ? 'Crítica' : 'Normal' }}</dd><dt>Punto de control</dt><dd>{{ [selected.seccion,selected.grupo,selected.denominacion].filter(Boolean).join(' · ') || 'No informado' }}</dd><dt>Subgrupo</dt><dd>{{ selected.subGrupo || '—' }}</dd><dt>Catálogo / artículo</dt><dd>{{ selected.numeroCatalogo || '—' }} / {{ selected.numeroArticulo || '—' }}</dd><dt v-if="selected.feedbackJefe">Seguimiento</dt><dd v-if="selected.feedbackJefe">{{ selected.feedbackJefe }}</dd></dl></div></template>
    <template v-else-if="modalType === 'ai'"><div class="history-ai-actions"><label>Día del análisis<PlantDatePicker v-model="aiDate" label="Día del análisis" /></label><button class="history-button primary" :disabled="aiLoading" @click="generateAi(false)">{{ aiLoading ? 'Generando…' : 'Consultar análisis' }}</button><button v-if="aiText" class="history-button" :disabled="aiLoading" @click="generateAi(true)">Regenerar</button><button v-if="aiText" class="history-button" @click="copyAi"><Copy :size="16" />Copiar resumen</button></div><p class="history-ai-note">Análisis del día completo para los sectores seleccionados. No aplica búsqueda, estado o categoría.</p><p v-if="aiError" class="history-error" role="alert">{{ aiError }}</p><p v-if="aiLoading" role="status">Generando resumen…</p><p v-if="aiFromCache && aiText" class="history-ai-note">Resumen guardado previamente</p><div v-if="aiText" class="history-ai-text" v-html="aiHtml"></div></template>
    </div><footer><div v-if="modalType === 'detail' && userProfile?.role === 'admin'" class="history-state-action"><label>Estado<select v-model="nextState" :disabled="saving"><option value="pendiente">Pendiente</option><option value="en proceso">En proceso</option><option value="resuelto">Resuelto</option></select></label><button class="history-button primary" :disabled="saving || nextState === selected?.estado" @click="saveState">{{ saving ? 'Guardando…' : 'Guardar estado' }}</button></div><button class="history-button" :disabled="saving" @click="closeModal()">Cerrar</button></footer></section></div></Teleport>
</template>

<style scoped>
.history-page { height:100%; min-height:0; display:flex; flex-direction:column; gap:10px; padding:12px; background:#f8fafc; overflow:hidden; }
.history-header { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-shrink:0; } h1 { color:#0f172a; font-size:19px; font-weight:650; } .history-header p { font-size:12px; color:#64748b; margin-top:2px; }
.history-actions,.history-export > div { display:flex; gap:6px; flex-wrap:wrap; }
.history-button { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:34px; padding:6px 10px; border:1px solid #cbd5e1; border-radius:5px; background:white; color:#334155; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap; } .history-button:hover { background:#f1f5f9; } .history-button.primary { background:#4f46e5; border-color:#4f46e5; color:white; } .history-button:disabled { opacity:.45; cursor:default; }
.history-filters { display:flex; gap:8px; align-items:end; flex-wrap:wrap; padding:9px; border:1px solid #e2e8f0; border-radius:6px; background:white; flex-shrink:0; } label { display:flex; flex-direction:column; gap:4px; font-size:11px; color:#64748b; font-weight:600; } input,select { min-height:34px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:5px; color:#334155; background:white; font-size:12px; min-width:0; max-width:100%; } .history-search { flex:1; min-width:180px; } .history-range { display:flex; gap:8px; align-items:end; flex-wrap:wrap; width:100%; } small { font-size:11px; color:#64748b; }
.history-export { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; flex-shrink:0; font-size:11px; color:#64748b; }
.history-table-scroll { flex:1; min-height:0; overflow:auto; background:white; border:1px solid #e2e8f0; border-radius:8px; } .history-table { width:100%; border-collapse:separate; border-spacing:0; table-layout:fixed; font-size:12px; color:#334155; } th { position:sticky; top:0; z-index:1; background:#f1f5f9; text-align:left; padding:10px 9px; border-bottom:1px solid #cbd5e1; font-size:11px; font-weight:600; color:#64748b; } th:nth-child(1) { width:15%; } th:nth-child(2) { width:16%; } th:nth-child(3) { width:13%; } th:nth-child(4) { width:35%; } th:nth-child(5) { width:13%; } th:nth-child(6) { width:8%; }
td { padding:10px 9px; border-bottom:1px solid #e2e8f0; vertical-align:top; overflow-wrap:anywhere; } tr:hover td { background:#f8fafc; } td strong { color:#0f172a; font-weight:600; } td small { display:block; margin-top:4px; } .history-description p { color:#64748b; margin-top:4px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; } .history-state { display:inline-block; border-radius:4px; padding:3px 6px; font-size:10px; font-weight:600; background:#f1f5f9; color:#475569; } .pendiente { background:#fef2f2; color:#b91c1c; } .en-proceso { background:#fffbeb; color:#b45309; } .resuelto { background:#ecfdf5; color:#047857; } .critical td:first-child { border-left:3px solid #ef4444; } .critical-label { color:#b91c1c; font-weight:600; }
.history-footer { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; font-size:11px; color:#64748b; flex-shrink:0; } .history-empty { padding:40px 16px; text-align:center; color:#64748b; } .history-error { padding:10px; color:#b91c1c; font-size:12px; }
.history-modal-overlay { position:fixed; inset:0; z-index:100; background:#0f172a66; display:flex; align-items:center; justify-content:center; padding:16px; } .history-modal { width:min(1000px,100%); max-height:calc(100dvh - 32px); background:white; border:1px solid #e2e8f0; border-radius:10px; box-shadow:0 20px 60px #0f172a40; display:flex; flex-direction:column; overflow:hidden; outline:none; } .history-modal > header { padding:15px 18px; display:flex; justify-content:space-between; gap:12px; border-bottom:1px solid #e2e8f0; flex-shrink:0; } h2 { font-size:17px; font-weight:650; color:#0f172a; } .history-modal header p { font-size:12px; color:#64748b; margin-top:4px; } .history-modal-body { padding:18px; overflow:auto; min-height:0; font-size:13px; color:#334155; } .history-detail-grid { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,1fr); gap:24px; } h3 { font-size:15px; font-weight:600; margin-bottom:10px; } .history-full-description { white-space:pre-wrap; line-height:1.6; } dl { display:grid; grid-template-columns:120px minmax(0,1fr); gap:8px; font-size:12px; overflow-wrap:anywhere; } dt { color:#64748b; } dd { color:#334155; } .history-photo { display:block; width:100%; margin-top:16px; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; cursor:zoom-in; } .history-photo :deep(img) { width:100%; max-height:250px; object-fit:contain; } .history-photo.expanded :deep(img) { max-height:65dvh; }
.history-modal footer { display:flex; justify-content:space-between; align-items:end; flex-wrap:wrap; gap:10px; padding:12px 18px; border-top:1px solid #e2e8f0; flex-shrink:0; } .history-state-action,.history-ai-actions { display:flex; gap:8px; align-items:end; flex-wrap:wrap; } .history-ai-note { color:#64748b; font-size:12px; margin:12px 0; } .history-ai-text { overflow-wrap:anywhere; line-height:1.65; } button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid #818cf8; outline-offset:2px; }
@media(max-width:980px) { .history-table th,.history-table td { padding:8px 6px; } .history-table th:nth-child(4) { width:31%; } .history-table th:nth-child(1) { width:17%; } .history-table th:nth-child(5) { width:15%; } }
@media(max-width:767px) { .history-page { padding:8px; } .history-header { align-items:start; flex-wrap:wrap; } h1 { font-size:17px; } .history-table { min-width:620px; } .history-detail-grid { grid-template-columns:minmax(0,1fr); gap:18px; } .history-modal-overlay { padding:8px; } .history-modal { max-height:calc(100dvh - 16px); } .history-export > div { width:100%; } .history-export select { flex:1; } }
</style>
