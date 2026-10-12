import { collection,query,where,or,and,orderBy,documentId,limit,startAfter,onSnapshot,getDocs,getCountFromServer,doc,runTransaction,serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userProfile } from './authService';
import { canAccessViewForUser } from './profileService';
import { getSectorScope } from '../utils/sectorScope';
import { plantInstant,addDays } from '../utils/plantTime';
const settings={ fault:{ collection:'novedades',states:['pendiente','en proceso'] },intervention:{ collection:'intervenciones',states:['PENDIENTE','EN_PROCESO'] } };
export const DASHBOARD_STREAMS=[{ key:'fault',kind:'fault',bucket:'base' },{ key:'fault-critical',kind:'fault',bucket:'critical' },{ key:'intervention',kind:'intervention',bucket:'base' },{ key:'intervention-critical',kind:'intervention',bucket:'critical' },{ key:'intervention-stopped',kind:'intervention',bucket:'stopped' },{ key:'fault-all',kind:'fault',bucket:'all' },{ key:'intervention-all',kind:'intervention',bucket:'all' }];
function scope(sectors) { if(sectors===null) return []; if(!sectors?.length) throw new Error('No hay sectores autorizados.'); return [where('sector',sectors.length===1 ? '==':'in',sectors.length===1 ? sectors[0]:sectors)]; }
function constraints(sectors,kind,{ bucket='base',state='',unassigned=false,both=false,priority=false }={}) { const config=settings[kind]; if(!config) throw new Error('Origen inválido.'); const fields=[...scope(sectors),where('estado',state ? '==':'in',state || config.states)]; if(bucket==='critical' || both) fields.push(where('critico','==',true)); if(bucket==='stopped' || both) fields.push(where('estadoMaquina','==','PARADA')); if(priority) fields.push(or(where('critico','==',true),where('estadoMaquina','==','PARADA'))); if(unassigned) fields.push(where('asignadoA','==',null)); return fields; }
export function dashboardQueueQuery(sectors,stream,size=50) { return query(collection(db,settings[stream.kind].collection),...constraints(sectors,stream.kind,stream),orderBy(stream.bucket==='base' ? 'createdAt':documentId(),'asc'),limit(size)); }
export function subscribeDashboard(sectors,stream,size,receive,fail) { return onSnapshot(dashboardQueueQuery(sectors,stream,size),{ includeMetadataChanges:true },snapshot=>receive({ records:snapshot.docs.map(item=>({ ...item.data(),id:item.id })),hasMore:snapshot.docs.length===size,fromCache:!!snapshot.metadata?.fromCache }),fail); }
export async function dashboardCounts(sectors) {
  const definitions={ faultPending:['fault',{ state:'pendiente' }],faultProcess:['fault',{ state:'en proceso' }],faultCritical:['fault',{ bucket:'critical' }],requestPending:['intervention',{ state:'PENDIENTE' }],requestProcess:['intervention',{ state:'EN_PROCESO' }],requestPriority:['intervention',{ priority:true }],unassigned:['intervention',{ unassigned:true }] };
  const entries=await Promise.all(Object.entries(definitions).map(async([key,[kind,options]])=>{ const snapshot=await getCountFromServer(query(collection(db,settings[kind].collection),and(...constraints(sectors,kind,options)))); return [key,snapshot.data().count]; }));
  const counts=Object.fromEntries(entries); counts.priority=counts.faultCritical+counts.requestPriority; return counts;
}
export async function manageDashboardFault(record,state,feedback) {
  const profile=userProfile.value,allowed=getSectorScope(profile);
  if(!canAccessViewForUser(profile.role,'jefe',profile.vistasPersonalizadas) || allowed!==null && !allowed.includes(record.sector)) throw new Error('No tenés permiso para gestionar este sector.');
  if(!['en proceso','resuelto'].includes(state)) throw new Error('Estado inválido.');
  const reference=doc(db,'novedades',record.id);
  await runTransaction(db,async transaction=>{ const snapshot=await transaction.get(reference); if(!snapshot.exists()) throw new Error('El reporte ya no existe.'); const current=snapshot.data(); if(current.estado!==record.estado || (current.feedbackJefe || '')!==(record.feedbackJefe || '')) throw new Error('Otro usuario modificó este reporte. Actualizá antes de guardar.'); transaction.update(reference,{ estado:state,feedbackJefe:String(feedback || '').trim(),updatedAt:serverTimestamp() }); });
}
export async function loadDashboardPeriod(sectors,kind,from,to,assertCurrent=()=>{}) {
  const config=settings[kind]; if(!config) throw new Error('Origen inválido.');
  const records=[]; let cursor=null;
  while(true) {
    assertCurrent(); const fields=[...scope(sectors),where('createdAt','>=',plantInstant(from)),where('createdAt','<',plantInstant(addDays(to,1))),orderBy('createdAt','asc')]; if(cursor) fields.push(startAfter(cursor)); fields.push(limit(50));
    const snapshot=await getDocs(query(collection(db,config.collection),...fields)); assertCurrent(); records.push(...snapshot.docs.map(item=>({ ...item.data(),id:item.id })));
    if(snapshot.docs.length<50) return records; cursor=snapshot.docs.at(-1);
  }
}
