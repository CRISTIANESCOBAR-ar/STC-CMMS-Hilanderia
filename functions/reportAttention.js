import { attentionCanReport,attentionCan,attentionPilotEnabled,attentionError } from './attentionPolicy.js';
const idOK=id=>typeof id==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
export function reportTime(value) { return typeof value?.toMillis==='function' ? value.toMillis():typeof value?.seconds==='number' ? value.seconds*1000:value instanceof Date ? value.getTime():NaN; }
export function automaticReportEnabled(config,uid,sector,createdAt) {
  const start=reportTime(config?.reportsFrom),created=reportTime(createdAt);
  return attentionPilotEnabled(config,uid,sector) && config.automaticReports===true && Number.isFinite(start) && Number.isFinite(created) && created>=start;
}
export function workFromReport(source,sourceId,timestamp,mention=null) {
  const type=String(source.tipoProblema || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  const specialty={ MECANICO:'MECANICO',ELECTRICO:'ELECTRICO',CALIDAD:'CALIDAD' }[type];
  if(!specialty || !['string','number'].includes(typeof source.numeroMaquina) || !String(source.numeroMaquina).trim() || typeof source.tipoMaquina!=='string' || !source.tipoMaquina.trim()) throw attentionError('failed-precondition','El reporte no tiene especialidad e identidad de máquina válidas.');
  const work={ sector:source.sector,tipoIntervencion:specialty,reporteOrigenId:sourceId,estado:'PENDIENTE',asignadoA:null,asignadoNombre:null,fechaAsignacion:null,fechaInicio:null,fechaFin:null,atencionVersion:1,atencionEstado:'REPORTADA',atencionRevision:1,createdAt:source.createdAt,atencionUpdatedAt:timestamp,critico:source.critico===true,estadoMaquina:source.estadoMaquina || 'CON_PROBLEMA',sintomaNombre:source.denominacion || source.motivo || 'Problema reportado',mencionadoUid:mention?.uid || null,mencionadoNombre:mention?.name || null };
  for(const field of ['maquinaId','numeroMaquina','tipoMaquina','modeloMaquina','planta','area','local_fisico','lado','observaciones','fotoUrl','creadoPorUid','creadoPorNombre','creadoPorEmail','seccion','grupo','subGrupo','denominacion','numeroArticulo','numeroCatalogo']) if(source[field]!==undefined) work[field]=source[field];
  return work;
}
export async function createAttentionFromReport(db,sourceId,timestamp) {
  if(!idOK(sourceId)) throw attentionError('invalid-argument','Identificador de reporte inválido.');
  const reportRef=db.doc(`novedades/${sourceId}`),workId=`reporte_${sourceId}`,workRef=db.doc(`intervenciones/${workId}`);
  return db.runTransaction(async tx=>{
    const [reportSnap,workSnap,configSnap,orgSnap]=await Promise.all([tx.get(reportRef),tx.get(workRef),tx.get(db.doc('config/attentionPilot')),tx.get(db.doc('config/organization'))]);
    if(!reportSnap.exists) return { skipped:'missing' };
    const source=reportSnap.data(),config=configSnap.data() || {},organization=orgSnap.data() || {};
    if(workSnap.exists) {
      if(workSnap.data().reporteOrigenId!==sourceId || source.intervencionId!==workId) throw attentionError('failed-precondition','El vínculo existente no coincide.');
      return { interventionId:workId,replayed:true };
    }
    if(!automaticReportEnabled(config,source.creadoPorUid,source.sector,source.createdAt)) return { skipped:'disabled' };
    if(!['pendiente','en proceso'].includes(source.estado) || source.intervencionId) return { skipped:'already-managed' };
    if(!idOK(source.creadoPorUid)) throw attentionError('failed-precondition','Autor inválido.');
    const actor=(await tx.get(db.doc(`usuarios/${source.creadoPorUid}`))).data() || {};
    if(!attentionCanReport(actor,organization,source.sector)) throw attentionError('permission-denied','El autor no puede reportar en este sector.');
    let mention=null;
    if(source.mecanicoMencionadoUid && idOK(source.mecanicoMencionadoUid) && attentionPilotEnabled(config,source.mecanicoMencionadoUid,source.sector)) {
      const profile=(await tx.get(db.doc(`usuarios/${source.mecanicoMencionadoUid}`))).data() || {};
      if(attentionCan(profile,organization,{ sector:source.sector,tipoIntervencion:workFromReport(source,sourceId,timestamp).tipoIntervencion },'execute')) mention={ uid:source.mecanicoMencionadoUid,name:profile.displayName || profile.nombre || profile.email || 'Técnico' };
    }
    const work=workFromReport(source,sourceId,timestamp,mention);
    tx.create(workRef,work);
    tx.create(workRef.collection('eventos_atencion').doc('reporte-creado'),{ action:'reportar',actorUid:source.creadoPorUid,actorName:actor.displayName || actor.nombre || actor.email || source.creadoPorUid,from:null,to:'REPORTADA',assignee:null,note:'Aviso disponible para el equipo',revision:1,createdAt:timestamp });
    tx.update(reportRef,{ intervencionId:workId,estado:'pendiente',atencionEstado:'REPORTADA',updatedAt:timestamp });
    return { interventionId:workId,replayed:false };
  });
}
