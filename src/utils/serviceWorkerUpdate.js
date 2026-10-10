export function isAppRegistration(registration, origin) {
  return registration.scope === `${origin}/`;
}

export function createUpdateNoticeTracker() {
  const seen = new WeakSet();
  return worker => {
    if (!worker || seen.has(worker)) return false;
    seen.add(worker);
    return true;
  };
}

export async function activateWaitingWorker(registration, { timeoutMs = 15000 } = {}) {
  const worker = registration?.waiting;
  if (!worker) throw new Error('La actualización ya no está disponible. Volvé a comprobarla.');
  await new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', changed);
      error ? reject(error) : resolve();
    };
    const changed = () => {
      if (worker.state === 'activated') finish();
      else if (worker.state === 'redundant') finish(new Error('No se pudo activar la actualización.'));
    };
    const timer = setTimeout(() => finish(new Error('La actualización demoró demasiado. Intentá nuevamente.')), timeoutMs);
    worker.addEventListener('statechange', changed);
    worker.postMessage({ type: 'SKIP_WAITING' });
    changed();
  });
}
