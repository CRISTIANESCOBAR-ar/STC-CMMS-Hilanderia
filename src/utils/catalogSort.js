export function compareCatalogItems(a, b) {
  for (const field of ['seccion', 'grupo', 'denominacion']) {
    const compared = String(a[field] ?? '').localeCompare(String(b[field] ?? ''));
    if (compared) return compared;
  }
  return 0;
}
