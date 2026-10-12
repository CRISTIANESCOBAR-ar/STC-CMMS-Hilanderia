<script setup>
import { ref,computed,watch,nextTick,onMounted,onUnmounted } from 'vue';
import { isNavigationFailure } from 'vue-router';
import { ShieldCheck,Wrench,BellRing,ClipboardList,ScanSearch,FileText,Users,Gauge,Scissors,Eye,History,BookMarked,Settings2,Stethoscope,ListFilter,Route,Languages,Factory,BookOpen,ChevronRight,ChevronDown,X } from 'lucide-vue-next';
import { navigationActive } from '../utils/navigation';
import { vTippy } from '../utils/tooltipDirective';
const props=defineProps({ model:{ type:Object,required:true },path:{ type:String,required:true },layout:{ type:String,default:'rail' },contextKey:{ type:String,default:'' },suspended:{ type:Boolean,default:false } });
const emit=defineEmits(['navigate']);
const icons={ ShieldCheck,Wrench,BellRing,ClipboardList,ScanSearch,FileText,Users,Gauge,Scissors,Eye,History,BookMarked,Settings2,Stethoscope,ListFilter,Route,Languages,Factory,BookOpen };
const root=ref(null),popup=ref(null),open=ref(''),position=ref({ left:'80px',top:'12px' }),error=ref('');
const navigating=ref(false);
const group=computed(()=>props.model.groups.find(item=>item.id===open.value));
const active=item=>navigationActive(props.path,item);
const groupActive=item=>item.items.some(active);
const panelId=id=>`plant-nav-${props.layout}-${id}`;
let trigger,alive=true;
function setPopup(el) { if(el) popup.value=el; }
const resize=()=>close();
function close(restore=false) { open.value=''; error.value=''; if(restore) nextTick(()=>trigger?.isConnected && trigger.focus?.()); }
function place() {
  const rect=trigger?.getBoundingClientRect?.(),size=popup.value?.getBoundingClientRect?.();
  if(!rect) return;
  const width=Math.min(304,globalThis.innerWidth-rect.right-20),height=size?.height || 360;
  position.value={ left:`${rect.right+8}px`,top:`${Math.max(12,Math.min(rect.top,globalThis.innerHeight-height-12))}px`,width:`${Math.max(220,width)}px` };
}
async function toggle(item,event,focus=false) {
  if(open.value===item.id && !focus) { close(); return; }
  trigger=event.currentTarget; error.value=''; open.value=item.id;
  await nextTick(); if(!alive) return;
  if(props.layout==='rail') place();
  if(focus || props.layout==='rail') popup.value?.querySelector('a')?.focus?.();
}
async function follow(event,navigate) {
  if(event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button>0) return;
  if(navigating.value) { event.preventDefault?.(); return; }
  navigating.value=true;
  error.value='';
  try {
    const result=await navigate(event); if(!alive) return;
    if(isNavigationFailure(result) && result.type!==16) return;
    close(); emit('navigate');
  } catch { if(alive) error.value='No se pudo abrir la vista. Intentá nuevamente.'; }
  finally { navigating.value=false; }
}
function outside(event) { if(!navigating.value && open.value && !root.value?.contains?.(event.target) && !popup.value?.contains?.(event.target)) close(); }
function scroll(event) { if(props.layout==='rail' && open.value && !popup.value?.contains?.(event.target)) close(); }
function keys(event) {
  if(event.key==='Escape' && open.value) { event.preventDefault(); event.stopPropagation(); close(true); return; }
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
  const links=[...(popup.value?.querySelectorAll('a') || [])],index=links.indexOf(globalThis.document?.activeElement);
  if(!links.length) return;
  event.preventDefault(); links[event.key==='Home' ? 0:event.key==='End' ? links.length-1:(index+(event.key==='ArrowDown' ? 1:-1)+links.length)%links.length]?.focus();
}
watch(()=>props.path,()=>close());
watch(()=>props.contextKey,()=>close());
watch(()=>props.suspended,value=>{ if(value) close(); });
watch(()=>props.model,()=>close());
onMounted(()=>{ globalThis.document?.addEventListener('pointerdown',outside); globalThis.document?.addEventListener('focusin',outside); globalThis.document?.addEventListener('scroll',scroll,true); globalThis.window?.addEventListener('resize',resize); });
onUnmounted(()=>{ alive=false; globalThis.document?.removeEventListener('pointerdown',outside); globalThis.document?.removeEventListener('focusin',outside); globalThis.document?.removeEventListener('scroll',scroll,true); globalThis.window?.removeEventListener('resize',resize); });
</script>
<template>
  <nav ref="root" class="plant-navigation" :class="layout" aria-label="Navegación principal" @keydown.esc="keys">
    <RouterLink v-for="item in model.primary" :key="item.slug" :to="item.route" custom v-slot="{ href,navigate }"><a :href="href" class="nav-entry" :class="{ active:active(item) }" :aria-label="item.label" :aria-current="active(item) ? 'page':undefined" @click="follow($event,navigate)" v-tippy="layout==='rail' ? item.label:''"><component :is="icons[item.icon]" :size="20" /><span v-if="layout==='mobile'">{{ item.label }}</span></a></RouterLink>
    <div v-if="model.primary.length && model.groups.length" class="nav-divider"></div>
    <section v-for="item in model.groups" :key="item.id" class="nav-group">
      <button class="nav-entry" :class="{ active:groupActive(item),expanded:open===item.id }" :aria-label="item.label" :aria-expanded="open===item.id" :aria-controls="open===item.id ? panelId(item.id):undefined" @click="toggle(item,$event)" @keydown.down.prevent="toggle(item,$event,true)" v-tippy="layout==='rail' && open!==item.id ? item.label:''"><component :is="icons[item.icon]" :size="20" /><span v-if="layout==='mobile'">{{ item.label }}</span><component :is="layout==='mobile' ? ChevronDown:ChevronRight" :size="12" class="group-chevron" /></button>
      <div v-if="layout==='mobile' && open===item.id" :id="panelId(item.id)"  :ref="setPopup" class="nav-mobile-children" @keydown="keys"><RouterLink v-for="child in item.items" :key="child.slug" :to="child.route" custom v-slot="{ href,navigate }"><a :href="href" class="nav-child" :class="{ active:active(child) }" :aria-current="active(child) ? 'page':undefined" @click="follow($event,navigate)"><component :is="icons[child.icon]" :size="17" /><span>{{ child.label }}</span></a></RouterLink><p v-if="error" role="alert">{{ error }}</p></div>
    </section>
    <p v-if="error && !open" role="alert">{{ error }}</p>
  </nav>
  <Teleport to="body"><nav v-if="layout==='rail' && group && !suspended"  :ref="setPopup" class="nav-flyout" :id="panelId(group.id)" :style="position" :aria-label="group.label" @keydown="keys"><header><strong>{{ group.label }}</strong><button @click="close(true)" aria-label="Cerrar submenú"><X :size="16" /></button></header><div class="nav-flyout-list"><RouterLink v-for="item in group.items" :key="item.slug" :to="item.route" custom v-slot="{ href,navigate }"><a :href="href" class="nav-child" :class="{ active:active(item) }" :aria-current="active(item) ? 'page':undefined" @click="follow($event,navigate)"><component :is="icons[item.icon]" :size="18" /><span>{{ item.label }}</span><ChevronRight :size="14" /></a></RouterLink></div><p v-if="error" role="alert">{{ error }}</p></nav></Teleport>
</template>
<style scoped>
.plant-navigation.rail{width:100%;display:flex;flex-direction:column;align-items:center;gap:4px;padding:0 8px;min-height:0;overflow-y:auto;flex:1}.nav-group{width:100%;flex-shrink:0}.nav-entry{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:42px;flex-shrink:0;border:1px solid transparent;border-radius:7px;background:transparent;color:#64748b;text-decoration:none;cursor:pointer;position:relative;font-size:14px;font-weight:550}.nav-entry:hover,.nav-child:hover{background:#f1f5f9;color:#334155}.nav-entry.active,.nav-child.active{background:#eef2ff;color:#4338ca;font-weight:650}.nav-entry.active{border-color:#c7d2fe}.nav-entry.expanded{background:#f1f5f9;border-color:#cbd5e1}.group-chevron{position:absolute;right:1px;color:#94a3b8}.nav-divider{width:28px;height:1px;background:#e2e8f0;margin:6px 0;flex-shrink:0}.nav-flyout{position:fixed;z-index:80;background:white;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 8px 28px #0f172a26;max-height:calc(100dvh - 24px);display:flex;flex-direction:column;overflow:hidden;color:#334155;font-size:13px}.nav-flyout header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #e2e8f0}.nav-flyout header strong{font-size:14px;font-weight:650}.nav-flyout header button{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border:0;background:#f8fafc;color:#64748b;border-radius:5px;cursor:pointer}.nav-flyout-list{padding:6px;overflow:auto;min-height:0}.nav-child{display:flex;align-items:center;gap:10px;min-height:42px;padding:9px 10px;color:#334155;text-decoration:none;border-radius:5px;line-height:1.4;overflow-wrap:anywhere}.nav-child>svg{flex-shrink:0}.nav-child span{flex:1;min-width:0}.plant-navigation.mobile{display:flex;flex-direction:column;gap:4px}.mobile .nav-entry{justify-content:flex-start;padding:10px 14px;min-height:44px}.mobile .group-chevron{position:static;margin-left:auto}.mobile .nav-divider{width:100%;margin:7px 0}.nav-mobile-children{margin:4px 0 6px 20px;border-left:2px solid #e2e8f0;padding:0 6px}.nav-flyout p,.plant-navigation p{color:#b91c1c;font-size:12px;padding:8px;margin:0}.nav-entry:focus-visible,.nav-child:focus-visible,button:focus-visible{outline:2px solid #818cf8;outline-offset:-2px}.nav-mobile-children .nav-child{font-size:13px}
</style>
