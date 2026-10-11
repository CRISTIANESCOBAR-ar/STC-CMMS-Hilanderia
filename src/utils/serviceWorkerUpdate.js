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
  // Another tab can activate the release while the notice is still visible.
  // Reloading is then sufficient: navigation always fetches fresh HTML.
  const worker = registration?.waiting || registration?.active;
  if (!worker) throw new Error('La actualización ya no está disponible. Volvé a comprobarla.');
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
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
    changed();
    if (!settled && worker.state === 'installed') {
      try { worker.postMessage({ type: 'SKIP_WAITING' }); }
      catch (error) { finish(error); }
    }
  });
}
