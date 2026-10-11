import test from 'node:test';
import assert from 'node:assert/strict';
import { faultEventWindow, filterFaultEvents } from '../src/utils/faultEvents.js';

test('fault windows preserve the night shift start and use plant midnight for today', () => {
  const now = new Date('2026-10-11T05:00:00Z'); // Sunday 02:00 in plant.
  const shift = faultEventWindow('shift', now);
  assert.equal(shift.from.toISOString(), '2026-10-11T01:00:00.000Z');
  assert.equal(shift.to.toISOString(), '2026-10-11T09:00:00.000Z');
  assert.equal(faultEventWindow('today', now).from.toISOString(), '2026-10-11T03:00:00.000Z');
  assert.equal(faultEventWindow('week', now).from.toISOString(), '2026-10-05T03:00:00.000Z');
  const older = faultEventWindow('older', now);
  assert.equal(older.pendingOnly, true);
  assert.equal(older.from, null);
  assert.equal(older.to.toISOString(), shift.from.toISOString());
});

test('fault filters combine category, status and accent-insensitive search without reordering', () => {
  const events = [
    { id:'1', tipoProblema:'Mecánico', estado:'pendiente', numeroMaquina:35001, observaciones:'Pérdida de aceite' },
    { id:'2', tipoProblema:'Eléctrico', estado:'en proceso', numeroMaquina:35002, observaciones:'Motor' },
    { id:'3', estado:'pendiente', numeroMaquina:35003 },
  ];
  assert.deepEqual(filterFaultEvents(events, { category:'Mecánico', state:'pendiente', search:'perdida' }).map(e => e.id), ['1']);
  assert.deepEqual(filterFaultEvents(events, { category:'other' }).map(e => e.id), ['3']);
  assert.deepEqual(filterFaultEvents(events, { search:'35002' }).map(e => e.id), ['2']);
  assert.deepEqual(filterFaultEvents(events).map(e => e.id), ['1', '2', '3']);
});

test('custom fault ranges include the whole last day and reject reversed or excessive windows', () => {
  const range = faultEventWindow('range', new Date(), { from:'2026-10-01', to:'2026-10-11' });
  assert.equal(range.from.toISOString(), '2026-10-01T03:00:00.000Z');
  assert.equal(range.to.toISOString(), '2026-10-12T03:00:00.000Z');
  assert.throws(() => faultEventWindow('range', new Date(), { from:'2026-10-12', to:'2026-10-11' }));
  assert.throws(() => faultEventWindow('range', new Date(), { from:'2026-09-01', to:'2026-10-11' }));
});
