import { ATTENTION_STATES } from '../../functions/attentionPolicy.js';
export function attentionLabel(item) { return ATTENTION_STATES[item.atencionEstado] || (item.estado==='PENDIENTE' ? 'Pendiente':item.estado==='EN_PROCESO' ? 'En proceso':'Completada'); }
export function attentionQueueMatches(item,filter,uid) {
  const open=item.estado!=='COMPLETADO';
  switch(filter) {
    case 'mine': return !!uid && item.asignadoA===uid && open;
    case 'free': return !item.asignadoA && open;
    case 'accept': return item.atencionEstado==='ASIGNADA';
    case 'waiting': return item.atencionEstado==='EN_ESPERA';
    case 'review': return item.atencionEstado==='COMPLETADA';
    default: return true;
  }
}
export function attentionDraftKey(uid,id) { return `cmms.attention.draft.v1:${uid}:${id}`; }
export function readAttentionDraft(storage,uid,id,revision,now=Date.now()) {
  try {
    const item=JSON.parse(storage?.getItem(attentionDraftKey(uid,id)) || 'null');
    if (!item || item.uid!==uid || item.id!==id || !Number.isFinite(item.savedAt) || now-item.savedAt>7*86400000) return null;
    return { ...item,stale:item.revision!==revision };
  } catch { return null; }
}
export function writeAttentionDraft(storage,uid,id,revision,draft,now=Date.now()) {
  try { storage?.setItem(attentionDraftKey(uid,id),JSON.stringify({ uid,id,revision,draft,savedAt:now })); return !!storage; }
  catch { return false; }
}
