import { collection,query,where,and,or,Timestamp,onSnapshot } from 'firebase/firestore';
export function activeInterventionQueries(db,sectors,now=Date.now()) {
  if(!Array.isArray(sectors) || !sectors.length || sectors.some(s=>!['TEJEDURIA','HILANDERIA'].includes(s))) throw new Error('No hay sectores autorizados para consultar.');
  const scope=()=>where('sector',sectors.length===1 ? '==':'in',sectors.length===1 ? sectors[0]:sectors);
  return [
    query(collection(db,'intervenciones'),and(scope(),or(where('estado','in',['PENDIENTE','EN_PROCESO']),where('atencionEstado','==','COMPLETADA')))),
    query(collection(db,'intervenciones'),scope(),where('estado','==','COMPLETADO'),where('fechaFin','>=',Timestamp.fromMillis(now-86400000))),
  ];
}
export function subscribeActiveInterventions(db,sectors,receive,fail) {
  const sources=[null,null]; let active=true;
  function publish() {
    if(!active || sources.some(source=>source===null)) return;
    const unique=new Map(); for(const source of sources) for(const item of source) unique.set(item.id,item);
    receive([...unique.values()].filter(item=>['PENDIENTE','EN_PROCESO'].includes(item.estado) || item.atencionEstado==='COMPLETADA' || item.fechaFin?.toMillis?.()>=Date.now()-86400000).sort((a,b)=>({ PENDIENTE:0,EN_PROCESO:1,COMPLETADO:2 }[a.estado] ?? 3)-({ PENDIENTE:0,EN_PROCESO:1,COMPLETADO:2 }[b.estado] ?? 3) || (b.createdAt?.seconds || 0)-(a.createdAt?.seconds || 0)));
  }
  const unsubscribe=activeInterventionQueries(db,sectors).map((q,index)=>onSnapshot(q,snapshot=>{ if(!active) return; sources[index]=snapshot.docs.map(document=>({ ...document.data(),id:document.id })); publish(); },error=>{ if(active) fail?.(error); }));
  const clock=setInterval(publish,60000);
  return ()=>{ active=false; clearInterval(clock); unsubscribe.forEach(stop=>stop()); };
}
