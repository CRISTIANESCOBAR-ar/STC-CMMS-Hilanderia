export function canExecuteIntervention(role, permissions, intervention) {
  return role === 'admin' || permissions?.cerrarOrden === true
    || (role === 'inspector' && intervention?.tipoIntervencion === 'CALIDAD');
}
