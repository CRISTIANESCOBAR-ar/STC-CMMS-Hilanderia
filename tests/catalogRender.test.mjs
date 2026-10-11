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

test('symptom transactions preserve identifiers, reject duplicate creates and concurrent edits, normalize ordering', async () => {
  const source = fs.readFileSync(new URL('../src/services/sintomasService.js', import.meta.url), 'utf8');
  const role = Vue.ref('admin'), store = new Map(), writes = [], reads = [];
  const a = { id:'a', nombre:'Trama', descripcion:'Antes', categoria:'TRAMA', derivaA:'MECANICO', destacado:false, activo:true, orden:2 };
  const b = { ...a, id:'b', nombre:'Otra', orden:2 };
  store.set('a', { ...a }); store.set('b', { ...b });
  const dependencies = {
    '../firebase/config':{ db:{} }, './authService':{ userRole:role },
    'firebase/firestore':{
      doc:(db, collection, id) => id, collection:() => 'sintomas', where:(...args) => args, query:(...args) => args,
      getDocs:async query => { reads.push(query); return { docs:[...store].map(([id,data]) => ({ id, data:() => data })) }; },
      serverTimestamp:() => 'server-time',
      runTransaction:async (db, work) => {
        const pending = [];
        await work({ get:async id => ({ exists:() => store.has(id), data:() => store.get(id) }),
          set:(id,data) => pending.push({ id,data,kind:'set' }), update:(id,data) => pending.push({ id,data,kind:'update' }), delete:id => pending.push({ id,kind:'delete' }) });
        pending.forEach(write => { writes.push(write); if (write.kind === 'delete') store.delete(write.id); else store.set(write.id, { ...(write.kind === 'update' ? store.get(write.id):{}), ...write.data }); });
      },
    },
  };
  const service = evaluate(source.replace(/export (async function|const)/g, '$1') + '\nreturn { loadSymptoms, saveSymptom, deleteSymptom, reorderSymptoms, symptomFields };', dependencies);
  await service.loadSymptoms('TEJEDURIA','TELAR');
  assert.deepEqual(reads[0].slice(1), [['sector','==','TEJEDURIA'],['tipoMaquina','==','TELAR']]);
  await service.saveSymptom('a', { ...a, nombre:'Nombre editado', descripcion:'Descripción editada' }, a);
  assert.equal(store.get('a').nombre,'Nombre editado'); assert.equal(store.get('a').descripcion,'Descripción editada');
  assert.equal(writes[0].id,'a'); assert.equal(writes[0].kind,'update');
  await assert.rejects(service.saveSymptom('a', a), /Ya existe/);
  await assert.rejects(service.saveSymptom('a', a, a), /Otro usuario/);
  await assert.rejects(service.deleteSymptom(a), /Otro usuario/);
  await service.reorderSymptoms([b, store.get('a')]);
  assert.equal(store.get('b').orden,1); assert.equal(store.get('a').orden,2);
  await assert.rejects(service.reorderSymptoms([b]), /Otro usuario/);
  role.value = 'tejedor'; const count = writes.length;
  await assert.rejects(service.saveSymptom('new',a), /administrador/);
  await assert.rejects(service.deleteSymptom(b), /administrador/);
  await assert.rejects(service.reorderSymptoms([b]), /administrador/);
  assert.equal(writes.length,count);
});

test('symptom view ignores stale loads and preserves the edit draft after a failed explicit save', async () => {
  const { descriptor } = parse(fs.readFileSync(new URL('../src/components/SintomasAdmin.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id:'symptoms-test' });
  const template = compileTemplate({ id:'symptoms-test', source:descriptor.template.content, compilerOptions:{ bindingMetadata:script.bindings } });
  assert.deepEqual(template.errors, []);
  const requests = [], writes = [], ordering = []; const role = Vue.ref('admin');
  let failSave = true, confirm = false;
  const fields = ['nombre','descripcion','categoria','derivaA','destacado','activo'];
  const dependencies = {
    vue:Vue, 'vue-router':{ onBeforeRouteLeave() {} }, 'lucide-vue-next':icons,
    '../services/authService':{ userRole:role }, '../utils/tooltipDirective':{ vTippy }, 'file-saver':{ saveAs() {} },
    sweetalert2:{ fire:async () => ({ isConfirmed:confirm }) },
    '../services/sintomasService':{ symptomFields:fields,
      loadSymptoms:(sector,type) => new Promise(resolve => requests.push({ sector,type,resolve })),
      saveSymptom:async (id,data,baseline) => { writes.push({ id,data,baseline }); if (failSave) throw new Error('Conflicto de prueba'); },
      deleteSymptom:async () => {}, reorderSymptoms:async list => ordering.push(list),
    },
  };
  const component = evaluate(script.content,dependencies); component.render = evaluate(template.code,dependencies);
  const { renderer,root } = host(); const app = renderer.createApp(component), errors = [];
  app.config.errorHandler = error => errors.push(error); app.mount(root);
  const state = root._vnode.component.setupState;
  state.sector = 'HILANDERIA'; state.changeSector(); await Vue.nextTick();
  requests[0].resolve([{ id:'old', nombre:'Viejo' }]); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state.rows, []); assert.equal(requests[1].type,'CARDA');
  const row = { id:'stable-id', nombre:'Pérdida de aceite', descripcion:'Inicial', categoria:'MECANICO', derivaA:'MECANICO', activo:true, destacado:false, orden:1 };
  requests[1].resolve([row,{ ...row,id:'second',activo:false,orden:2 }]); await new Promise(resolve => setImmediate(resolve));
  state.search = 'perdida'; assert.equal(state.visible.length,2); state.status = 'active'; assert.equal(state.visible.length,1);
  await state.move(row,1); assert.equal(ordering.length,0);
  state.openEditor(row); state.draft.nombre = 'Nuevo nombre'; state.draft.descripcion = 'Nueva descripción';
  await state.save(); assert.equal(writes[0].id,'stable-id'); assert.equal(writes[0].data.descripcion,'Nueva descripción');
  assert.equal(state.editing,true); assert.equal(state.formError,'Conflicto de prueba'); assert.equal(state.draft.nombre,'Nuevo nombre');
  assert.equal(await state.closeEditor(),false); assert.equal(state.editing,true);
  failSave = false; const saved = state.save(); await new Promise(resolve => setImmediate(resolve));
  requests.at(-1).resolve([row]); await saved; assert.equal(state.editing,false);
  role.value = 'tejedor'; state.openEditor(row); assert.equal(state.editing,false);
  await state.remove(row); assert.equal(state.busy,false);
  assert.deepEqual(errors,[]); app.unmount();
});

test('rounds editor preserves reordered machines, guards dirty drafts and duplicate saves, and retains failed drafts', async () => {
  const { descriptor } = parse(fs.readFileSync(new URL('../src/components/RondasAdmin.vue', import.meta.url),'utf8'));
  const script = compileScript(descriptor,{ id:'rounds-test' });
  const template = compileTemplate({ id:'rounds-test',source:descriptor.template.content,compilerOptions:{ bindingMetadata:script.bindings } });
  assert.deepEqual(template.errors,[]);
  const route = { id:'route',nombre:'Recorrido completo',sector:'TEJEDURIA',tipo:'roturas',orden:1,activa:true,maquinas:[{ maquinaId:'a',orden:1 },{ maquinaId:'b',orden:2 }] };
  const machines = [{ id:'a',maquina:35001,tipo:'TELAR',sector:'TEJEDURIA',activo:true },{ id:'b',maquina:35002,tipo:'TELAR',sector:'TEJEDURIA',activo:true },{ id:'c',maquina:35003,tipo:'TELAR',sector:'TEJEDURIA',activo:false },{ id:'d',maquina:165001,tipo:'CARDA',sector:'HILANDERIA',activo:true }];
  const role = Vue.ref('admin'), writes = []; let confirm = false, finishWrite, leave;
  const dependencies = {
    vue:Vue, 'vue-router':{ onBeforeRouteLeave:callback => { leave=callback; } },'lucide-vue-next':icons,
    '../firebase/config':{ db:{} }, '../services/authService':{ userRole:role },'../constants/organization':{ normalizeSectorValue:value => String(value || '').toUpperCase() },
    '../utils/tooltipDirective':{ vTippy }, sweetalert2:{ fire:async () => ({ isConfirmed:confirm }) },
    'firebase/firestore':{ collection:() => 'machines',getDocs:async () => ({ docs:machines.map(machine => ({ id:machine.id,data:() => machine })) }) },
    '../services/patrullaService':{ cargarTodasRutasPatrulla:async () => [route],guardarRutaPatrulla:(id,data) => { writes.push({ id,data }); return new Promise((resolve,reject) => { finishWrite={ resolve,reject }; }); },eliminarRutaPatrulla:async () => {} },
  };
  const component = evaluate(script.content,dependencies); component.render = evaluate(template.code,dependencies);
  const { renderer,root } = host(); const app=renderer.createApp(component),errors=[]; app.config.errorHandler=error => errors.push(error); app.mount(root);
  const state=root._vnode.component.setupState; await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.cargando,false); assert.equal(state.rutas.length,1);
  state.search='recorrido'; assert.equal(state.rutasVisibles.length,1); state.tipoFiltro='eficiencia'; assert.equal(state.rutasVisibles.length,0); state.tipoFiltro='';
  await state.abrirEditor(route); assert.equal(state.gridTelar.length,8); assert.equal(state.gridTelar[0].length,10);
  assert.equal(state.maquinasFiltradas.length,2); state.agregarMaquina(machines[0]); assert.equal(state.form.maquinas.length,2);
  state.agregarMaquina(machines[2]); assert.equal(state.form.maquinas.length,2);
  state.mover(1,-1); assert.deepEqual(state.form.maquinas.map(machine => machine.maquinaId),['b','a']);
  assert.equal(state.dirty,true); assert.equal(await leave(),false); assert.equal(await state.cerrarEditor(),false);
  await state.abrirEditor(); assert.equal(state.editandoId,'route');
  const event={ target:{ value:'HILANDERIA' } }; await state.cambiarSector(event); assert.equal(state.form.sector,'TEJEDURIA'); assert.equal(event.target.value,'TEJEDURIA');
  const failed=state.guardarRuta(); await state.guardarRuta(); assert.equal(writes.length,1); assert.deepEqual(writes[0].data.maquinas,[{ maquinaId:'b',orden:1 },{ maquinaId:'a',orden:2 }]);
  state.mover(0,1); state.quitarMaquina('a'); assert.equal(state.form.maquinas.length,2); assert.equal(await state.cerrarEditor(),false);
  finishWrite.reject(new Error('Sin conexión')); await failed; assert.match(state.formError,/Sin conexión/); assert.equal(state.modoEditor,true); assert.equal(state.dirty,true);
  const saved=state.guardarRuta(); finishWrite.resolve('route'); await saved; assert.equal(state.dirty,false); assert.match(state.mensaje,/guardada/);
  state.mover(0,1); confirm=true; await state.cambiarSector({ target:{ value:'HILANDERIA' } }); assert.equal(state.form.maquinas.length,0); assert.equal(state.maquinasDisponibles[0].id,'d');
  state.agregarMaquina(machines[3]); assert.deepEqual(state.form.maquinas,[{ maquinaId:'d',orden:1 }]);
  role.value='tejedor'; await state.guardarRuta(); assert.equal(writes.length,2); assert.deepEqual(errors,[]); app.unmount();
});

test('rounds load failures stop loading and retry; partial creation keeps its ID for safe retry', async () => {
  const { descriptor }=parse(fs.readFileSync(new URL('../src/components/RondasAdmin.vue',import.meta.url),'utf8'));
  const script=compileScript(descriptor,{ id:'rounds-retry-test' });
  const template=compileTemplate({ id:'rounds-retry-test',source:descriptor.template.content,compilerOptions:{ bindingMetadata:script.bindings } });
  let failLoad=true; const writes=[];
  const dependencies={ vue:Vue,'vue-router':{ onBeforeRouteLeave() {} },'lucide-vue-next':icons,'../firebase/config':{ db:{} },'../services/authService':{ userRole:Vue.ref('admin') },'../constants/organization':{ normalizeSectorValue:value => value },'../utils/tooltipDirective':{ vTippy },sweetalert2:{ fire:async () => ({ isConfirmed:true }) },'firebase/firestore':{ collection:() => 'machines',getDocs:async () => ({ docs:[] }) },'../services/patrullaService':{ cargarTodasRutasPatrulla:async () => { if(failLoad) throw new Error('Read failed'); return []; },guardarRutaPatrulla:async (id,data) => { writes.push(id); return id || 'created-id'; },eliminarRutaPatrulla:async () => {} } };
  const component=evaluate(script.content,dependencies); component.render=evaluate(template.code,dependencies);
  const { renderer,root }=host(), app=renderer.createApp(component); app.mount(root); const state=root._vnode.component.setupState;
  await new Promise(resolve => setImmediate(resolve)); assert.equal(state.cargando,false); assert.match(state.error,/No se pudo/);
  await state.abrirEditor(); assert.equal(state.modoEditor,false);
  failLoad=false; await state.cargar(); await state.abrirEditor(); state.form.nombre='Nueva ruta'; failLoad=true;
  await state.guardarRuta(); assert.equal(state.editandoId,'created-id'); assert.match(state.formError,/Read failed/);
  failLoad=false; await state.guardarRuta(); assert.deepEqual(writes,[null,'created-id']); assert.equal(state.formError,''); app.unmount();
});

test('operator view filters accents, preserves failed master forms and limits administration by role', async () => {
  const { descriptor }=parse(fs.readFileSync(new URL('../src/components/OperariosTejeduria.vue',import.meta.url),'utf8'));
  const script=compileScript(descriptor,{ id:'operators-test' });
  const template=compileTemplate({ id:'operators-test',source:descriptor.template.content,compilerOptions:{ bindingMetadata:script.bindings } });
  assert.deepEqual(template.errors,[]);
  const role=Vue.ref('admin'),profile=Vue.ref({ role:'admin' }),writes=[];
  const employees=[{ legajo:1,nombre:'JOSÉ OPERARIO',puesto:'TELAR',turno:'A' },{ legajo:2,nombre:'OTRO',puesto:'',turno:'B' }];
  let failWrite=true,confirm=false,leave;
  const dependencies={ vue:Vue,'vue-router':{ onBeforeRouteLeave:callback => { leave=callback; } },'lucide-vue-next':icons,'../utils/plantTime':{ shiftSlot:() => ({ fecha:'2026-10-11',turno:'A' }),plantShift:() => 'A',addDays },'../firebase/config':{ db:{} },'../services/authService':{ userRole:role,userProfile:profile },'../services/profileService':{ canAccessViewForUser:() => true },'../utils/sectorScope':{ getSectorScope:() => ['TEJEDURIA'] },'../utils/tooltipDirective':{ vTippy },'./PlantDatePicker.vue':{ render:() => Vue.h('button','Fecha') },'./CameraCapture.vue':{ render:() => Vue.h('div','Camera') },'../services/geminiClient':{ generateGeminiText:async () => ({ text:'{}' }),GEMINI_SETUP_MSG:'Setup' },sweetalert2:{ fire:async () => ({ isConfirmed:confirm }) },'firebase/firestore':{ doc:(db,collection,id) => `${collection}/${id}`,serverTimestamp:() => 'server-time',getDoc:async path => path.startsWith('config/') ? { exists:() => true,data:() => ({ operarios:employees }) } : { exists:() => true,data:() => ({ horarios:{ 1:{ ingreso:'06:00' },3:{ ingreso:'06:10' } },extras:[{ legajo:3,nombre:'DESCONOCIDO' }] }) },setDoc:async (path,data) => { writes.push({ path,data }); if(failWrite) throw new Error('Write failed'); } } };
  const component=evaluate(script.content,dependencies); component.render=evaluate(template.code,dependencies);
  const { renderer,root }=host(),app=renderer.createApp(component),errors=[]; app.config.errorHandler=error => errors.push(error); app.mount(root); const state=root._vnode.component.setupState;
  await new Promise(resolve => setImmediate(resolve)); assert.equal(state.isLoading,false); assert.equal(state.listaCompleta.length,2);
  state.searchQuery='jose'; assert.equal(state.operariosFiltrados.length,1); state.searchQuery=''; state.statusFilter='desconocido'; assert.equal(state.operariosFiltrados[0].legajo,3);
  state.openGestion(); assert.equal(state.showGestion,true); state.nuevoLegajo='4'; state.nuevoNombre='NUEVO';
  await state.agregarOperario(); assert.equal(state.maestroOperarios.length,2); assert.equal(state.nuevoNombre,'NUEVO'); assert.equal(state.masterError,'Write failed');
  await state.closeGestion(); assert.equal(state.showGestion,true); assert.equal(await leave(),false);
  failWrite=false; await state.agregarOperario(); assert.equal(state.maestroOperarios.length,3); assert.equal(state.nuevoNombre,'');
  state.editOperario(state.maestroOperarios[0]); state.nuevoNombre='EDITADO'; await state.agregarOperario(); assert.equal(state.maestroOperarios[0].nombre,'EDITADO'); assert.equal(state.maestroOperarios[0].legajo,1);
  state.maestroOperarios.push({ legajo:3,nombre:'DESCONOCIDO',turno:'A' }); assert.equal(state.listaCompleta.filter(employee => employee.legajo===3).length,1); assert.equal(state.listaCompleta.find(employee => employee.legajo===3).ingreso,'06:10');
  confirm=true; failWrite=true; const before=state.listaCompleta.map(employee => employee.ingreso); await state.limpiarHorarios(); assert.deepEqual(state.listaCompleta.map(employee => employee.ingreso),before);
  await state.closeGestion(); role.value='auxiliar'; profile.value={ role:'auxiliar' }; state.openGestion(); assert.equal(state.showGestion,false); const count=writes.length; await state.agregarOperario(); assert.equal(writes.length,count);
  assert.deepEqual(errors,[]); app.unmount();
});

test('operator OCR loads the detected date and shift once, keeps failed schedules and ignores stale reads', async t => {
  const originalReader=globalThis.FileReader;
  globalThis.FileReader=class { readAsDataURL() { this.result='data:image/jpeg;base64,test'; this.onloadend(); } };
  t.after(() => { if(originalReader===undefined) delete globalThis.FileReader; else globalThis.FileReader=originalReader; });
  const { descriptor }=parse(fs.readFileSync(new URL('../src/components/OperariosTejeduria.vue',import.meta.url),'utf8'));
  const script=compileScript(descriptor,{ id:'operators-ocr-test' });
  const template=compileTemplate({ id:'operators-ocr-test',source:descriptor.template.content,compilerOptions:{ bindingMetadata:script.bindings } });
  const reads=[],writes=[],dialogs=[]; let failWrite=true,leave;
  const dependencies={ vue:Vue,'vue-router':{ onBeforeRouteLeave:callback => { leave=callback; } },'lucide-vue-next':icons,'../utils/plantTime':{ shiftSlot:() => ({ fecha:'2026-10-11',turno:'A' }),plantShift:() => 'A',addDays },'../firebase/config':{ db:{} },'../services/authService':{ userRole:Vue.ref('auxiliar'),userProfile:Vue.ref({ role:'auxiliar' }) },'../services/profileService':{ canAccessViewForUser:() => true },'../utils/sectorScope':{ getSectorScope:() => ['TEJEDURIA'] },'../utils/tooltipDirective':{ vTippy },'./PlantDatePicker.vue':{ render:() => Vue.h('button','Fecha') },'./CameraCapture.vue':{ render:() => Vue.h('div','Camera') },'../services/geminiClient':{ generateGeminiText:async () => ({ text:JSON.stringify({ fecha:'2026-10-10',turno:'B',operarios:[{ legajo:'2',nombre:'OTRO',ingreso:'14:00',salida:'22:00' }] }) }),GEMINI_SETUP_MSG:'Setup' },sweetalert2:{ fire:async value => { dialogs.push(value); return { isConfirmed:true }; } },'firebase/firestore':{ doc:(db,collection,id) => `${collection}/${id}`,serverTimestamp:() => 'server-time',getDoc:path => path.startsWith('config/') ? Promise.resolve({ exists:() => true,data:() => ({ operarios:[{ legajo:2,nombre:'OTRO',turno:'B' }] }) }) : new Promise(resolve => reads.push({ path,resolve })),setDoc:async (path,data) => { writes.push({ path,data }); if(failWrite) throw new Error('Disconnected'); } } };
  const component=evaluate(script.content,dependencies); component.render=evaluate(template.code,dependencies);
  const { renderer,root }=host(),app=renderer.createApp(component),errors=[]; app.config.errorHandler=error => errors.push(error); app.mount(root); const state=root._vnode.component.setupState;
  await new Promise(resolve => setImmediate(resolve)); reads[0].resolve({ exists:() => false }); await new Promise(resolve => setImmediate(resolve));
  const scan=state.handleCapture({}); await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads.length,2); assert.equal(reads[1].path,'operarios_horarios/2026-10-10_B');
  reads[1].resolve({ exists:() => false }); await scan; assert.equal(state.pendingSchedule,true); assert.equal(state.listaCompleta[0].ingreso,'14:00'); assert.equal(writes[0].path,'operarios_horarios/2026-10-10_B'); assert.equal(writes[0].data.horarios[2].salida,'22:00'); assert.equal(await leave(),false); assert.ok(!dialogs.some(dialog => dialog?.icon==='success'));
  failWrite=false; await state.retrySchedule(); assert.equal(state.pendingSchedule,false);
  state.turnoActivo='A'; await Vue.nextTick(); state.turnoActivo='C'; await Vue.nextTick();
  reads[2].resolve({ exists:() => true,data:() => ({ horarios:{ 99:{ ingreso:'00:00' } } }) }); await new Promise(resolve => setImmediate(resolve)); assert.equal(state.registroDia.length,0);
  reads[3].resolve({ exists:() => false }); await new Promise(resolve => setImmediate(resolve)); assert.equal(state.isLoading,false); assert.equal(state.registroDia.length,0);
  assert.deepEqual(errors,[]); app.unmount();
});

test('stop workspace filters records, preserves failed drafts, validates time and updates the original night document', async () => {
  const { descriptor }=parse(fs.readFileSync(new URL('../src/components/ParosAnudado.vue',import.meta.url),'utf8'));
  const script=compileScript(descriptor,{ id:'stops-test' });
  const template=compileTemplate({ id:'stops-test',source:descriptor.template.content,compilerOptions:{ bindingMetadata:script.bindings } });
  assert.deepEqual(template.errors,[]);
  const subscriptions=[],writes=[],role=Vue.ref('admin'),profile=Vue.ref({ role:'admin' });
  let finishWrite,confirm=false,leave;
  const record={ id:'night',fechaDocumento:'2026-10-12',fecha:'2026-10-11',telar:'35001',codigo:'101',horaParo:'23:50',horaInicioAnudado:'00:00',horaFinAnudado:'00:10',tiempoTotal:'20',turno:'C',articulo:'AF311',partida:'0-1234-56',anudadores:[352],revisor:77 };
  const dependencies={ vue:Vue,'vue-router':{ onBeforeRouteLeave:callback => { leave=callback; } },'lucide-vue-next':icons,'../utils/plantTime':{ shiftSlot:() => ({ fecha:'2026-10-11',turno:'C' }),addDays },'../composables/usePlantClock':{ usePlantClock:() => Vue.ref(new Date()) },'../constants/organization':{ getTurnoActual:() => 'C' },'../firebase/config':{ db:{},auth:{ currentUser:{ uid:'admin',displayName:'Supervisor' } } },'../services/authService':{ userRole:role,userProfile:profile },'../services/profileService':{ canAccessViewForUser:() => role.value==='admin' },'../utils/sectorScope':{ getSectorScope:() => ['TEJEDURIA'] },'../utils/tooltipDirective':{ vTippy },'./PlantDatePicker.vue':{ render:() => Vue.h('button','Fecha') },sweetalert2:{ fire:async () => ({ isConfirmed:confirm }) },'firebase/firestore':{ collection:() => 'machines',query:value => value,getDocs:async () => ({ docs:[{ id:'m',data:() => ({ maquina:'35001',tipo:'TELAR',activo:true }) }] }) },'../services/paroTelarService':{ suscribirParos:(day,callback,onError) => { const subscription={ day,callback,onError,stopped:false }; subscriptions.push(subscription); return () => { subscription.stopped=true; }; },crearParo:(day,data) => { writes.push({ type:'create',day,data }); return new Promise((resolve,reject) => { finishWrite={ resolve,reject }; }); },actualizarParo:(day,id,data) => { writes.push({ type:'update',day,id,data }); return new Promise((resolve,reject) => { finishWrite={ resolve,reject }; }); },eliminarParo:async () => {} } };
  const component=evaluate(script.content,dependencies); component.render=evaluate(template.code,dependencies);
  const { renderer,root }=host(),app=renderer.createApp(component),errors=[]; app.config.errorHandler=error => errors.push(error); app.mount(root); const state=root._vnode.component.setupState;
  await new Promise(resolve => setImmediate(resolve)); subscriptions[0].callback([record,{ ...record,id:'other',telar:'35064',codigo:102,turno:'A',horaFinAnudado:'',tiempoTotal:30,hilosCruzados:true }]);
  assert.equal(state.parosFiltrados.length,2); assert.equal(state.stats.tiempoStr,'0:50'); assert.equal(state.stats.termino,1);
  state.search='64'; assert.equal(state.parosFiltrados.length,1); state.search=''; state.shiftFilter='C'; assert.equal(state.parosFiltrados.length,1); state.shiftFilter=''; state.stateFilter='crossed'; assert.equal(state.parosFiltrados.length,1); state.stateFilter='';
  state.abrirEdicion(record); assert.equal(state.form.revisor,'77'); assert.equal(state.form.anudadores[0],'352');
  state.onHoraInput({ target:{ value:'9999',dataset:{} } },'horaParo'); await state.guardar(); assert.match(state.formError,/horarios/); assert.equal(writes.length,0);
  state.onHoraInput({ target:{ value:'2350',dataset:{} } },'horaParo'); state.form.color='ABCD'; assert.equal(state.tiempoTotal,20);
  assert.equal(await state.cerrarForm(),false); assert.equal(await leave(),false);
  const failed=state.guardar(); await state.guardar(); assert.equal(writes.length,1); assert.equal(writes[0].day,'2026-10-12'); assert.equal(writes[0].data.turno,'C');
  finishWrite.reject(new Error('Offline')); await failed; assert.equal(state.mostrarForm,true); assert.equal(state.form.color,'ABCD'); assert.equal(state.formError,'Offline');
  const saved=state.guardar(); finishWrite.resolve(); await saved; assert.equal(state.mostrarForm,false);
  state.fechaInput='2026-10-10'; await Vue.nextTick(); assert.equal(subscriptions[0].stopped,true); subscriptions[0].callback([record]); assert.equal(state.paros.length,0); subscriptions[1].onError(new Error('Permission denied')); assert.equal(state.cargando,false); assert.equal(state.error,'Permission denied');
  role.value='mecanico'; profile.value={ role:'mecanico' }; state.abrirEdicion(record); state.form.color='READ'; const count=writes.length; await state.guardar(); assert.equal(writes.length,count); assert.equal(state.dirty,false);
  assert.deepEqual(errors,[]); app.unmount(); assert.equal(subscriptions[1].stopped,true);
});

test('stop subscription reports failures and retains normalized night records from the following day', () => {
  const source=fs.readFileSync(new URL('../src/services/paroTelarService.js',import.meta.url),'utf8');
  const calls=[],updates=[],failures=[];
  const dependencies={ '../firebase/config':{ db:{} },'../utils/plantTime':{ SHIFT_DATE_CRITERION:'inicio_turno',addDays,normalizeShiftRecord:record => ({ ...record,fecha:record.turno==='C' ? '2026-10-11':record.fecha }) },'firebase/firestore':{ collection:(db,...path) => path.join('/'),query:(...args) => args,orderBy:() => 'createdAt',onSnapshot:(query,callback,onError) => { calls.push({ query,callback,onError,stopped:false }); return () => { calls.at(calls.findIndex(item => item.callback===callback)).stopped=true; }; } } };
  const service=evaluate(source.replace(/export (async function|function)/g,'$1')+'\nreturn { suscribirParos };',dependencies);
  const stop=service.suscribirParos('2026/10/11',records => updates.push(records),error => failures.push(error));
  assert.equal(calls.length,2); calls[0].callback({ docs:[] }); assert.equal(updates.length,0);
  calls[1].callback({ docs:[{ id:'night',data:() => ({ fecha:'2026-10-12',turno:'C' }) }] }); assert.equal(updates[0][0].fechaDocumento,'2026-10-12');
  calls[0].onError(new Error('Failed')); assert.equal(failures[0].message,'Failed'); stop(); assert.ok(calls.every(call => call.stopped));
});

test('user administration renders all tabs and keeps role/sector drafts isolated until an authorized save', async () => {
  const organizationSource=fs.readFileSync(new URL('../src/constants/organization.js',import.meta.url),'utf8');
  const names=[...organizationSource.matchAll(/export const (\w+)/g)].map(match => match[1]);
  const organization=evaluate(organizationSource.replace(/export const/g,'const')+`\nreturn { ${names.join(',')} };`,{ '../utils/plantTime':{ plantShift:() => 'A' } });
  const { descriptor }=parse(fs.readFileSync(new URL('../src/components/Usuarios.vue',import.meta.url),'utf8'));
  const script=compileScript(descriptor,{ id:'users-test' });
  const template=compileTemplate({ id:'users-test',source:descriptor.template.content,compilerOptions:{ bindingMetadata:script.bindings } });
  assert.deepEqual(template.errors,[]);
  const role=Vue.ref('admin'),writes=[],override=Vue.ref({}); let failWrite=true,confirm=false,leave,failLoad=false;
  const employee={ id:'legacy',email:'legacy@example.test',displayName:'José Operador',role:'mecanico',sectorDefault:'TEJEDURIA',sectoresAsignados:['TEJEDURIA'] };
  const dependencies={ vue:Vue,'vue-router':{ onBeforeRouteLeave:callback => { leave=callback; } },'lucide-vue-next':icons,'../firebase/config':{ db:{} },'../services/authService':{ userRole:role },'../constants/organization':organization,'../utils/tooltipDirective':{ vTippy },sweetalert2:{ fire:async () => ({ isConfirmed:confirm }) },'../services/profileService':{ profileOverrides:override,loadProfiles:async () => {},saveProfiles:async () => {},getEffectiveVistas:r => organization.ROLE_PROFILES[r]?.vistas || [],getEffectivePermisos:r => organization.ROLE_PROFILES[r]?.permisos || {},getDefaultRoute:() => '/',getEffectiveDescripcion:r => organization.ROLE_PROFILES[r]?.descripcion || '',getEffectiveNivel:r => organization.ROLE_PROFILES[r]?.nivel || 'operativo',getEffectiveSectorDefault:() => 'TEJEDURIA' },'firebase/firestore':{ collection:() => 'usuarios',doc:(db,...path) => path.join('/'),query:() => assert.fail('User listing must include documents without createdAt'),orderBy:() => assert.fail('No date-only listing'),getDoc:async () => { if(failLoad) throw new Error('Config offline'); return { exists:() => true,data:() => ({ roles:organization.ROLE_OPTIONS,sectores:['TEJEDURIA','HILANDERIA'] }) }; },getDocs:async () => ({ docs:[{ id:employee.id,data:() => employee },{ id:'unapproved',data:() => ({ displayName:'Sin rol' }) }] }),setDoc:async () => {},updateDoc:async (path,data) => { writes.push({ path,data }); if(failWrite) throw new Error('Write failed'); } } };
  const component=evaluate(script.content,dependencies); component.render=evaluate(template.code,dependencies);
  const { renderer,root }=host(),app=renderer.createApp(component),errors=[]; app.config.errorHandler=error => errors.push(error); app.mount(root); const state=root._vnode.component.setupState;
  await new Promise(resolve => setImmediate(resolve)); assert.equal(state.isLoading,false); assert.equal(state.usuarios.length,2); assert.equal(state.usuarios.find(user => user.id==='unapproved').role,'pendiente');
  state.searchQuery='jose'; assert.equal(state.filteredUsuarios.length,1); state.searchQuery=''; state.filterSector='HILANDERIA'; assert.equal(state.filteredUsuarios.length,1); state.filterSector='';
  state.activeTab='perfiles'; await Vue.nextTick(); assert.ok(state.rolesByNivel.length); state.perfilesViewMode='editor'; await Vue.nextTick(); state.activeTab='config'; await Vue.nextTick(); state.activeTab='usuarios'; await Vue.nextTick();
  const original=state.usuarios.find(user => user.id==='legacy'); state.selectUser(original); state.selectedUser.role='inspector'; state.selectedUser.sectoresAsignados.push('HILANDERIA');
  assert.equal(original.role,'mecanico'); assert.deepEqual(original.sectoresAsignados,['TEJEDURIA']); assert.equal(state.isDirty,true);
  assert.equal(await state.closeUser(),false); assert.equal(await leave(),false);
  await state.guardarConfiguracion(state.selectedUser); assert.equal(state.saveError,'Write failed'); assert.equal(original.role,'mecanico'); assert.equal(state.selectedUser.role,'inspector');
  failWrite=false; await state.guardarConfiguracion(state.selectedUser); assert.equal(original.role,'inspector'); assert.deepEqual(original.sectoresAsignados,['TEJEDURIA','HILANDERIA']); assert.equal(state.isDirty,false);
  await state.closeUser(); assert.equal(state.selectedUser,null); state.selectUser(original); role.value='mecanico'; const count=writes.length; await state.guardarConfiguracion(state.selectedUser); assert.equal(writes.length,count); await state.closeUser(); role.value='admin';
  failLoad=true; await state.reloadAll(); assert.equal(state.isLoading,false); assert.match(state.loadError,/configuración/); failLoad=false; await state.reloadAll(); assert.equal(state.loadError,'');
  assert.deepEqual(errors,[]); app.unmount();
});

test('preview applies role sectors and defaults, restores on cancellation and never restores after logout', async () => {
  const source=fs.readFileSync(new URL('../src/constants/organization.js',import.meta.url),'utf8');
  const names=[...source.matchAll(/export const (\w+)/g)].map(match => match[1]);
  const organization=evaluate(source.replace(/export const/g,'const')+`\nreturn { ${names.join(',')} };`,{ '../utils/plantTime':{ plantShift:() => 'A' } });
  const builder=evaluate(fs.readFileSync(new URL('../src/utils/previewProfile.js',import.meta.url),'utf8').replace('export function','function')+'\nreturn { buildPreviewProfile };',{ '../constants/organization':organization }).buildPreviewProfile;
  const administrator={ role:'admin',sectorDefault:'TEJEDURIA',sectoresAsignados:['TEJEDURIA','HILANDERIA'],alcance:'global',vistasPersonalizadas:['usuarios'],permisosPersonalizados:{ configSistema:true } };
  assert.throws(() => builder({ role:'mecanico' },'inspector','TEJEDURIA'),/administración/);
  assert.throws(() => builder(administrator,'unknown','TEJEDURIA'),/válidos/);
  const profile=Vue.ref(administrator),role=Vue.ref('admin'),sector=Vue.ref(null),user=Vue.ref({ uid:'admin' });
  let navigate=async () => undefined;
  const appSource=fs.readFileSync(new URL('../src/App.vue',import.meta.url),'utf8');
  const code=appSource.slice(appSource.indexOf('// Preview changes'),appSource.indexOf('const closeMenu'));
  const preview=new Function('ref','computed','watch','userProfile','userRole','previewSector','user','buildPreviewProfile','router','getDefaultRouteForUser','isNavigationFailure','Swal','closeMenu',code+'\nreturn { simulateProfile,exitPreview,isPreviewMode,realProfile,previewBusy };')(Vue.ref,Vue.computed,Vue.watch,profile,role,sector,user,builder,{ push:path => navigate(path) },()=>'/patrulla',result=>Boolean(result?.type),{ fire:async () => {} },()=>{});
  await preview.simulateProfile({ role:'inspector',sector:'HILANDERIA' }); assert.equal(role.value,'inspector'); assert.equal(profile.value.role,'inspector'); assert.deepEqual(profile.value.sectoresAsignados,['HILANDERIA']); assert.equal(profile.value.vistasPersonalizadas,null); assert.equal(profile.value.permisosPersonalizados,null); assert.equal(profile.value.alcance,'sector'); assert.equal(preview.isPreviewMode.value,true);
  navigate=async () => ({ type:4 }); await preview.simulateProfile({ role:'auxiliar',sector:'TEJEDURIA' }); assert.equal(role.value,'inspector'); assert.equal(sector.value,'HILANDERIA');
  navigate=async () => undefined; await preview.exitPreview(); assert.equal(role.value,'admin'); assert.deepEqual(profile.value.vistasPersonalizadas,['usuarios']); assert.equal(preview.isPreviewMode.value,false);
  let rejectNavigation; navigate=() => new Promise((resolve,reject) => { rejectNavigation=reject; });
  const changing=preview.simulateProfile({ role:'auxiliar',sector:'TEJEDURIA' });
  user.value=null; profile.value=null; role.value=null; await Vue.nextTick(); rejectNavigation(new Error('Signed out')); await changing;
  assert.equal(profile.value,null); assert.equal(role.value,null); assert.equal(preview.isPreviewMode.value,false); assert.equal(preview.previewBusy.value,false);
});

test('account panel displays configured role views and emits one role/sector simulation request', async () => {
  const source=fs.readFileSync(new URL('../src/constants/organization.js',import.meta.url),'utf8'); const names=[...source.matchAll(/export const (\w+)/g)].map(match => match[1]);
  const organization=evaluate(source.replace(/export const/g,'const')+`\nreturn { ${names.join(',')} };`,{ '../utils/plantTime':{ plantShift:() => 'A' } });
  const { descriptor }=parse(fs.readFileSync(new URL('../src/components/AccountPanel.vue',import.meta.url),'utf8'));
  const script=compileScript(descriptor,{ id:'account-test' }),template=compileTemplate({ id:'account-test',source:descriptor.template.content,compilerOptions:{ bindingMetadata:script.bindings } }); assert.deepEqual(template.errors,[]);
  const dependencies={ vue:Vue,'lucide-vue-next':icons,'../constants/organization':organization,'../utils/tooltipDirective':{ vTippy },'../services/profileService':{ getEffectiveVistas:()=>['shiftreport','operarios'],getEffectivePermisos:()=>({ verCalidad:true,configSistema:false }),getEffectiveSectorDefault:()=> 'TEJEDURIA' } };
  const component=evaluate(script.content,dependencies); component.render=evaluate(template.code,dependencies);
  const { renderer,root }=host(),app=renderer.createApp(component,{ canPreview:true,profile:{ role:'admin',nombre:'Administrador',sectoresAsignados:['TEJEDURIA'] } }),errors=[]; app.config.errorHandler=error => errors.push(error); app.mount(root);
  const state=root._vnode.component.setupState; state.role='auxiliar'; state.chooseRole(); await Vue.nextTick(); assert.equal(state.sector,'TEJEDURIA'); assert.deepEqual(state.views.map(view=>view.slug),['shiftreport','operarios']); assert.equal(state.permissions.length,1); assert.deepEqual(errors,[]); app.unmount();
});

test('patrol decimal validation and atomic saves preserve conflicts and compute the night round evaluation', async () => {
  const utilitySource=fs.readFileSync(new URL('../src/utils/patrolSheet.js',import.meta.url),'utf8');
  const utility=evaluate(utilitySource.replace(/export function/g,'function')+'\nreturn { patrolValue,comparePatrol,patrolSummary,stablePatrol };',{});
  assert.equal(utility.patrolValue('1,3'),1.3); assert.equal(utility.patrolValue('10.5'),10.5); assert.equal(utility.patrolValue('0'),0); assert.equal(utility.patrolValue(''),null); assert.throws(()=>utility.patrolValue('1,33')); assert.throws(()=>utility.patrolValue('-1'));
  assert.equal(utility.comparePatrol(1.3,2.3),'peor'); assert.equal(utility.comparePatrol(10.5,8),'mejor'); assert.equal(utility.comparePatrol(null,0),'missing');
  let stored={ inspectorUid:'inspector',fecha:'2026-10-11',turno:'C',rondas:{ ronda_1:{ completada:true,datos:{ a:{ roU:1.3,roT:10.5 } } },ronda_2:{ completada:true },ronda_3:{ completada:true },ronda_4:{ completada:true },ronda_5:{ completada:true } } }; const writes=[];
  const source=fs.readFileSync(new URL('../src/services/patrolSheetService.js',import.meta.url),'utf8');
  const service=evaluate(source.replace('export async function','async function')+'\nreturn { savePatrolSheet };',{ '../firebase/config':{ db:{} },'../utils/patrolSheet':utility,'firebase/firestore':{ doc:()=> 'patrol',runTransaction:async (db,work)=>work({ get:async ()=>({ exists:()=>true,data:()=>stored }),update:(reference,data)=>writes.push(data) }) } });
  const saved=await service.savePatrolSheet('p','ronda_6',{}, { a:{ roU:2.3,roT:8 } },true,{ rutaId:'route' });
  assert.equal(saved.fecha,'2026-10-11'); assert.equal(saved.turno,'C'); assert.equal(saved.rondas.ronda_7.completada,true); assert.deepEqual(saved.rondas.ronda_7.resumen,{ mejoras:1,empeoramientos:1,leves:0,iguales:0 }); assert.equal(writes[0]['rondas.ronda_6'].rutaId,'route');
  stored=saved; await assert.rejects(service.savePatrolSheet('p','ronda_6',{}, {},false),/cambió/); assert.equal(writes.length,1);
  const reopened=await service.savePatrolSheet('p','ronda_1',stored.rondas.ronda_1,{},false,{},true); assert.equal(reopened.rondas.ronda_7.completada,false); assert.deepEqual(reopened.rondas.ronda_1.datos,stored.rondas.ronda_1.datos);
  stored={ rondas:{} }; await assert.rejects(service.savePatrolSheet('p','ronda_2',{}, {},false),/anterior/);
});

test('patrol sheet renders the route order, preserves failed decimal drafts and distinguishes partial from completed saves', async t => {
  const previousWindow=globalThis.window; globalThis.window={ innerWidth:800,addEventListener() {},removeEventListener() {} }; t.after(()=>{ if(previousWindow===undefined) delete globalThis.window; else globalThis.window=previousWindow; });
  const utility=evaluate(fs.readFileSync(new URL('../src/utils/patrolSheet.js',import.meta.url),'utf8').replace(/export function/g,'function')+'\nreturn { patrolValue,comparePatrol };',{});
  const { descriptor }=parse(fs.readFileSync(new URL('../src/components/PatrullaPlanilla.vue',import.meta.url),'utf8'));
  const script=compileScript(descriptor,{ id:'patrol-sheet-test' }),template=compileTemplate({ id:'patrol-sheet-test',source:descriptor.template.content,compilerOptions:{ bindingMetadata:script.bindings } }); assert.deepEqual(template.errors,[]);
  const patrol={ id:'p',sector:'TEJEDURIA',turno:'C',fecha:'2026-10-11',inspectorNombre:'Inspector',rondas:{} },writes=[]; let confirm=false,fail=true,leave;
  const dependencies={ vue:Vue,'vue-router':{ useRouter:()=>({ push() {} }),onBeforeRouteLeave:callback=>{ leave=callback; } },'lucide-vue-next':icons,'../firebase/config':{ db:{} },'../services/authService':{ userProfile:Vue.ref({ role:'inspector',nombre:'Inspector',sectorDefault:'TEJEDURIA' }),userRole:Vue.ref('inspector') },'../utils/patrolSheet':utility,'../utils/tooltipDirective':{ vTippy },'../constants/organization':{ DEFECTOS_TRAMA:[{ id:'hilo_doble',label:'Hilo doble' }],ESTADOS_TELAR:[{ id:'trabajando',label:'Trabajando' }] },sweetalert2:{ fire:async()=>({ isConfirmed:confirm }) },'firebase/auth':{ getAuth:()=>({ currentUser:{ uid:'inspector' } }) },'firebase/firestore':{ collection:()=> 'machines',getDocs:async()=>({ docs:[{ id:'a',data:()=>({ maquina:'35001',tipo:'TELAR',sector:'TEJEDURIA',activo:true }) },{ id:'b',data:()=>({ maquina:'35064',tipo:'TELAR',sector:'TEJEDURIA',activo:true }) }] }) },'../services/patrullaService':{ cargarRutasPatrulla:async()=>[{ id:'route',nombre:'Recorrido',maquinas:[{ maquinaId:'b',orden:1 },{ maquinaId:'a',orden:2 }] }],loadPatrullaConfig:async()=>({ umbralRoturaU:2,umbralRoturaT:3 }),cargarPatrullaPorId:async()=>patrol,crearPatrulla:async()=>({ id:'p' }) },'../services/patrolSheetService':{ savePatrolSheet:async(id,key,baseline,data,complete,meta)=>{ writes.push({ id,key,data,complete,meta }); if(fail) throw new Error('Offline'); return { ...patrol,rondas:{ ...patrol.rondas,[key]:{ datos:data,completada:complete,...meta } } }; } } };
  const component=evaluate(script.content,dependencies); component.render=evaluate(template.code,dependencies); const { renderer,root }=host(),app=renderer.createApp(component,{ patrulla:patrol,canEdit:true }),errors=[]; app.config.errorHandler=error=>errors.push(error); app.mount(root); const state=root._vnode.component.setupState;
  await new Promise(resolve=>setImmediate(resolve)); assert.equal(state.loading,false); assert.deepEqual(state.rows.map(machine=>machine.id),['b','a']); assert.equal(state.full,false); assert.equal(state.writable,true);
  state.numberInput('b','roU',{ target:{ value:'10,5' } }); state.numberInput('b','roT',{ target:{ value:'0' } }); assert.equal(state.dirty,true); assert.equal(await leave(),false);
  await state.save(false); assert.equal(state.error,'Offline'); assert.equal(state.draft.b.roU,'10,5'); assert.equal(writes[0].data.b.roU,10.5); assert.equal(writes[0].data.b.roT,0); assert.equal(writes[0].complete,false);
  fail=false; await state.save(false); assert.equal(state.dirty,false); confirm=true; await state.save(true); assert.equal(writes.at(-1).complete,true); assert.equal(state.writable,false);
  state.presentation='full'; assert.equal(state.full,true); state.active=3; state.seed(); assert.equal(state.writable,false); state.openCell(3,state.rows[0]); await Vue.nextTick(); assert.deepEqual(errors,[]); app.unmount();
  const emptyHost=host(),emptyApp=emptyHost.renderer.createApp(component,{ patrulla:null,canEdit:true }); emptyApp.config.errorHandler=error=>errors.push(error); emptyApp.mount(emptyHost.root);
  const emptyState=emptyHost.root._vnode.component.setupState; await new Promise(resolve=>setImmediate(resolve)); emptyState.presentation='full'; await Vue.nextTick();
  assert.equal(emptyState.patrol,null); assert.equal(emptyState.error,''); assert.equal(emptyState.rows.length,2); assert.equal(emptyState.writable,false);
  const hasTable=node=>node.type==='table' || node.children.some(hasTable); assert.equal(hasTable(emptyHost.root),true); assert.deepEqual(errors,[]); emptyApp.unmount();
});
