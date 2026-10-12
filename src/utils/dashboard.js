import { plantDate,PLANT_TIME_ZONE } from './plantTime';
export function dashboardTime(value) { if(value==null || value==='' || typeof value==='boolean') return null; const time=value.toMillis?.() ?? (value.seconds!=null ? value.seconds*1000:new Date(value).getTime()); return Number.isFinite(time) ? time:null; }
const normalize=value=>String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function dashboardItem(record,kind) {
  const number=String(record.numeroMaquina ?? record.telar ?? ''),request=kind==='intervention';
  const category=record.tipoProblema || ({ MECANICO:'Mecánico',ELECTRICO:'Eléctrico',CALIDAD:'Calidad' }[record.tipoIntervencion]) || record.tipoIntervencion || 'Otra';
  return { ...record,key:`${kind}:${record.id}`,kind,number,shortNumber:/^\d+$/.test(number) ? String(Number(number.slice(-2))):number || '—',category,
    description:request ? [record.sintomaNombre || record.sintoma || record.motivoDescripcion,record.observaciones].filter(Boolean).join(' · ') || 'Sin descripción':record.observaciones || record.motivo || 'Sin descripción',
    priority:request && record.estadoMaquina==='PARADA' ? 0:record.critico===true ? 1:request && record.estadoMaquina==='CON_PROBLEMA' ? 2:3,
    status:({ pendiente:'Pendiente','en proceso':'En proceso',PENDIENTE:'Pendiente',EN_PROCESO:'En proceso' }[record.estado]) || record.estado,
    assigned:request ? (record.asignadoA ? record.asignadoNombre || 'Asignado sin nombre':'Sin asignar'):'Sin responsable vinculado',
    created:dashboardTime(record.createdAt),started:dashboardTime(record.fechaInicio) };
}
export function dashboardFilter(items,{ kind='',category='',quick='',search='' }={}) {
  const text=normalize(search.trim());
  return items.filter(item=>(!kind || item.kind===kind) && (!category || normalize(item.category)===normalize(category)) && (!quick || quick==='critical' ? !quick || item.priority<=1 : quick==='unassigned' ? item.kind==='intervention' && !item.asignadoA : quick==='pending' ? item.kind==='fault' && item.estado==='pendiente' : quick==='process' ? item.kind==='intervention' && item.estado==='EN_PROCESO':true) && (!text || normalize([item.number,item.shortNumber,item.description,item.category,item.sector,item.assigned,item.creadoPorNombre,item.feedbackJefe].join(' ')).includes(text))).sort((a,b)=>a.priority-b.priority || (a.created ?? 0)-(b.created ?? 0) || a.key.localeCompare(b.key));
}
export function dashboardTrends(faults,requests,from,to) {
  const machines=new Map(),days=new Map(),durations=[];
  for(const record of faults) {
    const key=JSON.stringify([record.sector,record.tipoMaquina,String(record.numeroMaquina ?? '')]);
    const machine=machines.get(key) || { key,number:String(record.numeroMaquina ?? ''),sector:record.sector,type:record.tipoMaquina,count:0,critical:0 };
    machine.count++; if(record.critico===true) machine.critical++; machines.set(key,machine);
    const created=dashboardTime(record.createdAt); if(created!=null) { const day=plantDate(new Date(created)); days.set(day,(days.get(day) || 0)+1); }
  }
  for(const record of requests) { const start=dashboardTime(record.createdAt),end=dashboardTime(record.fechaFin); if(record.estado==='COMPLETADO' && start!=null && end!=null && end>=start) durations.push((end-start)/60000); }
  durations.sort((a,b)=>a-b); const middle=Math.floor(durations.length/2);
  return { from,to,reports:faults.length,resolved:faults.filter(item=>item.estado==='resuelto').length,requests:requests.length,completed:requests.filter(item=>item.estado==='COMPLETADO').length,medianMinutes:durations.length ? durations.length%2 ? durations[middle]:(durations[middle-1]+durations[middle])/2:null,durationSamples:durations.length,machines:[...machines.values()].sort((a,b)=>b.count-a.count || b.critical-a.critical).slice(0,12),days:[...days].sort(([a],[b])=>a.localeCompare(b)),timeZone:PLANT_TIME_ZONE };
}
