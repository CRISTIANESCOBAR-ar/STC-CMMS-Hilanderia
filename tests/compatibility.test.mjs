import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibilityIssues } from '../scripts/production-compatibility.mjs';
test('audit detects legacy records that would disappear from scoped queries', () => {
  assert.deepEqual(compatibilityIssues('novedades', {}), ['missing-or-invalid-sector']);
  assert.deepEqual(compatibilityIssues('patrullas', { sector: 'tejeduria' }), ['missing-or-invalid-sector']);
  assert.deepEqual(compatibilityIssues('novedades', { sector: 'TEJEDURIA' }), []);
});
test('audit detects inconsistent profiles and distinguishes intentional pending accounts', () => {
  assert.deepEqual(compatibilityIssues('usuarios', { role: 'pendiente' }), ['pending-approval']);
  assert.deepEqual(compatibilityIssues('usuarios', { role: 'admin' }), []);
  assert.deepEqual(compatibilityIssues('usuarios', { role: 'inspector', sectorDefault: 'TEJEDURIA', sectoresAsignados: ['TEJEDURIA'] }), []);
  assert.ok(compatibilityIssues('usuarios', { role: 'inspector' }).includes('invalid-assigned-sectors'));
});
test('audit flags active orders without owner or with invalid state', () => {
  assert.deepEqual(compatibilityIssues('intervenciones', { sector: 'HILANDERIA', estado: 'EN_PROCESO' }), ['unassigned-active-order']);
  assert.deepEqual(compatibilityIssues('intervenciones', { sector: 'HILANDERIA', estado: 'unknown' }), ['invalid-order-state']);
});
