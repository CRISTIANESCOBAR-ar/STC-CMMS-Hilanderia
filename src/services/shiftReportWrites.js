import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { checkShiftChanges } from '../utils/shiftGrid.js';

/** Save only edited records, atomically, without overwriting a concurrent edit. */
export async function saveManualShiftChanges(db, fecha, changes) {
  if (!changes.length) return;
  const docRef = doc(db, 'shift_reports', fecha.replaceAll('/', '-'));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(docRef);
    checkShiftChanges(snapshot.exists() ? snapshot.data().registros || {} : {}, changes);
    if (snapshot.exists()) {
      const patch = { updatedAt: serverTimestamp() };
      for (const change of changes) patch['registros.' + change.key] = change.data;
      transaction.update(docRef, patch);
    } else {
      transaction.set(docRef, { fecha, csvMeta: null, registros: Object.fromEntries(changes.map(change => [change.key, change.data])), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
  });
}
