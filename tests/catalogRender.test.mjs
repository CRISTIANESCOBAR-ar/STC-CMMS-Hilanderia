import { vTippy } from '../src/utils/tooltipDirective.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import * as icons from 'lucide-vue-next';
import { catalogColumnLayout } from '../src/utils/catalogColumnLayout.js';
import { createLatestLoad } from '../src/utils/latestLoad.js';
import { eventView, filterFaultEvents, faultEventWindow } from '../src/utils/faultEvents.js';
import { canExecuteIntervention } from '../src/utils/interventionAccess.js';
import { formatSummary } from '../src/utils/formatSummary.js';
import { plantDate, addDays, PLANT_TIME_ZONE } from '../src/utils/plantTime.js';

function evaluate(code, dependencies) {
  code = code.replace(/^import\s+['"][^'"]+['"];?\s*/gm, '');
  code = code.replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm, (_, bindings, source) => {
    if (bindings.startsWith('{')) {
      const fields = bindings.slice(1, -1).replace(/\bas\b/g, ':');
      return `const {${fields}} = dependencies[${JSON.stringify(source)}];`;
    }
    return `const ${bindings} = dependencies[${JSON.stringify(source)}];`;
  }).replace(/^import\s+['"][^'"]+['"];?\s*/gm, '');
  return new Function('dependencies', code.replace('export default', 'return').replace('export function render', 'return function render'))(dependencies);
}

// The in-memory renderer supplies the DOM types used by Vue v-model focus checks.
globalThis.Document ??= class Document {};
globalThis.ShadowRoot ??= class ShadowRoot {};

function host({ missingDesktopPortal = false } = {}) {
  const node = (type, text = '') => ({ type, text, children: [], parent: null,
    tagName: type.toUpperCase(), options: [], addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, contains() { return false; }, getRootNode() { return { activeElement: null }; }, setAttribute() {}, removeAttribute() {}, getAttribute() { return null; } });
  const body = node('body');
  const insert = (child, parent, anchor) => {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
  };
  const renderer = Vue.createRenderer({
    insert, remove(child) { child.parent?.children.splice(child.parent.children.indexOf(child), 1); child.parent = null; },
    createElement: node, createText: text => node('text', text), createComment: text => node('comment', text),
    setText: (child, text) => { child.text = text; },
    setElementText: (child, text) => { child.text = text; child.children = []; },
    parentNode: child => child.parent,
    nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] || null,
    patchProp() {}, querySelector: selector => missingDesktopPortal && selector === '#navbar-actions' ? null : body,
    insertStaticContent(text, parent, anchor) { const child = node('static', text); insert(child, parent, anchor); return [child, child]; },
  });
  return { renderer, root: node('root'), body };
}

test('history uses bounded pages, ignores stale responses, opens detail and generates safe AI only on demand', async () => {
  const { descriptor } = parse(fs.readFileSync(new URL('../src/components/HistoricoNovedades.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id:'history-test' });
  const template = compileTemplate({ id:'history-test', source:descriptor.template.content, compilerOptions:{ bindingMetadata:script.bindings } });
  assert.deepEqual(template.errors, []);
  const requests = [], aiRequests = [], writes = [], downloads = [];
  const profile = Vue.ref({ role:'admin' });
  let finishAI, failState = true;
  const records = [
    { id:'first', numeroMaquina:35001, tipoMaquina:'TELAR', sector:'TEJEDURIA', tipoProblema:'Mecánico', estado:'pendiente', observaciones:'Pérdida de aceite', creadoPorNombre:'Inspector', createdAt:{ seconds:1791712800 } },
    { id:'second', numeroMaquina:35064, sector:'TEJEDURIA', tipoProblema:'Eléctrico', estado:'resuelto', observaciones:'Sensor', createdAt:{ seconds:1791712800 } },
  ];
  const dependencies = {
    vue:Vue, 'lucide-vue-next':icons, 'vue-router':{ onBeforeRouteLeave() {} }, '../firebase/config':{ db:{} }, '../services/authService':{ userProfile:profile },
    '../utils/sectorScope':{ getSectorScope:() => profile.value.role === 'admin' ? null : ['TEJEDURIA'] },
    '../utils/faultEvents':{ eventView, filterFaultEvents, faultEventWindow },
    '../utils/plantTime':{ plantDate, addDays, PLANT_TIME_ZONE }, '../utils/formatSummary':{ formatSummary }, '../utils/tooltipDirective':{ vTippy },
    './PlantDatePicker.vue':{ props:['modelValue'], render:() => Vue.h('button', 'Fecha') }, './OperationalImage.vue':{ render:() => Vue.h('img') },
    'file-saver':{ saveAs:(blob, name) => downloads.push({ blob, name }) }, sweetalert2:{ fire:async () => ({ isConfirmed:true }) },
    '../services/faultEvents':{ loadFaultEventsPage:(db, sectors, options, cursor) => new Promise(resolve => requests.push({ sectors, options, cursor, resolve })) },
    '../services/historyService':{
      collectHistoryPages:async () => [...records, { ...records[0], id:'third', numeroMaquina:165001 }],
      updateHistoryState:async (record, state) => { writes.push({ record, state }); if (failState) throw new Error('Conflict'); },
    },
    '../services/aiService':{ aiService:{ generarResumenDiario:(force, day, sectors) => { aiRequests.push({ force, day, sectors }); return new Promise(resolve => { finishAI = resolve; }); } } },
  };
  const component = evaluate(script.content, dependencies); component.render = evaluate(template.code, dependencies);
  const { renderer, root } = host(); const app = renderer.createApp(component), errors = [];
  app.config.errorHandler = error => errors.push(error); app.mount(root);
  const state = root._vnode.component.setupState;
  assert.equal(requests[0].options.period, 'week'); assert.equal(requests[0].options.order, 'desc');
  requests[0].resolve({ events:records, cursor:'page1', hasMore:true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.visible[0].numeroMaquinaDisplay, '1');
  const more = state.more();
  state.state = 'pendiente'; await Vue.nextTick();
  requests[1].resolve({ events:[{ id:'stale' }], cursor:null, hasMore:false }); await more;
  assert.deepEqual(state.events, []);
  requests[2].resolve({ events:[records[0]], cursor:'new', hasMore:true });
  await new Promise(resolve => setImmediate(resolve));
  state.search = 'perdida'; assert.equal(state.visible.length, 1);
  state.openDetail(state.visible[0]); await Vue.nextTick(); assert.equal(state.modalType, 'detail');
  state.nextState = 'resuelto'; await state.saveState();
  assert.equal(state.selected.id, 'first', 'failed state update preserves the detail');
  failState = false; const saved = state.saveState();
  await new Promise(resolve => setImmediate(resolve));
  requests.at(-1).resolve({ events:[{ ...records[0], estado:'resuelto' }], cursor:null, hasMore:false }); await saved;
  assert.equal(state.modalType, ''); assert.equal(writes.length, 2);
  state.openAi(); await Vue.nextTick(); assert.equal(aiRequests.length, 0);
  const oldAI = state.generateAi(); state.aiDate = '2026-10-01'; await Vue.nextTick();
  finishAI({ text:'Old', fromCache:false }); await oldAI; assert.equal(state.aiText, '');
  const newAI = state.generateAi(); finishAI({ text:'*Resumen* <script>alert(1)</script>', fromCache:true }); await newAI;
  assert.ok(state.aiHtml.includes('&lt;script&gt;')); assert.ok(!state.aiHtml.includes('<script>'));
  state.closeModal();
  state.state = ''; state.search = ''; await Vue.nextTick();
  requests.at(-1).resolve({ events:records, cursor:null, hasMore:false }); await new Promise(resolve => setImmediate(resolve));
  state.exportScope = 'all'; await state.exportExcel();
  assert.equal(downloads.length, 1); assert.ok(downloads[0].name.endsWith('_periodo.xlsx'));
  const { default:ExcelJS } = await import('exceljs'); const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await downloads[0].blob.arrayBuffer());
  assert.equal(workbook.worksheets[0].rowCount, 4, 'full period export includes all collected rows');
  assert.equal(workbook.worksheets[0].getRow(2).getCell(2).value, 35001, 'exports preserve full machine ID');
  profile.value = { role:'mecanico' }; await Vue.nextTick();
  assert.deepEqual(requests.at(-1).sectors, ['TEJEDURIA']);
  state.openDetail(eventView(records[0])); state.nextState = 'resuelto'; await state.saveState(); assert.equal(writes.length, 2);
  app.unmount(); assert.deepEqual(errors.map(error => error.message), []);
});

test('history service walks every page and rejects unauthorized or conflicting state writes', async () => {
  const source = fs.readFileSync(new URL('../src/services/historyService.js', import.meta.url), 'utf8');
  const profile = Vue.ref({ role:'admin' }), reads = [], writes = [];
  let serverState = 'pendiente';
  const dependencies = {
    'firebase/firestore': { doc:() => 'record', serverTimestamp:() => 'server-time', runTransaction:async (db, run) => run({ get:async () => ({ exists:() => true, data:() => ({ estado:serverState }) }), update:(ref, value) => writes.push(value) }) },
    '../firebase/config':{ db:{} }, './authService':{ userProfile:profile },
    './faultEvents':{ loadFaultEventsPage:async (db, sectors, options, cursor) => { reads.push(cursor); return cursor ? { events:[{ id:'b' }], hasMore:false, cursor:'b' } : { events:[{ id:'a' }], hasMore:true, cursor:'a' }; } },
  };
  const service = evaluate(source.replace(/export async function/g, 'async function') + '\nreturn { collectHistoryPages, updateHistoryState };', dependencies);
  assert.deepEqual((await service.collectHistoryPages(['TEJEDURIA'], {})).map(record => record.id), ['a', 'b']);
  assert.deepEqual(reads, [null, 'a']);
  await assert.rejects(service.collectHistoryPages(null, {}, () => { throw new Error('Changed'); }), /Changed/);
  await service.updateHistoryState({ id:'a', estado:'pendiente' }, 'resuelto');
  assert.deepEqual(writes, [{ estado:'resuelto', updatedAt:'server-time' }]);
  serverState = 'resuelto';
  await assert.rejects(service.updateHistoryState({ id:'a', estado:'pendiente' }, 'en proceso'), /Otro usuario/);
  profile.value = { role:'mecanico' };
  await assert.rejects(service.updateHistoryState({ id:'a', estado:'resuelto' }, 'pendiente'), /administrador/);
  assert.equal(writes.length, 1);
});

test('intervention management filters grouped requests and only takes permitted items once', async t => {
  const originalStorage = globalThis.localStorage;
  const stored = new Map();
  globalThis.localStorage = { getItem:key => stored.get(key), setItem:(key, value) => stored.set(key, value) };
  t.after(() => { if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage; });
  const { descriptor } = parse(fs.readFileSync(new URL('../src/components/IntervencionesView.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id: 'intervention-management-test' });
  const template = compileTemplate({ id: 'intervention-management-test', source: descriptor.template.content,
    compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const subscriptions = [], writes = [];
  let finishWrite;
  const dependencies = {
    vue: Vue, 'lucide-vue-next': icons, 'vue-router': { useRouter: () => ({ push() {} }) },
    'firebase/auth': { getAuth: () => ({ currentUser: { uid:'inspector', displayName:'Inspector' } }) },
    '../services/authService': { userRole:Vue.ref('inspector'), userProfile:Vue.ref({ sectoresAsignados:['TEJEDURIA'] }) },
    '../services/profileService': { getEffectivePermisosForUser: () => ({}) },
    '../utils/interventionAccess': { canExecuteIntervention }, '../utils/faultEvents': { eventView },
    '../utils/tooltipDirective': { vTippy },
    '../constants/organization': { DEFAULT_SECTOR:'TEJEDURIA', normalizeSectorValue:v => v,
      sanitizeSectorList:v => v, canDespacharIntervencion: () => true },
    './OperationalImage.vue': { render: () => Vue.h('img') },
    './IntervencionDetalle.vue': { props:['id'], render: () => Vue.h('div') },
    sweetalert2: { fire: async () => ({ isConfirmed:true }) },
    '../services/intervencionService': { intervencionService: {
      suscribirActivas: (sectors, callback, error) => { subscriptions.push({ callback, error }); return () => {}; },
      actualizarEstadoBatch: ids => { writes.push(ids); return new Promise(resolve => { finishWrite = resolve; }); },
      actualizarEstado: id => { writes.push([id]); return Promise.resolve(); },
    } },
  };
  const component = evaluate(script.content, dependencies);
  component.render = evaluate(template.code, dependencies);
  const { renderer, root } = host();
  const app = renderer.createApp(component), errors = [];
  app.config.errorHandler = error => errors.push(error);
  app.mount(root);
  const state = root._vnode.component.setupState;
  const requests = [
    { id:'quality', maquinaId:'35001', numeroMaquina:35001, tipoMaquina:'TELAR', tipoIntervencion:'CALIDAD', estado:'PENDIENTE', estadoMaquina:'PARADA', sector:'TEJEDURIA', sintomaNombre:'Pérdida', createdAt:{ seconds:Date.now()/1000 } },
    { id:'mechanic', maquinaId:'35001', numeroMaquina:35001, tipoMaquina:'TELAR', tipoIntervencion:'MECANICO', estado:'PENDIENTE', sector:'TEJEDURIA' },
    { id:'assigned', maquinaId:'35064', numeroMaquina:35064, tipoMaquina:'TELAR', tipoIntervencion:'CALIDAD', estado:'EN_PROCESO', asignadoA:'inspector', sector:'TEJEDURIA' },
  ];
  subscriptions[0].callback(requests);
  await Vue.nextTick();
  assert.equal(state.grupos[0].items.length, 2);
  assert.equal(state.numeroCorto(requests[0]), '1');
  state.abrirDetalle(requests[0]); await Vue.nextTick();
  assert.equal(state.detalleId, 'quality');
  assert.equal(subscriptions.length, 1);
  state.detalleId = null;
  state.busqueda = 'perdida';
  assert.deepEqual(state.intervencionesFiltered.map(i => i.id), ['quality']);
  state.limpiarFiltros();
  state.filtroTipo = 'CALIDAD';
  assert.equal(state.intervencionesFiltered.length, 1);
  state.presentacion = 'specialty';
  await Vue.nextTick();
  assert.equal(subscriptions.length, 1, 'switching presentation reuses the subscription');
  assert.equal(stored.get('cmms.interventions.presentation'), 'specialty');
  assert.deepEqual(state.columnasEspecialidad.map(column => [column.id, column.count]), [['MECANICO', 1], ['ELECTRICO', 0], ['CALIDAD', 1]]);
  assert.equal(state.columnasEspecialidad[0].grupos[0].items[0].id, 'mechanic');
  assert.equal(state.columnasEspecialidad[2].grupos[0].items[0].id, 'quality');
  state.presentacion = 'table';
  await Vue.nextTick();
  assert.equal(state.filtroTipo, 'CALIDAD', 'category selection survives presentation changes');
  assert.equal(state.intervencionesFiltered.length, 1);
  state.limpiarFiltros();
  const taking = state.onTomarGrupo(state.grupos[0]);
  await new Promise(resolve => setImmediate(resolve));
  await state.onTomar(requests[0]);
  assert.deepEqual(writes, [['quality']]);
  finishWrite(); await taking;
  state.filtroAsignacion = 'mine';
  assert.deepEqual(state.intervencionesFiltered.map(i => i.id), ['assigned']);
  subscriptions[0].error(new Error('Unavailable'));
  await Vue.nextTick();
  assert.equal(state.errorCarga, true);
  state.cargarIntervenciones();
  subscriptions[0].callback(requests);
  assert.equal(state.intervenciones.length, 0);
  subscriptions[1].callback(requests);
  await Vue.nextTick();
  assert.equal(state.loading, false);
  state.limpiarFiltros(); state.filtroEstado = 'TODO'; state.presentacion = 'specialty';
  subscriptions[1].callback([...requests, { id:'unknown', tipoIntervencion:'LEGACY', numeroMaquina:35002, estado:'PENDIENTE' }]);
  await Vue.nextTick();
  assert.equal(state.columnasEspecialidad.at(-1).id, 'OTHER', 'legacy categories are not silently hidden');
  state.especialidadActiva = 'OTHER';
  subscriptions[1].callback(requests);
  await Vue.nextTick();
  assert.equal(state.especialidadActiva, 'MECANICO');
  app.unmount();
  assert.deepEqual(errors.map(error => error.message), []);
});

test('intervention detail modal preserves dirty diagnosis on snapshots and failures and guards closing', async () => {
  const { descriptor } = parse(fs.readFileSync(new URL('../src/components/IntervencionDetalle.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id:'intervention-detail-test' });
  const template = compileTemplate({ id:'intervention-detail-test', source:descriptor.template.content,
    compilerOptions:{ bindingMetadata:script.bindings } });
  assert.deepEqual(template.errors, []);
  let snapshot, finish, fail, closed = 0, confirm = false, writes = 0;
  const transitions = [];
  const dependencies = {
    vue:Vue, 'lucide-vue-next':icons,
    'vue-router': { useRoute: () => ({ params:{ id:'direct-id' } }), useRouter: () => ({ push() {} }), onBeforeRouteLeave() {} },
    'firebase/auth': { getAuth: () => ({ currentUser:{ uid:'tech', displayName:'Técnico' } }) },
    'firebase/firestore': { getDoc:async () => ({ exists:() => false }), doc() {} }, '../firebase/config':{ db:{} },
    '../services/authService':{ userRole:Vue.ref('admin'), userProfile:Vue.ref({}) },
    '../services/profileService':{ getEffectivePermisosForUser: () => ({}) },
    '../utils/interventionAccess':{ canExecuteIntervention },
    '../utils/faultEvents':{ eventView, machineStateLabel:value => value }, '../utils/tooltipDirective':{ vTippy },
    '../services/catalogoService':{ catalogoService:{ obtenerPorModelo:async () => [] } },
    './OperationalImage.vue':{ render:() => Vue.h('img') }, sweetalert2:{ fire:async () => ({ isConfirmed:confirm }) },
    '../services/intervencionService':{ intervencionService:{
      suscribirPorId:(id, callback) => { assert.equal(id, 'selected-id'); snapshot = callback; return () => {}; },
      guardarDiagnostico:() => { writes++; return new Promise((resolve, reject) => { finish = resolve; fail = reject; }); },
      actualizarEstado:async (id, state) => { transitions.push([id, state]); },
    } },
  };
  const component = evaluate(script.content, dependencies);
  component.render = evaluate(template.code, dependencies);
  const { renderer, root } = host();
  const app = renderer.createApp(component, { id:'selected-id', onClose:() => closed++ }), errors = [];
  app.config.errorHandler = error => errors.push(error);
  app.mount(root);
  const state = root._vnode.component.setupState;
  const data = { id:'selected-id', numeroMaquina:35001, estado:'EN_PROCESO', asignadoA:'tech', tipoIntervencion:'MECANICO', causaRaiz:'Original', grupoTelar:'1' };
  snapshot(data); await Vue.nextTick();
  assert.equal(state.puedeEditar, true);
  state.diagnostico.causaRaiz = '';
  snapshot({ ...data, observaciones:'Actualizada' }); await Vue.nextTick();
  assert.equal(state.diagnostico.causaRaiz, '', 'empty local edits survive snapshots');
  await state.close(); assert.equal(closed, 0);
  state.diagnostico.causaRaiz = 'Corregida';
  const saving = state.guardarDiagnostico();
  await state.guardarDiagnostico(); await state.close();
  assert.equal(writes, 1); assert.equal(closed, 0);
  fail(new Error('Disconnected')); await saving;
  assert.equal(state.diagnostico.causaRaiz, 'Corregida'); assert.equal(state.dirty, true);
  const saved = state.guardarDiagnostico(); finish(); await saved;
  assert.equal(state.dirty, false);
  await state.close(); assert.equal(closed, 1);
  confirm = true;
  const completing = state.completar();
  await new Promise(resolve => setImmediate(resolve));
  await state.close(); assert.equal(closed, 1);
  finish(); await completing;
  assert.deepEqual(transitions, [['selected-id', 'COMPLETADO']]);
  assert.equal(state.dirty, false);
  snapshot({ ...data, estado:'COMPLETADO' }); await Vue.nextTick();
  assert.equal(state.puedeEditar, false);
  await state.guardarDiagnostico(); assert.equal(writes, 3);
  snapshot(null); await Vue.nextTick(); assert.equal(state.loading, false); assert.equal(state.intervencion, null);
  app.unmount(); assert.deepEqual(errors.map(error => error.message), []);
});

test('real catalog template renders loading, data and model changes for admin without Vue errors', async () => {
  const { descriptor } = parse(fs.readFileSync(new URL('../src/components/CatalogoExplorer.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id: 'catalog-render-test' });
  const template = compileTemplate({ id: 'catalog-render-test', source: descriptor.template.content,
    compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  let finish;
  const dependencies = {
    vue: Vue, 'lucide-vue-next': icons,
    '../utils/latestLoad': { createLatestLoad },
    '../services/maquinaService': { maquinaService: { obtenerMaquinasOnce: async () => [{ tipo: 'TELAR', modelo: 'M1' }, { tipo: 'TELAR', modelo: 'M2' }] } },
    '../services/catalogoService': { catalogoService: { obtenerPorModelo: () => new Promise(resolve => { finish = resolve; }) } },
    '../constants/motivos': { MOTIVOS_POR_TIPO: {}, MOTIVOS_DEFAULT: {} },
    '../services/motivosService': { getMotivosFirestore: async () => null, updateCategoriaMotivos() {} },
    '../services/authService': { userRole: Vue.ref('admin') },
    sweetalert2: { fire: async () => ({}) }, 'tippy.js': () => ({}),
  };
  const component = evaluate(script.content, dependencies);
  component.render = evaluate(template.code, dependencies);
  const { renderer, root } = host();
  const app = renderer.createApp(component);
  const errors = [];
  app.config.errorHandler = error => errors.push(error);
  app.mount(root);
  await new Promise(resolve => setImmediate(resolve));
  const state = root._vnode.component.setupState;
  state.seleccionarTipo('TELAR');
  const loading = state.seleccionarModelo('M1');
  await Vue.nextTick();
  finish([{ id: 'part1', seccion: 'Motor', grupo: '1', denominacion: 'Pieza', procedimiento: [] }]);
  await loading;
  await Vue.nextTick();
  assert.equal(state.catalogoItems.length, 1);
  const next = state.seleccionarModelo('M2');
  await Vue.nextTick();
  finish([]);
  await next;
  await Vue.nextTick();
  app.unmount();
  assert.deepEqual(errors.map(error => error.message), []);
});

test('machine view renders table, cards and empty filters without depending on desktop portal', async () => {
  const { descriptor } = parse(fs.readFileSync(new URL('../src/components/GestionMaquinas.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id: 'machine-render-test' });
  const template = compileTemplate({ id: 'machine-render-test', source: descriptor.template.content,
    compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const machineSource = fs.readFileSync(new URL('../src/composables/useMaquinasList.js', import.meta.url), 'utf8')
    .replaceAll('export function ', 'function ') + '\nreturn { useMaquinasList, normalizeMachineRecord };';
  const findings = [];
  for (const missingDesktopPortal of [true, false]) {
    let finish;
    const dependencies = {
      vue: Vue, 'lucide-vue-next': icons,
      'firebase/firestore': { collection() {}, query() {}, getDocs: () => new Promise(resolve => { finish = resolve; }) },
      'firebase/storage': {}, '../firebase/config': {},
      '../constants/organization': { DEFAULT_SECTOR: 'HILANDERIA', SECTOR_OPTIONS: ['HILANDERIA', 'TEJEDURIA'], normalizeSectorValue: value => value },
      '../services/authService': { authService: {}, userRole: Vue.ref('admin') },
      '../services/catalogoService': { catalogoService: { obtenerTodo: async () => [] } },
      '../services/maquinaService': { maquinaService: {} }, '../utils/imageCompressor': {},
      '../utils/catalogColumnLayout': { catalogColumnLayout }, '../data/catalogo_full_r60.json': [], sweetalert2: { fire: async () => ({}) },
      exceljs: {}, 'file-saver': {}, 'tippy.js': () => ({}),
    };
    dependencies['../composables/useMaquinasList'] = evaluate(machineSource, dependencies);
    const component = evaluate(script.content, dependencies);
    component.render = evaluate(template.code, dependencies);
    const { renderer, root } = host({ missingDesktopPortal });
    const app = renderer.createApp(component);
    const errors = [];
    app.config.errorHandler = error => errors.push(error.message);
    app.mount(root);
    await Vue.nextTick();
    finish({ docs: [{ id: 'machine1', data: () => ({ tipo: 'TELAR', maquina: 35001, sector: 'TEJEDURIA' }) }] });
    await new Promise(resolve => setImmediate(resolve));
    findings.push(errors);
    {
      assert.equal(root._vnode.component.setupState.isLoading, false);
      assert.equal(root._vnode.component.setupState.maquinas.length, 1);
      const state = root._vnode.component.setupState;
      assert.equal(state.viewMode, 'table');
      state.exportMenuOpen = true;
      await Vue.nextTick();
      let exported = false;
      state.runExport(() => { exported = true; });
      assert.equal(exported, true);
      assert.equal(state.exportMenuOpen, false);
      state.exportMenuOpen = true;
      state.handleExportKeydown({ key: 'Escape' });
      assert.equal(state.exportMenuOpen, false);
      state.exportMenuElement = { contains: () => false };
      state.exportMenuOpen = true;
      state.handleExportOutside({ target: {} });
      assert.equal(state.exportMenuOpen, false);
      state.exportMenuElement = null;
      state.catalogoData = [{ id: 'catalog-part-1', seccion: 'Motor', grupo: '1', subGrupo: 'A', denominacion: 'Motor de accionamiento con una denominación extensa para verificar el renderizado', numeroCatalogo: 'R60-01', numeroArticulo: 'ART-01' }];
      state.showCatalogModal = true;
      await Vue.nextTick();
      assert.equal(state.filteredCatalogo.length, 1);
      state.openProcedimientoEditor(state.catalogoData[0]);
      await Vue.nextTick();
      assert.equal(state.procedimientoPasos.length, 0);
      state.agregarPaso();
      await Vue.nextTick();
      state.eliminarPaso(0);
      state.closeProcedimientoEditor();
      state.catalogoData[0].procedimiento = [{ texto: 'Revisar motor', imagenUrl: '/test-image.png' }];
      await Vue.nextTick();
      state.openProcedimientoEditor(state.catalogoData[0]);
      await Vue.nextTick();
      state.procedimientoPasos[0].texto = 'Texto editado';
      assert.equal(state.catalogoData[0].procedimiento[0].texto, 'Revisar motor');
      state.closeProcedimientoEditor();
      await Vue.nextTick();
      state.startCatalogEdit(state.catalogoData[0]);
      await Vue.nextTick();
      state.cancelCatalogEdit();
      state.catalogoSearchQuery = 'does-not-exist';
      await Vue.nextTick();
      assert.equal(state.filteredCatalogo.length, 0);
      state.catalogoSearchQuery = '';
      state.closeCatalogModal();
      await Vue.nextTick();
      assert.equal(state.showCatalogModal, false);
      state.showModal = true;
      await Vue.nextTick();
      state.showModal = false;
      state.viewMode = 'cards';
      await Vue.nextTick();
      state.searchQuery = 'does-not-exist';
      await Vue.nextTick();
      assert.equal(state.filteredMaquinas.length, 0);
      state.searchQuery = '';
      state.itemsPerPage = 50;
      await Vue.nextTick();
      assert.equal(state.currentPage, 1);
      app.unmount();
    }
  }
  assert.deepEqual(findings[0], []);
  assert.deepEqual(findings[1], []);
  const shell = fs.readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8');
  assert.ok(shell.indexOf('id="navbar-actions"') < shell.indexOf('<router-view>'));
});
import * as plantTime from '../src/utils/plantTime.js';
import * as shiftGrid from '../src/utils/shiftGrid.js';
import * as shiftReportService from '../src/services/shiftReportService.js';

test('real shift sheet auto-advances, selects arrow targets and preserves unsaved data on snapshots and save failure', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const { descriptor } = parse(fs.readFileSync(new URL('../src/components/ShiftReport.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id: 'shift-render-test' });
  const template = compileTemplate({ id: 'shift-render-test', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  let pushSnapshot;
  let failSave = true;
  let saved;
  const dependencies = {
    // CSS transitions are excluded from this in-memory renderer.
    vue: { ...Vue, Transition: { inheritAttrs: false, setup(_, { slots }) { return () => slots.default?.(); } } }, 'lucide-vue-next': icons, 'vue-router': { onBeforeRouteLeave() {} },
    '../utils/plantTime': plantTime, '../utils/shiftGrid': shiftGrid, '../utils/tooltipDirective': { vTippy },
    'firebase/firestore': { collection() {}, query() {}, getDocs: async () => ({ docs: [{ id: 'loom1', data: () => ({ tipo: 'TELAR', maquina: 35001, activo: true }) }] }) },
    '../firebase/config': {}, '../services/shiftReportService': shiftReportService,
    '../services/shiftReportFirestore': {
      guardarReporteCSV() {},
      guardarCambiosManual: async (date, changes) => { saved = { date, changes }; if (failSave) throw Object.assign(new Error('Conflict'), { code: 'shiftreport/conflict' }); },
      suscribirReporte: (_, callback) => { pushSnapshot = callback; callback(null); return () => {}; },
    },
    sweetalert2: { fire: async () => ({ isConfirmed: true }) },
  };
  const component = evaluate(script.content, dependencies);
  component.render = evaluate(template.code, dependencies);
  const { renderer, root } = host();
  const app = renderer.createApp(component);
  const errors = [];
  app.config.errorHandler = error => errors.push(error.message);
  try {
    app.mount(root);
    await new Promise(resolve => setImmediate(resolve));
    const state = root._vnode.component.setupState;
    state.calendarMonth = '2028-02';
    assert.equal(state.calendarDays.length, 42);
    assert.ok(state.calendarDays.some(day => day.date === '2028-02-29' && !day.outside));
    state.moveCalendarMonth(-2);
    assert.equal(state.calendarMonth, '2027-12');
    state.selectReportDate('2026-10-10');
    assert.equal(state.fechaInput, '2026-10-10');
    let focused;
    let selected = 0;
    state.gridElement.querySelector = selector => ({ readOnly: false, focus() { focused = selector; }, select() { selected++; } });
    state.gridInput({ target: { value: '261' } }, '35001', 'A', state.gridFields[0], 0);
    state.selectReportDate('2026-10-11');
    assert.equal(state.fechaInput, '2026-10-10');
    await Vue.nextTick();
    assert.equal(focused, '[data-grid-index="1"]');
    assert.equal(selected, 1);
    let prevented = false;
    state.gridKeydown({ key: 'ArrowLeft', preventDefault() { prevented = true; } }, 1);
    await Vue.nextTick();
    assert.equal(prevented, true);
    assert.equal(focused, '[data-grid-index="0"]');
    assert.equal(selected, 2);
    state.setVal('35001', 'A', 'picks', '001');
    await Vue.nextTick();
    assert.equal(state.getInputVal('35001', 'A', 'picks'), '001');
    assert.equal(state.getVal('35001', 'A', 'picks'), 1);
    state.setVal('35001', 'A', 'picks', '261');
    pushSnapshot({ registros: { '35002_A': { loom: '35002', turno: 'A', picks: 300 } } });
    await Vue.nextTick();
    assert.equal(state.getVal('35001', 'A', 'picks'), 261);
    assert.equal(state.getVal('35002', 'A', 'picks'), 300);
    assert.equal(await state.guardarPlanilla(), false);
    assert.equal(state.dirtyCount, 1);
    assert.equal(state.getVal('35001', 'A', 'picks'), 261);
    failSave = false;
    assert.equal(await state.guardarPlanilla(), true);
    assert.equal(saved.changes[0].data.picks, 261);
    assert.equal(saved.changes[0].base, null);
    assert.equal(state.dirtyCount, 0);
    app.unmount();
    assert.deepEqual(errors, []);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
import * as faultUtilities from '../src/utils/faultEvents.js';
import { getSectorScope } from '../src/utils/sectorScope.js';

test('fault event panel handles live updates, filters, stale pages and scope changes', async () => {
  const { descriptor } = parse(fs.readFileSync(new URL('../src/components/FaultEventsPanel.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id:'fault-panel-test' });
  const template = compileTemplate({ id:'fault-panel-test', source:descriptor.template.content, compilerOptions:{ bindingMetadata:script.bindings } });
  assert.deepEqual(template.errors, []);
  const profile = Vue.ref({ role:'mecanico', sectoresAsignados:['HILANDERIA'] });
  const subscriptions = [];
  let resolvePage, stopped = 0;
  const dependencies = {
    vue:Vue, 'lucide-vue-next':icons, '../firebase/config':{},
    '../services/authService':{ userProfile:profile },
    '../utils/sectorScope':{ getSectorScope },
    '../utils/faultEvents':faultUtilities, '../utils/plantTime':{ plantDate }, './PlantDatePicker.vue':{ render:() => null },
    '../utils/tooltipDirective':{ vTippy },
    '../services/faultEvents':{
      subscribeFaultEvents(db, sectors, options, receive, fail) { subscriptions.push({ sectors, options, receive, fail }); return () => stopped++; },
      loadFaultEventsPage:() => new Promise(resolve => { resolvePage = resolve; }),
    },
  };
  const component = evaluate(script.content, dependencies);
  component.render = evaluate(template.code, dependencies);
  const { renderer, root } = host();
  const app = renderer.createApp(component);
  const errors = [];
  app.config.errorHandler = e => errors.push(e.message);
  try {
    app.mount(root);
    const state = root._vnode.component.setupState;
    assert.deepEqual(subscriptions[0].sectors, ['HILANDERIA']);
    assert.equal(subscriptions[0].options.period, 'shift');
    const event = { id:'one', numeroMaquina:35001, tipoProblema:'Mecánico', estado:'pendiente', observaciones:'Pérdida de aceite' };
    subscriptions[0].receive({ events:[event], cursor:'cursor', hasMore:true });
    state.search = 'perdida';
    await Vue.nextTick();
    assert.equal(state.visible.length, 1);
    const pending = state.more();
    subscriptions[0].receive({ events:[{ ...event, estado:'en proceso' }], cursor:'new', hasMore:true });
    resolvePage({ events:[{ id:'stale' }], cursor:null, hasMore:false });
    await pending;
    assert.deepEqual(state.events.map(e => e.id), ['one']);
    assert.equal(state.events[0].estado, 'en proceso');
    state.period = 'older';
    await Vue.nextTick();
    assert.equal(stopped, 1);
    subscriptions[0].receive({ events:[{ id:'old-subscription' }], hasMore:false });
    assert.equal(state.events.length, 0);
    subscriptions[1].fail(new Error('permission-denied'));
    assert.ok(state.error);
    assert.equal(state.loading, false);
    app.unmount();
    assert.equal(stopped, 2);
    assert.deepEqual(errors, []);
  } finally { if (root._vnode) app.unmount(); }
});


test('desktop report keeps failed drafts, prevents duplicate sends and refreshes after success', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { matchMedia:() => ({ matches:true, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  const { descriptor } = parse(fs.readFileSync(new URL('../src/components/CargaNovedad.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id:'fault-form-test' });
  const template = compileTemplate({ id:'fault-form-test', source:descriptor.template.content, compilerOptions:{ bindingMetadata:script.bindings } });
  assert.deepEqual(template.errors, []);
  let calls = 0, fail = true, resolveSave;
  const machine = { id:'m1', tipo:'TELAR', maquina:35001, sector:'TEJEDURIA', nombre_maquina:'Toyota', local_fisico:1 };
  const stub = { render:() => null };
  const dependencies = {
    vue:Vue, 'lucide-vue-next':icons, 'vue-router':{ useRouter:() => ({}), onBeforeRouteLeave() {} },
    '../services/accessScope':{ sectorConstraints:() => [] },
    'firebase/firestore':{ collection() {}, query() {}, where() {}, orderBy() {}, limit() {}, serverTimestamp() {},
      getDocs:async () => ({ forEach(callback) { callback({ id:'m1', data:() => machine }); } }) },
    '../firebase/config':{}, 'firebase/auth':{ getAuth:() => ({ currentUser:{ uid:'user' } }) },
    '../services/mantenimientoService':{ mantenimientoService:{ crearNovedad:async data => {
      calls++; assert.equal(data.sector, 'TEJEDURIA');
      if (fail) throw new Error('Sin conexión');
      await new Promise(resolve => { resolveSave = resolve; });
    } } },
    '../services/catalogoService':{ catalogoService:{ inicializarSiVacio:async () => {}, obtenerPuntosPorTipo:async () => [], obtenerPuntosPorModelo:async () => [] } },
    '../services/authService':{ userProfile:Vue.ref({ role:'admin', sectorDefault:'TEJEDURIA', sectoresAsignados:['TEJEDURIA'] }), userRole:Vue.ref('admin') },
    '../constants/organization':{ DEFAULT_SECTOR:'HILANDERIA', normalizeSectorValue:value => value, sanitizeSectorList:(sectors, fallback) => sectors || [fallback] }, '../data/catalogo_full_r60.json':[],
    sweetalert2:{ fire:async () => ({ isConfirmed:true }) },
    '../utils/imageCompressor':{ compressImage() {}, formatSize:() => '' },
    './CameraCapture.vue':stub, './FaultEventsPanel.vue':stub,
    '../utils/tooltipDirective':{ vTippy },
    '../constants/motivos':{ getMotivos:() => ['VERIFICACIÓN'] },
    '../services/motivosService':{ getMotivosList:async () => ['VERIFICACIÓN'] },
  };
  const component = evaluate(script.content, dependencies);
  component.render = evaluate(template.code, dependencies);
  const { renderer, root } = host();
  const app = renderer.createApp(component);
  const errors = [];
  app.config.errorHandler = e => errors.push(e.message);
  const originalError = console.error;
  console.error = () => {};
  try {
    app.mount(root);
    await new Promise(resolve => setImmediate(resolve));
    const state = root._vnode.component.setupState;
    assert.equal(state.desktop, true);
    state.maquinaSeleccionadaId = 'm1';
    state.observaciones = 'Motor detenido';
    await Vue.nextTick();
    await state.onSubmit();
    assert.equal(state.observaciones, 'Motor detenido');
    assert.equal(state.eventsRefresh, 0);
    fail = false;
    const pending = state.onSubmit();
    await state.onSubmit();
    assert.equal(calls, 2);
    assert.equal(state.isSubmitting, true);
    resolveSave();
    await pending;
    assert.equal(state.observaciones, '');
    assert.equal(state.eventsRefresh, 1);
    assert.equal(state.isSubmitting, false);
    assert.deepEqual(errors, []);
  } finally {
    app.unmount(); console.error = originalError;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});
for (const isDesktop of [true, false]) {
test('request form preserves patrol preload and failed drafts, then saves once (' + (isDesktop ? 'desktop' : 'mobile') + ')', async () => {
  const previousWindow = globalThis.window, previousStorage = globalThis.sessionStorage;
  const store = new Map([['patrol_intervention_return', JSON.stringify({ tipoInterv:'MECANICO' })]]);
  globalThis.sessionStorage = { getItem:key => store.get(key) || null, setItem:(key,value) => store.set(key,value), removeItem:key => store.delete(key) };
  globalThis.window = { matchMedia:() => ({ matches:isDesktop, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  const { descriptor } = parse(fs.readFileSync(new URL('../src/components/LlamarIntervencion.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id:'request-form-test' });
  const template = compileTemplate({ id:'request-form-test', source:descriptor.template.content, compilerOptions:{ bindingMetadata:script.bindings } });
  assert.deepEqual(template.errors, []);
  let calls = 0, fail = true, resolveSave, returned = 0, leaveGuard;
  const route = { query:{ origen:'patrulla', maqId:'m1', tipo:'TELAR', grp:'01', obs:'Equipo parado', tipoInterv:'CALIDAD', sintomaName:'Mancha' } };
  const machine = { tipo:'TELAR', maquina:35001, sector:'TEJEDURIA', nombre_maquina:'Toyota', grp_tear:'01', g_cmest:'02', lado:'U' };
  const symptom = { sector:'TEJEDURIA', tipoMaquina:'TELAR', nombre:'Mancha', derivaA:'CALIDAD' };
  const stub = { render:() => null };
  const dependencies = {
    vue:Vue, 'lucide-vue-next':icons,
    'vue-router':{ useRouter:() => ({ back() { returned++; } }), useRoute:() => route, onBeforeRouteLeave:callback => { leaveGuard = callback; } },
    'firebase/firestore':{ collection:(db,name) => name, query:value => value, where() {},
      getDocs:async name => ({ docs:[{ id:name === 'maquinas' ? 'm1' : 's1', data:() => name === 'maquinas' ? machine : symptom }] }) },
    '../firebase/config':{},
    '../services/intervencionService':{ intervencionService:{ crearIntervencion:async data => {
      calls++; assert.equal(data.sector, 'TEJEDURIA'); assert.equal(data.tipoIntervencion, 'CALIDAD');
      assert.equal(data.critico, true); assert.equal(data.estadoMaquina, 'PARADA'); assert.equal(data.sintomaNombre, 'Mancha');
      if (fail) throw new Error('Sin conexión');
      await new Promise(resolve => { resolveSave = resolve; }); return 'request-id';
    } } },
    '../services/authService':{ userProfile:Vue.ref({ role:'admin', sectorDefault:'TEJEDURIA', sectoresAsignados:['TEJEDURIA'] }), userRole:Vue.ref('admin') },
    '../constants/organization':{ DEFAULT_SECTOR:'HILANDERIA', normalizeSectorValue:value => value, sanitizeSectorList:(sectors, fallback) => sectors || [fallback] },
    '../constants/motivos':{ MOTIVOS_POR_TIPO:{}, MOTIVOS_DEFAULT:{} },
    sweetalert2:{ fire:async () => ({ isConfirmed:false }) },
    '../utils/imageCompressor':{ compressImage() {}, formatSize:() => '' },
    './CameraCapture.vue':stub, './FaultEventsPanel.vue':stub, '../utils/tooltipDirective':{ vTippy },
  };
  const component = evaluate(script.content, dependencies);
  component.render = evaluate(template.code, dependencies);
  const { renderer, root } = host();
  const app = renderer.createApp(component), errors = [];
  app.config.errorHandler = e => errors.push(e.message);
  try {
    app.mount(root);
    await new Promise(resolve => setImmediate(resolve));
    const state = root._vnode.component.setupState;
    assert.equal(state.desktop, isDesktop);
    assert.equal(state.maquinaSeleccionadaId, 'm1');
    assert.equal(state.observaciones, 'Equipo parado');
    assert.equal(state.tipoIntervencion, 'CALIDAD');
    assert.equal(state.isPreloading, false);
    state.estadoMaquina = 'PARADA';
    await Vue.nextTick();
    await state.onSubmit();
    assert.equal(state.observaciones, 'Equipo parado');
    assert.equal(state.sintomaSeleccionado.nombre, 'Mancha');
    assert.equal(state.eventsRefresh, 0);
    fail = false;
    const pending = state.onSubmit();
    await state.onSubmit();
    assert.equal(calls, 2);
    assert.equal(await leaveGuard(), false);
    resolveSave(); await pending;
    assert.equal(state.observaciones, '');
    assert.equal(state.eventsRefresh, 1);
    assert.equal(state.lastSent.id, 'request-id');
    assert.equal(state.lastSent.data.obs, 'Equipo parado');
    assert.equal(returned, 1);
    assert.equal(JSON.parse(store.get('patrol_intervention_return')).sintomaLabel, 'Mancha');
    assert.equal(await leaveGuard(), true);
    assert.deepEqual(errors, []);
  } finally {
    app.unmount();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousStorage === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previousStorage;
  }
});
}

test('shared event panel reads intervention categories and states through its kind prop', async () => {
  const { descriptor } = parse(fs.readFileSync(new URL('../src/components/FaultEventsPanel.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id:'requests-panel-test' });
  const template = compileTemplate({ id:'requests-panel-test', source:descriptor.template.content, compilerOptions:{ bindingMetadata:script.bindings } });
  let subscription;
  const dependencies = {
    vue:Vue, 'lucide-vue-next':icons, '../firebase/config':{},
    '../services/authService':{ userProfile:Vue.ref({ role:'admin' }) },
    '../utils/sectorScope':{ getSectorScope }, '../utils/faultEvents':faultUtilities,
    '../utils/plantTime':{ plantDate }, './PlantDatePicker.vue':{ render:() => null }, '../utils/tooltipDirective':{ vTippy },
    '../services/faultEvents':{
      subscribeFaultEvents(db, sectors, options, receive) { subscription = { sectors, options, receive }; return () => {}; },
      loadFaultEventsPage:async () => ({ events:[], hasMore:false }),
    },
  };
  const component = evaluate(script.content, dependencies);
  component.render = evaluate(template.code, dependencies);
  const { renderer, root } = host(), app = renderer.createApp(component, { kind:'interventions' }), errors = [];
  app.config.errorHandler = e => errors.push(e.message);
  try {
    app.mount(root);
    const state = root._vnode.component.setupState;
    assert.equal(subscription.options.kind, 'interventions');
    assert.equal(subscription.sectors, null);
    state.category = 'CALIDAD'; state.state = 'EN_PROCESO';
    await Vue.nextTick();
    assert.equal(subscription.options.category, 'CALIDAD');
    assert.equal(subscription.options.state, 'EN_PROCESO');
    subscription.receive({ events:[{ id:'quality', tipoIntervencion:'CALIDAD', estado:'EN_PROCESO', sintomaNombre:'Mancha', numeroMaquina:35001 }], hasMore:false });
    await Vue.nextTick();
    assert.equal(state.visible[0].tipoProblema, 'Calidad');
    assert.equal(state.visible[0].motivo, 'Mancha');
    assert.equal(state.stateLabel('EN_PROCESO'), 'En proceso');
    state.state = 'COMPLETADO'; state.period = 'older';
    await Vue.nextTick();
    assert.equal(state.loading, false);
    assert.equal(state.events.length, 0);
    assert.deepEqual(errors, []);
  } finally { app.unmount(); }
});
