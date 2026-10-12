<script setup>
import { computed, ref } from 'vue';
import { attentionLabel, attentionQueueMatches } from '../utils/attentionQueue';
import { mobileWorkAction } from '../utils/mobileWorkAction';
import { attentionSpecialties } from '../../functions/attentionPolicy.js';
import { eventView } from '../utils/faultEvents';
const props=defineProps({ items:Array,profile:Object,uid:String,preview:Boolean,loading:Boolean,error:Boolean,busy:String,canTake:Function,alerts:Boolean,alertsBusy:Boolean });
const emit=defineEmits(['detail','take','claim','practice','retry','alerts','off']);
const queue=ref('available'),search=ref('');
const eligible=computed(()=>props.items.filter(item=>attentionSpecialties(props.profile).includes(item.tipoIntervencion)));
const queues=[{ id:'available',label:'Por tomar' },{ id:'mine',label:'Mis trabajos' },{ id:'team',label:'Equipo' }];
const count=id=>eligible.value.filter(item=>attentionQueueMatches(item,id,props.uid)).length;
const visible=computed(()=>eligible.value.filter(item=>attentionQueueMatches(item,queue.value,props.uid)).filter(item=>{
  const text=[eventView(item).numeroMaquinaDisplay,item.sintomaNombre,item.observaciones].join(' ').toLocaleLowerCase('es');
  return text.includes(search.value.trim().toLocaleLowerCase('es'));
}));
const action=item=>mobileWorkAction(item,props.uid,props.canTake(item));
function open(item){ const next=action(item); if(props.preview || next.kind==='detail') emit('detail',item); else emit(next.kind,item); }
const empty=computed(()=>search.value ? 'No hay coincidencias para esta búsqueda.' : queue.value==='mine' ? 'Todavía no tenés trabajos tomados.' : queue.value==='available' ? 'No hay trabajos disponibles para tomar.' : 'No hay trabajos abiertos en tu especialidad.');
</script>
<template>
  <section class="mechanic-mobile" aria-label="Atención del mecánico">
    <header><h1>Trabajos de mantenimiento</h1><p>{{ queue==='mine' ? 'Continuá la atención y registrá la corrección.' : queue==='available' ? 'Elegí un problema para atender.' : 'Consultá quién está atendiendo cada problema.' }}</p></header>
    <nav aria-label="Bandejas de atención"><button v-for="tab in queues" :key="tab.id" :aria-pressed="queue===tab.id" @click="queue=tab.id">{{ tab.label }}<span>{{ count(tab.id) }}</span></button></nav>
    <div v-if="preview" class="preview"><span>Vista previa · Sin cambios reales</span><button @click="emit('practice')">Probar el flujo</button></div>
    <details class="options"><summary>Buscar y opciones</summary><label>Máquina o problema<input v-model="search" type="search" placeholder="Ej. 14 o colita tejida" /></label><button v-if="search" @click="search=''">Limpiar búsqueda</button><template v-if="!preview"><button :disabled="alertsBusy" @click="emit('alerts')">{{ alertsBusy ? 'Activando…' : alerts ? 'Renovar turno y avisos' : 'Activar avisos de mi turno' }}</button><button v-if="alerts" :disabled="alertsBusy" @click="emit('off')">Finalizar mi turno</button></template></details>
    <p v-if="error" role="alert" class="empty">No pudimos cargar los trabajos. <button @click="emit('retry')">Reintentar</button></p>
    <p v-else-if="loading" role="status" class="empty">Cargando trabajos…</p>
    <template v-else><p class="empty" v-if="!visible.length">{{ empty }}<button v-if="queue==='mine'" @click="queue='available'">Ver trabajos por tomar</button></p>
      <article v-for="item in visible" :key="item.id" :class="{ urgent:item.critico || item.estadoMaquina==='PARADA' || item.prioridadAtencion==='URGENTE' }">
        <div class="identity"><strong>{{ String(item.tipoMaquina).toUpperCase()==='TELAR' ? 'Telar' : 'Máquina' }} {{ eventView(item).numeroMaquinaDisplay }}</strong><span v-if="item.estadoMaquina==='PARADA' || item.critico" class="priority">{{ item.estadoMaquina==='PARADA' ? 'Parado' : 'Crítico' }}</span><span v-else-if="item.prioridadAtencion==='URGENTE'" class="priority">Urgente</span></div>
        <h2>{{ item.sintomaNombre || 'Problema reportado' }}</h2><p v-if="item.observaciones && item.observaciones!==item.sintomaNombre" class="description">{{ item.observaciones }}</p>
        <p class="state">{{ attentionLabel(item) }}<span v-if="item.asignadoNombre"> · {{ item.asignadoA===uid ? 'A tu cargo' : item.asignadoNombre }}</span></p>
        <div class="actions"><button class="primary" :disabled="!!busy" @click="open(item)">{{ busy===item.id ? 'Confirmando…' : preview && action(item).kind!=='detail' ? 'Ver cómo atender' : action(item).label }}</button><button v-if="action(item).kind!=='detail'" @click="emit('detail',item)">Detalle</button></div>
      </article>
    </template>
  </section>
</template>
<style scoped>
.mechanic-mobile{padding:16px 12px 28px;color:#0f172a;display:grid;gap:14px}header h1{font-size:21px;font-weight:700;line-height:1.25;margin:0}header p{font-size:14px;color:#64748b;margin:6px 0 0;line-height:1.45}nav{display:flex;border-bottom:1px solid #cbd5e1}button{font:inherit;font-size:14px;min-height:44px;border-radius:6px;cursor:pointer;padding:10px 12px;border:1px solid #cbd5e1;background:white;color:#334155}nav button{flex:1;border:0;border-bottom:3px solid transparent;border-radius:0;background:transparent;padding:10px 3px;white-space:nowrap;font-weight:600}nav button[aria-pressed=true]{border-bottom-color:#4f46e5;color:#4338ca}nav span{font-size:12px;margin-left:5px;color:#64748b}.preview{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:12px;color:#64748b}.preview button{font-size:13px;padding:8px;color:#4338ca;background:transparent;border:0}.options{font-size:14px;color:#475569}.options summary{min-height:44px;cursor:pointer;padding:10px 0}.options label{display:grid;gap:6px;margin-bottom:10px}.options input{font:inherit;font-size:16px;padding:10px;border:1px solid #cbd5e1;border-radius:6px;min-width:0;width:100%;box-sizing:border-box}.options button{margin:0 6px 8px 0}article{border:1px solid #e2e8f0;border-radius:8px;background:#fff;padding:16px;min-width:0}article.urgent{border-left:4px solid #dc2626}.identity{display:flex;align-items:center;justify-content:space-between;gap:8px}.identity strong{font-size:19px;font-weight:700}.priority{color:#b91c1c;background:#fef2f2;border-radius:4px;padding:4px 7px;font-size:12px;font-weight:650}h2{font-size:16px;font-weight:600;margin:10px 0 0;line-height:1.4}.description{font-size:15px;color:#475569;line-height:1.5;margin:6px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.state{font-size:13px;color:#64748b;margin:12px 0}.actions{display:flex;gap:8px}.actions .primary{flex:1;background:#4f46e5;color:white;border-color:#4f46e5;font-weight:600}.empty{font-size:15px;color:#64748b;padding:24px 8px;line-height:1.5;text-align:center}.empty button{display:block;margin:12px auto 0}button:disabled{opacity:.55;cursor:wait}:focus-visible{outline:2px solid #818cf8;outline-offset:2px}@media(min-width:768px){.mechanic-mobile{display:none}}
</style>
