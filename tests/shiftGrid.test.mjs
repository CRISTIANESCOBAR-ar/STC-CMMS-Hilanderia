import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftGridTarget, cleanShiftDigits, sameShiftRecord, checkShiftChanges } from '../src/utils/shiftGrid.js';

test('grid arrows traverse adjacent cells, shifts and rows without leaving the sheet', () => {
  assert.equal(shiftGridTarget(4, 'ArrowRight', 45), 5);
  assert.equal(shiftGridTarget(5, 'ArrowLeft', 45), 4);
  assert.equal(shiftGridTarget(14, 'ArrowRight', 45), 15);
  assert.equal(shiftGridTarget(17, 'ArrowUp', 45), 2);
  assert.equal(shiftGridTarget(2, 'ArrowDown', 45), 17);
  assert.equal(shiftGridTarget(2, 'Enter', 45), 17);
  assert.equal(shiftGridTarget(0, 'ArrowLeft', 45), 0);
  assert.equal(shiftGridTarget(44, 'ArrowRight', 45), 44);
  assert.equal(shiftGridTarget(2, 'Tab', 45), null);
});

test('points keep the three digit thousands convention and empty differs from zero', () => {
  assert.equal(cleanShiftDigits('261', 3), '261');
  assert.equal(cleanShiftDigits('2a61x7', 3), '261');
  assert.equal(cleanShiftDigits('0', 3), '0');
  assert.equal(cleanShiftDigits('', 3), '');
});

test('optimistic saves allow independent shifts but reject changes to the same record', () => {
  const original = { loom: '1', turno: 'A', picks: 261, rpm: 750, source: 'manual' };
  const change = { key: '1_A', base: original, data: { ...original, picks: 262 } };
  checkShiftChanges({ '1_A': original, '2_A': { picks: 99 } }, [change]);
  assert.throws(() => checkShiftChanges({ '1_A': { ...original, rpm: 751 } }, [change]), { code: 'shiftreport/conflict' });
  assert.throws(() => checkShiftChanges({}, [change]), { code: 'shiftreport/conflict' });
  checkShiftChanges({}, [{ key: '1_A', base: null, data: original }]);
  assert.throws(() => checkShiftChanges({ '1_A': original }, [{ key: '1_A', base: null, data: original }]), { code: 'shiftreport/conflict' });
  assert.equal(sameShiftRecord({ picks: 0 }, { picks: null }), false);
});
import { generarReportePRD } from '../src/services/shiftReportService.js';

test('PRD export retains the existing thousands convention and field order', () => {
  const text = generarReportePRD([{ fecha: '2026/10/10', turno: 'A', loom: '1', picks: 261, weftCount: 4, warpCount: 19, otherCount: 0, rpm: 750 }]);
  assert.equal(text, '10102026\tA\t1\t750\t261\t4\t19\t0');
});
