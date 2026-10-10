const roles = new Set(['mecanico', 'tejedor', 'inspector', 'auxiliar', 'supervisor',
  'supervisor_mecanico', 'supervisor_electrico', 'jefe_sector', 'jefe_electricos',
  'jefe_produccion', 'gerente_produccion', 'admin']);
const sectors = new Set(['HILANDERIA', 'TEJEDURIA']);

export function compatibilityIssues(collection, data) {
  const issues = [];
  if (collection === 'usuarios') {
    if (data.role === 'pendiente') return ['pending-approval'];
    if (!roles.has(data.role)) issues.push('invalid-role');
    if (data.role !== 'admin') {
      if (!sectors.has(data.sectorDefault)) issues.push('invalid-default-sector');
      if (!Array.isArray(data.sectoresAsignados) || !data.sectoresAsignados.length
          || data.sectoresAsignados.some(sector => !sectors.has(sector))) issues.push('invalid-assigned-sectors');
    }
  } else if (['novedades', 'intervenciones', 'patrullas', 'notas_turno'].includes(collection)) {
    if (!sectors.has(data.sector)) issues.push('missing-or-invalid-sector');
    if (collection === 'intervenciones') {
      if (!['PENDIENTE', 'EN_PROCESO', 'COMPLETADO'].includes(data.estado)) issues.push('invalid-order-state');
      if (data.estado === 'EN_PROCESO' && !data.asignadoA) issues.push('unassigned-active-order');
    }
  }
  return issues;
}
