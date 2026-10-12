import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileWorkAction } from '../src/utils/mobileWorkAction.js';

test('mobile actions describe the next step without offering to take another worker’s job', () => {
  assert.equal(mobileWorkAction({ estado:'PENDIENTE' },'me',true).kind,'take');
  assert.equal(mobileWorkAction({ atencionVersion:1,atencionEstado:'REPORTADA' },'me',true).kind,'claim');
  for (const [state,label] of Object.entries({ ASIGNADA:'Aceptar tarea',ACEPTADA:'Iniciar trabajo',EN_TRABAJO:'Registrar corrección',EN_PROCESO:'Registrar corrección',EN_ESPERA:'Actualizar espera' })) {
    assert.equal(mobileWorkAction({ atencionEstado:state,asignadoA:'me' },'me',true).label,label);
    assert.equal(mobileWorkAction({ atencionEstado:state,asignadoA:'other' },'me',true).label,'Ver detalle');
  }
  assert.equal(mobileWorkAction({ estado:'PENDIENTE' },'me',false).kind,'detail');
  assert.equal(mobileWorkAction({ atencionEstado:'COMPLETADA' },'me',true).label,'Ver corrección');
  assert.equal(mobileWorkAction({ estado:'COMPLETADO' },'me',true).label,'Ver resolución');
});
