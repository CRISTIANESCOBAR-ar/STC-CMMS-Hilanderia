<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { Search, Plus, Trash2, FileDown, RefreshCw, Pencil, X, Star, ChevronUp, ChevronDown, LayoutGrid, Table2 } from 'lucide-vue-next';
import { userRole } from '../services/authService';
import { loadSymptoms, saveSymptom, deleteSymptom, reorderSymptoms, symptomFields } from '../services/sintomasService';
import { vTippy } from '../utils/tooltipDirective';
import { saveAs } from 'file-saver';
import Swal from 'sweetalert2';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/themes/light-border.css';
const types = { TEJEDURIA:['TELAR'], HILANDERIA:['CARDA','OPEN-END','PASADOR','APERTURA'] };
const categories = ['TRAMA','URDIMBRE','VISUAL','MECANICO','ELECTRICO','PROCESO'];
const destinations = ['MECANICO','ELECTRICO','AMBOS','TEJEDOR','CALIDAD'];
const labels = { MECANICO:'Mecánico', ELECTRICO:'Eléctrico', AMBOS:'Ambos', TEJEDOR:'Tejedor', CALIDAD:'Calidad', TEJEDURIA:'Tejeduría', HILANDERIA:'Hilandería', TRAMA:'Trama', URDIMBRE:'Urdimbre', VISUAL:'Visual', PROCESO:'Proceso' };
const label = value => labels[value] || value || '—';
const sector = ref('TEJEDURIA'), type = ref('TELAR'), search = ref(''), category = ref(''), destination = ref(''), status = ref(''), cards = ref(false);
const rows = ref([]), loading = ref(false), error = ref(''), busy = ref(false), exporting = ref(false);
const editing = ref(false), baseline = ref(null), draft = ref({}), modal = ref(null), formError = ref('');
const admin = computed(() => userRole.value === 'admin');
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const visible = computed(() => rows.value.filter(row => (!category.value || row.categoria === category.value) && (!destination.value || row.derivaA === destination.value) && (!status.value || Boolean(row.activo) === (status.value === 'active')) && (!search.value.trim() || normalize([row.nombre,row.descripcion,label(row.categoria),label(row.derivaA)].join(' ')).includes(normalize(search.value.trim())))));
const filtered = computed(() => Boolean(search.value.trim() || category.value || destination.value || status.value));
const dirty = computed(() => editing.value && symptomFields.some(field => JSON.stringify(draft.value[field] ?? null) !== JSON.stringify(initial[field] ?? null)));
let generation = 0, initial = {}, previousFocus;
async function reload() {
  const token = ++generation; loading.value = true; error.value = ''; rows.value = [];
  try { const result = await loadSymptoms(sector.value, type.value); if (token === generation) rows.value = result; }
  catch (failure) { if (token === generation) error.value = failure.message || 'No se pudieron cargar los síntomas.'; }
  finally { if (token === generation) loading.value = false; }
}
function changeSector() { type.value = types[sector.value][0]; search.value = ''; category.value = ''; destination.value = ''; status.value = ''; }
watch([sector, type], reload, { immediate:true });
function openEditor(row = null) {
  if (!admin.value || busy.value) return;
  previousFocus = globalThis.document?.activeElement;
  baseline.value = row ? { ...row } : null;
  draft.value = row ? Object.fromEntries(symptomFields.map(field => [field, row[field] ?? (['activo','destacado'].includes(field) ? false : '')])) : { nombre:'', descripcion:'', categoria:'TRAMA', derivaA:'MECANICO', destacado:false, activo:true };
  initial = { ...draft.value }; formError.value = ''; editing.value = true;
  nextTick(() => modal.value?.querySelector('input')?.focus());
}
async function closeEditor() {
  if (busy.value) return false;
  if (dirty.value && !(await Swal.fire({ title:'¿Descartar los cambios?', text:'Los cambios del formulario todavía no se guardaron.', icon:'warning', showCancelButton:true, confirmButtonText:'Descartar', cancelButtonText:'Seguir editando' })).isConfirmed) return false;
  editing.value = false; nextTick(() => previousFocus?.isConnected && previousFocus.focus()); return true;
}
async function save() {
  if (busy.value || !admin.value) return;
  if (!draft.value.nombre.trim() || !categories.includes(draft.value.categoria) || !destinations.includes(draft.value.derivaA)) { formError.value = 'Completá el nombre, la categoría y la derivación.'; return; }
  const slug = normalize(draft.value.nombre).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  if (!baseline.value && !slug) { formError.value = 'El nombre debe incluir letras o números.'; return; }
  const id = baseline.value?.id || `${sector.value.toLowerCase()}_${type.value.toLowerCase().replace(/[^a-z0-9]/g,'')}_${slug}`;
  busy.value = true; formError.value = '';
  try { await saveSymptom(id, { ...draft.value, sector:sector.value, tipoMaquina:type.value, orden:Math.max(0,...rows.value.map(row => Number(row.orden) || 0)) + 1 }, baseline.value); editing.value = false; nextTick(() => previousFocus?.isConnected && previousFocus.focus()); await reload(); }
  catch (failure) { formError.value = failure.message; }
  finally { busy.value = false; }
}
async function remove(row) {
  if (busy.value || !admin.value) return;
  busy.value = true;
  try {
    const answer = await Swal.fire({ title:'¿Eliminar síntoma?', text:`${row.nombre}. Para conservarlo sin ofrecerlo en la carga, podés desactivarlo desde Editar.`, icon:'warning', showCancelButton:true, confirmButtonText:'Eliminar', cancelButtonText:'Cancelar', confirmButtonColor:'#dc2626' });
    if (answer.isConfirmed) { await deleteSymptom(row); await reload(); }
  } catch (failure) { error.value = failure.message; }
  finally { busy.value = false; }
}
async function move(row, direction) {
  if (busy.value || loading.value || filtered.value || !admin.value) return;
  const list = [...rows.value], index = list.findIndex(item => item.id === row.id), target = index + direction;
  if (target < 0 || target >= list.length) return;
  [list[index],list[target]] = [list[target],list[index]]; busy.value = true;
  try { await reorderSymptoms(list); rows.value = list.map((item,index) => ({ ...item, orden:index+1 })); } catch (failure) { error.value = failure.message; } finally { busy.value = false; }
}
async function exportExcel() {
  if (exporting.value || loading.value || !visible.value.length) return;
  exporting.value = true;
  const records = visible.value.map(row => ({ ...row })), filename = `Sintomas_${sector.value}_${type.value}.xlsx`;
  try {
    const { default:ExcelJS } = await import('exceljs'); const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Síntomas');
    sheet.columns = ['id','nombre','categoria','derivaA','descripcion','destacado','activo','orden','sector','tipoMaquina'].map((key,index) => ({ key, header:['ID','Nombre','Categoría','Deriva a','Descripción','Destacado','Activo','Orden','Sector','Tipo de máquina'][index], width:[40,30,16,16,55,12,12,8,16,18][index] }));
    records.forEach(row => sheet.addRow({ ...row, activo:row.activo ? 'Sí':'No', destacado:row.destacado ? 'Sí':'No' }));
    sheet.views = [{ state:'frozen', ySplit:1 }]; sheet.autoFilter = 'A1:J1'; sheet.getRow(1).font = { bold:true }; sheet.eachRow(row => { row.alignment = { vertical:'top', wrapText:true }; });
    saveAs(new Blob([await workbook.xlsx.writeBuffer()]), filename);
  } catch (failure) { error.value = `No se pudo exportar: ${failure.message}`; } finally { exporting.value = false; }
}
function keyboard(event) {
  if (event.key === 'Escape') { event.stopPropagation(); closeEditor(); }
  if (event.key !== 'Tab') return;
  const nodes = [...(modal.value?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') || [])].filter(node => node.getClientRects().length);
  const active = globalThis.document?.activeElement, first = nodes[0], last = nodes.at(-1);
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && (active === first || !nodes.includes(active))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (active === last || !nodes.includes(active))) { event.preventDefault(); first.focus(); }
}
function beforeUnload(event) { if (dirty.value || busy.value) { event.preventDefault(); event.returnValue = ''; } }
globalThis.window?.addEventListener('beforeunload', beforeUnload);
onUnmounted(() => { generation++; globalThis.window?.removeEventListener('beforeunload', beforeUnload); });
onBeforeRouteLeave(async () => busy.value ? false : !editing.value || await closeEditor());
</script>

<template>
  <section class="symptoms" :inert="editing || undefined">
    <header class="page-header"><div><h1>Catálogo de síntomas</h1><p>Términos utilizados al reportar fallas · {{ rows.length }} registros</p></div><div class="header-actions">
      <button class="btn" :disabled="busy || loading" @click="reload"><RefreshCw :class="{ spinning:loading }" />Actualizar</button>
      <button class="btn" v-tippy="'Exportar los síntomas que coinciden con los filtros'" :disabled="exporting || loading || !visible.length" @click="exportExcel"><FileDown />{{ exporting ? 'Exportando…':'Exportar' }}</button>
      <button v-if="admin" class="btn primary" :disabled="busy || loading" @click="openEditor()"><Plus />Nuevo síntoma</button>
    </div></header>
    <div class="toolbar"><label>Sector<select v-model="sector" :disabled="busy" @change="changeSector"><option v-for="(_,key) in types" :key="key" :value="key">{{ label(key) }}</option></select></label><label>Máquina<select v-model="type" :disabled="busy"><option v-for="item in types[sector]" :key="item">{{ item }}</option></select></label>
      <div class="search"><Search /><input v-model="search" aria-label="Buscar síntomas" placeholder="Buscar nombre o descripción…" /></div>
      <label>Categoría<select v-model="category"><option value="">Todas</option><option v-for="item in categories" :key="item" :value="item">{{ label(item) }}</option></select></label>
      <label>Derivación<select v-model="destination"><option value="">Todas</option><option v-for="item in destinations" :key="item" :value="item">{{ label(item) }}</option></select></label>
      <label>Estado<select v-model="status"><option value="">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select></label>
      <div class="view-switch"><button v-tippy="'Vista de tabla'" aria-label="Vista de tabla" :aria-pressed="!cards" :class="{ chosen:!cards }" @click="cards=false"><Table2 /></button><button v-tippy="'Vista de tarjetas'" aria-label="Vista de tarjetas" :aria-pressed="cards" :class="{ chosen:cards }" @click="cards=true"><LayoutGrid /></button></div>
    </div>
    <div v-if="error" class="error" role="alert">{{ error }} <button :disabled="busy" @click="reload">Reintentar</button></div>
    <div class="data-panel" :aria-busy="loading || busy">
      <p v-if="loading" class="empty" role="status">Cargando síntomas…</p>
      <p v-else-if="!visible.length" class="empty">{{ error ? 'No se pudo completar la carga.':'No hay síntomas que coincidan con los filtros.' }}</p>
      <div v-else class="data-scroll" :class="{ 'card-view':cards }">
        <table v-if="!cards"><colgroup><col class="order-col" /><col class="name-col" /><col class="description-col" /><col class="category-col" /><col class="destination-col" /><col class="state-col" /><col class="actions-col" /></colgroup><thead><tr><th>Orden</th><th>Síntoma</th><th>Descripción</th><th>Categoría</th><th>Deriva a</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
          <tr v-for="(row,index) in visible" :key="row.id" :class="{ inactive:!row.activo }"><td><div class="order"><span>{{ row.orden ?? index+1 }}</span><div v-if="admin && !filtered"><button v-tippy="'Subir en el orden de carga'" aria-label="Subir síntoma" :disabled="busy || index===0" @click="move(row,-1)"><ChevronUp /></button><button v-tippy="'Bajar en el orden de carga'" aria-label="Bajar síntoma" :disabled="busy || index===visible.length-1" @click="move(row,1)"><ChevronDown /></button></div></div></td>
          <td class="name"><Star v-if="row.destacado" v-tippy="'Síntoma destacado'" class="star" />{{ row.nombre }}</td><td class="description">{{ row.descripcion || '—' }}</td><td><span class="badge">{{ label(row.categoria) }}</span></td><td><span class="badge" :class="String(row.derivaA || '').toLowerCase()">{{ label(row.derivaA) }}</span></td><td><span class="state" :class="{ active:row.activo }">{{ row.activo ? 'Activo':'Inactivo' }}</span></td><td><div class="row-actions"><button v-if="admin" v-tippy="'Editar síntoma'" class="icon-btn" aria-label="Editar síntoma" :disabled="busy" @click="openEditor(row)"><Pencil /></button><button v-if="admin" v-tippy="'Eliminar síntoma'" class="icon-btn danger" aria-label="Eliminar síntoma" :disabled="busy" @click="remove(row)"><Trash2 /></button></div></td></tr>
        </tbody></table>
        <div v-else class="cards"><article v-for="(row,index) in visible" :key="row.id" :class="{ inactive:!row.activo }"><div class="card-top"><span>{{ row.orden ?? index+1 }} · {{ label(row.categoria) }}</span><span class="state" :class="{ active:row.activo }">{{ row.activo ? 'Activo':'Inactivo' }}</span></div><h2><Star v-if="row.destacado" class="star" />{{ row.nombre }}</h2><p>{{ row.descripcion || 'Sin descripción' }}</p><footer><span class="badge" :class="String(row.derivaA || '').toLowerCase()">{{ label(row.derivaA) }}</span><div class="row-actions"><template v-if="admin && !filtered"><button class="icon-btn" v-tippy="'Subir síntoma'" aria-label="Subir síntoma" :disabled="busy || index===0" @click="move(row,-1)"><ChevronUp /></button><button class="icon-btn" v-tippy="'Bajar síntoma'" aria-label="Bajar síntoma" :disabled="busy || index===visible.length-1" @click="move(row,1)"><ChevronDown /></button></template><button v-if="admin" class="icon-btn" v-tippy="'Editar síntoma'" aria-label="Editar síntoma" :disabled="busy" @click="openEditor(row)"><Pencil /></button><button v-if="admin" class="icon-btn danger" v-tippy="'Eliminar síntoma'" aria-label="Eliminar síntoma" :disabled="busy" @click="remove(row)"><Trash2 /></button></div></footer></article></div>
      </div>
      <footer class="panel-footer"><span>{{ visible.length }} de {{ rows.length }} síntomas</span><span>{{ busy ? 'Guardando…':filtered ? 'Quitá los filtros para cambiar el orden de carga.':'El orden se utiliza al seleccionar síntomas en la carga.' }}</span></footer>
    </div>
  </section>
  <Teleport to="body"><div v-if="editing" class="modal-backdrop" @click.self="closeEditor"><form ref="modal" class="symptom-modal" role="dialog" aria-modal="true" aria-labelledby="symptom-title" tabindex="-1" @keydown="keyboard" @submit.prevent="save"><header><div><h2 id="symptom-title">{{ baseline ? 'Editar síntoma':'Nuevo síntoma' }}</h2><p>{{ label(sector) }} · {{ type }}</p></div><button type="button" class="icon-btn" v-tippy="'Cerrar'" aria-label="Cerrar" :disabled="busy" @click="closeEditor"><X /></button></header><div class="modal-body"><p v-if="formError" class="error" role="alert">{{ formError }}</p><fieldset :disabled="busy"><label>Nombre del síntoma<input v-model="draft.nombre" required autocomplete="off" /></label><div class="form-columns"><label>Categoría<select v-model="draft.categoria" required><option value="" disabled>Seleccionar</option><option v-for="item in categories" :key="item" :value="item">{{ label(item) }}</option></select></label><label>Deriva a<select v-model="draft.derivaA" required><option value="" disabled>Seleccionar</option><option v-for="item in destinations" :key="item" :value="item">{{ label(item) }}</option></select></label></div><label>Descripción<textarea v-model="draft.descripcion" rows="5" placeholder="Información para identificar el problema…" /></label><div class="checks"><label><input v-model="draft.activo" type="checkbox" />Activo en la carga</label><label><input v-model="draft.destacado" type="checkbox" />Destacado</label></div></fieldset><p class="hint">{{ baseline ? 'Se conserva el identificador y su relación con los registros existentes.':'Se agregará al final del orden de carga.' }}</p></div><footer><button type="button" class="btn" :disabled="busy" @click="closeEditor">Cancelar</button><button class="btn primary" type="submit" :disabled="busy">{{ busy ? 'Guardando…':'Guardar cambios' }}</button></footer></form></div></Teleport>
</template>

<style scoped>
.symptoms{height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;padding:14px 16px;color:#334155;font-size:13px}.page-header,.header-actions,.toolbar,.row-actions,.card-top,.cards footer,.panel-footer{display:flex;align-items:center;gap:8px}.page-header{justify-content:space-between;flex-wrap:wrap}.page-header h1{font-size:19px;font-weight:700;color:#1e293b}.page-header p,.symptom-modal header p{font-size:12px;color:#64748b;margin-top:3px}.btn,.icon-btn,.view-switch button,.order button{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #cbd5e1;background:white;border-radius:5px;min-height:34px;padding:0 10px;font-weight:600;color:#475569}.btn:hover,.icon-btn:hover,.view-switch button:hover{background:#f1f5f9}.btn svg,.icon-btn svg,.view-switch svg{width:16px;height:16px}.primary{background:#2563eb;border-color:#2563eb;color:white}.primary:hover{background:#1d4ed8}.icon-btn{width:30px;min-height:30px;padding:0;border-color:transparent}.danger:hover{color:#dc2626;background:#fef2f2}button:disabled{opacity:.4;cursor:not-allowed}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}.toolbar{flex-wrap:wrap;border:1px solid #e2e8f0;padding:9px;background:white;border-radius:7px}.toolbar label{display:flex;align-items:center;gap:5px;font-size:11px;color:#64748b}.toolbar select,.search input,.symptom-modal input:not([type=checkbox]),.symptom-modal select,.symptom-modal textarea{border:1px solid #cbd5e1;border-radius:5px;background:white;padding:7px 9px;font-size:13px;color:#334155;min-width:0}.search{position:relative;flex:1;min-width:190px}.search svg{position:absolute;left:9px;top:9px;width:16px;height:16px;color:#94a3b8}.search input{width:100%;padding-left:31px}.view-switch{display:flex;margin-left:auto}.view-switch button{padding:0 8px;border-radius:4px}.view-switch .chosen{background:#eff6ff;color:#2563eb;border-color:#93c5fd}.data-panel{flex:1;min-height:0;display:flex;flex-direction:column;background:white;border:1px solid #e2e8f0;border-radius:7px;overflow:hidden}.data-scroll{flex:1;min-height:0;overflow:auto}table{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0}th{position:sticky;top:0;z-index:1;background:#f1f5f9;color:#475569;font-size:11px;font-weight:700;text-align:left;border-bottom:1px solid #cbd5e1}th,td{padding:10px 12px}td{border-bottom:1px solid #eef2f6;vertical-align:middle;overflow-wrap:anywhere}tbody tr:nth-child(even){background:#fafbfd}tbody tr:hover{background:#eff6ff}.order-col{width:76px}.name-col{width:25%}.category-col,.destination-col{width:108px}.state-col{width:82px}.actions-col{width:82px}.name{font-weight:600;color:#1e293b}.description{color:#64748b;line-height:1.5}.star{display:inline-block;width:14px;height:14px;color:#d97706;fill:#fef3c7;vertical-align:middle;margin-right:5px}.badge{display:inline-block;background:#f1f5f9;color:#475569;padding:3px 7px;border-radius:4px;font-size:11px}.mecanico{background:#eff6ff;color:#1d4ed8}.electrico{background:#fffbeb;color:#92400e}.calidad{background:#fef2f2;color:#b91c1c}.ambos{background:#f5f3ff;color:#6d28d9}.tejedor{background:#ecfdf5;color:#047857}.state{font-size:11px;color:#64748b;white-space:nowrap}.state:before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:#94a3b8;margin-right:5px}.state.active{color:#047857}.state.active:before{background:#10b981}.inactive .name{color:#64748b}.order{display:flex;align-items:center;gap:7px}.order button{min-height:18px;padding:0;border:0;display:flex;color:#64748b;background:transparent}.order svg{width:14px;height:14px}.panel-footer{justify-content:space-between;flex-wrap:wrap;padding:8px 12px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:11px;color:#64748b}.empty{padding:50px 16px;text-align:center;color:#64748b;flex:1}.error{padding:9px 12px;background:#fef2f2;color:#b91c1c;border-radius:5px}.error button{text-decoration:underline;margin-left:8px}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;padding:12px}.cards article{border:1px solid #e2e8f0;border-radius:6px;padding:12px}.card-top,.cards footer{justify-content:space-between}.card-top{font-size:11px;color:#64748b}.cards h2{font-size:14px;font-weight:600;margin:10px 0 6px}.cards p{color:#64748b;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap}.cards footer{margin-top:12px}.modal-backdrop{position:fixed;inset:0;z-index:100;background:rgba(15,23,42,.4);display:flex;align-items:center;justify-content:center;padding:16px}.symptom-modal{background:white;width:min(640px,100%);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;border-radius:9px;box-shadow:0 20px 60px #0f172a33;color:#334155}.symptom-modal header,.symptom-modal footer{padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid #e2e8f0}.symptom-modal h2{font-size:17px;font-weight:700}.modal-body{overflow:auto;padding:18px;min-height:0}.symptom-modal fieldset{border:0;display:flex;flex-direction:column;gap:15px}.symptom-modal label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:600}.form-columns{display:grid;grid-template-columns:1fr 1fr;gap:14px}.symptom-modal textarea{resize:vertical;min-height:110px}.checks{display:flex;gap:20px;flex-wrap:wrap}.checks label{flex-direction:row;align-items:center}.hint{color:#64748b;font-size:11px;margin-top:15px}.symptom-modal footer{justify-content:flex-end;border-top:1px solid #e2e8f0;border-bottom:0}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:1100px){th,td{padding:8px}.order-col{width:60px}.category-col,.destination-col{width:88px}.state-col{width:70px}.actions-col{width:72px}.toolbar label{font-size:10px}.toolbar select{max-width:130px}.symptoms{padding:10px;gap:8px}}@media(max-width:767px){.symptoms{height:auto;min-height:100%;padding:10px}.data-panel{flex:none;min-height:300px}.data-scroll{max-height:65vh}table{min-width:660px}.header-actions{flex-wrap:wrap}.page-header h1{font-size:17px}.toolbar{gap:7px}.toolbar label{flex:1}.search{flex-basis:100%;order:1}.toolbar select{max-width:none;width:100%}.panel-footer span:last-child{display:none}.cards{grid-template-columns:1fr}.form-columns{grid-template-columns:1fr}.modal-backdrop{padding:10px}.symptom-modal{max-height:calc(100dvh - 20px)}}
</style>
