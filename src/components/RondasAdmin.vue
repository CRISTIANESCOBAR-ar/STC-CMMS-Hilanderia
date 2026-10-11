<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userRole } from '../services/authService';
import { normalizeSectorValue } from '../constants/organization';
import { cargarTodasRutasPatrulla, guardarRutaPatrulla, eliminarRutaPatrulla } from '../services/patrullaService';
import { Plus, Trash2, Save, Lock, Star, ChevronUp, ChevronDown, X, RefreshCw, Search, Pencil, ArrowLeft } from 'lucide-vue-next';
import { vTippy } from '../utils/tooltipDirective';
import Swal from 'sweetalert2';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/themes/light-border.css';
const TIPOS_POR_SECTOR = { TEJEDURIA:['TELAR'], HILANDERIA:['CARDA','OPEN-END','PASADOR','APERTURA'] };
const TIPO_RUTA_OPTIONS = [{ value:'roturas',label:'Roturas' },{ value:'eficiencia',label:'Eficiencia' },{ value:'ambos',label:'Ambos' }];
const rutas = ref([]), todasMaquinas = ref([]), cargando = ref(true), guardando = ref(false), error = ref(''), formError = ref(''), mensaje = ref('');
const modoEditor = ref(false), editandoId = ref(null), search = ref(''), sectorFiltro = ref(''), tipoFiltro = ref(''), estadoFiltro = ref(''), machineSearch = ref('');
const formBase = () => ({ nombre:'',tipo:'roturas',sector:'TEJEDURIA',activa:true,esDefault:false,obligatoria:false,orden:10,maquinas:[] });
const form = ref(formBase()), initial = ref('');
const dirty = computed(() => modoEditor.value && JSON.stringify(form.value) !== initial.value);
const admin = computed(() => userRole.value === 'admin');
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const sectorLabel = value => normalizeSectorValue(value) === 'TEJEDURIA' ? 'Tejeduría' : normalizeSectorValue(value) === 'HILANDERIA' ? 'Hilandería' : value || 'Sin sector';
const tipoLabel = tipo => TIPO_RUTA_OPTIONS.find(option => option.value === tipo)?.label || tipo;
const rutasVisibles = computed(() => rutas.value.filter(ruta => (!search.value.trim() || normalize(ruta.nombre).includes(normalize(search.value.trim()))) && (!sectorFiltro.value || normalizeSectorValue(ruta.sector) === sectorFiltro.value) && (!tipoFiltro.value || ruta.tipo === tipoFiltro.value) && (!estadoFiltro.value || (ruta.activa !== false) === (estadoFiltro.value === 'active'))));
const maquinasFiltradas = computed(() => {
  const sector = normalizeSectorValue(form.value.sector), validTypes = TIPOS_POR_SECTOR[sector] || [];
  return todasMaquinas.value.filter(machine => normalizeSectorValue(machine.sector) === sector && validTypes.includes(String(machine.tipo || '').toUpperCase()) && machine.activo !== false).sort((a,b) => String(a.maquina || a.id).localeCompare(String(b.maquina || b.id),undefined,{ numeric:true }));
});
const idsEnRuta = computed(() => new Set(form.value.maquinas.map(machine => machine.maquinaId)));
const maquinasEnRuta = computed(() => [...form.value.maquinas].sort((a,b) => a.orden-b.orden).map(machine => ({ ...machine, datos:todasMaquinas.value.find(item => item.id === machine.maquinaId) })));
const maquinasDisponibles = computed(() => maquinasFiltradas.value.filter(machine => !idsEnRuta.value.has(machine.id) && (!machineSearch.value.trim() || normalize([machine.maquina,machine.tipo,machine.grp_tear].join(' ')).includes(normalize(machineSearch.value.trim())))));
const gridTelar = computed(() => {
  if (form.value.sector !== 'TEJEDURIA') return [];
  const byNumber = new Map();
  maquinasFiltradas.value.forEach(machine => { const number = Number(String(machine.maquina || '').slice(-3)); if (number >= 1 && number <= 80) byNumber.set(number,machine); });
  return Array.from({ length:8 },(_,row) => Array.from({ length:10 },(_,col) => { const n = col*8+row+1, maq = byNumber.get(n); return { n,maq,inRuta:maq && idsEnRuta.value.has(maq.id) }; }));
});
let generation = 0, previousFocus;
async function cargar() {
  if (!admin.value || guardando.value) return;
  const token = ++generation; cargando.value = true; error.value = '';
  const results = await Promise.allSettled([cargarTodasRutasPatrulla(),getDocs(collection(db,'maquinas'))]);
  if (token !== generation) return;
  if (results[0].status === 'fulfilled') rutas.value = results[0].value;
  if (results[1].status === 'fulfilled') todasMaquinas.value = results[1].value.docs.map(document => ({ ...document.data(),id:document.id }));
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) error.value = 'No se pudo completar la carga de rutas o máquinas. Reintentá antes de editar.';
  cargando.value = false;
}
onMounted(cargar);
async function allowDiscard() {
  if (guardando.value) return false;
  if (!dirty.value) return true;
  return (await Swal.fire({ title:'¿Descartar cambios?',text:'La ruta tiene modificaciones sin guardar.',icon:'warning',showCancelButton:true,confirmButtonText:'Descartar',cancelButtonText:'Seguir editando' })).isConfirmed;
}
async function abrirEditor(ruta = null) {
  if (!admin.value || cargando.value || error.value || !await allowDiscard()) return;
  previousFocus = globalThis.document?.activeElement;
  editandoId.value = ruta?.id || null;
  form.value = ruta ? { nombre:ruta.nombre || '',tipo:ruta.tipo || 'roturas',sector:normalizeSectorValue(ruta.sector) || 'TEJEDURIA',activa:ruta.activa !== false,esDefault:!!ruta.esDefault,obligatoria:!!ruta.obligatoria,orden:ruta.orden ?? 10,maquinas:[...(ruta.maquinas || [])].sort((a,b) => (a.orden ?? 0)-(b.orden ?? 0)).map((machine,index) => ({ maquinaId:machine.maquinaId,orden:index+1 })) } : formBase();
  initial.value = JSON.stringify(form.value); modoEditor.value = true; formError.value = ''; mensaje.value = ''; machineSearch.value = '';
  nextTick(() => globalThis.document?.getElementById('route-name')?.focus());
}
async function cerrarEditor() {
  if (!await allowDiscard()) return false;
  modoEditor.value = false; editandoId.value = null; formError.value = ''; mensaje.value = '';
  nextTick(() => previousFocus?.isConnected && previousFocus.focus()); return true;
}
async function cambiarSector(event) {
  const value = event.target.value;
  if (guardando.value) { event.target.value = form.value.sector; return; }
  if (form.value.maquinas.length && !(await Swal.fire({ title:'¿Cambiar de sector?',text:'Se quitarán las máquinas seleccionadas del sector anterior. Este cambio se aplicará al guardar.',icon:'warning',showCancelButton:true,confirmButtonText:'Cambiar sector',cancelButtonText:'Cancelar' })).isConfirmed) { event.target.value = form.value.sector; return; }
  form.value.sector = value; form.value.maquinas = []; machineSearch.value = '';
}
function agregarMaquina(machine) {
  if (guardando.value || !admin.value || !modoEditor.value || idsEnRuta.value.has(machine.id) || !maquinasFiltradas.value.some(item => item.id === machine.id)) return;
  form.value.maquinas.push({ maquinaId:machine.id,orden:form.value.maquinas.length+1 });
}
function quitarMaquina(id) { if (guardando.value || !admin.value) return; form.value.maquinas = form.value.maquinas.filter(machine => machine.maquinaId !== id).map((machine,index) => ({ ...machine,orden:index+1 })); }
function mover(index,direction) {
  if (guardando.value || !admin.value) return;
  const list = [...form.value.maquinas].sort((a,b) => a.orden-b.orden), target = index+direction;
  if (index < 0 || target < 0 || target >= list.length) return;
  [list[index],list[target]] = [list[target],list[index]];
  form.value.maquinas = list.map((machine,index) => ({ ...machine,orden:index+1 }));
}
async function guardarRuta() {
  if (guardando.value || !admin.value || !modoEditor.value) return;
  if (!form.value.nombre.trim() || !TIPOS_POR_SECTOR[form.value.sector] || !TIPO_RUTA_OPTIONS.some(option => option.value === form.value.tipo) || !Number.isInteger(Number(form.value.orden)) || form.value.orden < 1 || form.value.orden > 99) { formError.value = 'Completá el nombre, tipo, sector y una posición entre 1 y 99.'; return; }
  guardando.value = true; formError.value = ''; mensaje.value = '';
  try {
    const data = { ...form.value,nombre:form.value.nombre.trim(),orden:Number(form.value.orden),maquinas:[...form.value.maquinas].sort((a,b) => a.orden-b.orden).map((machine,index) => ({ maquinaId:machine.maquinaId,orden:index+1 })) };
    const id = await guardarRutaPatrulla(editandoId.value,data);
    // Retain the ID even if a subsequent refresh fails, avoiding duplicate creation on retry.
    editandoId.value = id;
    if (data.obligatoria) await Promise.all(rutas.value.filter(route => route.id !== id && route.tipo === data.tipo && normalizeSectorValue(route.sector) === data.sector && route.obligatoria).map(route => guardarRutaPatrulla(route.id,{ obligatoria:false })));
    form.value = { ...data,maquinas:data.maquinas.map(machine => ({ ...machine })) }; initial.value = JSON.stringify(form.value);
    rutas.value = await cargarTodasRutasPatrulla(); mensaje.value = 'Ruta guardada correctamente.';
  } catch (failure) { formError.value = `No se pudo completar el guardado: ${failure.message || 'reintentá sin cerrar el editor.'}`; }
  finally { guardando.value = false; }
}
async function eliminar() {
  if (guardando.value || !admin.value || !editandoId.value) return;
  guardando.value = true; formError.value = ''; mensaje.value = '';
  try {
    const result = await Swal.fire({ title:'¿Eliminar ruta?',text:`${form.value.nombre}. Esta acción elimina la configuración de la ruta.`,icon:'warning',showCancelButton:true,confirmButtonText:'Eliminar',cancelButtonText:'Cancelar',confirmButtonColor:'#dc2626' });
    if (!result.isConfirmed) return;
    await eliminarRutaPatrulla(editandoId.value);
    rutas.value = rutas.value.filter(route => route.id !== editandoId.value); modoEditor.value = false; editandoId.value = null;
    nextTick(() => previousFocus?.isConnected && previousFocus.focus());
  } catch (failure) { formError.value = `No se pudo eliminar: ${failure.message || 'reintentá.'}`; }
  finally { guardando.value = false; }
}
function beforeUnload(event) { if (dirty.value || guardando.value) { event.preventDefault(); event.returnValue = ''; } }
globalThis.window?.addEventListener('beforeunload',beforeUnload);
onUnmounted(() => { generation++; globalThis.window?.removeEventListener('beforeunload',beforeUnload); });
onBeforeRouteLeave(allowDiscard);
</script>

<template>
  <section class="rounds-page">
    <p v-if="!admin" class="error">Solo administradores pueden gestionar las rutas de patrulla.</p>
    <template v-else>
      <header class="page-header"><div><h1>Rutas de patrulla</h1><p>Configuración de recorridos · {{ rutas.length }} rutas</p></div><div class="actions"><button class="btn" :disabled="cargando || guardando || modoEditor" v-tippy="modoEditor ? 'Cerrá el editor para actualizar la lista':'Actualizar rutas y máquinas'" @click="cargar"><RefreshCw :class="{ spinning:cargando }" />Actualizar</button><button class="btn primary" :disabled="cargando || guardando || !!error" @click="abrirEditor()"><Plus />Nueva ruta</button></div></header>
      <div v-if="error" class="error" role="alert">{{ error }} <button :disabled="guardando" @click="cargar">Reintentar</button></div>
      <div class="route-layout" :class="{ editing:modoEditor }">
        <aside class="route-panel">
          <div class="filters"><div class="search"><Search /><input v-model="search" aria-label="Buscar rutas" placeholder="Buscar ruta…" /></div><select v-model="sectorFiltro" aria-label="Filtrar sector"><option value="">Todos los sectores</option><option v-for="(_,sector) in TIPOS_POR_SECTOR" :key="sector" :value="sector">{{ sectorLabel(sector) }}</option></select><select v-model="tipoFiltro" aria-label="Filtrar tipo"><option value="">Todos los tipos</option><option v-for="option in TIPO_RUTA_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select><select v-model="estadoFiltro" aria-label="Filtrar estado"><option value="">Todos los estados</option><option value="active">Activas</option><option value="inactive">Inactivas</option></select></div>
          <div class="route-scroll" :aria-busy="cargando"><p v-if="cargando" class="empty" role="status">Cargando rutas y máquinas…</p><p v-else-if="!rutasVisibles.length" class="empty">{{ rutas.length ? 'No hay rutas que coincidan.':'No hay rutas definidas. Creá la primera con Nueva ruta.' }}</p>
            <table v-else-if="!modoEditor" class="routes-table"><colgroup><col style="width:65px" /><col /><col style="width:17%" /><col style="width:13%" /><col style="width:85px" /><col style="width:17%" /><col style="width:80px" /></colgroup><thead><tr><th>Orden</th><th>Ruta</th><th>Sector</th><th>Tipo</th><th>Máquinas</th><th>Configuración</th><th>Acciones</th></tr></thead><tbody><tr v-for="route in rutasVisibles" :key="route.id"><td>{{ route.orden ?? '—' }}</td><td><strong>{{ route.nombre }}</strong><span class="state" :class="{ inactive:route.activa===false }">{{ route.activa===false ? 'Inactiva':'Activa' }}</span></td><td>{{ sectorLabel(route.sector) }}</td><td>{{ tipoLabel(route.tipo) }}</td><td>{{ route.maquinas?.length || 0 }}</td><td><div class="badges"><span v-if="route.obligatoria" class="badge mandatory"><Lock />Obligatoria</span><span v-if="route.esDefault" class="badge default"><Star />Por defecto</span><span v-if="!route.obligatoria && !route.esDefault" class="muted">Libre elección</span></div></td><td><button class="icon-btn" v-tippy="'Editar ruta y secuencia de máquinas'" aria-label="Editar ruta" :disabled="guardando || !!error" @click="abrirEditor(route)"><Pencil /></button></td></tr></tbody></table>
            <div v-else class="route-list"><button v-for="route in rutasVisibles" :key="route.id" :class="{ selected:route.id===editandoId }" :disabled="guardando || !!error" @click="abrirEditor(route)"><strong>{{ route.nombre }}</strong><span>{{ sectorLabel(route.sector) }} · {{ tipoLabel(route.tipo) }}</span><span>{{ route.maquinas?.length || 0 }} máquinas · {{ route.activa===false ? 'Inactiva':'Activa' }}</span><span v-if="route.obligatoria || route.esDefault" class="route-flags">{{ route.obligatoria ? 'Obligatoria':'' }}{{ route.obligatoria && route.esDefault ? ' · ':'' }}{{ route.esDefault ? 'Por defecto':'' }}</span></button></div>
          </div><footer class="panel-footer">{{ rutasVisibles.length }} de {{ rutas.length }} rutas</footer>
        </aside>
        <form v-if="modoEditor" class="editor" @submit.prevent="guardarRuta">
          <header class="editor-header"><div><h2>{{ editandoId ? 'Editar ruta':'Nueva ruta' }}</h2><span>{{ dirty ? 'Cambios sin guardar':'Configuración del recorrido' }}</span></div><button type="button" class="icon-btn" v-tippy="'Cerrar editor y volver a la tabla'" aria-label="Cerrar editor" :disabled="guardando" @click="cerrarEditor"><X /></button></header>
          <div class="editor-scroll">
            <p v-if="formError" class="error" role="alert">{{ formError }}</p><p v-if="mensaje" class="success" role="status">{{ mensaje }}</p>
            <fieldset :disabled="guardando"><div class="settings"><label class="route-name">Nombre de la ruta<input id="route-name" v-model="form.nombre" required placeholder="Ej.: Ruta completa, Ruta parcial A…" /></label><label>Tipo<select v-model="form.tipo"><option v-for="option in TIPO_RUTA_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label>Sector<select :value="form.sector" @change="cambiarSector"><option v-for="(_,sector) in TIPOS_POR_SECTOR" :key="sector" :value="sector">{{ sectorLabel(sector) }}</option></select></label><label>Posición en selector<input v-model.number="form.orden" type="number" min="1" max="99" required /></label></div><div class="flags"><label><input v-model="form.activa" type="checkbox" />Activa</label><label v-tippy="'El inspector puede elegir otra ruta'"><input v-model="form.esDefault" type="checkbox" />Por defecto</label><label v-tippy="'El inspector no puede cambiar esta ruta'"><input v-model="form.obligatoria" type="checkbox" />Obligatoria</label><p v-if="form.obligatoria">Al guardar reemplaza la ruta obligatoria del mismo tipo y sector.</p></div>
            <div class="machine-workspace">
              <section class="machine-panel"><header><h3>{{ form.sector==='TEJEDURIA' ? 'Sala de telares':'Máquinas disponibles' }}</h3><span>{{ maquinasDisponibles.length }} disponibles</span></header>
                <div class="machine-scroll"><template v-if="form.sector==='TEJEDURIA'"><p class="hint">Seleccioná máquinas para agregarlas al recorrido.</p><div class="legend"><span><i class="available-dot" />Disponible</span><span><i class="selected-dot" />En ruta</span><span><i />Sin máquina</span></div><div class="loom-grid"><template v-for="(row,index) in gridTelar" :key="index"><button v-for="cell in row" :key="cell.n" type="button" :disabled="guardando || !cell.maq || cell.inRuta" :class="{ assigned:cell.inRuta, missing:!cell.maq }" v-tippy="cell.maq ? `${cell.maq.maquina} · ${cell.inRuta ? 'Ya en ruta':'Agregar al recorrido'}`:'Sin máquina registrada'" :aria-label="cell.maq ? `${cell.inRuta ? 'En ruta':'Agregar máquina'} ${cell.maq.maquina}`:`Posición ${cell.n} sin máquina`" @click="cell.maq && agregarMaquina(cell.maq)">{{ cell.n }}</button></template></div><p class="hint">El mapa conserva la distribución de 8 filas × 10 columnas. Pasá el cursor para ver el código completo.</p></template>
                  <template v-else><div class="search"><Search /><input v-model="machineSearch" aria-label="Buscar máquinas disponibles" placeholder="Buscar código o tipo…" /></div><p v-if="!maquinasDisponibles.length" class="empty">No hay máquinas disponibles que coincidan.</p><div class="available-list"><button v-for="machine in maquinasDisponibles" :key="machine.id" type="button" :disabled="guardando" @click="agregarMaquina(machine)"><Plus /><span>{{ machine.maquina || machine.id }}</span><small>{{ machine.tipo }}</small></button></div></template>
                </div>
              </section>
              <section class="sequence-panel"><header><h3>Secuencia del recorrido</h3><span>{{ maquinasEnRuta.length }} máquinas</span></header><div class="sequence-scroll"><p v-if="!maquinasEnRuta.length" class="empty">Agregá máquinas desde el mapa o la lista disponible.</p><table v-else class="sequence-table"><thead><tr><th>#</th><th>Máquina</th><th>Orden / quitar</th></tr></thead><tbody><tr v-for="(machine,index) in maquinasEnRuta" :key="machine.maquinaId"><td>{{ index+1 }}</td><td><strong>{{ machine.datos?.maquina || machine.maquinaId }}</strong><small>{{ machine.datos?.tipo || 'No disponible en catálogo' }}{{ machine.datos?.grp_tear ? ` · GP${machine.datos.grp_tear}`:'' }}</small></td><td><div class="actions"><button type="button" class="icon-btn" v-tippy="'Mover arriba'" aria-label="Mover máquina arriba" :disabled="guardando || index===0" @click="mover(index,-1)"><ChevronUp /></button><button type="button" class="icon-btn" v-tippy="'Mover abajo'" aria-label="Mover máquina abajo" :disabled="guardando || index===maquinasEnRuta.length-1" @click="mover(index,1)"><ChevronDown /></button><button type="button" class="icon-btn danger" v-tippy="'Quitar de la ruta'" aria-label="Quitar máquina de la ruta" :disabled="guardando" @click="quitarMaquina(machine.maquinaId)"><X /></button></div></td></tr></tbody></table></div></section>
            </div></fieldset>
          </div>
          <footer class="editor-footer"><button v-if="editandoId" type="button" class="btn danger" :disabled="guardando" @click="eliminar"><Trash2 />Eliminar</button><button type="button" class="btn cancel" :disabled="guardando" @click="cerrarEditor"><ArrowLeft />Volver</button><button type="submit" class="btn primary" :disabled="guardando"><Save />{{ guardando ? 'Guardando…':'Guardar ruta' }}</button></footer>
        </form>
      </div>
    </template>
  </section>
</template>

<style scoped>
.rounds-page{height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;padding:14px 16px;font-size:13px;color:#334155}
.page-header,.actions,.editor-header,.editor-footer,.machine-panel>header,.sequence-panel>header{display:flex;align-items:center;gap:8px}
.page-header{justify-content:space-between;flex-wrap:wrap}.page-header h1{font-size:19px;font-weight:700;color:#1e293b}.page-header p{font-size:12px;color:#64748b;margin-top:3px}
.btn,.icon-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:white;border:1px solid #cbd5e1;border-radius:5px;min-height:34px;padding:0 10px;font-weight:600;color:#475569}.btn:hover,.icon-btn:hover{background:#f1f5f9}.btn svg,.icon-btn svg,.search svg{width:16px;height:16px}.primary{background:#2563eb;color:white;border-color:#2563eb}.primary:hover{background:#1d4ed8}.danger{color:#dc2626}.danger:hover{background:#fef2f2}.icon-btn{width:28px;min-height:28px;padding:0;border-color:transparent}.btn:disabled,button:disabled{opacity:.4;cursor:not-allowed}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}
.route-layout{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr);gap:12px}.route-layout.editing{grid-template-columns:260px minmax(0,1fr)}.route-panel,.editor{display:flex;flex-direction:column;min-width:0;min-height:0;background:white;border:1px solid #e2e8f0;border-radius:7px;overflow:hidden}.filters{display:flex;gap:8px;flex-wrap:wrap;padding:10px;border-bottom:1px solid #e2e8f0}.search{position:relative;flex:1;min-width:140px}.search svg{position:absolute;left:9px;top:10px;color:#94a3b8}.search input{width:100%;padding-left:31px!important}input:not([type=checkbox]),select{border:1px solid #cbd5e1;background:white;border-radius:5px;padding:7px 9px;min-width:0;font-size:13px;color:#334155}.editing .filters select,.editing .filters .search{width:100%;flex-basis:100%}.route-scroll{flex:1;min-height:0;overflow:auto}.panel-footer{padding:8px 12px;border-top:1px solid #e2e8f0;background:#f8fafc;color:#64748b;font-size:11px}.routes-table,.sequence-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}th{position:sticky;top:0;background:#f1f5f9;z-index:1;font-size:11px;color:#475569;text-align:left;border-bottom:1px solid #cbd5e1}th,td{padding:10px 12px;overflow-wrap:anywhere}td{border-bottom:1px solid #eef2f6;vertical-align:middle}tbody tr:nth-child(even){background:#fafbfd}tbody tr:hover{background:#eff6ff}strong{font-weight:600}.state{display:block;font-size:11px;color:#047857;margin-top:3px}.state.inactive{color:#64748b}.badges{display:flex;gap:4px;flex-wrap:wrap}.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 6px;border-radius:4px;font-size:11px}.badge svg{width:12px;height:12px}.mandatory{background:#fef2f2;color:#b91c1c}.default{background:#fffbeb;color:#92400e}.muted{color:#64748b;font-size:11px}.route-list{padding:8px;display:flex;flex-direction:column;gap:7px}.route-list button{display:flex;flex-direction:column;gap:4px;text-align:left;padding:10px;border:1px solid #e2e8f0;border-radius:5px;background:white;overflow-wrap:anywhere}.route-list button:hover{background:#f8fafc}.route-list .selected{background:#eff6ff;border-color:#93c5fd}.route-list span{font-size:11px;color:#64748b}.route-list .route-flags{color:#9a3412}.editor-header{justify-content:space-between;padding:10px 14px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.editor-header h2{font-size:15px;font-weight:700}.editor-header span{font-size:11px;color:#64748b}.editor-scroll{flex:1;min-height:0;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px}.editor fieldset{border:0;min-height:0;display:flex;flex:1;flex-direction:column;gap:12px}.settings{display:grid;grid-template-columns:minmax(150px,2fr) repeat(2,minmax(100px,1fr)) 130px;gap:10px}.settings label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:600;color:#64748b}.flags{display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:12px}.flags label{display:flex;align-items:center;gap:6px}.flags p{font-size:11px;color:#9a3412}.machine-workspace{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.3fr) minmax(280px,1fr);gap:12px}.machine-panel,.sequence-panel{display:flex;flex-direction:column;min-width:0;min-height:0;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden}.machine-panel>header,.sequence-panel>header{justify-content:space-between;padding:10px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.machine-panel h3,.sequence-panel h3{font-size:12px;font-weight:700}.machine-panel header span,.sequence-panel header span{font-size:11px;color:#64748b}.machine-scroll{padding:10px;overflow:auto;flex:1;min-height:0;display:flex;flex-direction:column}.machine-scroll>.search{flex:none;min-width:0}.sequence-scroll{flex:1;min-height:0;overflow:auto}.loom-grid{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));grid-template-rows:repeat(8,minmax(30px,1fr));gap:5px;min-width:270px;min-height:275px;flex:1}.loom-grid button{min-height:30px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:4px;font-weight:600;font-size:clamp(11px,.9vw,15px)}.loom-grid button:hover:not(:disabled){background:#dbeafe}.loom-grid button.assigned{opacity:1;background:#e2e8f0;border-color:#cbd5e1;color:#64748b;text-decoration:line-through}.loom-grid button.missing{opacity:1;background:#f8fafc;border-color:#f1f5f9;color:#cbd5e1}.hint{font-size:11px;color:#64748b;margin:0 0 10px;line-height:1.5}.loom-grid+.hint{margin:10px 0 0}.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:10px;color:#64748b;margin-bottom:10px}.legend span{display:flex;align-items:center;gap:4px}.legend i{width:9px;height:9px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:2px}.legend .available-dot{background:#eff6ff;border-color:#93c5fd}.legend .selected-dot{background:#cbd5e1;border-color:#94a3b8}.sequence-table th:first-child{width:36px}.sequence-table th:last-child{width:100px}.sequence-table th,.sequence-table td{padding:8px}.sequence-table small{display:block;color:#64748b;font-size:10px;margin-top:3px}.sequence-table .actions{gap:0}.available-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:7px;margin-top:10px}.available-list button{display:flex;align-items:center;gap:6px;padding:9px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;color:#1d4ed8;flex-wrap:wrap}.available-list svg{width:14px;height:14px}.available-list small{color:#64748b;font-size:10px}.editor-footer{padding:10px 14px;border-top:1px solid #e2e8f0;background:#f8fafc;flex-wrap:wrap}.editor-footer .cancel{margin-left:auto}.empty{padding:40px 14px;text-align:center;color:#64748b;font-size:12px;line-height:1.5}.error,.success{padding:9px 12px;border-radius:5px;font-size:12px;line-height:1.5}.error{background:#fef2f2;color:#b91c1c}.success{background:#ecfdf5;color:#047857}.error button{text-decoration:underline;margin-left:8px}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:1450px){.route-layout.editing{grid-template-columns:225px minmax(0,1fr)}.settings{grid-template-columns:repeat(3,minmax(0,1fr))}.route-name{grid-column:1/-1}.machine-workspace{grid-template-columns:minmax(0,1fr) minmax(260px,.85fr)}}
@media(max-width:1199px){.route-layout.editing{grid-template-columns:200px minmax(0,1fr)}.machine-workspace{display:flex;flex-direction:column;flex:none}.machine-panel{flex:none}.sequence-panel{min-height:200px;max-height:460px;flex:none}.editor fieldset{flex:none}.editor-scroll{padding:10px}.loom-grid button{height:32px}.settings{gap:8px}.rounds-page{padding:10px;gap:8px}.flags{gap:10px}.routes-table th,.routes-table td{padding:8px}}
@media(max-width:767px){.rounds-page{height:auto;min-height:100%}.route-layout,.route-layout.editing{display:flex;flex-direction:column;flex:none}.route-panel{max-height:55vh;min-height:200px}.editing .route-panel{min-height:150px;max-height:260px}.editing .filters select{flex-basis:auto;width:auto;max-width:150px}.editing .filters .search{flex-basis:100%}.editor{min-height:500px}.editor-scroll{overflow:visible}.editor-footer{position:sticky;bottom:0;z-index:2}.routes-table{min-width:650px}.page-header h1{font-size:17px}.settings{grid-template-columns:1fr 1fr}.settings .route-name{grid-column:1/-1}.settings label:last-child{grid-column:1/-1}.settings label:last-child input{max-width:110px}.loom-grid{gap:3px}.legend{gap:8px}.actions{flex-wrap:wrap}.editor-footer .btn{padding:0 8px;font-size:12px}}
</style>
