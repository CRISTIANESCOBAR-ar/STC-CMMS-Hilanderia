export const SHIFT_GRID_FIELDS = [
  { field: 'picks', label: 'Pts', max: 3 },
  { field: 'weftCount', label: 'Rot T', max: 2, alertAbove: 10 },
  { field: 'warpCount', label: 'Rot U', max: 2, alertAbove: 5 },
  { field: 'otherCount', label: 'Rot O', max: 2 },
  { field: 'rpm', label: 'RPM', max: 3 },
];
export function shiftGridTarget(index, key, count, columns = 15) {
  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns, Enter: 1 }[key];
  if (delta === undefined) return null;
  const target = index + delta;
  return target >= 0 && target < count ? target : index;
}
export function cleanShiftDigits(value, max) {
  return String(value ?? '').replace(/\D/g, '').slice(0, max);
}
const RECORD_FIELDS = ['loom', 'turno', 'rpm', 'picks', 'weftCount', 'warpCount', 'otherCount', 'style', 'beam', 'source'];
export function sameShiftRecord(left, right) {
  if (!left || !right) return !left && !right;
  return RECORD_FIELDS.every(field => (left[field] ?? null) === (right[field] ?? null));
}
/** Validate optimistic baselines before any write in a transaction. */
export function checkShiftChanges(current, changes) {
  for (const change of changes) {
    if (!sameShiftRecord(current[change.key] ?? null, change.base)) {
      const error = new Error(`El telar ${change.data.loom}, turno ${change.data.turno}, cambió en otra sesión.`);
      error.code = 'shiftreport/conflict';
      throw error;
    }
  }
}
