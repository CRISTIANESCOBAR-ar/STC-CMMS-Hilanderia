export function createLatestLoad(onState, timeoutMs = 15000) {
  let generation = 0;
  let cancel;
  const invalidate = () => { generation++; cancel?.(); cancel = null; };
  return {
    invalidate,
    async run(load) {
      invalidate();
      const current = generation;
      onState({ loading: true, error: null });
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('La carga demoró demasiado. Revisá la conexión e intentá nuevamente.'), { code: 'load/timeout' })), timeoutMs);
        cancel = () => { clearTimeout(timer); reject(new Error('Carga reemplazada')); };
      });
      try {
        const data = await Promise.race([Promise.resolve().then(load), deadline]);
        if (current === generation) onState({ loading: false, error: null, data });
      } catch (error) {
        if (current === generation) onState({ loading: false, error });
      } finally {
        clearTimeout(timer);
        if (current === generation) cancel = null;
      }
    },
  };
}
