import { attentionError,attentionPilotEnabled,attentionCan,planAttention } from './attentionPolicy.js';
const safeId=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function validateAttentionCommand(value) {
  const allowed=['interventionId','operationId','expectedRevision','action','targetUid','sourceId','note','nextAction','reason','reviewAt','diagnostic','priority'];
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!allowed.includes(key)) || !safeId(value.interventionId) || !safeId(value.operationId) || !Number.isInteger(value.expectedRevision) || value.expectedRevision<0 || ['targetUid','sourceId'].some(key=>value[key]!==undefined && !safeId(value[key]))) throw attentionError('invalid-argument','Solicitud de atención inválida.');
  return value;
}
export async function executeAttention(db,auth,input,timestamp,now=Date.now()) {
  if (!auth?.uid || auth.token?.firebase?.sign_in_provider==='anonymous') throw attentionError('unauthenticated','Se requiere una cuenta identificada.');
  const command=validateAttentionCommand(input),reference=db.doc(`intervenciones/${command.interventionId}`),eventRef=reference.collection('eventos_atencion').doc(command.operationId);
  return db.runTransaction(async tx=>{
    const [recordSnap,actorSnap,configSnap,organizationSnap,eventSnap]=await Promise.all([tx.get(reference),tx.get(db.doc(`usuarios/${auth.uid}`)),tx.get(db.doc('config/attentionPilot')),tx.get(db.doc('config/organization')),tx.get(eventRef)]);
    if (!recordSnap.exists) throw attentionError('not-found','Intervención no encontrada.');
    const record=recordSnap.data(),actor=actorSnap.exists ? actorSnap.data():{},config=configSnap.exists ? configSnap.data():{},organization=organizationSnap.exists ? organizationSnap.data():{};
    if (!attentionPilotEnabled(config,auth.uid,record.sector)) throw attentionError('failed-precondition','El circuito de atención todavía no está habilitado para esta cuenta y sector.');
    if (!attentionCan(actor,organization,record,'execute') && !attentionCan(actor,organization,record,'coordinate')) throw attentionError('permission-denied','Usuario fuera del alcance de la tarea.');
    const fingerprint=JSON.stringify(Object.fromEntries(Object.entries(command).sort(([a],[b])=>a.localeCompare(b))));
    if (eventSnap.exists) {
      if (eventSnap.data().actorUid!==auth.uid || eventSnap.data().fingerprint!==fingerprint) throw attentionError('already-exists','Identificador de operación reutilizado para otro cambio.');
      return { revision:eventSnap.data().revision,replayed:true };
    }
    if ((record.atencionRevision || 0)!==command.expectedRevision) throw attentionError('aborted','Otro usuario modificó la tarea. Actualizá antes de continuar.');
    let target,source;
    if (command.targetUid) { const snap=await tx.get(db.doc(`usuarios/${command.targetUid}`)); target=snap.exists ? snap.data():{}; if(!attentionPilotEnabled(config,command.targetUid,record.sector)) throw attentionError('invalid-argument','El responsable debe pertenecer al piloto.'); }
    if (command.sourceId) { const snap=await tx.get(db.doc(`novedades/${command.sourceId}`)); source=snap.exists ? snap.data():null; }
    const { patch,event }=planAttention({ record,actor,actorUid:auth.uid,organization,command:{ ...command,now },target,targetUid:command.targetUid,source,timestamp });
    let reportRef;
    const sourceId=record.reporteOrigenId || patch.reporteOrigenId;
    if(sourceId) {
      if(!safeId(sourceId)) throw attentionError('failed-precondition','Vínculo de reporte inválido.');
      reportRef=db.doc(`novedades/${sourceId}`);
      const report=await tx.get(reportRef);
      if(!report.exists || (command.action==='preparar' ? report.data().intervencionId && report.data().intervencionId!==command.interventionId:report.data().intervencionId!==command.interventionId) || report.data().sector!==record.sector) throw attentionError('failed-precondition','El vínculo con el reporte cambió.');
    }
    tx.update(reference,patch); tx.create(eventRef,{ ...event,priority:patch.prioridadAtencion || null,fingerprint });
    if(reportRef) {
      const phase=patch.atencionEstado || record.atencionEstado;
      tx.update(reportRef,{ intervencionId:command.interventionId,estado:phase==='CERRADA' ? 'resuelto':phase==='REPORTADA' || phase==='ASIGNADA' ? 'pendiente':'en proceso',atencionEstado:phase,atendidoPorUid:patch.asignadoA || record.asignadoA || null,atendidoPorNombre:patch.asignadoNombre || record.asignadoNombre || null,updatedAt:timestamp });
    }
    return { revision:patch.atencionRevision,replayed:false };
  });
}
