import { ref, getBlob } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { storage, app } from '../firebase/config';
import { operationalImagePath } from '../utils/operationalImagePath';
import Swal from 'sweetalert2';
import { sessionUser } from './authService';

const finalize = httpsCallable(getFunctions(app, 'us-central1'), 'finalizeOperationalUpload', { timeout: 65_000 });
export async function finalizeOperationalUpload(fileRef) {
  await finalize({ path: fileRef.fullPath });
  return fileRef.fullPath;
}

export async function loadOperationalImage(source) {
  const path = operationalImagePath(source, app.options.storageBucket);
  const blob = await getBlob(ref(storage, path), 10 * 1024 * 1024);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new Error('Formato de imagen no autorizado.');
  return URL.createObjectURL(blob);
}

export async function showOperationalImage(source) {
  const uid = sessionUser.value?.uid;
  if (!uid) return;
  Swal.fire({ title: 'Cargando foto…', didOpen: () => Swal.showLoading(), showConfirmButton: false });
  let objectUrl;
  try {
    objectUrl = await loadOperationalImage(source);
    if (sessionUser.value?.uid !== uid) { Swal.close(); return; }
    await Swal.fire({ imageUrl: objectUrl, imageAlt: 'Foto de la incidencia', showCloseButton: true,
      showConfirmButton: false, width: 'min(90vw, 900px)' });
  } catch {
    await Swal.fire('Foto no disponible', 'No se pudo cargar la imagen. Verificá tu conexión y permisos.', 'warning');
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
