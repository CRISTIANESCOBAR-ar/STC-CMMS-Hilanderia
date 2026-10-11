import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userProfile } from './authService';
import { loadFaultEventsPage } from './faultEvents';

export async function collectHistoryPages(sectors, options, assertCurrent = () => {}) {
  const records = new Map();
  let cursor = null, hasMore = true;
  while (hasMore) {
    assertCurrent();
    const page = await loadFaultEventsPage(db, sectors, options, cursor);
    assertCurrent();
    for (const record of page.events) records.set(record.id, record);
    cursor = page.cursor; hasMore = page.hasMore;
    if (hasMore && !cursor) throw new Error('No se pudo continuar la exportación. Reintentá.');
  }
  return [...records.values()];
}

export async function updateHistoryState(record, state) {
  if (userProfile.value?.role !== 'admin') throw new Error('Solo el administrador puede cambiar el estado desde el histórico.');
  if (!['pendiente', 'en proceso', 'resuelto'].includes(state)) throw new Error('Estado no válido.');
  const reference = doc(db, 'novedades', record.id);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('El reporte ya no existe.');
    if (snapshot.data().estado !== record.estado) throw new Error('Otro usuario cambió el estado. Actualizá el historial antes de reintentar.');
    transaction.update(reference, { estado:state, updatedAt:serverTimestamp() });
  });
}
