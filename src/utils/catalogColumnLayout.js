/** Size the loaded model, not filtered results, so searching never shifts columns. */
export function catalogColumnLayout(items, { measureText = text => Array.from(text).length * 7.5, actions = true } = {}) {
  const fields = [
    ['seccion', 'Sección', 140, Infinity], ['grupo', 'Grupo', 72, Infinity],
    ['subGrupo', 'Sub-G', 84, Infinity], ['denominacion', 'Denominación', 180, 320],
    ['numeroCatalogo', 'Catálogo', 100, Infinity], ['numeroArticulo', 'Artículo', 100, Infinity],
  ];
  const cache = new Map();
  const measure = value => {
    const text = String(value ?? '');
    if (!cache.has(text)) cache.set(text, measureText(text));
    return cache.get(text);
  };
  const columns = fields.map(([key, label, minimum, maximum]) => {
    let maxLength = 0;
    let pixels = measure(label);
    for (const item of items) {
      const text = String(item[key] ?? '');
      maxLength = Math.max(maxLength, Array.from(text).length);
      pixels = Math.max(pixels, measure(text));
    }
    // Keep descriptions bounded; exact identifiers remain unbroken and fully sized.
    return { key, maxLength, pixels: Math.ceil(Math.max(minimum, Math.min(maximum, pixels + 28))) };
  });
  const contentWidth = columns.reduce((total, column) => total + column.pixels, 0);
  const actionWidth = actions ? 104 : 0;
  for (const column of columns) {
    const ratio = column.pixels / (contentWidth + actionWidth);
    column.width = `${ratio * 100}%`;
  }
  return { columns, actionWidth: `${actionWidth / (contentWidth + actionWidth) * 100}%`, minWidth: contentWidth + actionWidth };
}
