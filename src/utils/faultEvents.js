import { addDays, plantDate, plantInstant, shiftStart } from './plantTime.js';

const EVENT_KINDS = {
  faults: {
    collection:'novedades', categoryField:'tipoProblema', title:'Eventos de fallas', singular:'Falla', author:'Reportado por',
    categories:[{ value:'Mecánico', label:'Mecánico' }, { value:'Eléctrico', label:'Eléctrico' }],
    states:[{ value:'pendiente', label:'Pendiente' }, { value:'en proceso', label:'En proceso' }, { value:'resuelto', label:'Resuelto' }],
    pendingStates:['pendiente', 'en proceso'],
  },
  interventions: {
    collection:'intervenciones', categoryField:'tipoIntervencion', title:'Solicitudes de intervención', singular:'Solicitud', author:'Solicitado por',
    categories:[{ value:'MECANICO', label:'Mecánico' }, { value:'ELECTRICO', label:'Eléctrico' }, { value:'CALIDAD', label:'Calidad' }],
    states:[{ value:'PENDIENTE', label:'Pendiente' }, { value:'EN_PROCESO', label:'En proceso' }, { value:'COMPLETADO', label:'Completado' }],
    pendingStates:['PENDIENTE', 'EN_PROCESO'],
  },
};
export function eventKindConfig(kind = 'faults') {
  if (!Object.hasOwn(EVENT_KINDS, kind)) throw new Error('Tipo de eventos no válido.');
  return EVENT_KINDS[kind];
}
export function eventView(event, kind = 'faults') {
  const config = eventKindConfig(kind);
  return { ...event,
    tipoProblema: config.categories.find(category => category.value === event[config.categoryField])?.label || event[config.categoryField] || 'Sin categoría',
    motivo: kind === 'interventions' ? event.sintomaNombre || event.motivoDescripcion || 'Solicitud de asistencia' : event.motivo,
  };
}
export function machineStateLabel(value) {
  return { EN_MARCHA:'En marcha', CON_PROBLEMA:'Con problema', PARADA:'Parada' }[value] || value || 'No informado';
}
export function eventStateClass(value) {
  return { PENDIENTE:'pendiente', EN_PROCESO:'en-proceso', COMPLETADO:'resuelto' }[value] || value?.replace(' ', '-');
}

export function faultEventWindow(period, now = new Date(), range = {}) {
  const today = plantDate(now);
  if (period === 'range') {
    const from = plantInstant(range.from);
    const to = plantInstant(addDays(range.to, 1));
    if (to <= from || to.getTime() - from.getTime() > 31 * 86400000) throw new Error('Elegí un rango válido de hasta 31 días.');
    return { from, to, pendingOnly:false };
  }
  if (period === 'older') return { from: null, to: shiftStart(now), pendingOnly: true };
  if (period === 'shift') {
    const from = shiftStart(now);
    return { from, to: new Date(from.getTime() + 8 * 60 * 60 * 1000), pendingOnly: false };
  }
  const from = plantInstant(addDays(today, period === 'week' ? -6 : 0));
  return { from, to: plantInstant(addDays(today, 1)), pendingOnly: false };
}

export function filterFaultEvents(events, { category = '', state = '', search = '', kind = 'faults' } = {}) {
  const config = eventKindConfig(kind);
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const term = normalize(search.trim());
  return events.filter(event => (!category || (category === 'other'
    ? !config.categories.some(option => option.value === event[config.categoryField]) : event[config.categoryField] === category))
    && (!state || event.estado === state)
    && (!term || normalize([event.numeroMaquina, event.tipoMaquina, event.observaciones, event.motivo,
      event.creadoPorNombre, event.sector, event.sintomaNombre, event.motivoDescripcion,
      event.nombreMaquinaDisplay, event.asignadoNombre].join(' ')).includes(term)));
}
