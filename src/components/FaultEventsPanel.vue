<script setup>
import { computed, ref, watch, onUnmounted, nextTick } from 'vue';
import { RefreshCw, X, ChevronDown, Eye } from 'lucide-vue-next';
import { db } from '../firebase/config';
import { userProfile } from '../services/authService';
import { getSectorScope } from '../utils/sectorScope';
import { filterFaultEvents, faultEventWindow, eventKindConfig, eventView, machineStateLabel, eventStateClass } from '../utils/faultEvents';
import { subscribeFaultEvents, loadFaultEventsPage } from '../services/faultEvents';
import { vTippy } from '../utils/tooltipDirective';
import PlantDatePicker from './PlantDatePicker.vue';
import { plantDate } from '../utils/plantTime';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/themes/light-border.css';

const props = defineProps({ refreshKey: { type: Number, default: 0 }, kind: { type:String, default:'faults' } });
const config = computed(() => eventKindConfig(props.kind));
const period = ref('shift'), order = ref('asc'), category = ref(''), state = ref(''), search = ref('');
const rangeFrom = ref(plantDate()), rangeTo = ref(plantDate());
const sector = ref('');
const availableSectors = computed(() => {
  try { return getSectorScope(userProfile.value) || ['HILANDERIA', 'TEJEDURIA']; } catch { return []; }
});
const events = ref([]), loading = ref(true), loadingMore = ref(false), error = ref(''), hasMore = ref(false), selected = ref(null);
const modal = ref(null);
let previousFocus;
watch(selected, async value => {
  if (value) { previousFocus = document.activeElement; await nextTick(); modal.value?.querySelector('button')?.focus(); }
  else previousFocus?.focus();
});
function modalKeydown(event) {
  if (event.key !== 'Tab') return;
  const buttons = modal.value?.querySelectorAll('button:not(:disabled)');
  if (!buttons?.length) return;
  const target = event.shiftKey ? buttons[0] : buttons[buttons.length - 1];
  if (document.activeElement === target) { event.preventDefault(); (event.shiftKey ? buttons[buttons.length - 1] : buttons[0]).focus(); }
}
const visible = computed(() => filterFaultEvents(events.value, { category: category.value, state: state.value, search: search.value, kind:props.kind }).map(event => eventView(event, props.kind)));
const formatDate = value => value?.toDate ? new Intl.DateTimeFormat('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:'America/Argentina/Buenos_Aires' }).format(value.toDate()) : 'Confirmando…';
const stateLabel = value => config.value.states.find(state => state.value === value)?.label || value || 'Sin estado';
let unsubscribe, generation = 0, revision = 0, cursor = null, activeOptions, activeSectors;
function reload() {
  const token = ++generation;
  revision++;
  unsubscribe?.(); unsubscribe = null;
  events.value = []; cursor = null; hasMore.value = false; selected.value = null; error.value = ''; loading.value = true; loadingMore.value = false;
  try {
    activeSectors = getSectorScope(userProfile.value);
    if (sector.value) {
      if (activeSectors !== null && !activeSectors.includes(sector.value)) sector.value = '';
      else activeSectors = [sector.value];
    }
    activeOptions = { period: period.value, order: order.value, kind:props.kind, state: state.value, category: category.value, now: new Date(), range: { from:rangeFrom.value, to:rangeTo.value } };
    faultEventWindow(activeOptions.period, activeOptions.now, activeOptions.range);
    if (period.value === 'older' && state.value && !config.value.pendingStates.includes(state.value)) { loading.value = false; return; }
    unsubscribe = subscribeFaultEvents(db, activeSectors, activeOptions, page => {
      if (token !== generation) return;
      // Reset cursor pages on live changes so the table cannot retain stale rows.
      revision++;
      events.value = page.events; cursor = page.cursor; hasMore.value = page.hasMore; loading.value = false; loadingMore.value = false;
    }, failure => { if (token === generation) { error.value = failure.code === 'failed-precondition' ? 'Los filtros se están preparando. Reintentá en unos minutos.' : 'No se pudieron cargar los eventos. Revisá la conexión o los permisos y reintentá.'; loading.value = false; } });
  } catch (e) { error.value = e.message; loading.value = false; }
}
async function more() {
  if (loadingMore.value || !cursor) return;
  const token = revision;
  loadingMore.value = true;
  try {
    const page = await loadFaultEventsPage(db, activeSectors, activeOptions, cursor);
    if (token !== revision) return;
    const seen = new Set(events.value.map(event => event.id));
    events.value.push(...page.events.filter(event => !seen.has(event.id)));
    cursor = page.cursor; hasMore.value = page.hasMore; error.value = '';
  } catch { if (token === revision) error.value = 'No se pudo cargar la siguiente página. Podés reintentar.'; }
  finally { if (token === revision) loadingMore.value = false; }
}
watch([period, order, sector, category, state, rangeFrom, rangeTo, () => props.kind, () => props.refreshKey, () => JSON.stringify(userProfile.value)], reload, { immediate: true });
// Re-evaluate shift boundaries without opening a listener every minute.
const boundaryTimer = setInterval(() => {
  if (period.value !== 'range' && activeOptions && faultEventWindow(period.value).to.getTime() !== faultEventWindow(period.value, activeOptions.now).to.getTime()) reload();
}, 60000);
onUnmounted(() => { generation++; revision++; unsubscribe?.(); clearInterval(boundaryTimer); });
</script>

<template>
  <section class="fault-events">
    <header class="events-heading"><div><h2>{{ config.title }}</h2><p>Eventos del sector · orden de ingreso</p></div><button class="event-button" aria-label="Actualizar eventos" v-tippy="'Actualizar la lista sin modificar la carga'" @click="reload"><RefreshCw :size="16" /></button></header>
    <div class="events-filters">
      <label v-if="availableSectors.length > 1">Sector<select v-model="sector"><option value="">Todos los autorizados</option><option v-for="value in availableSectors" :key="value">{{ value }}</option></select></label>
      <label>Período<select v-model="period"><option value="shift">Turno actual</option><option value="today">Hoy</option><option value="week">Últimos 7 días</option><option value="older">Pendientes anteriores</option><option value="range">Rango de fechas</option></select></label>
      <template v-if="period === 'range'"><label>Desde<PlantDatePicker v-model="rangeFrom" label="Fecha desde" /></label><label>Hasta<PlantDatePicker v-model="rangeTo" label="Fecha hasta" /></label></template>
      <label>Categoría<select v-model="category"><option value="">Todas</option><option v-for="option in config.categories" :key="option.value" :value="option.value">{{ option.label }}</option><option value="other">Otras / sin categoría</option></select></label>
      <label>Estado<select v-model="state"><option value="">Todos</option><option v-for="option in config.states" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
      <label>Orden<select v-model="order"><option value="asc">Más antiguos primero</option><option value="desc">Más recientes primero</option></select></label>
      <label class="events-search">Buscar<input v-model="search" type="search" placeholder="Buscar en eventos cargados" /></label>
    </div>
    <p v-if="error" class="events-error" role="alert">{{ error }} <button class="event-button" @click="reload">Reintentar</button></p>
    <div class="events-scroll">
      <table class="events-table"><thead><tr><th>Ingreso</th><th>Máquina</th><th>Categoría</th><th class="event-description">{{ kind === 'interventions' ? 'Síntoma / descripción' : 'Motivo / descripción' }}</th><th>Estado</th><th class="event-author">{{ config.author }}</th><th><span class="sr-only">Detalle</span></th></tr></thead>
        <tbody><tr v-for="event in visible" :key="event.id" :class="{ 'event-critical': event.critico }"><td class="event-date">{{ formatDate(event.createdAt) }}</td><td><strong>{{ event.numeroMaquinaDisplay }}</strong><small>{{ event.tipoMaquina }} · {{ event.sector }}</small></td><td><span class="event-category" :class="{ electric: event.tipoProblema === 'Eléctrico', quality: event.tipoProblema === 'Calidad' }">{{ event.tipoProblema || 'Sin categoría' }}</span><small v-if="kind === 'interventions'" class="event-machine-state" :class="{ stopped: event.estadoMaquina === 'PARADA' }">{{ machineStateLabel(event.estadoMaquina) }}</small><small v-if="event.critico" class="event-critical-label">Crítico</small></td><td class="event-description"><strong>{{ event.motivo }}</strong><p>{{ event.observaciones }}</p></td><td><span class="event-state" :class="eventStateClass(event.estado)">{{ stateLabel(event.estado) }}</span></td><td class="event-author">{{ event.creadoPorNombre || 'Sin identificar' }}</td><td><button class="event-button" :aria-label="config.singular + ' de máquina ' + event.numeroMaquina" v-tippy="'Ver descripción completa y foto'" @click="selected = event"><Eye :size="16" /></button></td></tr>
          <tr v-if="!visible.length"><td colspan="7" class="events-empty">{{ loading ? 'Cargando eventos…' : error ? 'La lista no está disponible.' : events.length ? 'Sin coincidencias en los eventos cargados. Cargá más o ajustá los filtros.' : 'No hay eventos para este período.' }}</td></tr>
        </tbody>
      </table>
      <div class="event-cards" :aria-label="config.title + ' por orden de ingreso'">
        <article v-for="event in visible" :key="event.id" class="event-card" :class="{ 'is-critical': event.critico }">
          <header><div><strong>Máquina {{ event.numeroMaquinaDisplay }}</strong><small>{{ event.tipoMaquina }} · {{ event.sector }}</small></div><time>{{ formatDate(event.createdAt) }}</time></header>
          <div class="event-card-badges"><span class="event-category" :class="{ electric: event.tipoProblema === 'Eléctrico', quality: event.tipoProblema === 'Calidad' }">{{ event.tipoProblema || 'Sin categoría' }}</span><span class="event-state" :class="eventStateClass(event.estado)">{{ stateLabel(event.estado) }}</span><span v-if="event.critico" class="event-critical-label">Crítico</span></div>
          <p v-if="kind === 'interventions'" class="event-machine-state" :class="{ stopped: event.estadoMaquina === 'PARADA' }">{{ machineStateLabel(event.estadoMaquina) }}<span v-if="event.asignadoNombre"> · {{ event.asignadoNombre }}</span></p><h3>{{ event.motivo }}</h3><p class="event-card-description">{{ event.observaciones }}</p>
          <footer><span>{{ event.creadoPorNombre || 'Sin identificar' }}</span><button class="event-button" :aria-label="config.singular + ' de máquina ' + event.numeroMaquina" v-tippy="'Ver descripción completa y foto'" @click="selected = event"><Eye :size="16" />Detalle</button></footer>
        </article>
        <p v-if="!visible.length" class="events-empty">{{ loading ? 'Cargando eventos…' : error ? 'La lista no está disponible.' : events.length ? 'Sin coincidencias en los eventos cargados. Cargá más o ajustá los filtros.' : 'No hay eventos para este período.' }}</p>
      </div>
    </div>
    <footer class="events-footer"><span>{{ visible.length }} visibles / {{ events.length }} cargados · {{ category === 'other' ? 'otras categorías y búsqueda sobre filas cargadas' : 'búsqueda sobre filas cargadas' }}</span><button v-if="hasMore" class="event-button" :disabled="loadingMore" @click="more"><ChevronDown :size="16" />{{ loadingMore ? 'Cargando…' : 'Cargar más' }}</button></footer>
    <Teleport to="body"><div v-if="selected" class="event-modal-overlay" @click.self="selected = null" @keydown.esc="selected = null"><section ref="modal" class="event-modal" @keydown="modalKeydown" role="dialog" aria-modal="true" :aria-label="'Detalle de ' + config.singular.toLowerCase()" tabindex="-1"><header><div><h2>{{ config.singular }} · Máquina {{ selected.numeroMaquina }}</h2><p>{{ formatDate(selected.createdAt) }} · {{ selected.tipoProblema }} · {{ stateLabel(selected.estado) }}</p></div><button class="event-button" aria-label="Cerrar detalle" v-tippy="'Cerrar detalle'" @click="selected = null"><X :size="18" /></button></header><div class="event-modal-body"><p v-if="selected.critico" class="event-critical-label">Prioridad crítica</p><h3>{{ selected.motivo }}</h3><p class="event-full-description">{{ selected.observaciones }}</p><dl><dt>{{ config.author }}</dt><dd>{{ selected.creadoPorNombre }}</dd><dt>Sector</dt><dd>{{ selected.sector }}</dd><template v-if="kind === 'interventions'"><dt>Estado de máquina</dt><dd>{{ machineStateLabel(selected.estadoMaquina) }}</dd><dt>Asignado a</dt><dd>{{ selected.asignadoNombre || 'Sin asignar' }}</dd><dt>Grupo / GM</dt><dd>{{ selected.grupoTelar || '—' }} / {{ selected.gmTelar || '—' }}</dd></template><dt v-if="kind === 'faults'">Punto de control</dt><dd v-if="kind === 'faults'">{{ [selected.seccion, selected.grupo, selected.denominacion].filter(Boolean).join(' · ') || 'No informado' }}</dd></dl><img v-if="selected.fotoUrl" :src="selected.fotoUrl" alt="Foto adjunta al evento" loading="lazy" /></div><footer><button class="event-button" @click="selected = null">Cerrar</button></footer></section></div></Teleport>
  </section>
</template>

<style scoped>
.fault-events { display:flex; flex-direction:column; min-width:0; min-height:0; background:white; border:1px solid #dce3ec; border-radius:8px; overflow:hidden; }
.events-heading { display:flex; justify-content:space-between; align-items:center; padding:12px 14px; gap:12px; }
.events-heading h2,.event-modal h2 { font-size:17px; color:#0f172a; font-weight:600; }
.events-heading p,.event-modal header p { color:#64748b; font-size:12px; }
.event-button { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:34px; padding:6px 10px; border:1px solid #dce3ec; border-radius:6px; background:white; color:#475569; font-size:12px; cursor:pointer; white-space:nowrap; }
.event-button:hover { background:#f1f5f9; } .event-button:disabled { opacity:.5; cursor:default; }
.event-button:focus-visible,select:focus-visible,input:focus-visible { outline:2px solid #6366f1; outline-offset:2px; }
.events-filters { display:flex; flex-wrap:wrap; gap:8px; padding:0 14px 12px; }
.events-filters label { display:flex; flex-direction:column; gap:4px; color:#64748b; font-size:11px; flex:1; min-width:120px; }
.events-filters select,.events-filters input { width:100%; height:34px; border:1px solid #dce3ec; border-radius:6px; padding:5px 8px; font-size:12px; color:#334155; background:#fff; }
.events-filters .events-search { flex:2; min-width:180px; }
.events-scroll { flex:1; min-height:0; overflow:auto; border-top:1px solid #e2e8f0; }
.events-table { width:100%; border-collapse:separate; border-spacing:0; font-size:12px; }
.events-table th { position:sticky; top:0; z-index:1; padding:10px 8px; text-align:left; background:#f8fafc; border-bottom:1px solid #dce3ec; font-weight:600; color:#475569; white-space:nowrap; }
.events-table td { padding:10px 8px; border-bottom:1px solid #edf1f6; color:#334155; vertical-align:top; }
.events-table tr:hover td { background:#f8fafc; } .events-table strong { font-weight:550; }
.events-table small { display:block; font-size:10px; color:#64748b; margin-top:4px; }
.event-date { white-space:nowrap; font-variant-numeric:tabular-nums; }
.event-description { width:40%; min-width:140px; } .event-description p { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; margin-top:3px; overflow-wrap:anywhere; }
.event-category,.event-state { display:inline-block; padding:3px 6px; border-radius:4px; background:#f1f5f9; color:#475569; font-size:11px; white-space:nowrap; }
.event-category.quality { background:#fef2f2; color:#b91c1c; }
.event-machine-state { margin:4px 0; font-size:11px; color:#64748b; } .event-machine-state.stopped { color:#b91c1c; font-weight:600; }
.event-category.electric { background:#fffbeb; color:#92400e; } .event-state.pendiente { background:#fff7ed; color:#9a3412; } .event-state.resuelto { background:#ecfdf5; color:#047857; }
.event-state.en-proceso { background:#eef2ff; color:#4338ca; }
.event-critical td:first-child { border-left:3px solid #dc2626; } .event-critical-label,.events-table small.event-critical-label { color:#b91c1c; font-weight:600; }
.events-footer { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; padding:8px 12px; font-size:11px; color:#64748b; border-top:1px solid #e2e8f0; }
.events-empty { text-align:center; padding:32px 12px !important; color:#64748b !important; }
.event-cards { display:none; }
.event-card { padding:12px; border:1px solid #dce3ec; border-radius:7px; background:white; font-size:12px; color:#334155; }
.event-card.is-critical { border-left:3px solid #dc2626; }
.event-card header { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
.event-card strong,.event-card h3 { font-weight:600; }
.event-card small { display:block; margin-top:3px; font-size:10px; color:#64748b; }
.event-card time { white-space:nowrap; font-size:11px; color:#64748b; font-variant-numeric:tabular-nums; }
.event-card-badges { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:9px 0; }
.event-card-description { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; margin-top:4px; }
.event-card footer { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:10px; }
.event-card footer > span { min-width:0; color:#64748b; font-size:11px; overflow-wrap:anywhere; }
@media(min-width:768px) and (max-width:980px) {
  .events-table { display:none; }
  .event-cards { display:grid; grid-template-columns:minmax(0,1fr); gap:10px; padding:10px; background:#f8fafc; }
  .events-heading { padding:10px; }
  .events-heading h2 { font-size:15px; }
  .events-filters { padding:0 10px 10px; gap:6px; }
}
.events-error { padding:10px 14px; color:#b91c1c; font-size:12px; }
.event-modal-overlay { position:fixed; inset:0; z-index:110; background:#0f172a66; display:flex; align-items:center; justify-content:center; padding:20px; }
.event-modal { display:flex; flex-direction:column; width:min(680px,100%); max-height:90dvh; border-radius:10px; background:white; box-shadow:0 20px 60px #0f172a33; overflow:hidden; }
.event-modal header { display:flex; justify-content:space-between; gap:12px; padding:16px; border-bottom:1px solid #e2e8f0; }
.event-modal-body { min-height:0; overflow:auto; padding:16px; font-size:13px; color:#334155; }
.event-full-description { white-space:pre-wrap; overflow-wrap:anywhere; margin:12px 0; }
.event-modal dl { display:grid; grid-template-columns:130px 1fr; gap:8px; margin:16px 0; } .event-modal dt { color:#64748b; }
.event-modal img { width:100%; max-height:400px; object-fit:contain; border-radius:6px; }
.event-modal footer { padding:12px 16px; border-top:1px solid #e2e8f0; text-align:right; }
@media(max-width:1250px) { .event-author { display:none; } .events-table th,.events-table td { padding:8px 6px; } }
</style>
