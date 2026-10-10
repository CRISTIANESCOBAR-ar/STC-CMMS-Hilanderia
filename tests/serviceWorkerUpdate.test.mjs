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
