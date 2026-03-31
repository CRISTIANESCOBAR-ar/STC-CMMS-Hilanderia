<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { getAuth } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userProfile } from '../services/authService';
import { normalizeSectorValue, DEFAULT_SECTOR } from '../constants/organization';
import { loadPatrullaConfig, cargarPatrullaActiva, crearPatrulla, guardarRondaRoturas, guardarRondaParcial } from '../services/patrullaService';
import Swal from 'sweetalert2';
import { useRouter } from 'vue-router';
import { Save, Check, AlertTriangle, Loader2, ChevronDown, BellRing, SendHorizontal, Share2, CloudUpload } from 'lucide-vue-next';
import { intervencionService } from '../services/intervencionService';

const props = defineProps({
  rondaInicial: { type: String, default: null },
});
const emit = defineEmits(['completada']);

const router = useRouter();

// ── Estado ───────────────────────────────────────────────────────
const telares = ref([]);
const registros = ref({});        // { maq_id: { roU: '', roT: '', hora: null } }
const config = ref({ umbralRoturaU: 2, umbralRoturaT: 3 });
const patrullaId = ref(null);
const patrullaData = ref(null);   // datos completos de la patrulla activa
const rondaSeleccionada = ref(props.rondaInicial || 'ronda_1');
const rondaFija = computed(() => !!props.rondaInicial);
const enviando = ref({});  // { maqId: true } mientras envía
const enviado = ref({});   // { maqId: 'directo' | 'formulario' } ya enviado
const cargando = ref(true);
const guardando = ref(false);
const grupoSeleccionado = ref('');

// Auto-guardado
const autoSaveStatus = ref('idle'); // 'idle' | 'saving' | 'saved' | 'error'
let _autoSaveTimer = null;
let _autoSaveStatusTimer = null;

// Tolerancia para comparación Ronda 7 (diferencias <= a esto se consideran "igual")
const TOLERANCIA_COMPARACION = 0.5;

// ── Computed ─────────────────────────────────────────────────────
const sectoresUsuario = computed(() =>
  Array.isArray(userProfile.value?.sectoresAsignados)
    ? userProfile.value.sectoresAsignados
    : [normalizeSectorValue(userProfile.value?.sectorDefault || DEFAULT_SECTOR)]
);

// IDs de máquinas que tuvieron datos en ronda_1 (para filtrar ronda_6)
const maqIdsRonda1 = computed(() => {
  const r1 = patrullaData.value?.rondas?.ronda_1?.datos;
  if (!r1) return null;
  return new Set(Object.keys(r1));
});

const telaresOrdenados = computed(() => {
  let list = telares.value;

  // Ronda 6: filtrar solo telares que se controlaron en ronda 1
  if (rondaSeleccionada.value === 'ronda_6' && maqIdsRonda1.value) {
    list = list.filter(t => maqIdsRonda1.value.has(t.id));
  }

  if (grupoSeleccionado.value) {
    list = list.filter(t => String(t.grp_tear || '').trim() === grupoSeleccionado.value);
  }
  return list.sort((a, b) => (a.orden_patrulla || 999) - (b.orden_patrulla || 999));
});

const gruposDisponibles = computed(() => {
  const gs = telares.value.map(t => String(t.grp_tear || '').trim()).filter(Boolean);
  return [...new Set(gs)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
});

const alertasCompartidas = ref(new Set());

const alertas = computed(() => {
  const list = [];
  for (const t of telaresOrdenados.value) {
    const r = registros.value[t.id];
    if (!r) continue;
    const roU = parseFloat(r.roU);
    const roT = parseFloat(r.roT);
    if (!isNaN(roU) && roU > config.value.umbralRoturaU) list.push({ maq: t, campo: 'Ro.U', valor: roU, umbral: config.value.umbralRoturaU });
    if (!isNaN(roT) && roT > config.value.umbralRoturaT) list.push({ maq: t, campo: 'Ro.T', valor: roT, umbral: config.value.umbralRoturaT });
  }
  return list;
});

const alertasPendientes = computed(() =>
  alertas.value.filter(a => !alertasCompartidas.value.has(a.maq.id + '_' + a.campo))
);

const tieneRegistros = computed(() =>
  Object.values(registros.value).some(r => r.roU !== '' || r.roT !== '')
);

// ── Ronda 7: comparación automática ──────────────────────────────
const puedeVerRonda7 = computed(() => {
  const rondas = patrullaData.value?.rondas;
  return rondas?.ronda_1?.completada && rondas?.ronda_6?.completada;
});

const comparacionRonda7 = computed(() => {
  if (!puedeVerRonda7.value) return [];
  const d1 = patrullaData.value.rondas.ronda_1.datos || {};
  const d6 = patrullaData.value.rondas.ronda_6.datos || {};
  const allIds = new Set([...Object.keys(d1), ...Object.keys(d6)]);
  const result = [];
  for (const maqId of allIds) {
    const t = telares.value.find(t => t.id === maqId);
    if (!t) continue;
    const r1U = d1[maqId]?.roU ?? null;
    const r1T = d1[maqId]?.roT ?? null;
    const r6U = d6[maqId]?.roU ?? null;
    const r6T = d6[maqId]?.roT ?? null;
    const evalU = evaluarCambio(r1U, r6U);
    const evalT = evaluarCambio(r1T, r6T);
    if (r1U != null || r1T != null || r6U != null || r6T != null) {
      result.push({ telar: t, r1U, r1T, r6U, r6T, evalU, evalT });
    }
  }
  return result.sort((a, b) => (a.telar.local_fisico || 0) - (b.telar.local_fisico || 0));
});

const resumenRonda7 = computed(() => {
  const items = comparacionRonda7.value;
  let mejoras = 0, empeoramientos = 0, iguales = 0;
  for (const i of items) {
    for (const e of [i.evalU, i.evalT]) {
      if (e === 'mejor') mejoras++;
      else if (e === 'peor') empeoramientos++;
      else if (e === 'igual') iguales++;
    }
  }
  return { mejoras, empeoramientos, iguales };
});

function evaluarCambio(valR1, valR6) {
  if (valR1 == null || valR6 == null) return null;
  const diff = valR6 - valR1;
  if (Math.abs(diff) <= TOLERANCIA_COMPARACION) return 'igual';
  return diff < 0 ? 'mejor' : 'peor';
}

function colorCambio(eval_) {
  if (eval_ === 'mejor') return 'text-emerald-600 bg-emerald-50';
  if (eval_ === 'peor') return 'text-red-600 bg-red-50';
  if (eval_ === 'igual') return 'text-gray-500 bg-gray-50';
  return 'text-gray-300';
}

function iconCambio(eval_) {
  if (eval_ === 'mejor') return '↓';
  if (eval_ === 'peor') return '↑';
  if (eval_ === 'igual') return '=';
  return '—';
}

// ── Carga inicial ────────────────────────────────────────────────
onMounted(async () => {
  try {
    config.value = await loadPatrullaConfig();

    const snap = await getDocs(collection(db, 'maquinas'));
    const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    telares.value = todas.filter(m =>
      String(m.tipo || '').toUpperCase() === 'TELAR' &&
      (m.activo ?? true) &&
      sectoresUsuario.value.includes(normalizeSectorValue(m.sector || DEFAULT_SECTOR))
    );

    // Inicializar registros vacíos
    const regs = {};
    for (const t of telares.value) {
      regs[t.id] = { roU: '', roT: '', hora: null };
    }
    registros.value = regs;

    // Buscar o crear patrulla activa
    const uid = getAuth().currentUser?.uid;
    if (uid) {
      const activa = await cargarPatrullaActiva(uid);
      if (activa) {
        patrullaId.value = activa.id;
        patrullaData.value = activa;
        cargarDatosRonda(activa, rondaSeleccionada.value);
      } else {
        const nueva = await crearPatrulla({
          inspectorUid: uid,
          inspectorNombre: userProfile.value?.nombre || 'Inspector',
          sector: sectoresUsuario.value[0] || DEFAULT_SECTOR,
        });
        patrullaId.value = nueva.id;
        patrullaData.value = { id: nueva.id, rondas: {} };
      }
    }
  } catch (e) {
    console.error('Error cargando roturas:', e);
  } finally {
    cargando.value = false;
  }
});

// ── Cambio de ronda: recargar datos ──────────────────────────────
watch(rondaSeleccionada, (newRonda) => {
  // Limpiar registros y recargar desde patrulla
  for (const maqId of Object.keys(registros.value)) {
    registros.value[maqId] = { roU: '', roT: '', hora: null };
  }
  enviado.value = {};
  enviando.value = {};
  if (patrullaData.value) {
    cargarDatosRonda(patrullaData.value, newRonda);
  }
});

function cargarDatosRonda(patrulla, rondaKey) {
  const rondaData = patrulla.rondas?.[rondaKey]?.datos;
  if (!rondaData) return;
  for (const [maqId, vals] of Object.entries(rondaData)) {
    if (registros.value[maqId]) {
      registros.value[maqId].roU = vals.roU ?? '';
      registros.value[maqId].roT = vals.roT ?? '';
      registros.value[maqId].hora = vals.hora ?? null;
    }
  }
}

// ── Verificación de umbral (con debounce para no interferir con botones) ──
let _umbralTimer = null;
function cancelUmbralCheck() { clearTimeout(_umbralTimer); _umbralTimer = null; }

function verificarUmbral(telar, campo, valor) {
  cancelUmbralCheck();
  _umbralTimer = setTimeout(() => _verificarUmbral(telar, campo, valor), 250);
}

async function _verificarUmbral(telar, campo, valor) {
  const num = parseFloat(valor);
  if (isNaN(num)) return;
  const umbral = campo === 'roU' ? config.value.umbralRoturaU : config.value.umbralRoturaT;
  if (num <= umbral) return;

  const label = campo === 'roU' ? 'Ro.U' : 'Ro.T';
  const nombreTelar = nombreCorto(telar);
  const esUrdido = campo === 'roU';

  const result = await Swal.fire({
    icon: 'warning',
    title: `${label} = ${num}`,
    html: esUrdido
      ? `<b>${nombreTelar}</b> supera el umbral de urdido (${umbral}).<br><small class="text-gray-500">Se notifica a Tejedor/Supervisor (informativo)</small>`
      : `<b>${nombreTelar}</b> supera el umbral de trama (${umbral}).<br>¿Solicitar intervención mecánica?`,
    showCancelButton: true,
    confirmButtonText: esUrdido ? 'Notificar' : 'Enviar directo',
    cancelButtonText: 'Solo registrar',
    confirmButtonColor: esUrdido ? '#7c3aed' : '#2563eb',
    cancelButtonColor: '#6b7280',
  });

  if (result.isConfirmed) {
    enviarDirecto(telar, esUrdido ? 'urdido' : 'trama');
  }
}

// ── Solicitar intervención → guardar ronda + navegar a /llamar con datos precargados ──
async function solicitarIntervencion(telar) {
  cancelUmbralCheck();
  if (enviado.value[telar.id]) return;
  enviado.value[telar.id] = 'formulario';
  // Guardar ronda en Firestore antes de salir para no perder datos
  if (patrullaId.value && tieneRegistros.value) {
    try {
      const datos = {};
      for (const [maqId, vals] of Object.entries(registros.value)) {
        const roU = parseFloat(vals.roU);
        const roT = parseFloat(vals.roT);
        if (!isNaN(roU) || !isNaN(roT)) {
          datos[maqId] = {
            roU: isNaN(roU) ? null : roU,
            roT: isNaN(roT) ? null : roT,
            hora: vals.hora || new Date().toISOString(),
          };
        }
      }
      await guardarRondaRoturas(patrullaId.value, rondaSeleccionada.value, datos);
    } catch (e) {
      console.warn('Auto-save ronda antes de navegar:', e);
    }
  }

  const r = registros.value[telar.id];
  const roU = r ? r.roU : '';
  const roT = r ? r.roT : '';
  const obs = buildObservaciones(telar);

  router.push({
    path: '/llamar',
    query: {
      maqId: telar.id,
      tipo: 'TELAR',
      grp: String(telar.grp_tear || '').trim(),
      obs,
      sintomaName: 'Corte de trama',
      origen: 'roturas',
    },
  });
}

// ── Enviar intervención directo (sin navegar al formulario) ──────
async function enviarDirecto(telar, tipoAlerta = 'trama') {
  cancelUmbralCheck();
  const r = registros.value[telar.id];
  if (!r || (r.roU === '' && r.roT === '')) return;

  enviando.value[telar.id] = true;
  try {
    const obs = buildObservaciones(telar);
    const sectorTelar = normalizeSectorValue(telar.sector || DEFAULT_SECTOR);
    const grp = String(telar.grp_tear || '').trim();

    const esUrdido = tipoAlerta === 'urdido';

    await intervencionService.crearIntervencion({
      maquinaId:            telar.id,
      numeroMaquina:        telar.maquina,
      tipoMaquina:          telar.tipo || 'TELAR',
      modeloMaquina:        telar.modelo || '',
      sector:               sectorTelar,
      local_fisico:         telar.local_fisico,
      grupoTelar:           grp || null,
      gmTelar:              String(telar.g_cmest || '').trim() || null,
      nombreMaquinaDisplay: nombreCorto(telar),
      lado:                 telar.lado || null,
      tipoIntervencion:     esUrdido ? 'calidad' : 'mecanico',
      sintomaId:            null,
      sintomaNombre:        esUrdido ? 'Roturas de urdido elevadas' : 'Corte de trama',
      derivaA:              esUrdido ? 'calidad' : 'mecanico',
      motivoCodigo:         null,
      motivoDescripcion:    esUrdido ? 'Roturas de urdido elevadas' : 'Corte de trama',
      estadoMaquina:        'CON_PROBLEMA',
      critico:              false,
      observaciones:        obs,
      soloInformativo:      esUrdido,
    });

    enviado.value[telar.id] = 'directo';
    Swal.fire({
      icon: 'success',
      title: `${nombreCorto(telar)} — Intervención enviada`,
      toast: true,
      position: 'top-end',
      timer: 2500,
      showConfirmButton: false,
    });
  } catch (e) {
    console.error('Error envío directo:', e);
    Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo enviar la intervención.', confirmButtonColor: '#ea580c' });
  } finally {
    enviando.value[telar.id] = false;
  }
}

// ── Guardar ronda ────────────────────────────────────────────────
async function guardarRonda() {
  if (!patrullaId.value || !tieneRegistros.value) return;
  guardando.value = true;
  try {
    const datos = {};
    for (const [maqId, vals] of Object.entries(registros.value)) {
      const roU = parseFloat(vals.roU);
      const roT = parseFloat(vals.roT);
      if (!isNaN(roU) || !isNaN(roT)) {
        datos[maqId] = {
          roU: isNaN(roU) ? null : roU,
          roT: isNaN(roT) ? null : roT,
          hora: vals.hora || new Date().toISOString(),
        };
      }
    }
    await guardarRondaRoturas(patrullaId.value, rondaSeleccionada.value, datos);
    // Actualizar patrullaData local para ronda 7
    if (!patrullaData.value.rondas) patrullaData.value.rondas = {};
    patrullaData.value.rondas[rondaSeleccionada.value] = { tipo: 'roturas', completada: true, datos };
    Swal.fire({ icon: 'success', title: 'Ronda guardada', timer: 1500, showConfirmButton: false });
    emit('completada');
  } catch (e) {
    console.error('Error guardando ronda:', e);
    Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo guardar la ronda.' });
  } finally {
    guardando.value = false;
  }
}

// ── Compartir por WhatsApp ───────────────────────────────────────
function compartirAlertaIndividual(a) {
  const rondaLabel = rondaSeleccionada.value === 'ronda_1' ? 'Ronda 1' : 'Ronda 6';
  let msg = `⚠️ *Alerta de Roturas — ${rondaLabel}*\n`;
  msg += `📅 ${new Date().toLocaleDateString('es-AR')}\n\n`;
  msg += `• *${nombreCorto(a.maq)}* — ${a.campo}: *${a.valor}* (umbral: ${a.umbral})\n`;
  const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
  alertasCompartidas.value = new Set([...alertasCompartidas.value, a.maq.id + '_' + a.campo]);
}

function compartirWhatsApp() {
  const pendientes = alertasPendientes.value;
  const rondaLabel = rondaSeleccionada.value === 'ronda_1' ? 'Ronda 1 (inicio turno)' : 'Ronda 6 (fin turno)';
  let msg = `🔧 *Control de Roturas — ${rondaLabel}*\n`;
  msg += `📅 ${new Date().toLocaleDateString('es-AR')}\n\n`;

  if (pendientes.length) {
    msg += `⚠️ *${pendientes.length} lectura(s) sobre umbral:*\n`;
    for (const a of pendientes) {
      msg += `• ${nombreCorto(a.maq)} — ${a.campo}: *${a.valor}* (umbral: ${a.umbral})\n`;
    }
    msg += '\n';
  }

  // Resumen de ronda 7 si disponible
  if (rondaSeleccionada.value === 'ronda_6' && puedeVerRonda7.value) {
    const r = resumenRonda7.value;
    msg += `📊 *Evaluación Ronda 7:*\n`;
    msg += `✅ Mejoras: ${r.mejoras} · ❌ Empeoramientos: ${r.empeoramientos} · ➖ Sin cambio: ${r.iguales}\n\n`;
  }

  const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

// ── Helpers ──────────────────────────────────────────────────────
function superaUmbral(maqId, campo) {
  const val = parseFloat(registros.value[maqId]?.[campo]);
  if (isNaN(val)) return false;
  const umbral = campo === 'roU' ? config.value.umbralRoturaU : config.value.umbralRoturaT;
  return val > umbral;
}

function registrarHora(maqId) {
  if (registros.value[maqId] && !registros.value[maqId].hora) {
    registros.value[maqId].hora = new Date().toISOString();
  }
}

// ── Auto-guardado parcial (debounce 3s tras cada @blur) ──────────
function programarAutoSave() {
  if (!patrullaId.value) return;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => ejecutarAutoSave(), 3000);
}

async function ejecutarAutoSave() {
  if (!patrullaId.value || !tieneRegistros.value) return;
  // No auto-guardar si la ronda ya está completada
  const rondaActual = patrullaData.value?.rondas?.[rondaSeleccionada.value];
  if (rondaActual?.completada) return;

  autoSaveStatus.value = 'saving';
  try {
    const datos = {};
    for (const [maqId, vals] of Object.entries(registros.value)) {
      const roU = parseFloat(vals.roU);
      const roT = parseFloat(vals.roT);
      if (!isNaN(roU) || !isNaN(roT)) {
        datos[maqId] = {
          roU: isNaN(roU) ? null : roU,
          roT: isNaN(roT) ? null : roT,
          hora: vals.hora || new Date().toISOString(),
        };
      }
    }
    if (Object.keys(datos).length === 0) { autoSaveStatus.value = 'idle'; return; }
    await guardarRondaParcial(patrullaId.value, rondaSeleccionada.value, datos);
    autoSaveStatus.value = 'saved';
    clearTimeout(_autoSaveStatusTimer);
    _autoSaveStatusTimer = setTimeout(() => { autoSaveStatus.value = 'idle'; }, 4000);
  } catch (e) {
    console.error('Auto-save error:', e);
    autoSaveStatus.value = 'error';
    clearTimeout(_autoSaveStatusTimer);
    _autoSaveStatusTimer = setTimeout(() => { autoSaveStatus.value = 'idle'; }, 5000);
  }
}

function formatHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function onInputDecimal(maqId, campo, event) {
  let val = event.target.value.replace(',', '.');
  val = val.replace(/[^0-9.]/g, '');
  // solo un punto decimal
  const parts = val.split('.');
  if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
  registros.value[maqId][campo] = val;
  event.target.value = val.replace('.', ',');
}

function displayDecimal(val) {
  if (val === '' || val == null) return '';
  return String(val).replace('.', ',');
}

function nombreCorto(t) {
  const id = String(t.maquina || '');
  const n = parseInt(id.slice(-2), 10);
  return `Toyota ${isNaN(n) ? id : n}`;
}

function buildObservaciones(telar) {
  const r = registros.value[telar.id];
  const roU = r ? r.roU : '';
  const roT = r ? r.roT : '';
  const umbralU = config.value.umbralRoturaU;
  const umbralT = config.value.umbralRoturaT;
  const lines = [];
  if (roU !== '') {
    const num = parseFloat(roU);
    const excede = !isNaN(num) && num > umbralU;
    lines.push(excede ? `Roturas de Urdido: **${roU}**` : `Roturas de Urdido: ${roU}`);
  }
  if (roT !== '') {
    const num = parseFloat(roT);
    const excede = !isNaN(num) && num > umbralT;
    lines.push(excede ? `Roturas de Trama: **${roT}**` : `Roturas de Trama: ${roT}`);
  }
  lines.push('Reportado por Patrulla de Calidad');
  return lines.join('\n');
}

function grupoLabel(t) {
  const g = String(t.grp_tear || '').trim();
  if (!g) return '';
  const last = parseInt(g.slice(-1), 10);
  return `Grupo ${isNaN(last) ? g : last}`;
}

function gmLabel(t) {
  const c = String(t.g_cmest || '').trim();
  if (!c) return '';
  const n = parseInt(c, 10);
  return `GM ${isNaN(n) ? c : n}`;
}
</script>

<template>
  <div>
    <!-- ═══ STICKY HEADER: selector + info + columnas ═══ -->
    <div class="sticky top-0 z-30 bg-gray-50 pb-0.5 -mx-3 px-3">
      <!-- Selector de ronda y grupo -->
      <div class="bg-white p-3 rounded-xl shadow-sm border border-gray-100 space-y-2">
        <div class="flex items-center gap-2">
          <div class="relative flex-1">
            <select v-if="!rondaFija" v-model="rondaSeleccionada"
                    class="w-full appearance-none bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm font-bold text-blue-700 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-300">
              <option value="ronda_1">Ronda 1 (inicio turno)</option>
              <option value="ronda_6">Ronda 6 (fin turno)</option>
  
            </select>
            <div v-else class="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm font-bold text-blue-700">
              {{ rondaSeleccionada === 'ronda_6' ? 'Ronda 6 (fin turno)' : 'Ronda 1 (inicio turno)' }}
            </div>
          </div>
          <div v-if="rondaSeleccionada !== 'ronda_7' && gruposDisponibles.length > 1" class="relative">
            <select v-model="grupoSeleccionado"
                    class="appearance-none bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 pr-8 focus:outline-none focus:ring-2 focus:ring-gray-300">
              <option value="">Todos</option>
              <option v-for="g in gruposDisponibles" :key="g" :value="g">Grupo {{ parseInt(g, 10) || g }}</option>
            </select>
            <ChevronDown class="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
        <div class="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[9px] font-bold text-gray-400">
          <span>Roturas Urdimbre 10<sup>5</sup>: {{ config.umbralRoturaU }}</span>
          <span>·</span>
          <span>Roturas Trama 10<sup>5</sup>: {{ config.umbralRoturaT }}</span>
          <span>·</span>
          <span>{{ rondaSeleccionada === 'ronda_7' ? comparacionRonda7.length : telaresOrdenados.length }} telares</span>
        </div>
        <!-- Aviso Ronda 6 filtrada -->
        <div v-if="rondaSeleccionada === 'ronda_6' && maqIdsRonda1" class="text-[10px] text-blue-600 font-medium bg-blue-50 rounded-lg px-2 py-1">
          Mostrando solo los {{ telaresOrdenados.length }} telares controlados en Ronda 1
        </div>
      </div>

      <!-- Encabezado de columnas -->
      <div class="mt-1.5 bg-gray-50 border-b border-gray-200 grid grid-cols-[1fr_72px_72px_32px_32px] gap-1.5 px-3 py-1.5 text-[10px] font-black text-gray-400 uppercase tracking-wider">
        <span>Telar</span>
        <span class="text-center">Ro.U</span>
        <span class="text-center">Ro.T</span>
        <span></span>
        <span></span>
      </div>


    </div>

    <!-- Loading -->
    <div v-if="cargando" class="flex items-center justify-center py-12">
      <Loader2 class="w-6 h-6 text-indigo-400 animate-spin" />
    </div>

    <!-- ═══════════ RONDA 1 / 6: REGISTRO ═══════════ -->
    <template v-else>
      <!-- Filas -->
      <div
        v-for="t in telaresOrdenados"
        :key="t.id"
        class="grid grid-cols-[1fr_72px_72px_32px_32px] gap-1.5 items-center bg-white px-3 py-2 border-b border-gray-50"
      >
          <div class="min-w-0">
            <p class="text-sm font-black text-gray-800 truncate">{{ nombreCorto(t) }}</p>
            <div class="flex items-center gap-1.5 flex-wrap">
              <span v-if="t.grp_tear" class="text-[10px] text-gray-400 font-medium">{{ grupoLabel(t) }}</span>
              <span v-if="t.g_cmest" class="text-[10px] text-indigo-400 font-bold">{{ gmLabel(t) }}</span>
              <span v-if="registros[t.id]?.hora" class="text-[10px] text-emerald-500 font-medium">{{ formatHora(registros[t.id].hora) }}</span>
            </div>
          </div>

          <input
            :value="displayDecimal(registros[t.id].roU)"
            @input="onInputDecimal(t.id, 'roU', $event)"
            type="text"
            inputmode="decimal"
            placeholder="—"
            @blur="registrarHora(t.id); verificarUmbral(t, 'roU', registros[t.id].roU); programarAutoSave()"
            class="w-full text-center text-sm font-bold rounded-lg border px-1 py-1.5 focus:outline-none focus:ring-2 transition-colors"
            :class="superaUmbral(t.id, 'roU')
              ? 'border-red-400 bg-red-50 text-red-700 focus:ring-red-300'
              : 'border-gray-200 bg-gray-50 text-gray-800 focus:ring-blue-300'"
          />

          <input
            :value="displayDecimal(registros[t.id].roT)"
            @input="onInputDecimal(t.id, 'roT', $event)"
            type="text"
            inputmode="decimal"
            placeholder="—"
            @blur="registrarHora(t.id); verificarUmbral(t, 'roT', registros[t.id].roT); programarAutoSave()"
            class="w-full text-center text-sm font-bold rounded-lg border px-1 py-1.5 focus:outline-none focus:ring-2 transition-colors"
            :class="superaUmbral(t.id, 'roT')
              ? 'border-red-400 bg-red-50 text-red-700 focus:ring-red-300'
              : 'border-gray-200 bg-gray-50 text-gray-800 focus:ring-blue-300'"
          />

          <button
            @click="solicitarIntervencion(t)"
            :disabled="!!enviado[t.id]"
            class="w-8 h-8 flex items-center justify-center rounded-lg transition-colors active:scale-95"
            :class="enviado[t.id] === 'formulario'
              ? 'bg-orange-500 text-white'
              : enviado[t.id]
                ? 'opacity-25 cursor-not-allowed text-gray-300'
                : 'text-gray-400 hover:text-orange-500 hover:bg-orange-50'"
            title="Solicitar intervención (formulario)"
          >
            <BellRing class="w-4 h-4" />
          </button>

          <button
            @click="enviarDirecto(t)"
            :disabled="(registros[t.id].roU === '' && registros[t.id].roT === '') || enviando[t.id] || !!enviado[t.id]"
            class="w-8 h-8 flex items-center justify-center rounded-lg transition-colors active:scale-95 disabled:cursor-not-allowed"
            :class="enviado[t.id] === 'directo'
              ? 'bg-blue-500 text-white'
              : enviando[t.id]
                ? 'text-blue-400 bg-blue-50'
                : enviado[t.id]
                  ? 'opacity-25 text-gray-300'
                  : (registros[t.id].roU === '' && registros[t.id].roT === '')
                    ? 'opacity-30 text-gray-300'
                    : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'"
            title="Enviar intervención directo"
          >
            <Loader2 v-if="enviando[t.id]" class="w-4 h-4 animate-spin" />
            <SendHorizontal v-else class="w-4 h-4" />
          </button>
        </div>

      <!-- Vacío -->
      <div v-if="!telaresOrdenados.length" class="text-center py-8 text-sm text-gray-400 font-medium">
        {{ rondaSeleccionada === 'ronda_6' && maqIdsRonda1 ? 'No hay telares registrados en Ronda 1. Completá primero la Ronda 1.' : 'No hay telares asignados a tu sector.' }}
      </div>

      <!-- Alertas (debajo de la grilla) -->
      <div v-if="alertas.length" class="bg-red-50 border border-red-200 rounded-xl p-3 space-y-1.5">
        <p class="text-xs font-black text-red-700 flex items-center gap-1">
          <AlertTriangle class="w-3.5 h-3.5" /> {{ alertas.length }} lectura(s) sobre umbral
        </p>
        <div v-for="a in alertas" :key="a.maq.id + a.campo" class="flex items-center justify-between gap-2">
          <p class="text-[11px] font-medium flex-1" :class="alertasCompartidas.has(a.maq.id + '_' + a.campo) ? 'text-gray-400 line-through' : 'text-red-600'">
            {{ nombreCorto(a.maq) }} — {{ a.campo }}: {{ a.valor }} (umbral: {{ a.umbral }})
          </p>
          <button
            v-if="!alertasCompartidas.has(a.maq.id + '_' + a.campo)"
            @click="compartirAlertaIndividual(a)"
            class="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-green-600 hover:bg-green-100 active:scale-95 transition-colors"
            title="Compartir esta alerta por WhatsApp"
          >
            <Share2 class="w-3.5 h-3.5" />
          </button>
          <span v-else class="shrink-0 text-[10px] text-gray-400 font-bold">✓ enviada</span>
        </div>
      </div>

      <!-- Botones de acción -->
      <div v-if="!cargando && telaresOrdenados.length" class="space-y-2">
        <!-- Indicador auto-guardado -->
        <div v-if="autoSaveStatus !== 'idle'" class="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-all"
             :class="{
               'text-blue-500 bg-blue-50': autoSaveStatus === 'saving',
               'text-emerald-600 bg-emerald-50': autoSaveStatus === 'saved',
               'text-red-500 bg-red-50': autoSaveStatus === 'error',
             }">
          <Loader2 v-if="autoSaveStatus === 'saving'" class="w-3 h-3 animate-spin" />
          <CloudUpload v-else-if="autoSaveStatus === 'saved'" class="w-3 h-3" />
          <AlertTriangle v-else-if="autoSaveStatus === 'error'" class="w-3 h-3" />
          {{ autoSaveStatus === 'saving' ? 'Guardando borrador…' : autoSaveStatus === 'saved' ? 'Borrador guardado ✓' : 'Error al guardar, reintentando…' }}
        </div>

        <button
          @click="guardarRonda"
          :disabled="guardando || !tieneRegistros"
          class="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-black text-white transition-all shadow-md active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
          :class="guardando ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'"
        >
          <Loader2 v-if="guardando" class="w-4 h-4 animate-spin" />
          <Check v-else class="w-4 h-4" />
          {{ guardando ? 'Guardando…' : 'Completar Ronda' }}
        </button>

        <button
          v-if="alertasPendientes.length"
          @click="compartirWhatsApp"
          class="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-green-700 bg-green-50 border border-green-200 hover:bg-green-100 transition-all active:scale-[0.98]"
        >
          <Share2 class="w-4 h-4" />
          Compartir {{ alertasPendientes.length }} alerta(s) restantes por WhatsApp
        </button>
      </div>
    </template>
  </div>
</template>
