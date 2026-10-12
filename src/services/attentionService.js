import { collection,query,orderBy,limit,onSnapshot,doc,getDoc } from 'firebase/firestore';
import { getFunctions,httpsCallable } from 'firebase/functions';
import app,{ db,auth } from '../firebase/config';
import { attentionPilotEnabled } from '../../functions/attentionPolicy.js';
import { previewSector,userProfile } from './authService';
const callable=httpsCallable(getFunctions(app,'us-central1'),'transitionAttention',{ timeout:35000 });
export async function loadAttentionContext(sector) {
  const uid=auth.currentUser?.uid;
  if (!uid) return { enabled:false,profile:{},organization:{} };
  const [pilot,profile,organization]=await Promise.all([getDoc(doc(db,'config','attentionPilot')),getDoc(doc(db,'usuarios',uid)),getDoc(doc(db,'config','organization'))]);
  if (auth.currentUser?.uid!==uid) throw new Error('La sesión cambió. Volvé a abrir el detalle.');
  const enabled=attentionPilotEnabled(pilot.data(),uid,sector);
  const ids=enabled && Array.isArray(pilot.data()?.userIds) ? pilot.data().userIds.slice(0,30):[];
  const people=await Promise.all(ids.map(async id=>{ const snapshot=await getDoc(doc(db,'usuarios',id)); return { ...snapshot.data(),uid:id }; }));
  if (auth.currentUser?.uid!==uid) throw new Error('La sesión cambió. Volvé a abrir el detalle.');
  return { enabled,uid,preview:previewSector.value!==null,profile:previewSector.value!==null ? userProfile.value:profile.data() || {},organization:organization.data() || {},pilot:pilot.data() || {},people };
}
export function subscribeAttentionEvents(id,receive,fail) {
  return onSnapshot(query(collection(db,'intervenciones',id,'eventos_atencion'),orderBy('revision','desc'),limit(30)),snapshot=>receive(snapshot.docs.map(item=>({ ...item.data(),id:item.id }))),fail);
}
export async function transitionAttention(command) {
  if(previewSector.value!==null) throw Object.assign(new Error('La vista previa no ejecuta cambios de atención. Usá Ensayar atención para probar con datos ficticios.'),{ code:'functions/failed-precondition' });
  return (await callable(command)).data;
}
