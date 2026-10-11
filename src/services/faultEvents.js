import { collection, query, where, orderBy, limit, startAfter, onSnapshot, getDocs } from 'firebase/firestore';
import { faultEventWindow, eventKindConfig } from '../utils/faultEvents.js';

export const FAULT_PAGE_SIZE = 50;
export function faultEventsQuery(db, sectors, options, cursor = null) {
  const config = eventKindConfig(options.kind);
  const constraints = [];
  if (sectors !== null) {
    if (!sectors?.length) throw new Error('No hay sectores autorizados.');
    constraints.push(where('sector', sectors.length === 1 ? '==' : 'in', sectors.length === 1 ? sectors[0] : sectors));
  }
  const window = faultEventWindow(options.period, options.now, options.range);
  if (window.pendingOnly && options.state && !config.pendingStates.includes(options.state)) throw new Error('Los pendientes anteriores solo incluyen pendientes o en proceso.');
  if (options.state && !config.states.some(state => state.value === options.state)) throw new Error('Estado de evento no válido.');
  if (window.pendingOnly) constraints.push(where('estado', 'in', options.state ? [options.state] : config.pendingStates));
  else if (options.state) constraints.push(where('estado', '==', options.state));
  if (config.categories.some(category => category.value === options.category)) constraints.push(where(config.categoryField, '==', options.category));
  if (window.from) constraints.push(where('createdAt', '>=', window.from));
  constraints.push(where('createdAt', '<', window.to), orderBy('createdAt', options.order || 'asc'));
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(FAULT_PAGE_SIZE));
  return query(collection(db, config.collection), ...constraints);
}

function page(snapshot) {
  return { events: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    cursor: snapshot.docs.at(-1) || null, hasMore: snapshot.docs.length === FAULT_PAGE_SIZE };
}
export function subscribeFaultEvents(db, sectors, options, receive, fail) {
  return onSnapshot(faultEventsQuery(db, sectors, options), snapshot => receive(page(snapshot)), fail);
}
export async function loadFaultEventsPage(db, sectors, options, cursor) {
  return page(await getDocs(faultEventsQuery(db, sectors, options, cursor)));
}
