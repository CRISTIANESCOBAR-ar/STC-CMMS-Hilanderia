import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import * as icons from 'lucide-vue-next';
import { catalogColumnLayout } from '../src/utils/catalogColumnLayout.js';
import { createLatestLoad } from '../src/utils/latestLoad.js';

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
    '../utils/plantTime': plantTime, '../utils/shiftGrid': shiftGrid,
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
    let focused;
    let selected = 0;
    state.gridElement.querySelector = selector => ({ readOnly: false, focus() { focused = selector; }, select() { selected++; } });
    state.gridInput({ target: { value: '261' } }, '35001', 'A', state.gridFields[0], 0);
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
