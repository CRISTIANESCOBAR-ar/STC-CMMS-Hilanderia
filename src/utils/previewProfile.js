import { ROLE_OPTIONS, SECTOR_OPTIONS, isJefeRole } from '../constants/organization';
export function buildPreviewProfile(administrator, role, sector) {
  if (administrator?.role !== 'admin') throw new Error('Solo administración puede simular perfiles.');
  if (role === 'admin' || !ROLE_OPTIONS.some(option => option.value === role) || !SECTOR_OPTIONS.includes(sector)) throw new Error('Seleccioná un rol y sector válidos.');
  return { ...administrator,role,sectorDefault:sector,sectoresAsignados:[sector],jefeDeSectores:isJefeRole(role) ? [sector]:[],alcance:'sector',vistasPersonalizadas:null,permisosPersonalizados:null,especialidades:null };
}
