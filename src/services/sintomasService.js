import { collection, query, where, getDocs, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userRole } from './authService';
export const symptomFields = ['nombre', 'descripcion', 'categoria', 'derivaA', 'destacado', 'activo'];
const requireAdmin = () => { if (userRole.value !== 'admin') throw new Error('Se requiere permiso de administrador.'); };
export async function loadSymptoms(sector, type) {
  const result = await getDocs(query(collection(db, 'sintomas'), where('sector', '==', sector), where('tipoMaquina', '==', type)));
  return result.docs.map(item => ({ ...item.data(), id:item.id })).sort((a,b) => (a.orden ?? 99) - (b.orden ?? 99) || a.id.localeCompare(b.id));
}
function assertUnchanged(snapshot, baseline, fields) {
  if (!snapshot.exists()) throw new Error('El síntoma ya no existe. Actualizá la lista.');
  if (fields.some(field => JSON.stringify(snapshot.data()[field] ?? null) !== JSON.stringify(baseline[field] ?? null))) throw new Error('Otro usuario modificó este síntoma. Actualizá la lista antes de guardar.');
}
export async function saveSymptom(id, data, baseline = null) {
  requireAdmin();
  const fields = Object.fromEntries(symptomFields.map(field => [field, data[field]]));
  fields.nombre = String(fields.nombre || '').trim(); fields.descripcion = String(fields.descripcion || '').trim();
  if (!fields.nombre) throw new Error('Ingresá el nombre del síntoma.');
  await runTransaction(db, async transaction => {
    const reference = doc(db, 'sintomas', id), snapshot = await transaction.get(reference);
    if (baseline) { assertUnchanged(snapshot, baseline, symptomFields); transaction.update(reference, fields); }
    else {
      if (snapshot.exists()) throw new Error('Ya existe un síntoma con ese nombre para esta máquina.');
      transaction.set(reference, { ...fields, sector:data.sector, tipoMaquina:data.tipoMaquina, orden:data.orden, creadoEn:serverTimestamp() });
    }
  });
}
export async function deleteSymptom(row) {
  requireAdmin();
  await runTransaction(db, async transaction => {
    const reference = doc(db, 'sintomas', row.id), snapshot = await transaction.get(reference);
    assertUnchanged(snapshot, row, symptomFields); transaction.delete(reference);
  });
}
export async function reorderSymptoms(rows) {
  requireAdmin();
  // Normalize the complete order atomically, including legacy duplicate/missing numbers.
  await runTransaction(db, async transaction => {
    const references = rows.map(row => doc(db, 'sintomas', row.id));
    const snapshots = await Promise.all(references.map(reference => transaction.get(reference)));
    snapshots.forEach((snapshot, index) => assertUnchanged(snapshot, rows[index], ['orden']));
    references.forEach((reference, index) => transaction.update(reference, { orden:index + 1 }));
  });
}
