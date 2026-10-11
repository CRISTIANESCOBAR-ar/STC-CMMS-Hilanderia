import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogColumnLayout } from '../src/utils/catalogColumnLayout.js';

test('catalog sizing measures glyph width rather than character count', () => {
  const measureText = text => [...text].reduce((sum, glyph) => sum + (glyph === 'W' ? 15 : 4), 0);
  const narrow = catalogColumnLayout([{ numeroCatalogo: 'I'.repeat(10) }], { measureText });
  const wide = catalogColumnLayout([{ numeroCatalogo: 'W'.repeat(10) }], { measureText });
  assert.equal(narrow.columns[4].maxLength, wide.columns[4].maxLength);
  assert.ok(wide.columns[4].pixels > narrow.columns[4].pixels);
});

test('long descriptions stay bounded while full identifiers determine the scrollable width', () => {
  const layout = catalogColumnLayout([{ seccion: 'S'.repeat(300), denominacion: 'D'.repeat(500), numeroArticulo: 'A'.repeat(50), grupo: null }], { measureText: text => text.length * 10 });
  assert.equal(layout.columns[0].pixels, 260);
  assert.equal(layout.columns[3].pixels, 380);
  assert.equal(layout.columns[5].pixels, 528);
  assert.equal(layout.columns[1].maxLength, 0);
  assert.equal(layout.minWidth, layout.columns.reduce((sum, column) => sum + column.pixels, 104));
  const reader = catalogColumnLayout([], { actions: false });
  assert.equal(reader.minWidth, reader.columns.reduce((sum, column) => sum + column.pixels, 0));
});
