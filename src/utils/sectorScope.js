const SECTORS = ['HILANDERIA', 'TEJEDURIA'];
const LEADERS = ['jefe_sector', 'jefe_electricos', 'jefe_produccion', 'gerente_produccion'];
const ROLES = ['mecanico', 'tejedor', 'inspector', 'auxiliar', 'supervisor',
  'supervisor_mecanico', 'supervisor_electrico', ...LEADERS, 'admin'];

export function getSectorScope(profile) {
  if (!ROLES.includes(profile?.role)) throw new Error('Se requiere un perfil aprobado.');
  if (profile.role === 'admin') return null;
  const assigned = Array.isArray(profile.sectoresAsignados)
    ? profile.sectoresAsignados : [profile.sectorDefault || 'HILANDERIA'];
  const leaders = LEADERS.includes(profile.role) && Array.isArray(profile.jefeDeSectores)
    ? profile.jefeDeSectores : [];
  const sectors = [...new Set([...assigned, ...leaders])].filter(value => SECTORS.includes(value));
  if (!sectors.length) throw new Error('No hay sectores válidos asignados. Contactá al administrador.');
  return sectors;
}
