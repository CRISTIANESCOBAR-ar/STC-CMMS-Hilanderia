import test from 'node:test';
import assert from 'node:assert/strict';
import { plantDate, plantShift, addDays, shiftSlot, moveShift, plantInstant, shiftStart, normalizeShiftRecord, shiftCandidateDates, SHIFT_DATE_CRITERION, reportRange } from '../src/utils/plantTime.js';

test('plant date differs from UTC after 21:00 and is independent of device timezone', () => {
  for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
    const previous = process.env.TZ;
    try {
      process.env.TZ = zone;
      assert.equal(plantDate('2026-10-11T01:00:00Z'), '2026-10-10');
      assert.equal(plantShift('2026-10-11T01:00:00Z'), 'C');
      assert.equal(plantInstant('2026-10-10', 6).toISOString(), '2026-10-10T09:00:00.000Z');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  }
});

test('shift boundaries have no overlaps or gaps', () => {
  for (const [instant, shift] of [
    ['08:59:59', 'C'], ['09:00:00', 'A'], ['16:59:59', 'A'],
    ['17:00:00', 'B'], ['00:59:59', 'B'], ['01:00:00', 'C'],
  ]) assert.equal(plantShift(`2026-10-11T${instant}Z`), shift);
});

test('night shift starting date remains stable across midnight and ends at 06:00', () => {
  assert.deepEqual(shiftSlot('2026-10-11T05:00:00Z'), { fecha: '2026-10-10', turno: 'C' });
  assert.deepEqual(shiftSlot('2026-10-11T05:00:00Z', false), { fecha: '2026-10-11', turno: 'C' });
  assert.equal(shiftStart('2026-10-11T08:59:59Z').toISOString(), '2026-10-11T01:00:00.000Z');
  assert.equal(shiftStart('2026-10-11T09:00:00Z').toISOString(), '2026-10-11T09:00:00.000Z');
});

test('calendar and shift navigation cross month, year and leap-day boundaries', () => {
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.deepEqual(moveShift('2026-01-01', 'A', -1), { fecha: '2025-12-31', turno: 'C' });
  assert.deepEqual(moveShift('2025-12-31', 'C', 1), { fecha: '2026-01-01', turno: 'A' });
  assert.deepEqual(moveShift('2026-10-10', 'B', 1), { fecha: '2026-10-10', turno: 'C' });
  for (const date of ['2026-02-30', 'bad', '2026-13-01']) assert.throws(() => addDays(date, 1), RangeError);
  assert.throws(() => plantDate('bad'), RangeError);
  assert.throws(() => moveShift('2026-10-10', 'D', 1), RangeError);
});

test('legacy patrols from UTC and calendar dates belong to the same night slot without mutation', () => {
  for (const instant of ['2026-10-11T01:30:00Z', '2026-10-11T05:00:00Z']) {
    const record = { fecha: '2026-10-11', turno: 'C', createdAt: new Date(instant) };
    const normalized = normalizeShiftRecord(record);
    assert.equal(normalized.fecha, '2026-10-10');
    assert.equal(normalized.fechaOriginal, '2026-10-11');
    assert.equal(record.fecha, '2026-10-11');
  }
  assert.deepEqual(shiftCandidateDates('2026-12-31', 'C'), ['2026-12-31', '2027-01-01']);
  assert.equal(normalizeShiftRecord({ fecha: '2026-10-10', turno: 'C' }).fecha, '2026-10-10');
  assert.equal(normalizeShiftRecord({ fecha: '2026-10-10', turno: 'C', fechaCriterio: SHIFT_DATE_CRITERION, createdAt: new Date('2026-10-12T05:00:00Z') }).fecha, '2026-10-10');
});

test('night report includes following dawn while calendar report ends at midnight', () => {
  const range = reportRange('2026-10-10', '2026-10-10', 'C');
  assert.equal(range.desde.toISOString(), '2026-10-11T01:00:00.000Z');
  assert.equal(range.hastaExclusiva.toISOString(), '2026-10-11T09:00:00.000Z');
  const calendar = reportRange('2026-10-10', '2026-10-10');
  assert.equal(calendar.hastaExclusiva.toISOString(), '2026-10-11T03:00:00.000Z');
  const week = reportRange('2026-10-04', '2026-10-10');
  assert.equal((week.hastaExclusiva - week.desde) / 86400000, 7);
  assert.throws(() => reportRange('2026-10-11', '2026-10-10'), RangeError);
});
