<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { getAuth } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userProfile } from '../services/authService';
import { normalizeSectorValue, DEFAULT_SECTOR } from '../constants/organization';
import { loadPatrullaConfig, cargarPatrullaActiva, crearPatrulla, guardarRondaRoturas, guardarRondaParcial } from '../services/patrullaService';
import { useRouter } from 'vue-router';
import { Check, AlertTriangle, Loader2, ChevronDown, ChevronRight, Share2, CloudUpload, Zap } from 'lucide-vue-next';
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
const telarActivo = ref(null);
const mensajeToast = ref(null); // { tipo: 'success'|'error', texto: '' }
const autoEnvio = ref(false); // checkbox de envío automático
let _toastTimer = null;

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
  let list = telares.value.filter(t => t.orden_patrulla != null);

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

// ── Verificación de umbral (ahora inline, sin SweetAlert) ──
let _umbralTimer = null;
function cancelUmbralCheck() { clearTimeout(_umbralTimer); _umbralTimer = null; }
function verificarUmbral() { /* no-op: detección inline en template */ }

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
    mostrarToast('success', `${nombreCorto(telar)} — Intervención enviada`);
  } catch (e) {
    console.error('Error envío directo:', e);
    mostrarToast('error', 'No se pudo enviar la intervención');
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
    mostrarToast('success', 'Ronda guardada ✓');
    emit('completada');
  } catch (e) {
    console.error('Error guardando ronda:', e);
    mostrarToast('error', 'No se pudo guardar la ronda');
  } finally {
    guardando.value = false;
  }
}

// ── Compartir por WhatsApp ───────────────────────────────────────
function formatGrp(grp) {
  if (!grp) return '';
  const last = parseInt(grp.slice(-1), 10);
  return isNaN(last) ? grp : String(last);
}

function compartirAlertaIndividual(a) {
  const rondaLabel = rondaSeleccionada.value === 'ronda_1' ? 'Ronda 1 (inicio turno)' : 'Ronda 6 (fin turno)';
  const grp = String(a.maq.grp_tear || '').trim();
  const gm = String(a.maq.g_cmest || '').trim();
  const sector = normalizeSectorValue(a.maq.sector || DEFAULT_SECTOR);
  const esTrama = a.campo === 'Ro.T';

  let msg = `⚠️ *ALERTA DE ROTURAS — ${rondaLabel}*\n\n`;
  msg += `🏭 *${nombreCorto(a.maq)}*`;
  if (grp) msg += ` · GP ${formatGrp(grp)}`;
  if (gm) msg += ` · GM ${parseInt(gm, 10) || gm}`;
  msg += `\n📍 ${sector}\n`;
  msg += `📅 ${new Date().toLocaleDateString('es-AR')}\n\n`;
  msg += `🔴 ${a.campo}: *${a.valor}* (umbral: ${a.umbral})\n`;
  msg += `🔧 Derivar a: *${esTrama ? 'Mecánico' : 'Calidad / Tejedor'}*\n`;
  msg += `\n📱 Enviado desde CMMS STC`;

  const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
  alertasCompartidas.value = new Set([...alertasCompartidas.value, a.maq.id + '_' + a.campo]);
}

function compartirWhatsApp() {
  const pendientes = alertasPendientes.value;
  const rondaLabel = rondaSeleccionada.value === 'ronda_1' ? 'Ronda 1 (inicio turno)' : 'Ronda 6 (fin turno)';
  const sector = sectoresUsuario.value[0] || DEFAULT_SECTOR;

  let msg = `⚠️ *CONTROL DE ROTURAS — ${rondaLabel}*\n\n`;
  msg += `📍 ${sector}\n`;
  msg += `📅 ${new Date().toLocaleDateString('es-AR')}\n\n`;

  if (pendientes.length) {
    msg += `🔴 *${pendientes.length} lectura(s) sobre umbral:*\n\n`;
    for (const a of pendientes) {
      const grp = String(a.maq.grp_tear || '').trim();
      const gm = String(a.maq.g_cmest || '').trim();
      const esTrama = a.campo === 'Ro.T';
      msg += `🏭 *${nombreCorto(a.maq)}*`;
      if (grp) msg += ` · GP ${formatGrp(grp)}`;
      if (gm) msg += ` · GM ${parseInt(gm, 10) || gm}`;
      msg += `\n   ${a.campo}: *${a.valor}* (umbral: ${a.umbral})`;
      msg += ` → *${esTrama ? 'Mecánico' : 'Calidad'}*\n\n`;
    }
  }

  // Resumen de ronda 7 si disponible
  if (rondaSeleccionada.value === 'ronda_6' && puedeVerRonda7.value) {
    const r = resumenRonda7.value;
    msg += `📊 *Evaluación Ronda 7:*\n`;
    msg += `✅ Mejoras: ${r.mejoras} · ❌ Empeoramientos: ${r.empeoramientos} · ➖ Sin cambio: ${r.iguales}\n\n`;
  }

  msg += `📱 Enviado desde CMMS STC`;

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

// ── Focus mode ───────────────────────────────────────────────────
function telarTieneValores(maqId) {
  const r = registros.value[maqId];
  return r && (r.roU !== '' || r.roT !== '');
}

function telarTieneAlerta(maqId) {
  return superaUmbral(maqId, 'roU') || superaUmbral(maqId, 'roT');
}

function toggleTelar(telarId) {
  telarActivo.value = telarActivo.value === telarId ? null : telarId;
  if (telarActivo.value) {
    nextTick(() => {
      const el = document.getElementById('telar-' + telarActivo.value);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
}

function avanzarSiguiente() {
  // Auto-envío: si el telar actual supera umbral y no fue enviado, enviar automáticamente
  if (autoEnvio.value && telarActivo.value) {
    const telarAct = telaresOrdenados.value.find(t => t.id === telarActivo.value);
    if (telarAct && telarTieneAlerta(telarAct.id) && !enviado.value[telarAct.id] && !enviando.value[telarAct.id]) {
      enviarIntervencionFocus(telarAct);
    }
  }

  programarAutoSave();
  const lista = telaresOrdenados.value;
  const idx = lista.findIndex(t => t.id === telarActivo.value);
  if (idx < lista.length - 1) {
    telarActivo.value = lista[idx + 1].id;
    nextTick(() => {
      const el = document.getElementById('telar-' + lista[idx + 1].id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  } else {
    telarActivo.value = null;
  }
}

async function enviarIntervencionFocus(telar) {
  const roT = parseFloat(registros.value[telar.id]?.roT);
  const excedeT = !isNaN(roT) && roT > config.value.umbralRoturaT;
  await enviarDirecto(telar, excedeT ? 'trama' : 'urdido');
}

function enviarWhatsAppTelar(telar) {
  const r = registros.value[telar.id];
  const roU = r ? r.roU : '';
  const roT = r ? r.roT : '';
  const numU = parseFloat(roU);
  const numT = parseFloat(roT);
  const excedeU = !isNaN(numU) && numU > config.value.umbralRoturaU;
  const excedeT = !isNaN(numT) && numT > config.value.umbralRoturaT;
  const rondaLabel = rondaSeleccionada.value === 'ronda_1' ? 'Ronda 1 (inicio turno)' : 'Ronda 6 (fin turno)';
  const grp = String(telar.grp_tear || '').trim();
  const gm = String(telar.g_cmest || '').trim();
  const sector = normalizeSectorValue(telar.sector || DEFAULT_SECTOR);

  let msg = `⚠️ *ALERTA DE ROTURAS — ${rondaLabel}*\n\n`;
  msg += `🏭 *${nombreCorto(telar)}*`;
  if (grp) msg += ` · GP ${formatGrp(grp)}`;
  if (gm) msg += ` · GM ${parseInt(gm, 10) || gm}`;
  msg += `\n📍 ${sector}\n`;
  msg += `📅 ${new Date().toLocaleDateString('es-AR')}\n\n`;
  if (roU !== '') msg += `${excedeU ? '🔴' : '⚪'} Ro. Urdimbre: *${displayDecimal(roU)}* (umbral: ${config.value.umbralRoturaU})\n`;
  if (roT !== '') msg += `${excedeT ? '🔴' : '⚪'} Ro. Trama: *${displayDecimal(roT)}* (umbral: ${config.value.umbralRoturaT})\n`;
  if (excedeU || excedeT) {
    const destino = excedeT ? 'Mecánico' : 'Calidad / Tejedor';
    msg += `\n🔧 Derivar a: *${destino}*\n`;
    msg += `⚙️ Intervención solicitada desde Patrulla de Calidad\n`;
  }
  msg += `\n📱 Enviado desde CMMS STC`;

  const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

function mostrarToast(tipo, texto) {
  clearTimeout(_toastTimer);
  mensajeToast.value = { tipo, texto };
  _toastTimer = setTimeout(() => { mensajeToast.value = null; }, 3000);
}
</script>

<template>
  <div>
    <!-- ═══ Toast inline ═══ -->
    <Transition name="toast">
      <div v-if="mensajeToast"
           class="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-sm font-bold"
           :class="mensajeToast.tipo === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'">
        {{ mensajeToast.texto }}
      </div>
    </Transition>

    <!-- ═══ STICKY HEADER ═══ -->
    <div class="sticky top-0 z-30 bg-gray-50 pb-0.5 -mx-3 px-3">
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
          <div v-if="gruposDisponibles.length > 1" class="relative">
            <select v-model="grupoSeleccionado"
                    class="appearance-none bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 pr-8 focus:outline-none focus:ring-2 focus:ring-gray-300">
              <option value="">Todos</option>
              <option v-for="g in gruposDisponibles" :key="g" :value="g">Grupo {{ parseInt(g, 10) || g }}</option>
            </select>
            <ChevronDown class="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
        <div class="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[9px] font-bold text-gray-400">
          <span>Umbral Urdimbre: {{ config.umbralRoturaU }}</span>
          <span>·</span>
          <span>Umbral Trama: {{ config.umbralRoturaT }}</span>
          <span>·</span>
          <span>{{ telaresOrdenados.length }} telares</span>
        </div>
        <!-- Auto-envío checkbox -->
        <label class="flex items-center gap-2 mt-1 cursor-pointer select-none rounded-lg px-2 py-1.5 transition-colors"
               :class="autoEnvio ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50 border border-gray-100'">
          <input type="checkbox" v-model="autoEnvio"
                 class="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 accent-amber-500" />
          <Zap class="w-3.5 h-3.5" :class="autoEnvio ? 'text-amber-500' : 'text-gray-300'" />
          <span class="text-[10px] font-bold" :class="autoEnvio ? 'text-amber-700' : 'text-gray-400'">
            Envío automático al pasar
          </span>
        </label>
        <div v-if="rondaSeleccionada === 'ronda_6' && maqIdsRonda1" class="text-[10px] text-blue-600 font-medium bg-blue-50 rounded-lg px-2 py-1">
          Mostrando solo los {{ telaresOrdenados.length }} telares controlados en Ronda 1
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="cargando" class="flex items-center justify-center py-12">
      <Loader2 class="w-6 h-6 text-indigo-400 animate-spin" />
    </div>

    <!-- ═══ TELARES CON FOCUS MODE ═══ -->
    <template v-else>
      <div class="space-y-1 mt-1.5">
        <template v-for="(t, idx) in telaresOrdenados" :key="t.id">

          <!-- ── EXPANDED CARD (telar activo) ─────────────────── -->
          <div v-if="telarActivo === t.id" :id="'telar-' + t.id"
               class="bg-white rounded-2xl shadow-md border border-gray-200 overflow-hidden">

            <!-- Card header -->
            <div class="flex items-center justify-between px-4 pt-4 pb-2 cursor-pointer" @click="toggleTelar(t.id)">
              <div>
                <p class="text-lg font-black text-gray-900 leading-tight">{{ nombreCorto(t) }}</p>
                <div class="flex items-center gap-2 mt-1">
                  <span v-if="t.orden_patrulla" class="text-[10px] font-extrabold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">PAT {{ t.orden_patrulla }}</span>
                  <span v-if="t.grp_tear" class="text-[10px] text-gray-400 font-medium">{{ grupoLabel(t) }}</span>
                  <span v-if="t.g_cmest" class="text-[10px] text-indigo-500 font-bold">{{ gmLabel(t) }}</span>
                </div>
              </div>
              <span v-if="registros[t.id]?.hora" class="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-1 rounded-lg">
                {{ formatHora(registros[t.id].hora) }}
              </span>
            </div>

            <!-- Inputs -->
            <div class="px-4 pb-3">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-[9px] font-extrabold text-gray-400 tracking-widest mb-1">RO. URDIMBRE</label>
                  <input
                    :value="displayDecimal(registros[t.id].roU)"
                    @input="onInputDecimal(t.id, 'roU', $event)"
                    type="text" inputmode="decimal" placeholder="—"
                    @blur="registrarHora(t.id); programarAutoSave()"
                    class="w-full text-center text-2xl font-black rounded-xl border px-2 py-3 focus:outline-none focus:ring-2 transition-colors"
                    :class="superaUmbral(t.id, 'roU')
                      ? 'border-red-300 bg-red-50 text-red-700 focus:ring-red-300'
                      : 'border-gray-200 bg-gray-50 text-gray-800 focus:ring-blue-200'"
                  />
                </div>
                <div>
                  <label class="block text-[9px] font-extrabold text-gray-400 tracking-widest mb-1">RO. TRAMA</label>
                  <input
                    :value="displayDecimal(registros[t.id].roT)"
                    @input="onInputDecimal(t.id, 'roT', $event)"
                    type="text" inputmode="decimal" placeholder="—"
                    @blur="registrarHora(t.id); programarAutoSave()"
                    class="w-full text-center text-2xl font-black rounded-xl border px-2 py-3 focus:outline-none focus:ring-2 transition-colors"
                    :class="superaUmbral(t.id, 'roT')
                      ? 'border-red-300 bg-red-50 text-red-700 focus:ring-red-300'
                      : 'border-gray-200 bg-gray-50 text-gray-800 focus:ring-blue-200'"
                  />
                </div>
              </div>
            </div>

            <!-- Alerta + acciones (umbral superado, no enviado) -->
            <div v-if="telarTieneAlerta(t.id) && !enviado[t.id]" class="mx-4 mb-3 rounded-xl bg-red-50 border border-red-100 p-3 space-y-2.5">
              <p class="text-[11px] font-bold text-red-600 flex items-center gap-1.5">
                <AlertTriangle class="w-3.5 h-3.5 shrink-0" />
                Supera umbral — ¿Solicitar intervención?
              </p>
              <div v-if="autoEnvio" class="flex items-center gap-1.5 text-[10px] font-bold text-amber-600 bg-amber-50 rounded-lg px-2 py-1">
                <Zap class="w-3 h-3" />
                Se enviará automáticamente al pasar al siguiente
              </div>
              <div class="grid grid-cols-2 gap-2">
                <button @click="enviarIntervencionFocus(t)" :disabled="enviando[t.id]"
                        class="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.97] transition-all shadow-sm disabled:opacity-50">
                  <Loader2 v-if="enviando[t.id]" class="w-4 h-4 animate-spin" />
                  <template v-else>
                    <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75"/><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 3.75h9.75c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125H8.25a1.125 1.125 0 01-1.125-1.125V4.875c0-.621.504-1.125 1.125-1.125z"/></svg>
                    Intervención
                  </template>
                </button>
                <button @click="enviarWhatsAppTelar(t)"
                        class="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-bold text-[#25D366] bg-[#25D366]/10 hover:bg-[#25D366]/20 active:scale-[0.97] transition-all">
                  <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                  WhatsApp
                </button>
              </div>
            </div>

            <!-- Confirmación de envío -->
            <div v-if="enviado[t.id]" class="mx-4 mb-3 rounded-xl bg-emerald-50 border border-emerald-100 p-3 space-y-2">
              <p class="text-[13px] font-bold text-emerald-700 flex items-center gap-1.5">
                <Check class="w-4 h-4" /> Intervención enviada
              </p>
              <button @click="enviarWhatsAppTelar(t)"
                      class="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[13px] font-bold text-[#25D366] bg-[#25D366]/10 hover:bg-[#25D366]/20 active:scale-[0.97] transition-all">
                <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Compartir por WhatsApp
              </button>
            </div>

            <!-- Botón Siguiente -->
            <div class="px-4 pb-4">
              <button @click="avanzarSiguiente()"
                      class="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-black transition-all active:scale-[0.97]"
                      :class="idx < telaresOrdenados.length - 1
                        ? 'text-white bg-gray-800 hover:bg-gray-900 shadow-sm'
                        : 'text-gray-600 bg-gray-100 hover:bg-gray-200'">
                {{ idx < telaresOrdenados.length - 1 ? 'Siguiente telar' : 'Finalizar lista' }}
                <ChevronRight class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- ── COLLAPSED ROW (hay un telar activo distinto) ── -->
          <div v-else-if="telarActivo"
               :id="'telar-' + t.id"
               @click="toggleTelar(t.id)"
               class="flex items-center bg-gray-50 px-3 py-1.5 rounded-lg cursor-pointer transition-all"
               :class="telarTieneValores(t.id) ? 'opacity-70' : 'opacity-40'">
            <p class="text-xs font-bold text-gray-500 flex-1 truncate">{{ nombreCorto(t) }}</p>
            <div class="flex items-center gap-1.5">
              <span v-if="telarTieneValores(t.id)" class="text-[10px] text-gray-400">
                {{ displayDecimal(registros[t.id].roU) || '—' }} / {{ displayDecimal(registros[t.id].roT) || '—' }}
              </span>
              <span v-if="telarTieneAlerta(t.id)" class="w-5 h-5 flex items-center justify-center rounded-full bg-red-100 text-red-500">
                <AlertTriangle class="w-3 h-3" />
              </span>
              <span v-else-if="telarTieneValores(t.id)" class="w-5 h-5 flex items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <Check class="w-3 h-3" />
              </span>
            </div>
          </div>

          <!-- ── NORMAL ROW (ningún telar activo) ─────────────── -->
          <div v-else
               :id="'telar-' + t.id"
               @click="toggleTelar(t.id)"
               class="flex items-center bg-white px-3 py-2.5 rounded-lg border border-gray-100 cursor-pointer hover:bg-blue-50 hover:border-blue-200 transition-all active:scale-[0.99]">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-black text-gray-800 truncate">{{ nombreCorto(t) }}</p>
              <div class="flex items-center gap-1.5">
                <span v-if="t.orden_patrulla" class="text-[10px] text-violet-500 font-bold">PAT {{ t.orden_patrulla }}</span>
                <span v-if="t.grp_tear" class="text-[10px] text-gray-400">{{ grupoLabel(t) }}</span>
                <span v-if="t.g_cmest" class="text-[10px] text-indigo-400 font-bold">{{ gmLabel(t) }}</span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <div v-if="telarTieneValores(t.id)" class="flex items-center gap-1.5 text-xs">
                <span :class="superaUmbral(t.id, 'roU') ? 'text-red-600 font-bold' : 'text-gray-500'">
                  U:{{ displayDecimal(registros[t.id].roU) || '—' }}
                </span>
                <span :class="superaUmbral(t.id, 'roT') ? 'text-red-600 font-bold' : 'text-gray-500'">
                  T:{{ displayDecimal(registros[t.id].roT) || '—' }}
                </span>
              </div>
              <span v-if="telarTieneAlerta(t.id)" class="w-6 h-6 flex items-center justify-center rounded-full bg-red-100 text-red-500">
                <AlertTriangle class="w-3.5 h-3.5" />
              </span>
              <span v-else-if="telarTieneValores(t.id)" class="w-6 h-6 flex items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <Check class="w-3.5 h-3.5" />
              </span>
              <ChevronRight v-else class="w-4 h-4 text-gray-300" />
            </div>
          </div>

        </template>
      </div>

      <!-- Vacío -->
      <div v-if="!telaresOrdenados.length" class="text-center py-8 text-sm text-gray-400 font-medium">
        {{ rondaSeleccionada === 'ronda_6' && maqIdsRonda1 ? 'No hay telares registrados en Ronda 1. Completá primero la Ronda 1.' : 'No hay telares asignados a tu sector.' }}
      </div>

      <!-- Alertas resumen -->
      <div v-if="alertas.length" class="bg-red-50 border border-red-200 rounded-xl p-3 space-y-1.5 mt-2">
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
            class="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-green-600 hover:bg-green-100 active:scale-95 transition-colors">
            <Share2 class="w-3.5 h-3.5" />
          </button>
          <span v-else class="shrink-0 text-[10px] text-gray-400 font-bold">✓ enviada</span>
        </div>
      </div>

      <!-- Botones de acción -->
      <div v-if="!cargando && telaresOrdenados.length" class="space-y-2 mt-3">
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
          :class="guardando ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'">
          <Loader2 v-if="guardando" class="w-4 h-4 animate-spin" />
          <Check v-else class="w-4 h-4" />
          {{ guardando ? 'Guardando…' : 'Completar Ronda' }}
        </button>

        <button
          v-if="alertasPendientes.length"
          @click="compartirWhatsApp"
          class="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-green-700 bg-green-50 border border-green-200 hover:bg-green-100 transition-all active:scale-[0.98]">
          <Share2 class="w-4 h-4" />
          Compartir {{ alertasPendientes.length }} alerta(s) restantes por WhatsApp
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-10px); }
</style>
