import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase/config';
import { stablePatrol, patrolSummary } from '../utils/patrolSheet';
const keys=['ronda_1','ronda_2','ronda_3','ronda_4','ronda_5','ronda_6'];
export async function savePatrolSheet(id,key,baseline,data,complete,meta={},reopen=false) {
  if(!id || !keys.includes(key)) throw new Error('Patrulla o ronda inválida.');
  return runTransaction(db,async transaction=>{
    const reference=doc(db,'patrullas',id),snapshot=await transaction.get(reference);
    if(!snapshot.exists()) throw new Error('La patrulla ya no existe.');
    const record=snapshot.data(),rounds={ ...(record.rondas || {}) },current=rounds[key] || {};
    const identity=round=>JSON.stringify(stablePatrol({ datos:round?.datos || {},completada:!!round?.completada }));
    if(identity(current)!==identity(baseline)) throw new Error('Esta ronda cambió en otra sesión. Se conserva tu borrador; actualizá antes de reintentar.');
    if(current.completada && !reopen) throw new Error('Reabrí la ronda antes de editarla.');
    const index=keys.indexOf(key);
    if(!reopen && index>0 && !rounds[keys[index-1]]?.completada) throw new Error('Completá la ronda anterior antes de guardar.');
    const next=reopen ? { ...current,completada:false,hora:null,reabierta:new Date().toISOString() } : { ...current,...meta,datos:data,tipo:key==='ronda_1'||key==='ronda_6' ? 'roturas':key==='ronda_3' ? 'trama_negra':'paro_defecto',completada:complete,horaInicio:current.horaInicio || new Date().toISOString(),ultimoGuardado:new Date().toISOString(),...(complete ? { hora:new Date().toISOString() }:{}) };
    rounds[key]=next; const update={ [`rondas.${key}`]:next };
    if(key==='ronda_1' || key==='ronda_6') {
      const ready=rounds.ronda_1?.completada && rounds.ronda_6?.completada;
      rounds.ronda_7={ ...(rounds.ronda_7 || {}),tipo:'evaluacion',completada:!!ready,calculadoAutomatico:true,...(ready ? { resumen:patrolSummary(rounds),hora:new Date().toISOString() }:{ hora:null }) };
      update['rondas.ronda_7']=rounds.ronda_7;
    }
    transaction.update(reference,update);
    return { ...record,id,rondas:rounds };
  });
}
