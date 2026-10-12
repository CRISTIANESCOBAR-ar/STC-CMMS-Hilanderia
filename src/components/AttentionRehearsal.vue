<script setup>
import { ref,computed,onMounted,onUnmounted,nextTick } from 'vue';
import Swal from 'sweetalert2';
import AttentionPanel from './AttentionPanel.vue';
import { attentionLabel,attentionQueueMatches } from '../utils/attentionQueue';
import { attentionSpecialties } from '../../functions/attentionPolicy.js';
import { vTippy } from '../utils/tooltipDirective';
const emit=defineEmits(['close']);
const people=[
  { uid:'demo-coordinator',displayName:'Coordinación de turno',role:'jefe_produccion',sectoresAsignados:['TEJEDURIA'] },
  { uid:'demo-mechanic',displayName:'Técnico mecánico · turno A',role:'mecanico',especialidades:['MECANICO'],sectoresAsignados:['TEJEDURIA'] },
  { uid:'demo-relief',displayName:'Técnico mecánico · relevo',role:'mecanico',especialidades:['MECANICO'],sectoresAsignados:['TEJEDURIA'] },
  { uid:'demo-electrician',displayName:'Técnico eléctrico',role:'mecanico',especialidades:['ELECTRICO'],sectoresAsignados:['TEJEDURIA'] },
  { uid:'demo-inspector',displayName:'Inspector de calidad',role:'inspector',sectoresAsignados:['TEJEDURIA'] },
];
function seed() { return [
  { id:'demo-1',numeroMaquina:35014,tipoMaquina:'TELAR',sector:'TEJEDURIA',tipoIntervencion:'MECANICO',sintomaNombre:'Colita tejida',observaciones:'Colita tejida en telar 14',estado:'PENDIENTE',asignadoA:null,critico:false,atencionVersion:1,atencionEstado:'REPORTADA',atencionRevision:1,mencionadoUid:'demo-mechanic',mencionadoNombre:'Técnico mecánico · turno A' },
  { id:'demo-2',numeroMaquina:35004,tipoMaquina:'TELAR',sector:'TEJEDURIA',tipoIntervencion:'ELECTRICO',sintomaNombre:'Falla de accionamiento',estado:'PENDIENTE',asignadoA:null,critico:true,atencionVersion:1,atencionEstado:'REPORTADA',atencionRevision:0 },
  { id:'demo-3',numeroMaquina:35012,tipoMaquina:'TELAR',sector:'TEJEDURIA',tipoIntervencion:'CALIDAD',sintomaNombre:'Defecto de tejido',estado:'PENDIENTE',asignadoA:null,critico:false,atencionVersion:1,atencionEstado:'REPORTADA',atencionRevision:0 },
]; }
const items=ref(seed()),histories=ref({}),actorId=ref(people[0].uid),selected=ref('demo-1'),filter=ref(''),dirty=ref(false),busy=ref(false),dialog=ref(null);
const actor=computed(()=>people.find(person=>person.uid===actorId.value));
const item=computed(()=>items.value.find(record=>record.id===selected.value));
const visible=computed(()=>items.value.filter(record=>attentionQueueMatches(record,filter.value,actorId.value)));
async function discard() { if(busy.value) return false; if(!dirty.value) return true; return (await Swal.fire({ title:'¿Descartar cambios del ensayo?',showCancelButton:true,confirmButtonText:'Descartar',cancelButtonText:'Seguir editando' })).isConfirmed; }
async function select(id) { if(id===selected.value || !await discard()) return; dirty.value=false; selected.value=id; }
async function switchActor(event) { const next=event.target.value; if(!await discard()) { event.target.value=actorId.value; return; } dirty.value=false; actorId.value=next; }
async function reset() { if(!await discard()) return; dirty.value=false; items.value=seed(); histories.value={}; selected.value='demo-1'; actorId.value=people[0].uid; }
async function close() { if(await discard()) emit('close'); }
function transition({ patch,event }) { Object.assign(item.value,patch); histories.value={ ...histories.value,[item.value.id]:[...(histories.value[item.value.id] || []),event] }; }
function keydown(event) {
  if(event.key==='Escape') { event.stopPropagation(); close(); }
  if(event.key!=='Tab') return;
  const nodes=[...(dialog.value?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') || [])].filter(node=>node.getClientRects().length);
  if(!nodes.length) return;
  const first=nodes[0],last=nodes.at(-1),active=globalThis.document?.activeElement;
  if(event.shiftKey && (active===first || !nodes.includes(active))) { event.preventDefault(); last.focus(); }
  else if(!event.shiftKey && (active===last || !nodes.includes(active))) { event.preventDefault(); first.focus(); }
}
function beforeUnload(event) { if(dirty.value || busy.value) { event.preventDefault(); event.returnValue=''; } }
let previousFocus;
onMounted(()=>{ previousFocus=globalThis.document?.activeElement; nextTick(()=>dialog.value?.focus?.()); globalThis.window?.addEventListener('beforeunload',beforeUnload); });
onUnmounted(()=>{ globalThis.window?.removeEventListener('beforeunload',beforeUnload); previousFocus?.focus?.(); });
</script>
<template>
  <Teleport to="body"><div class="rehearsal-overlay" @click.self="close"><section class="rehearsal-dialog" ref="dialog" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="rehearsal-title" @keydown="keydown">
    <header><div><h2 id="rehearsal-title">Ensayo del circuito de atención</h2><p>Datos ficticios · Preparación para las pruebas de campo</p></div><button @click="close" :disabled="busy" aria-label="Cerrar ensayo">Cerrar</button></header>
    <div class="rehearsal-toolbar"><label>Persona del ensayo<select :value="actorId" @change="switchActor" :disabled="busy"><option v-for="person in people" :key="person.uid" :value="person.uid">{{ person.displayName }}</option></select></label><label>Bandeja<select v-model="filter"><option value="">Todas</option><option value="mine">Mi trabajo</option><option value="team">Avisos del equipo</option><option value="available">Disponibles para atender</option><option value="free">Sin asignar</option><option value="accept">Sin aceptar</option><option value="waiting">En espera</option><option value="review">Por validar</option></select></label><button @click="reset" :disabled="busy" v-tippy="'Restaurar las tareas ficticias y comenzar otro ensayo'">Reiniciar ensayo</button></div>
    <p class="rehearsal-guide">Recorrido sugerido: un reporte ya aparece disponible → un técnico confirma «Voy a atender» → al llegar inicia → informa espera o completa. Coordinación puede asignar, priorizar o entregar al relevo.</p>
    <div class="rehearsal-body"><section class="rehearsal-list"><p class="rehearsal-scope">{{ actor.displayName }} · {{ attentionSpecialties(actor).join(' / ') }} · TEJEDURIA</p><div class="rehearsal-table-scroll"><table><thead><tr><th>Máq.</th><th>Problema</th><th>Atención / responsable</th><th>Detalle</th></tr></thead><tbody><tr v-for="record in visible" :key="record.id" :class="{ selected:record.id===selected }"><td><strong>{{ Number(String(record.numeroMaquina).slice(-2)) }}</strong></td><td>{{ record.sintomaNombre }}<small>{{ record.tipoIntervencion }}{{ record.critico ? ' · Crítica':'' }}</small></td><td>{{ attentionLabel(record) }}<small>{{ record.asignadoNombre || 'Sin asignar' }}</small><small v-if="record.proximaAccion">{{ record.proximaAccion }}</small></td><td><button @click="select(record.id)" :disabled="busy">Ver</button></td></tr></tbody></table></div><p v-if="!visible.length">Sin tareas en esta bandeja.</p></section>
    <AttentionPanel v-if="item" :key="actorId + ':' + selected" :item="item" demo :actor="actor" :people="people" :history="histories[selected] || []" @transition="transition" @dirty="dirty=$event" @busy="busy=$event" /></div>
  </section></div></Teleport>
</template>
<style scoped>
.rehearsal-overlay{position:fixed;inset:0;z-index:110;background:#0f172a70;padding:16px;display:flex;align-items:center;justify-content:center}.rehearsal-dialog{width:min(1400px,100%);height:min(900px,calc(100dvh - 32px));background:#fff;border-radius:9px;display:flex;flex-direction:column;overflow:hidden;outline:none;color:#334155;font-size:13px}header{display:flex;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid #e2e8f0}h2{font-size:19px;font-weight:650;margin:0}header p{margin:5px 0 0;color:#64748b}.rehearsal-toolbar{display:flex;align-items:end;gap:10px;flex-wrap:wrap;padding:12px 18px}.rehearsal-toolbar label{display:flex;flex-direction:column;gap:5px;font-weight:600}.rehearsal-toolbar select{min-width:160px;padding:8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;font:inherit}button{min-height:36px;padding:7px 11px;border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:6px;font:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:default}.rehearsal-guide{padding:10px 18px;margin:0;background:#eef2ff;color:#4338ca;font-size:12px;line-height:1.5}.rehearsal-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(340px,420px);gap:14px;padding:14px 18px;overflow:auto;min-height:0;flex:1;align-items:start}.rehearsal-list{min-width:0}.rehearsal-scope{color:#64748b;font-size:12px;margin:0 0 12px}.rehearsal-table-scroll{overflow:auto;border:1px solid #e2e8f0;border-radius:6px}table{width:100%;border-collapse:collapse;min-width:450px}th{text-align:left;background:#f1f5f9;font-size:12px}th,td{padding:10px;border-bottom:1px solid #e2e8f0;vertical-align:top}td small{display:block;color:#64748b;margin-top:5px;line-height:1.4}.selected{background:#eef2ff} :focus-visible{outline:2px solid #818cf8;outline-offset:2px}@media(max-width:980px){.rehearsal-body{grid-template-columns:minmax(0,1fr)}}@media(max-width:600px){.rehearsal-overlay{padding:8px}.rehearsal-dialog{height:calc(100dvh - 16px)}.rehearsal-toolbar,.rehearsal-body,header{padding:10px}.rehearsal-toolbar label{flex:1}.rehearsal-toolbar select{width:100%;min-width:0}}
</style>
