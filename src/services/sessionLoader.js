export function withTimeout(promise, timeoutMs = 12_000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('No se pudo cargar el perfil. Verificá la conexión e intentá ingresar nuevamente.')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Never publishes stale privileges after logout/account switch, or a fallback role. */
export function createSessionLoader(loadProfile, publish) {
  let generation = 0;
  return async (user) => {
    const current = ++generation;
    publish({ user: null, profile: null, error: null, loading: Boolean(user) });
    let profile = null;
    let error = null;
    if (user) {
      try {
        if (user.isAnonymous) throw new Error('Ingresá con Google para acceder al sistema.');
        profile = await withTimeout(loadProfile(user));
        if (!profile?.role) throw new Error('Perfil sin rol asignado. Contactá al administrador.');
      } catch (cause) {
        error = cause;
      }
    }
    if (current !== generation) return false;
    publish({ user: error ? null : user, profile: error ? null : profile, error, loading: false });
    return true;
  };
}
