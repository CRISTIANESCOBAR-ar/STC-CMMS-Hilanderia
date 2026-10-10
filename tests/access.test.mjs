import test from 'node:test';
import assert from 'node:assert/strict';
import { getSectorScope } from '../src/utils/sectorScope.js';
import { canExecuteIntervention } from '../src/utils/interventionAccess.js';
test('scope rejects unapproved/missing users and never treats empty assignments as global', () => {
  assert.throws(() => getSectorScope(null));
  assert.throws(() => getSectorScope({ role: 'pendiente' }));
  assert.throws(() => getSectorScope({ role: 'mecanico', sectoresAsignados: [] }));
  assert.equal(getSectorScope({ role: 'admin' }), null);
  assert.deepEqual(getSectorScope({ role: 'mecanico' }), ['HILANDERIA']);
});
test('leadership sectors apply only to leader roles and invalid sectors are rejected', () => {
  assert.deepEqual(getSectorScope({ role: 'jefe_sector', sectoresAsignados: ['HILANDERIA'], jefeDeSectores: ['TEJEDURIA'] }), ['HILANDERIA', 'TEJEDURIA']);
  assert.deepEqual(getSectorScope({ role: 'inspector', sectoresAsignados: ['TEJEDURIA'], jefeDeSectores: ['HILANDERIA'] }), ['TEJEDURIA']);
  assert.throws(() => getSectorScope({ role: 'mecanico', sectoresAsignados: ['INVALID'] }));
});
test('execution UI matches quality exception and granular permission', () => {
  assert.equal(canExecuteIntervention('inspector', {}, { tipoIntervencion: 'CALIDAD' }), true);
  assert.equal(canExecuteIntervention('inspector', {}, { tipoIntervencion: 'MECANICO' }), false);
  assert.equal(canExecuteIntervention('supervisor', { cerrarOrden: false }, {}), false);
  assert.equal(canExecuteIntervention('mecanico', { cerrarOrden: true }, {}), true);
});
