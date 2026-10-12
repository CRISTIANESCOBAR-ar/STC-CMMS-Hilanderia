import { createHash } from 'node:crypto';
import { attentionCan,attentionCanReport,attentionPilotEnabled } from './attentionPolicy.js';
import { reportTime } from './reportAttention.js';
export function attentionTokenOnDuty(token,now=Date.now()) {
  const issued=reportTime(token?.updatedAt);
  if(token?.turnoActivo!==true || !Number.isFinite(issued) || issued>now) return false;
  // Same plant schedule as the shared calendar: A 06–14, B 14–22, C 22–06,
  // Argentina UTC-03. Token activation expires at the end of that shift.
  const local=new Date(issued-3*3600000),hour=local.getUTCHours();
  const end=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),hour<6 ? 6:hour<14 ? 14:hour<22 ? 22:30)+3*3600000;
  return now<end;
}
export function attentionNotificationKind(before,after) {
  if(after?.atencionVersion!==1) return null;
  if(before?.atencionVersion!==1 && after.atencionEstado==='REPORTADA') return 'available';
  if(after.atencionEstado==='ASIGNADA' && (before?.atencionEstado!=='ASIGNADA' || before?.asignadoA!==after.asignadoA || before?.atencionRevision!==after.atencionRevision)) return 'assigned';
  if(before && after.prioridadAtencion!==before.prioridadAtencion && !['COMPLETADA','CERRADA'].includes(after.atencionEstado)) return 'priority';
  if(after.atencionEstado==='CERRADA' && before?.atencionEstado!=='CERRADA') return 'closed';
  return null;
}
export function attentionNotificationMessage(kind,id) {
  return { notification:{ title:{ available:'Nuevo aviso del equipo',assigned:'Tenés un trabajo asignado',priority:'Cambió la prioridad de un trabajo',closed:'Tu problema reportado fue resuelto' }[kind],body:'Abrí la aplicación para consultar el estado y los detalles.' },data:{ url:kind==='closed' ? '/':`/intervenciones/${id}`,kind },webpush:{ headers:{ TTL:'1800' },notification:{ icon:'/icons/icon-192x192.png',tag:`attention-${id}` },fcmOptions:{ link:`https://stc-cmms.web.app${kind==='closed' ? '/':`/intervenciones/${id}`}` } } };
}
// FCM acknowledgement is not proof of receipt or task acceptance. A lost response
// can cause a repeated notification; work transitions remain idempotent.
export async function deliverAttentionNotification(db,{ id,before,after,eventId },send,timestamp,now=Date.now()) {
  const kind=attentionNotificationKind(before,after);
  if(!kind || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || !eventId) return { skipped:'irrelevant' };
  const [configSnap,orgSnap,currentSnap]=await Promise.all([db.doc('config/attentionPilot').get(),db.doc('config/organization').get(),db.doc(`intervenciones/${id}`).get()]);
  const config=configSnap.data() || {},organization=orgSnap.data() || {},current=currentSnap.data();
  if(!current || current.atencionRevision!==after.atencionRevision || current.atencionEstado!==after.atencionEstado) return { skipped:'superseded' };
  if(config.pushEnabled!==true || !Array.isArray(config.userIds) || config.userIds.length>30) return { skipped:'disabled' };
  const ids=kind==='available' || kind==='priority' && !current.asignadoA ? config.userIds:kind==='assigned' || kind==='priority' ? [current.asignadoA]:[current.creadoPorUid];
  const tokens=[];
  for(const uid of [...new Set(ids)]) {
    if(typeof uid!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !attentionPilotEnabled(config,uid,current.sector)) continue;
    const [profileSnap,tokenSnap]=await Promise.all([db.doc(`usuarios/${uid}`).get(),db.doc(`fcm_tokens/${uid}`).get()]);
    const profile=profileSnap.data() || {},device=tokenSnap.data(),token=device?.token;
    if(attentionTokenOnDuty(device,now) && (kind==='closed' ? attentionCanReport(profile,organization,current.sector):attentionCan(profile,organization,current,'execute')) && typeof token==='string' && token.length>10 && token.length<4096) tokens.push(token);
  }
  if(!tokens.length) return { skipped:'no-registered-device' };
  const receipt=db.doc(`_attention_push/${createHash('sha256').update(eventId).digest('hex')}`);
  const reserved=await db.runTransaction(async tx=>{
    const state=(await tx.get(receipt)).data();
    if(state?.status==='sent') return false;
    if(state?.leaseUntil?.toMillis?.()>now) throw new Error('Delivery in progress; retry later');
    tx.set(receipt,{ status:'sending',workId:id,kind,leaseUntil:new Date(now+60000),updatedAt:timestamp }); return true;
  });
  if(!reserved) return { skipped:'already-sent' };
  let result;
  try { result=await send({ ...attentionNotificationMessage(kind,id),tokens:[...new Set(tokens)] }); }
  catch { throw new Error('Temporary notification delivery failure'); }
  const temporary=(result.responses || []).some(response=>!response.success && !['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(response.error?.code));
  if(temporary) throw new Error('Temporary notification delivery failure');
  await receipt.set({ status:'sent',workId:id,kind,accepted:result.successCount || 0,failed:result.failureCount || 0,updatedAt:timestamp });
  return { accepted:result.successCount || 0,failed:result.failureCount || 0 };
}
