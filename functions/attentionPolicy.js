// Shared by the server and the isolated rehearsal. Never trust a browser profile.
export const ATTENTION_STATES = { REPORTADA:'Reportada', ASIGNADA:'Asignada', ACEPTADA:'Aceptada', EN_TRABAJO:'En trabajo', EN_ESPERA:'En espera', COMPLETADA:'Completada', CERRADA:'Cerrada' };
export const ATTENTION_ACTIONS = { preparar:'Incorporar al piloto', tomar:'Voy a atender', asignar:'Asignar / entregar turno', aceptar:'Aceptar tarea asignada', priorizar:'Cambiar prioridad', iniciar:'Iniciar trabajo', esperar:'Informar espera', reanudar:'Reanudar', diagnostico:'Guardar diagnóstico', completar:'Completar trabajo', cerrar:'Validar cierre', reabrir:'Reabrir' };
const MEMBERS = ['admin','mecanico','tejedor','inspector','auxiliar','supervisor','supervisor_mecanico','supervisor_electrico','jefe_sector','jefe_electricos','jefe_produccion','gerente_produccion'];
const COORDINATORS = ['admin','supervisor','supervisor_mecanico','supervisor_electrico','jefe_sector','jefe_electricos','jefe_produccion','gerente_produccion'];
const EXECUTORS = ['admin','mecanico','supervisor_mecanico','supervisor_electrico','jefe_sector','jefe_electricos','jefe_produccion','gerente_produccion'];
const LEADERS = ['jefe_sector','jefe_electricos','jefe_produccion','gerente_produccion'];
export function attentionError(code,message) { return Object.assign(new Error(message),{ code }); }
export function attentionScope(profile) {
  if (!MEMBERS.includes(profile?.role)) return [];
  if (profile.role==='admin') return null;
  return [...new Set([...(Array.isArray(profile.sectoresAsignados) ? profile.sectoresAsignados:[profile.sectorDefault || 'HILANDERIA']),...(LEADERS.includes(profile.role) ? profile.jefeDeSectores || []:[])])].filter(s=>['HILANDERIA','TEJEDURIA'].includes(s));
}
function permission(profile,organization,name,defaults) {
  if (!MEMBERS.includes(profile?.role)) return false;
  if (profile.role==='admin') return true;
  const personal=profile.permisosPersonalizados,configured=organization?.profiles?.[profile.role]?.permisos;
  if (personal && typeof personal==='object') return personal[name]===true;
  if (configured && typeof configured==='object' && Object.hasOwn(configured,name)) return configured[name]===true;
  return defaults.includes(profile.role);
}
export function attentionSpecialties(profile) {
  if (Array.isArray(profile?.especialidades)) return profile.especialidades.filter(s=>['MECANICO','ELECTRICO','CALIDAD'].includes(s));
  if (profile?.role==='inspector') return ['CALIDAD'];
  if (['supervisor_electrico','jefe_electricos'].includes(profile?.role)) return ['ELECTRICO'];
  if (['mecanico','supervisor_mecanico','jefe_sector'].includes(profile?.role)) return ['MECANICO'];
  return MEMBERS.includes(profile?.role) ? ['MECANICO','ELECTRICO','CALIDAD']:[];
}
export function attentionCan(profile,organization,record,operation) {
  const sectors=attentionScope(profile);
  if (sectors!==null && !sectors.includes(record.sector)) return false;
  if (profile.role!=='admin' && !attentionSpecialties(profile).includes(record.tipoIntervencion)) return false;
  return operation==='coordinate' ? permission(profile,organization,'coordinarAtencion',COORDINATORS)
    : permission(profile,organization,'cerrarOrden',EXECUTORS) || profile.role==='inspector' && record.tipoIntervencion==='CALIDAD';
}
export function attentionCanReport(profile,organization,sector) {
  const scope=attentionScope(profile);
  return (scope===null || scope.includes(sector)) && permission(profile,organization,'crearFalla',[...EXECUTORS,'tejedor','inspector','supervisor']);
}
export function attentionPilotEnabled(config,uid,sector) {
  return config?.enabled===true && config?.version===1 && Array.isArray(config.userIds) && config.userIds.includes(uid)
    && Array.isArray(config.sectors) && config.sectors.includes(sector) && ['HILANDERIA','TEJEDURIA'].includes(sector);
}
function text(value,max=2000) { if (typeof value!=='string' || value.trim().length>max) throw attentionError('invalid-argument','Texto inválido o demasiado largo.'); return value.trim(); }
function required(value) { const result=text(value); if (!result) throw attentionError('invalid-argument','Indicá el motivo o la próxima acción.'); return result; }
function diagnostic(payload) {
  const allowed=['causaRaiz','accionTomada','piezaId','piezaNombre','tiempoReal','numeroCatalogo','numeroArticulo'];
  if (!payload || typeof payload!=='object' || Array.isArray(payload) || Object.keys(payload).some(key=>!allowed.includes(key))) throw attentionError('invalid-argument','Diagnóstico inválido.');
  const result={}; for(const key of allowed) if(Object.hasOwn(payload,key)) result[key]=payload[key]===null ? null:text(payload[key]);
  if (result.tiempoReal && !/^\d{1,5}(?:[.,]\d{1,2})?$/.test(result.tiempoReal)) throw attentionError('invalid-argument','Tiempo de trabajo inválido.');
  return result;
}
export function planAttention({ record,actor,actorUid,organization={},command,target,targetUid,source,timestamp }) {
  if (!Object.hasOwn(ATTENTION_ACTIONS,command.action)) throw attentionError('invalid-argument','Acción desconocida.');
  const coordinate=attentionCan(actor,organization,record,'coordinate'),execute=attentionCan(actor,organization,record,'execute');
  const mine=record.asignadoA===actorUid,state=record.atencionEstado;
  const fail=()=>{ throw attentionError('failed-precondition','La tarea cambió o no admite esta acción. Actualizá el detalle.'); };
  const denied=()=>{ throw attentionError('permission-denied','No tenés permiso para esta acción.'); };
  const patch={ atencionVersion:1,atencionRevision:(record.atencionRevision || 0)+1,atencionUpdatedAt:timestamp };
  const note=command.note===undefined ? '':text(command.note);
  switch(command.action) {
    case 'preparar':
      if (!coordinate) denied();
      if (record.atencionVersion || record.estado!=='PENDIENTE' || record.asignadoA) fail();
      patch.atencionEstado='REPORTADA';
      if (command.sourceId) {
        if (!source || !['string','number'].includes(typeof record.numeroMaquina) || !String(record.numeroMaquina).trim() || typeof record.tipoMaquina!=='string' || !record.tipoMaquina.trim() || source.sector!==record.sector || String(source.numeroMaquina)!==String(record.numeroMaquina) || source.tipoMaquina!==record.tipoMaquina || source.estado==='resuelto') fail();
        patch.reporteOrigenId=command.sourceId;
      }
      break;
    case 'asignar':
      if (!coordinate) denied();
      if (!['REPORTADA','ASIGNADA','ACEPTADA','EN_TRABAJO','EN_ESPERA'].includes(state)) fail();
      if (!targetUid || !attentionCan(target,organization,record,'execute')) throw attentionError('invalid-argument','El responsable no tiene sector, especialidad o permiso de ejecución.');
      patch.atencionEstado='ASIGNADA'; patch.estado='PENDIENTE'; patch.asignadoA=targetUid;
      patch.asignadoNombre=target.displayName || target.nombre || target.email || 'Responsable';
      patch.fechaAsignacion=timestamp; patch.aceptadaAt=null; patch.proximaAccion=required(command.nextAction);
      patch.esperaMotivo=null; patch.revisarAt=null;
      required(note); // Includes an explicit explanation of a transfer between shifts.
      break;
    case 'tomar':
      if (!execute) denied(); if(state!=='REPORTADA' || record.asignadoA) fail();
      patch.atencionEstado='ACEPTADA'; patch.asignadoA=actorUid;
      patch.asignadoNombre=actor.displayName || actor.nombre || actor.email || actorUid;
      patch.fechaAsignacion=timestamp; patch.aceptadaAt=timestamp; break;
    case 'priorizar':
      if (!coordinate) denied(); if(['CERRADA','COMPLETADA'].includes(state)) fail();
      if (!['URGENTE','ALTA','NORMAL'].includes(command.priority)) throw attentionError('invalid-argument','Prioridad inválida.');
      patch.prioridadAtencion=command.priority; required(note); break;
    case 'aceptar':
      if (!execute || !mine) denied(); if(state!=='ASIGNADA') fail();
      patch.atencionEstado='ACEPTADA'; patch.aceptadaAt=timestamp; break;
    case 'iniciar':
      if (!execute || !mine) denied(); if(state!=='ACEPTADA') fail();
      patch.atencionEstado='EN_TRABAJO'; patch.estado='EN_PROCESO';
      if (!record.fechaInicio) patch.fechaInicio=timestamp; break;
    case 'esperar':
      if (!execute || !mine) denied(); if(!['ACEPTADA','EN_TRABAJO'].includes(state)) fail();
      if (!['REPUESTO','AUTORIZACION','MAQUINA','APOYO','OTRO'].includes(command.reason)) throw attentionError('invalid-argument','Elegí un motivo de espera.');
      if (typeof command.reviewAt!=='string' || !Number.isFinite(Date.parse(command.reviewAt)) || Date.parse(command.reviewAt)<=command.now) throw attentionError('invalid-argument','La próxima revisión debe ser futura.');
      patch.atencionEstado='EN_ESPERA'; patch.esperaMotivo=command.reason; patch.proximaAccion=required(command.nextAction);
      patch.revisarAt=new Date(command.reviewAt); patch.esperaDesdeEstado=state; required(note); break;
    case 'reanudar':
      if (!execute || !mine) denied(); if(state!=='EN_ESPERA') fail();
      patch.atencionEstado=record.esperaDesdeEstado==='ACEPTADA' ? 'ACEPTADA':'EN_TRABAJO';
      patch.esperaMotivo=null; patch.revisarAt=null; required(note); break;
    case 'diagnostico':
      if (!execute || !mine) denied(); if(!['EN_TRABAJO','EN_ESPERA'].includes(state)) fail();
      Object.assign(patch,diagnostic(command.diagnostic)); patch.diagnosticoUpdatedAt=timestamp; break;
    case 'completar': {
      if (!execute || !mine) denied(); if(state!=='EN_TRABAJO') fail();
      const payload=diagnostic(command.diagnostic),merged={ ...record,...payload };
      required(merged.accionTomada); Object.assign(patch,payload);
      patch.atencionEstado=record.critico===true ? 'COMPLETADA':'CERRADA'; patch.estado='COMPLETADO'; patch.fechaFin=timestamp;
      patch.diagnosticoUpdatedAt=timestamp; patch.esperaMotivo=null; patch.revisarAt=null;
      if (patch.atencionEstado==='CERRADA') patch.cerradaAt=timestamp;
      break;
    }
    case 'cerrar':
      if (!coordinate) denied(); if(state!=='COMPLETADA') fail();
      patch.atencionEstado='CERRADA'; patch.cerradaAt=timestamp; required(note); break;
    case 'reabrir':
      if (!coordinate) denied(); if(!['COMPLETADA','CERRADA'].includes(state)) fail();
      if(!targetUid || !attentionCan(target,organization,record,'execute')) throw attentionError('invalid-argument','Seleccioná un responsable habilitado para reabrir.');
      patch.atencionEstado='ASIGNADA'; patch.estado='PENDIENTE'; patch.asignadoA=targetUid;
      patch.asignadoNombre=target.displayName || target.nombre || target.email || 'Responsable'; patch.fechaAsignacion=timestamp;
      patch.fechaFin=null; patch.cerradaAt=null; patch.aceptadaAt=null; patch.proximaAccion=required(command.nextAction); required(note); break;
  }
  if (command.action!=='preparar' && record.atencionVersion!==1) fail();
  return { patch,event:{ action:command.action,actorUid,actorName:actor.displayName || actor.nombre || actor.email || actorUid,from:state || null,to:patch.atencionEstado || state,previousAssignee:record.asignadoA || null,assignee:patch.asignadoA ?? record.asignadoA ?? null,note,nextAction:patch.proximaAccion || null,reason:patch.esperaMotivo || null,revision:patch.atencionRevision,createdAt:timestamp } };
}
