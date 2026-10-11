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
      state.catalogoData = [{ seccion: 'Motor', grupo: '1', subGrupo: 'A', denominacion: 'Motor de accionamiento con una denominación extensa para verificar el renderizado', numeroCatalogo: 'R60-01', numeroArticulo: 'ART-01' }];
      state.showCatalogModal = true;
      await Vue.nextTick();
      assert.equal(state.filteredCatalogo.length, 1);
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
