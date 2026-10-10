import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatestLoad } from '../src/utils/latestLoad.js';
import { compareCatalogItems } from '../src/utils/catalogSort.js';

test('stalled catalog stops loading and allows successful retry', async () => {
  let state;
  const loader = createLatestLoad(next => { state = next; }, 10);
  await loader.run(() => new Promise(() => {}));
  assert.equal(state.loading, false);
  assert.equal(state.error.code, 'load/timeout');
  await loader.run(() => ['catalog']);
  assert.deepEqual(state.data, ['catalog']);
  assert.equal(state.error, null);
});

test('permission errors stop loading without being confused with empty catalog', async () => {
  let state;
  await createLatestLoad(next => { state = next; }).run(() => { throw { code: 'permission-denied' }; });
  assert.equal(state.loading, false);
  assert.equal(state.error.code, 'permission-denied');
  assert.equal(state.data, undefined);
});

test('an old model response cannot replace the latest selection', async () => {
  let state, resolveOld;
  const loader = createLatestLoad(next => { state = next; });
  const old = loader.run(() => new Promise(resolve => { resolveOld = resolve; }));
  await Promise.resolve();
  await loader.run(() => ['new']);
  resolveOld(['old']);
  await old;
  assert.deepEqual(state.data, ['new']);
});

test('catalog sort accepts legacy fields that are absent, null or numeric', () => {
  const items = [{ seccion: 2, denominacion: null }, {}, { seccion: 'A', grupo: 1, denominacion: 'Pieza' }];
  assert.doesNotThrow(() => items.sort(compareCatalogItems));
  assert.equal(items.length, 3);
});
