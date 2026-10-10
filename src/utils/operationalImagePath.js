export function operationalImagePath(source, bucket) {
  if (typeof source !== 'string' || !source) throw new Error('Imagen inválida.');
  let path = source;
  if (source.startsWith('gs://')) {
    if (!source.startsWith(`gs://${bucket}/`)) throw new Error('Bucket no autorizado.');
    path = source.slice(`gs://${bucket}/`.length);
  } else if (source.startsWith('https://')) {
    const url = new URL(source);
    const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (url.hostname !== 'firebasestorage.googleapis.com' || !match
        || decodeURIComponent(match[1]) !== bucket) throw new Error('Origen no autorizado.');
    path = decodeURIComponent(match[2]); // Discard download token; never request the source URL.
  }
  if (!/^(novedades|intervenciones)\//.test(path) || path.split('/').some(segment => !segment || segment === '.' || segment === '..')
      || path.includes('\\')) throw new Error('Ruta de imagen inválida.');
  return path;
}
