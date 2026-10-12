export function mobileWorkAction(item, uid, canTake) {
  const own = !!uid && item.asignadoA === uid;
  const state = item.atencionEstado || item.estado;
  if (['CERRADA', 'COMPLETADO'].includes(state)) return { label: 'Ver resolución', kind: 'detail' };
  if (state === 'COMPLETADA') return { label: 'Ver corrección', kind: 'detail', hint: 'Pendiente de validación del responsable.' };
  if (!item.asignadoA && canTake && ['REPORTADA', 'PENDIENTE'].includes(state))
    return { label: item.atencionVersion ? 'Voy a atender' : 'Tomar trabajo', kind: item.atencionVersion ? 'claim' : 'take' };
  if (own) {
    const labels = { ASIGNADA: 'Aceptar tarea', ACEPTADA: 'Iniciar trabajo', EN_TRABAJO: 'Registrar corrección', EN_PROCESO: 'Registrar corrección', EN_ESPERA: 'Actualizar espera' };
    return { label: labels[state] || 'Ver acciones', kind: 'detail', hint: 'Trabajo asignado a vos.' };
  }
  return { label: 'Ver detalle', kind: 'detail', hint: item.asignadoA ? `A cargo de ${item.asignadoNombre || 'otro usuario'}.` : 'Revisá el detalle y los permisos de atención.' };
}
