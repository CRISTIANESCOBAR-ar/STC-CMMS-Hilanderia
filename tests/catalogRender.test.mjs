import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import * as icons from 'lucide-vue-next';
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

function host() {
  const node = (type, text = '') => ({ type, text, children: [], parent: null });
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
    patchProp() {}, querySelector: () => body,
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
