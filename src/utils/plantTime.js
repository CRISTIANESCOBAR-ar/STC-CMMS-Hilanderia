export const PLANT_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PLANT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function plantParts(instant = new Date()) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Fecha inválida');
  return Object.fromEntries(formatter.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}

export function plantDate(instant = new Date()) {
  const p = plantParts(instant);
  return `${p.year}-${p.month}-${p.day}`;
}

export function addDays(date, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(days)) throw new RangeError('Fecha o desplazamiento inválido');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new RangeError('Fecha inválida');
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function plantShift(instant = new Date()) {
  const hour = Number(plantParts(instant).hour);
  return hour >= 6 && hour < 14 ? 'A' : hour >= 14 && hour < 22 ? 'B' : 'C';
}

// Calendar reports keep midnight boundaries; shifts may use their starting date.
export function shiftSlot(instant = new Date(), startingDate = true) {
  const hour = Number(plantParts(instant).hour);
  const date = plantDate(instant);
  return { fecha: startingDate && hour < 6 ? addDays(date, -1) : date, turno: plantShift(instant) };
}

export function moveShift(fecha, turno, delta) {
  addDays(fecha, 0);
  const index = ['A', 'B', 'C'].indexOf(turno);
  if (index < 0 || !Number.isInteger(delta)) throw new RangeError('Turno inválido');
  const next = index + delta;
  return { fecha: addDays(fecha, Math.floor(next / 3)), turno: ['A', 'B', 'C'][((next % 3) + 3) % 3] };
}

// Resolve wall-clock time through the IANA zone, rather than the PC timezone.
export function plantInstant(date, hour = 0) {
  addDays(date, 0);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new RangeError('Hora inválida');
  const wall = Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
  let candidate = wall;
  for (let i = 0; i < 3; i++) {
    const p = plantParts(candidate);
    const represented = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    candidate += wall - represented;
  }
  return new Date(candidate);
}

export function shiftStart(instant = new Date()) {
  const slot = shiftSlot(instant);
  return plantInstant(slot.fecha, { A: 6, B: 14, C: 22 }[slot.turno]);
}
