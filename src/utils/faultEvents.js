import { addDays, plantDate, plantInstant, shiftStart } from './plantTime.js';

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

export function filterFaultEvents(events, { category = '', state = '', search = '' } = {}) {
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const term = normalize(search.trim());
  return events.filter(event => (!category || (category === 'other'
    ? !['Mecánico', 'Eléctrico'].includes(event.tipoProblema) : event.tipoProblema === category))
    && (!state || event.estado === state)
    && (!term || normalize([event.numeroMaquina, event.tipoMaquina, event.observaciones, event.motivo,
      event.creadoPorNombre, event.sector].join(' ')).includes(term)));
}
