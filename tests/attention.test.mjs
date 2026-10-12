import test from 'node:test';
import assert from 'node:assert/strict';
import { planAttention,attentionCan,attentionPilotEnabled,attentionScope,attentionSpecialties } from '../functions/attentionPolicy.js';
import { validateAttentionCommand } from '../functions/attentionWorkflow.js';
import { automaticReportEnabled,workFromReport } from '../functions/reportAttention.js';
import { attentionQueueMatches,readAttentionDraft,writeAttentionDraft } from '../src/utils/attentionQueue.js';
const chief={ role:'jefe_produccion',sectoresAsignados:['TEJEDURIA'],displayName:'Coordinador' };
const tech={ role:'mecanico',sectoresAsignados:['TEJEDURIA'],displayName:'Técnico' };
const base={ sector:'TEJEDURIA',tipoIntervencion:'MECANICO',tipoMaquina:'TELAR',numeroMaquina:35001,estado:'PENDIENTE',asignadoA:null };
const act=(record,action,extra={},actor=chief,actorUid='chief')=>planAttention({ record,actor,actorUid,organization:{},command:{ action,now:1000,...extra },target:tech,targetUid:'tech',timestamp:'server' });
test('pilot is closed by default and requires version, user and sector allowlists',()=>{
  assert.equal(attentionPilotEnabled(undefined,'a','TEJEDURIA'),false);
  const config={ enabled:true,version:1,userIds:['a'],sectors:['TEJEDURIA'] };
  assert.equal(attentionPilotEnabled(config,'a','TEJEDURIA'),true);
  assert.equal(attentionPilotEnabled(config,'b','TEJEDURIA'),false);
  assert.equal(attentionPilotEnabled(config,'a','HILANDERIA'),false);
  assert.equal(attentionPilotEnabled({ ...config,enabled:'true' },'a','TEJEDURIA'),false);
});
test('function, specialty, scope and explicit personal permission are independent',()=>{
  assert.deepEqual(attentionScope({ role:'pendiente',sectoresAsignados:['TEJEDURIA'] }),[]);
  assert.deepEqual(attentionSpecialties({ ...tech,especialidades:['ELECTRICO','INVALID'] }),['ELECTRICO']);
  assert.equal(attentionCan(tech,{},base,'execute'),true);
  assert.equal(attentionCan(tech,{}, { ...base,tipoIntervencion:'ELECTRICO' },'execute'),false);
  assert.equal(attentionCan({ ...tech,especialidades:['ELECTRICO'] },{}, { ...base,tipoIntervencion:'ELECTRICO' },'execute'),true);
  assert.equal(attentionCan(tech,{}, { ...base,sector:'HILANDERIA' },'execute'),false);
  assert.equal(attentionCan({ ...chief,permisosPersonalizados:{ coordinarAtencion:false } },{},base,'coordinate'),false);
  assert.equal(attentionCan({ role:'inspector',sectoresAsignados:['TEJEDURIA'] },{}, { ...base,tipoIntervencion:'CALIDAD' },'execute'),true);
});
test('assignment does not start work; acceptance and start remain separate events',()=>{
  let record={ ...base,...act(base,'preparar').patch };
  record={ ...record,...act(record,'asignar',{ note:'Turno A',nextAction:'Inspeccionar fuga' }).patch };
  assert.equal(record.estado,'PENDIENTE'); assert.equal(record.atencionEstado,'ASIGNADA'); assert.equal(record.fechaInicio,undefined);
  record={ ...record,...act(record,'aceptar',{},tech,'tech').patch }; assert.equal(record.atencionEstado,'ACEPTADA'); assert.equal(record.fechaInicio,undefined);
  record={ ...record,...act(record,'iniciar',{},tech,'tech').patch }; assert.equal(record.estado,'EN_PROCESO'); assert.equal(record.fechaInicio,'server');
  assert.throws(()=>act(record,'aceptar',{},tech,'tech'),/cambió/);
});
test('waiting requires reason, next action, note and future review and resumes previous phase',()=>{
  const record={ ...base,atencionVersion:1,atencionEstado:'ACEPTADA',asignadoA:'tech' };
  assert.throws(()=>act(record,'esperar',{},tech,'tech'),/motivo/);
  assert.throws(()=>act(record,'esperar',{ reason:'REPUESTO',reviewAt:new Date(500).toISOString() },tech,'tech'),/futura/);
  const result=act(record,'esperar',{ reason:'REPUESTO',reviewAt:new Date(2000).toISOString(),nextAction:'Consultar depósito',note:'Sin repuesto' },tech,'tech');
  assert.equal(result.patch.atencionEstado,'EN_ESPERA');
  assert.equal(act({ ...record,...result.patch },'reanudar',{ note:'Repuesto disponible' },tech,'tech').patch.atencionEstado,'ACEPTADA');
});
test('only assigned executor can diagnose or complete; effective minutes do not mean elapsed time',()=>{
  const record={ ...base,atencionVersion:1,atencionEstado:'EN_TRABAJO',asignadoA:'tech' };
  assert.throws(()=>act(record,'diagnostico',{ diagnostic:{ accionTomada:'Reparación' } }),/permiso/);
  assert.throws(()=>act(record,'completar',{ diagnostic:{ accionTomada:'' } },tech,'tech'),/motivo/);
  assert.throws(()=>act(record,'diagnostico',{ diagnostic:{ estado:'COMPLETADO' } },tech,'tech'),/inválido/);
  const result=act(record,'completar',{ diagnostic:{ accionTomada:'Reparación',tiempoReal:'25,5' } },tech,'tech');
  assert.equal(result.patch.atencionEstado,'CERRADA'); assert.equal(result.patch.tiempoReal,'25,5'); assert.equal(result.patch.tiempoAuto,undefined);
});
test('critical completion requires coordinator validation and reopening records a new assignment',()=>{
  const record={ ...base,critico:true,atencionVersion:1,atencionEstado:'EN_TRABAJO',asignadoA:'tech' };
  const completed={ ...record,...act(record,'completar',{ diagnostic:{ accionTomada:'Reparación' } },tech,'tech').patch };
  assert.equal(completed.atencionEstado,'COMPLETADA');
  assert.throws(()=>act(completed,'cerrar',{ note:'Verificado' },tech,'tech'),/permiso/);
  const closed={ ...completed,...act(completed,'cerrar',{ note:'Verificado en máquina' }).patch };
  const reopened=act(closed,'reabrir',{ note:'Reaparece el defecto',nextAction:'Revisar bajo carga' });
  assert.equal(reopened.patch.estado,'PENDIENTE'); assert.equal(reopened.patch.fechaFin,null); assert.equal(reopened.event.from,'CERRADA');
});
test('shift transfer keeps history and requires an eligible target and handover note',()=>{
  const record={ ...base,atencionVersion:1,atencionEstado:'EN_TRABAJO',asignadoA:'previous',fechaInicio:'original' };
  assert.throws(()=>act(record,'asignar',{ nextAction:'Continuar' }),/motivo/);
  const result=act(record,'asignar',{ nextAction:'Revisar válvula',note:'Entrega al turno B' });
  assert.equal(result.event.previousAssignee,'previous'); assert.equal(result.patch.atencionEstado,'ASIGNADA'); assert.equal(result.patch.fechaInicio,undefined);
  assert.throws(()=>planAttention({ record,actor:chief,actorUid:'chief',command:{ action:'asignar',note:'Relevo',nextAction:'Continuar' },target:{ ...tech,sectoresAsignados:['HILANDERIA'] },targetUid:'wrong',timestamp:'server' }),/responsable/);
});
test('linking requires an explicit fault id and matching full machine identity and sector',()=>{
  const source={ ...base,estado:'pendiente' };
  assert.throws(()=>act(base,'preparar',{ sourceId:'fault' },chief),/cambió/);
  const result=planAttention({ record:base,actor:chief,actorUid:'chief',command:{ action:'preparar',sourceId:'fault' },source,timestamp:'server' });
  assert.equal(result.patch.reporteOrigenId,'fault');
  assert.throws(()=>planAttention({ record:base,actor:chief,actorUid:'chief',command:{ action:'preparar',sourceId:'fault' },source:{ ...source,numeroMaquina:165001 },timestamp:'server' }),/cambió/);
  assert.throws(()=>planAttention({ record:{ ...base,numeroMaquina:undefined,tipoMaquina:undefined },actor:chief,actorUid:'chief',command:{ action:'preparar',sourceId:'fault' },source:{ ...source,numeroMaquina:undefined,tipoMaquina:undefined },timestamp:'server' }),/cambió/);
});
test('command boundary rejects privilege injection, unsafe document ids and invalid revision',()=>{
  const valid={ interventionId:'one',operationId:'op-1',expectedRevision:0,action:'aceptar' };
  assert.equal(validateAttentionCommand(valid),valid);
  for(const patch of [{ actorUid:'admin' },{ interventionId:'one/events/other' },{ expectedRevision:-1 },{ diagnostic:null,unknown:true }]) assert.throws(()=>validateAttentionCommand({ ...valid,...patch }),/inválida/);
});
test('attention inbox never treats a missing signed-in user as an assignee',()=>{
  assert.equal(attentionQueueMatches({ estado:'PENDIENTE',asignadoA:null },'mine',null),false);
  assert.equal(attentionQueueMatches({ estado:'COMPLETADO',asignadoA:'a' },'mine','a'),false);
  assert.equal(attentionQueueMatches({ estado:'PENDIENTE',atencionEstado:'ASIGNADA' },'accept','a'),true);
  assert.equal(attentionQueueMatches({ atencionEstado:'COMPLETADA' },'review','a'),true);
});
test('drafts are account-bound, preserve revision mismatch, expire and handle unavailable storage',()=>{
  const data=new Map(),storage={ getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value) };
  assert.equal(writeAttentionDraft(storage,'a','one',1,{ note:'Pendiente' },1000),true);
  assert.equal(readAttentionDraft(storage,'b','one',1,1001),null);
  assert.equal(readAttentionDraft(storage,'a','one',2,1001).stale,true);
  assert.equal(readAttentionDraft(storage,'a','one',1,8*86400000),null);
  assert.equal(writeAttentionDraft({ setItem(){throw new Error('quota');} },'a','one',1,{}),false);
});

test('an eligible teammate may take a mentioned notice without reserving it or starting work',()=>{
  const record={ ...base,atencionVersion:1,atencionEstado:'REPORTADA',atencionRevision:1,mencionadoUid:'someone-else' };
  const taken=act(record,'tomar',{},tech,'tech'); assert.equal(taken.patch.asignadoA,'tech'); assert.equal(taken.patch.atencionEstado,'ACEPTADA'); assert.equal(taken.patch.fechaInicio,undefined);
  assert.throws(()=>act({ ...record,...taken.patch },'tomar',{},tech,'another'),/cambió/);
  assert.throws(()=>act({ ...record,atencionEstado:'ASIGNADA',asignadoA:'other' },'tomar',{},tech,'tech'),/cambió/);
});
test('automatic reports require a cutoff and never backfill old reports; copied hints never assign work',()=>{
  const config={ enabled:true,version:1,automaticReports:true,reportsFrom:new Date(2000),userIds:['reporter'],sectors:['TEJEDURIA'] };
  assert.equal(automaticReportEnabled(config,'reporter','TEJEDURIA',new Date(3000)),true);
  assert.equal(automaticReportEnabled(config,'reporter','TEJEDURIA',new Date(1000)),false);
  assert.equal(automaticReportEnabled({ ...config,reportsFrom:undefined },'reporter','TEJEDURIA',new Date(3000)),false);
  assert.equal(automaticReportEnabled({ ...config,automaticReports:false },'reporter','TEJEDURIA',new Date(3000)),false);
  const source={ ...base,tipoProblema:'Mecánico',observaciones:'Colita tejida en telar 14',fotoUrl:'novedades/TEJEDURIA/reporter/private.jpg',createdAt:new Date(3000) };
  const copied=workFromReport(source,'report','server',{ uid:'tech',name:'Técnico' });
  assert.equal(copied.asignadoA,null); assert.equal(copied.mencionadoUid,'tech'); assert.equal(copied.tipoIntervencion,'MECANICO'); assert.equal(copied.fotoUrl,source.fotoUrl); assert.equal(copied.observaciones,source.observaciones); assert.equal(copied.reporteOrigenId,'report');
});
test('only coordination can set priority, with an explicit reason',()=>{
  const record={ ...base,atencionVersion:1,atencionEstado:'REPORTADA' };
  assert.throws(()=>act(record,'priorizar',{ priority:'URGENTE',note:'Riesgo' },tech,'tech'),/permiso/);
  assert.throws(()=>act(record,'priorizar',{ priority:'URGENTE' }),/motivo/);
  assert.equal(act(record,'priorizar',{ priority:'URGENTE',note:'Impacto en producción' }).patch.prioridadAtencion,'URGENTE');
});
