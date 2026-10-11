<script setup>
import { computed, ref, nextTick } from 'vue';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-vue-next';
import { addDays, plantDate } from '../utils/plantTime';
import { vTippy } from '../utils/tooltipDirective';

const props = defineProps({ modelValue: { type:String, required:true }, label: { type:String, default:'Fecha' } });
const emit = defineEmits(['update:modelValue']);
const open = ref(false), month = ref(''), dialog = ref(null), trigger = ref(null);
const monthLabel = computed(() => month.value ? new Intl.DateTimeFormat('es-AR', { month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(month.value + '-01T12:00:00Z')) : '');
const days = computed(() => {
  if (!month.value) return [];
  const offset = (new Date(month.value + '-01T12:00:00Z').getUTCDay() + 6) % 7;
  return Array.from({ length:42 }, (_, index) => addDays(month.value + '-01', index - offset));
});
async function show() { month.value = props.modelValue.slice(0,7); open.value = true; await nextTick(); dialog.value?.querySelector('[aria-pressed="true"]')?.focus(); }
function close() { open.value = false; nextTick(() => trigger.value?.focus()); }
function select(date) { emit('update:modelValue', date); close(); }
function move(delta) { const date = new Date(month.value + '-01T12:00:00Z'); date.setUTCMonth(date.getUTCMonth() + delta); month.value = date.toISOString().slice(0,7); }
function keyboard(event) {
  if (event.key === 'Escape') { close(); return; }
  if (event.key === 'Tab') {
    const buttons = dialog.value?.querySelectorAll('button');
    const edge = event.shiftKey ? buttons?.[0] : buttons?.[buttons.length - 1];
    if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? buttons[buttons.length - 1] : buttons[0]).focus(); }
  }
  const delta = { ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7 }[event.key];
  const date = event.target.dataset?.date;
  if (delta != null && date) {
    event.preventDefault(); const target = addDays(date, delta); month.value = target.slice(0,7);
    nextTick(() => dialog.value?.querySelector('[data-date="' + target + '"]')?.focus());
  }
}
</script>
<template>
  <button ref="trigger" class="date-trigger" type="button" :aria-label="label + ': ' + modelValue.split('-').reverse().join('/')" aria-haspopup="dialog" :aria-expanded="open" v-tippy="label" @click="show"><CalendarDays :size="16" />{{ modelValue.split('-').reverse().join('/') }}</button>
  <Teleport to="body"><div v-if="open" class="date-overlay" @click.self="close"><section ref="dialog" class="date-panel" role="dialog" aria-modal="true" :aria-label="label" @keydown="keyboard"><header><strong>{{ label }}</strong><button type="button" aria-label="Cerrar calendario" @click="close"><X :size="16" /></button></header><div class="date-month"><button type="button" aria-label="Mes anterior" @click="move(-1)"><ChevronLeft :size="16" /></button><strong>{{ monthLabel }}</strong><button type="button" aria-label="Mes siguiente" @click="move(1)"><ChevronRight :size="16" /></button></div><div class="date-days"><span v-for="day in ['Lu','Ma','Mi','Ju','Vi','Sá','Do']" :key="day">{{ day }}</span><button v-for="date in days" :key="date" type="button" :data-date="date" :aria-label="date.split('-').reverse().join('/')" :aria-pressed="date === modelValue" :class="{ outside: !date.startsWith(month) }" @click="select(date)">{{ Number(date.slice(-2)) }}</button></div><footer><button type="button" @click="select(plantDate())">Hoy</button><button type="button" @click="select(addDays(plantDate(), -1))">Ayer</button></footer></section></div></Teleport>
</template>
<style scoped>
.date-trigger { display:flex; align-items:center; justify-content:center; gap:8px; height:34px; padding:5px 8px; border:1px solid #dce3ec; border-radius:6px; font-size:12px; color:#334155; background:white; cursor:pointer; }
.date-overlay { position:fixed; inset:0; z-index:120; background:#0f172a44; display:flex; align-items:center; justify-content:center; padding:16px; }
.date-panel { width:300px; max-width:100%; padding:14px; background:white; border:1px solid #dce3ec; border-radius:10px; box-shadow:0 15px 45px #0f172a33; font-size:13px; color:#334155; }
.date-panel header,.date-month { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px; }
.date-panel strong { font-weight:600; } .date-month strong { text-transform:capitalize; }
.date-panel button { display:inline-flex; align-items:center; justify-content:center; min-height:32px; padding:5px; border-radius:5px; cursor:pointer; }
.date-panel button:hover { background:#eef2ff; } button:focus-visible { outline:2px solid #6366f1; outline-offset:1px; }
.date-days { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:3px; } .date-days span { text-align:center; font-size:11px; color:#64748b; }
.date-days .outside { color:#94a3b8; } .date-days button[aria-pressed=true] { background:#4f46e5; color:white; }
.date-panel footer { display:flex; gap:8px; border-top:1px solid #e2e8f0; margin-top:10px; padding-top:8px; } .date-panel footer button { flex:1; border:1px solid #dce3ec; }
</style>
