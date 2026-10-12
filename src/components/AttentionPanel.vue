<script setup>
import { ref,computed,watch,onMounted,onUnmounted } from 'vue';
import { ATTENTION_STATES,ATTENTION_ACTIONS,attentionCan,planAttention } from '../../functions/attentionPolicy.js';
import { loadAttentionContext,subscribeAttentionEvents,transitionAttention } from '../services/attentionService';
import { readAttentionDraft,writeAttentionDraft,attentionDraftKey } from '../utils/attentionQueue';
import { vTippy } from '../utils/tooltipDirective';
const props=defineProps({ item:{ type:Object,required:true },demo:{ type:Boolean,default:false },actor:{ type:Object,default:null },people:{ type:Array,default:()=>[] },history:{ type:Array,default:()=>[] } });
const emit=defineEmits(['transition','busy','dirty']);
const context=ref({ enabled:false,profile:{},organization:{} }),events=ref([]),error=ref(''),busy=ref(false),draftWarning=ref('');
const draft=ref({ action:'',targetUid:'',note:'',nextAction:'',reason:'REPUESTO',reviewAt:'',sourceId:'',causaRaiz:'',accionTomada:'',tiempoReal:'' });
const baseline=ref(JSON.stringify(draft.value));
const draftRevision=ref(props.item.atencionRevision || 0);
const actor= computed(()=>props.demo ? props.actor:context.value.profile);
const uid=computed(()=>props.demo ? props.actor?.uid:context.value.uid);
const enabled=computed(()=>props.demo || context.value.enabled);
const dirty=computed(()=>JSON.stringify(draft.value)!==baseline.value);
const actions=computed(()=>{
  const item=props.item,state=item.atencionEstado,coordinator=attentionCan(actor.value,context.value.organization,item,'coordinate'),mine=uid.value===item.asignadoA && attentionCan(actor.value,context.value.organization,item,'execute');
  return Object.keys(ATTENTION_ACTIONS).filter(action=>{
    if (!enabled.value) return false;
    if (!item.atencionVersion) return coordinator && item.estado==='PENDIENTE' && !item.asignadoA && action==='preparar';
    if(action==='asignar') return coordinator && ['REPORTADA','ASIGNADA','ACEPTADA','EN_TRABAJO','EN_ESPERA'].includes(state);
    if(action==='reabrir') return coordinator && ['COMPLETADA','CERRADA'].includes(state);
    if(action==='cerrar') return coordinator && state==='COMPLETADA';
    if(!mine) return false;
    return { aceptar:state==='ASIGNADA',iniciar:state==='ACEPTADA',esperar:['ACEPTADA','EN_TRABAJO'].includes(state),reanudar:state==='EN_ESPERA',diagnostico:['EN_TRABAJO','EN_ESPERA'].includes(state),completar:state==='EN_TRABAJO' }[action]===true;
  });
});
const targets=computed(()=>(props.demo ? props.people:context.value.people || []).filter(person=>attentionCan(person,context.value.organization,props.item,'execute')));
const timeline=computed(()=>props.demo ? [...props.history].reverse().slice(0,30):events.value);
const assignment=computed(()=>['asignar','reabrir'].includes(draft.value.action));
const diagnostic=computed(()=>['diagnostico','completar'].includes(draft.value.action));
let unsubscribe,alive=true,deadline,loadVersion=0;
const pending=ref(null);
const stale=computed(()=>dirty.value && draftRevision.value!==(props.item.atencionRevision || 0));
watch(busy,value=>emit('busy',value),{ flush:'sync' }); watch(dirty,value=>emit('dirty',value),{ flush:'sync' });
watch(()=>props.item.atencionRevision,revision=>{ if(!dirty.value) draftRevision.value=revision || 0; });
watch(draft,()=>{
  pending.value=null;
  if(!props.demo && uid.value && dirty.value && !writeAttentionDraft(globalThis.localStorage,uid.value,props.item.id,draftRevision.value,draft.value)) draftWarning.value='Este navegador no pudo conservar el borrador. Mantené abierta la ventana.';
},{ deep:true });
function restoreDraft() {
  const stored=readAttentionDraft(globalThis.localStorage,uid.value,props.item.id,props.item.atencionRevision || 0);
  if(stored) { draftRevision.value=stored.revision; Object.assign(draft.value,stored.draft); draftWarning.value=stored.stale ? 'Se recuperó un borrador de una revisión anterior. Revisá los datos antes de enviar.':'Borrador recuperado de este navegador.'; }
}
async function load() {
  const version=++loadVersion;
  error.value='';
  if(props.demo) return;
  const id=props.item.id;
  clearTimeout(deadline); deadline=setTimeout(()=>{ if(alive && version===loadVersion) error.value='No se pudo confirmar el acceso al piloto. Podés reintentar.'; },15000);
  try { const result=await loadAttentionContext(props.item.sector); if(alive && version===loadVersion && id===props.item.id) { context.value=result; restoreDraft(); } }
  catch { if(alive && version===loadVersion) error.value='No se pudo comprobar la habilitación del piloto.'; }
  finally { if(version===loadVersion) clearTimeout(deadline); }
}
function command() {
  const value={ interventionId:props.item.id,operationId:globalThis.crypto.randomUUID(),expectedRevision:draftRevision.value,action:draft.value.action };
  for(const key of ['note','nextAction','reason']) if(draft.value[key]) value[key]=draft.value[key];
  if(assignment.value) value.targetUid=draft.value.targetUid;
  if(value.action==='preparar' && draft.value.sourceId) value.sourceId=draft.value.sourceId.trim();
  if(value.action==='esperar') { const parsed=new Date(draft.value.reviewAt); if(!Number.isFinite(parsed.getTime())) throw new Error('Indicá la fecha y hora de revisión.'); value.reviewAt=parsed.toISOString(); }
  if(diagnostic.value) value.diagnostic={ causaRaiz:draft.value.causaRaiz,accionTomada:draft.value.accionTomada,tiempoReal:draft.value.tiempoReal || null };
  return value;
}
async function submit() {
  if(busy.value || !enabled.value || !pending.value && (!actions.value.includes(draft.value.action) || stale.value)) return;
  busy.value=true; error.value='';
  try {
    pending.value ||= command();
    if(props.demo) {
      const result=planAttention({ record:props.item,actor:props.actor,actorUid:uid.value,command:{ ...pending.value,now:Date.now() },target:props.people.find(person=>person.uid===pending.value.targetUid),targetUid:pending.value.targetUid,timestamp:new Date() });
      emit('transition',result);
    } else await transitionAttention(pending.value);
    if(!alive) return;
    if(!props.demo) { try { globalThis.localStorage?.removeItem(attentionDraftKey(uid.value,props.item.id)); } catch {} }
    draft.value={ action:'',targetUid:'',note:'',nextAction:'',reason:'REPUESTO',reviewAt:'',sourceId:'',causaRaiz:'',accionTomada:'',tiempoReal:'' };
    baseline.value=JSON.stringify(draft.value); draftWarning.value=''; pending.value=null; draftRevision.value=props.item.atencionRevision || 0;
  } catch(e) { if(alive) { error.value=e.message || 'No se pudo confirmar el cambio. El borrador se conserva.'; if(e.code && !['functions/unavailable','functions/deadline-exceeded','functions/internal'].includes(e.code)) pending.value=null; } }
  finally { busy.value=false; }
}
onMounted(()=>{ load(); if(!props.demo && props.item.atencionVersion) unsubscribe=subscribeAttentionEvents(props.item.id,data=>{ if(alive) events.value=data; },()=>{ if(alive) error.value='No se pudo cargar el historial de atención.'; }); });
onUnmounted(()=>{ alive=false; clearTimeout(deadline); unsubscribe?.(); });
</script>

<template>
  <section class="attention-panel">
    <header><h3>Atención y continuidad</h3><span>{{ ATTENTION_STATES[item.atencionEstado] || 'Circuito actual' }}</span></header>
    <p v-if="demo" class="attention-notice">Ensayo con datos ficticios. Los cambios solo existen en esta ventana.</p>
    <dl><dt>Responsable</dt><dd>{{ item.asignadoNombre || 'Sin asignar' }}</dd><dt>Próxima acción</dt><dd>{{ item.proximaAccion || 'Por definir' }}</dd><template v-if="item.esperaMotivo"><dt>Espera</dt><dd>{{ item.esperaMotivo }} · {{ item.revisarAt?.toDate ? item.revisarAt.toDate().toLocaleString('es-AR') : new Date(item.revisarAt).toLocaleString('es-AR') }}</dd></template><template v-if="item.reporteOrigenId"><dt>Reporte vinculado</dt><dd>{{ item.reporteOrigenId }}</dd></template></dl>
    <p v-if="!enabled" class="attention-notice">El piloto no está habilitado para esta cuenta y sector. El historial continúa disponible en modo consulta.</p>
    <p v-if="draftWarning" role="status">{{ draftWarning }}</p>
    <p v-if="stale" class="attention-error" role="alert">La tarea cambió mientras editabas. Revisá estado, responsable y próxima acción. <button :disabled="busy" @click="draftRevision=item.atencionRevision || 0; pending=null">Revisé los cambios, usar revisión actual</button></p>
    <p v-if="error" class="attention-error" role="alert">{{ error }} <button v-if="!enabled && !demo" @click="load">Reintentar</button></p>
    <form v-if="actions.length || pending" @submit.prevent="submit">
      <fieldset :disabled="busy"><label>Acción<select v-model="draft.action"><option value="">Seleccionar…</option><option v-for="action in actions" :key="action" :value="action">{{ ATTENTION_ACTIONS[action] }}</option></select></label>
      <template v-if="assignment"><label>Responsable<select v-model="draft.targetUid" required><option value="">Seleccionar…</option><option v-for="person in targets" :key="person.uid" :value="person.uid">{{ person.displayName || person.nombre || person.email }}</option></select></label></template>
      <label v-if="draft.action==='preparar' && !demo">ID del reporte de falla vinculado (opcional)<input v-model="draft.sourceId" maxlength="128" /></label>
      <template v-if="draft.action==='esperar'"><label>Motivo de espera<select v-model="draft.reason"><option value="REPUESTO">Repuesto</option><option value="AUTORIZACION">Autorización</option><option value="MAQUINA">Disponibilidad de máquina</option><option value="APOYO">Apoyo de otra especialidad</option><option value="OTRO">Otro</option></select></label><label>Próxima revisión<input v-model="draft.reviewAt" type="datetime-local" required /></label></template>
      <label v-if="assignment || draft.action==='esperar'">Próxima acción<textarea v-model="draft.nextAction" maxlength="2000" required /></label>
      <template v-if="diagnostic"><label>Causa identificada<textarea v-model="draft.causaRaiz" maxlength="2000" /></label><label>Trabajo realizado<textarea v-model="draft.accionTomada" maxlength="2000" :required="draft.action==='completar'" /></label><label>Minutos efectivos de trabajo<input v-model="draft.tiempoReal" inputmode="decimal" maxlength="8" /></label></template>
      <label v-if="draft.action && !['aceptar','iniciar','diagnostico','completar'].includes(draft.action)">Nota / motivo<textarea v-model="draft.note" maxlength="2000" :required="draft.action!=='preparar'" /></label>
      <button type="submit" :disabled="!draft.action || stale && !pending" v-tippy="demo ? 'Aplicar al ensayo ficticio':'Confirmar el cambio y registrar su historial'">{{ busy ? 'Confirmando…':pending && !demo ? 'Reintentar confirmación':demo ? 'Aplicar al ensayo':'Confirmar acción' }}</button></fieldset>
    </form>
    <h4>Historial de atención</h4><p v-if="!timeline.length">Sin movimientos registrados en este circuito.</p>
    <ol><li v-for="event in timeline" :key="event.id || event.revision"><strong>{{ ATTENTION_ACTIONS[event.action] }} · {{ event.actorName }}</strong><span>{{ ATTENTION_STATES[event.from] || 'Circuito actual' }} → {{ ATTENTION_STATES[event.to] }}</span><p v-if="event.note">{{ event.note }}</p><p v-if="event.nextAction">Próxima acción: {{ event.nextAction }}</p><small>{{ event.createdAt?.toDate ? event.createdAt.toDate().toLocaleString('es-AR'):new Date(event.createdAt).toLocaleString('es-AR') }}</small></li></ol>
    <small>Se muestran los últimos 30 movimientos. Cada cambio confirmado queda registrado.</small>
  </section>
</template>

<style scoped>
.attention-panel { font-size:13px; color:#334155; padding:16px; background:#fff; border:1px solid #cbd5e1; border-radius:7px; } header { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; } h3 { margin:0; font-size:16px; font-weight:650; } header span { background:#eef2ff; color:#4338ca; padding:4px 8px; border-radius:5px; font-weight:600; } dl { display:grid; grid-template-columns:120px minmax(0,1fr); gap:7px; margin:16px 0; } dt { color:#64748b; } dd { margin:0; overflow-wrap:anywhere; font-weight:600; } p { line-height:1.5; margin:8px 0; } .attention-notice { background:#f1f5f9; padding:10px; border-radius:5px; } .attention-error { color:#b91c1c; } fieldset { border:0; margin:0; padding:0; } label { display:flex; flex-direction:column; gap:5px; margin:12px 0; font-weight:600; } input,select,textarea { padding:9px; border:1px solid #cbd5e1; border-radius:6px; background:#fff; color:#334155; width:100%; min-width:0; font:inherit; } textarea { min-height:72px; resize:vertical; } button { min-height:36px; padding:7px 12px; border-radius:6px; border:1px solid #cbd5e1; background:#eef2ff; color:#4338ca; font:inherit; cursor:pointer; } button:disabled,fieldset:disabled { opacity:.6; } h4 { margin:20px 0 10px; font-weight:650; } ol { list-style:none; padding:0; margin:0; } li { padding:10px 0; border-top:1px solid #e2e8f0; overflow-wrap:anywhere; } li span { display:block; margin-top:4px; color:#64748b; } small { color:#64748b; } :focus-visible { outline:2px solid #818cf8; outline-offset:2px; } @media(max-width:480px){dl{grid-template-columns:100px minmax(0,1fr)}}
</style>
