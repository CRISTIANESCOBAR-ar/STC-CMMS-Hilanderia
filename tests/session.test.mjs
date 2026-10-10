import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionLoader, withTimeout } from '../src/services/sessionLoader.js';

test('profile load failure leaves no operational identity or fallback role', async () => {
  let state;
  const failure = new Error('Permission denied');
  const refresh = createSessionLoader(async () => { throw failure; }, value => { state = value; });
  await refresh({ uid: 'inspector' });
  assert.equal(state.user, null);
  assert.equal(state.profile, null);
  assert.equal(state.error, failure);
  assert.equal(state.loading, false);
});

test('anonymous identity does not load or receive a profile', async () => {
  let state;
  const refresh = createSessionLoader(async () => { assert.fail('Anonymous must not fetch profile'); }, value => { state = value; });
  await refresh({ uid: 'guest', isAnonymous: true });
  assert.equal(state.user, null);
  assert.equal(state.profile, null);
  assert.match(state.error.message, /Google/);
});

test('late profile cannot restore privileges after logout', async () => {
  let finish;
  let state;
  const refresh = createSessionLoader(() => new Promise(resolve => { finish = resolve; }), value => { state = value; });
  const loading = refresh({ uid: 'admin' });
  await refresh(null);
  finish({ role: 'admin' });
  assert.equal(await loading, false);
  assert.equal(state.user, null);
  assert.equal(state.profile, null);
});

test('account switch keeps newest identity when older load completes last', async () => {
  let finishOld;
  let state;
  const refresh = createSessionLoader(user => user.uid === 'old'
    ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve({ role: 'inspector' }), value => { state = value; });
  const old = refresh({ uid: 'old' });
  await refresh({ uid: 'new' });
  finishOld({ role: 'admin' });
  await old;
  assert.equal(state.user.uid, 'new');
  assert.equal(state.profile.role, 'inspector');
});

test('missing role denies session and stalled loads have a bounded timeout', async () => {
  let state;
  await createSessionLoader(async () => ({}), value => { state = value; })({ uid: 'user' });
  assert.equal(state.profile, null);
  assert.ok(state.error);
  await assert.rejects(withTimeout(new Promise(() => {}), 10), /perfil/);
});
