import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateNoticeTracker, isAppRegistration, activateWaitingWorker } from '../src/utils/serviceWorkerUpdate.js';

test('the same waiting worker is announced once; a later release can be announced', () => {
  const notice = createUpdateNoticeTracker();
  const worker = {};
  assert.equal(notice(worker), true);
  assert.equal(notice(worker), false);
  assert.equal(notice({}), true);
  assert.equal(isAppRegistration({ scope: 'https://plant.example/firebase-messaging/' }, 'https://plant.example'), false);
});

test('update waits for activation instead of reloading after an arbitrary delay', async () => {
  const worker = new EventTarget();
  worker.state = 'installed';
  worker.postMessage = message => { assert.equal(message.type, 'SKIP_WAITING'); };
  let completed = false;
  const update = activateWaitingWorker({ waiting: worker }).then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  worker.state = 'activated';
  worker.dispatchEvent(new Event('statechange'));
  await update;
  assert.equal(completed, true);
});

test('failed activation rejects without reloading or clearing caches', async () => {
  const worker = new EventTarget();
  worker.state = 'installed';
  worker.postMessage = () => { worker.state = 'redundant'; worker.dispatchEvent(new Event('statechange')); };
  await assert.rejects(activateWaitingWorker({ waiting: worker }), /activar/);
  await assert.rejects(activateWaitingWorker({}), /disponible/);
});

test('an update activated by another tab can reload without a waiting worker', async () => {
  const active = new EventTarget(); active.state = 'activated';
  active.postMessage = () => assert.fail('An activated worker needs no skipWaiting message');
  await activateWaitingWorker({ waiting:null, active });
});

test('an activation already underway completes without a duplicate message', async () => {
  const active = new EventTarget(); active.state = 'activating';
  active.postMessage = () => assert.fail('Activation is already underway');
  let done = false;
  const update = activateWaitingWorker({ active }).then(() => { done = true; });
  await Promise.resolve(); assert.equal(done,false);
  active.state = 'activated'; active.dispatchEvent(new Event('statechange')); await update;
  assert.equal(done,true);
});

test('message failures and activation timeouts release the worker listeners', async () => {
  for (const throws of [true,false]) {
    const worker = new EventTarget(); worker.state = 'installed';
    let listeners = 0;
    const add = worker.addEventListener.bind(worker), remove = worker.removeEventListener.bind(worker);
    worker.addEventListener = (...args) => { listeners++; add(...args); };
    worker.removeEventListener = (...args) => { listeners--; remove(...args); };
    worker.postMessage = () => { if (throws) throw new Error('Message failed'); };
    await assert.rejects(activateWaitingWorker({ waiting:worker }, { timeoutMs:5 }), throws ? /Message failed/ : /demoró/);
    assert.equal(listeners,0);
  }
});
