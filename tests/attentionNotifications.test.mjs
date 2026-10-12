import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionNotificationKind,attentionNotificationMessage,deliverAttentionNotification,attentionTokenOnDuty } from '../functions/attentionNotifications.js';
test('notification types distinguish available work, formal assignment, priority changes and closure',()=>{
  const initial={ atencionVersion:1,atencionEstado:'REPORTADA',atencionRevision:1 };
  assert.equal(attentionNotificationKind(undefined,initial),'available');
  assert.equal(attentionNotificationKind(initial,{ ...initial,atencionEstado:'ACEPTADA' }),null);
  assert.equal(attentionNotificationKind(initial,{ ...initial,atencionEstado:'ASIGNADA',asignadoA:'tech' }),'assigned');
  assert.equal(attentionNotificationKind(initial,{ ...initial,prioridadAtencion:'URGENTE' }),'priority');
  assert.equal(attentionNotificationKind(initial,{ ...initial,atencionEstado:'CERRADA' }),'closed');
  const message=attentionNotificationMessage('available','work-1'); assert.equal(message.data.url,'/intervenciones/work-1'); assert.ok(!JSON.stringify(message).includes('observaciones')); assert.equal(message.webpush.notification.tag,'attention-work-1');
});
test('push is off by default, filters specialty and sector and does not resend an acknowledged event',async()=>{
  const work={ atencionVersion:1,atencionEstado:'REPORTADA',atencionRevision:1,sector:'TEJEDURIA',tipoIntervencion:'MECANICO' };
  const profiles={ tech:{ role:'mecanico',sectoresAsignados:['TEJEDURIA'] },electrical:{ role:'mecanico',especialidades:['ELECTRICO'],sectoresAsignados:['TEJEDURIA'] },other:{ role:'mecanico',sectoresAsignados:['HILANDERIA'] } };
  const records=new Map([['intervenciones/work',work],['config/attentionPilot',{ enabled:true,version:1,userIds:Object.keys(profiles),sectors:['TEJEDURIA'] }]]);
  for(const [uid,profile] of Object.entries(profiles)) { records.set(`usuarios/${uid}`,profile); records.set(`fcm_tokens/${uid}`,{ token:`fictitious-token-${uid}`,turnoActivo:true,updatedAt:new Date() }); }
  const doc=path=>({ path,get:async()=>({ data:()=>records.get(path) }),set:async value=>records.set(path,value) });
  const db={ doc,runTransaction:async run=>run({ get:ref=>ref.get(),set:(ref,value)=>records.set(ref.path,value) }) },sent=[];
  const change={ id:'work',before:undefined,after:work,eventId:'fake-event' },send=async message=>{ sent.push(message); return { successCount:message.tokens.length,failureCount:0,responses:message.tokens.map(()=>({ success:true })) }; };
  assert.equal((await deliverAttentionNotification(db,change,send,'server')).skipped,'disabled'); assert.equal(sent.length,0);
  records.get('config/attentionPilot').pushEnabled=true;
  assert.equal((await deliverAttentionNotification(db,change,send,'server')).accepted,1); assert.deepEqual(sent[0].tokens,['fictitious-token-tech']);
  assert.equal((await deliverAttentionNotification(db,change,send,'server')).skipped,'already-sent'); assert.equal(sent.length,1);
  records.set('intervenciones/work',{ ...work,atencionRevision:2,atencionEstado:'ACEPTADA' });
  assert.equal((await deliverAttentionNotification(db,{ ...change,eventId:'older-event' },send,'server')).skipped,'superseded');
});
test('declared availability expires at each plant shift boundary, including dawn after midnight',()=>{
  const active=(issued,now)=>attentionTokenOnDuty({ turnoActivo:true,updatedAt:new Date(issued) },Date.parse(now));
  assert.equal(active('2026-10-12T10:00:00Z','2026-10-12T16:59:59Z'),true); assert.equal(active('2026-10-12T10:00:00Z','2026-10-12T17:00:00Z'),false);
  assert.equal(active('2026-10-12T23:00:00Z','2026-10-13T00:59:59Z'),true); assert.equal(active('2026-10-12T23:00:00Z','2026-10-13T01:00:00Z'),false);
  assert.equal(active('2026-10-13T03:30:00Z','2026-10-13T08:59:59Z'),true); assert.equal(active('2026-10-13T03:30:00Z','2026-10-13T09:00:00Z'),false);
  assert.equal(attentionTokenOnDuty({ turnoActivo:false,updatedAt:new Date() }),false);
});
