# Preparación y pruebas de campo del circuito de atención

Preparado el domingo 11 de octubre de 2026. Primera validación de flujo prevista para el martes 13. La vista de ensayo usa datos ficticios; el circuito real requiere despliegue y habilitación explícitos. No se migran automáticamente perfiles ni tareas.

## Actualización del 12 de octubre: aviso directo y toma móvil

El flujo acordado reproduce el aviso del grupo: **reportar → trabajo disponible para el equipo → «Voy a atender» → iniciar al llegar → completar**. Coordinación puede asignar, priorizar, transferir o validar, pero no debe autorizar cada reporte antes de que alguien lo atienda.

- Un reporte nuevo de un participante del piloto genera un trabajo con ID reservado `reporte_ID`, foto/datos reutilizados y vínculo recíproco. Trabajo, primer evento y vínculo se guardan en la misma transacción. Reintentos del trigger no crean otro trabajo. No se convierten automáticamente reportes anteriores al inicio configurado.
- La mención es opcional y se valida contra sector, especialidad y permisos actuales de la persona. No asigna ni reserva. Una asignación formal exige aceptación de esa persona; otro técnico no puede tomarla libremente.
- Tomar cambia a ACEPTADA y registra responsable y aceptación; iniciar registra el comienzo efectivo. Completar un caso normal cierra; crítico requiere validación. Las transiciones sincronizan estado/responsable del reporte original. Sus estados vinculados no se modifican ni eliminan directamente desde el cliente.
- La primera versión genera un trabajo por reporte. El circuito de apoyo con varios trabajos vinculados a una misma falla queda fuera de este bloque; no combinar registros solo porque comparten número de máquina.
- Mecánico entra a Avisos del equipo, filtrados por sus especialidades, y puede pasar a Mis trabajos. La toma se muestra en tarjetas móviles y tabla desktop. El detalle prioriza acciones en móvil, conservando consulta de datos técnicos. La vista previa de rol muestra controles, pero bloquea cambios del nuevo circuito; el ensayo ficticio permite ejecutarlos.
- Preparados avisos FCM para disponibilidad, asignación, prioridad y cierre. Solo participantes elegibles con dispositivo registrado y declaración de turno vigente. «Estoy de turno · Avisos» renueva al inicio; «Fuera de turno» desactiva; expira a las 06/14/22 de planta. Declarar turno afecta notificaciones, no permisos ni capacidad de tomar trabajos para cubrir a un compañero.
- Registro actual conserva un dispositivo por cuenta: activar en el teléfono que usará el mecánico. Cierre de sesión intenta retirar ese registro y suscripción sin impedir logout si la red falla. Soporte de varios dispositivos y pruebas físicas de cada navegador requieren validación adicional.
- Avisos con texto genérico y enlace protegido, sin descripción privada del problema en la pantalla bloqueada. Confirmación de FCM no equivale a recepción ni aceptación. Una respuesta perdida puede repetir un aviso; la toma sigue siendo transaccional. La bandeja es la referencia ante falta de permiso, conexión o entrega push.

### Habilitación de esta actualización

Mantener deshabilitado hasta aprobar el ensayo. Desplegar primero reglas compatibles y luego `transitionAttention`, `createReportedWork` y `notifyAttention`, además de Hosting. Se añaden a `config/attentionPilot`: `automaticReports: true`, `reportsFrom: Timestamp` con el instante de inicio autorizado y `pushEnabled: true` solo después de registrar/probar dispositivos. `enabled`, `version`, participantes y sectores siguen siendo obligatorios. No se creó ni activó esta configuración durante el desarrollo.

El trigger registra fallos de datos/permisos para diagnóstico; errores transitorios reintentan. La auditoría de solo lectura detecta reportes elegibles sin trabajo después de dos minutos. Aún se deben configurar alertas remotas de estos fallos y probar dispositivos/red de planta antes de declarar producción.

Para ensayar: abrir Intervenciones → Ensayar atención → seleccionar técnico mecánico del turno o del relevo → tomar el aviso «Colita tejida» del telar 14 → iniciar → completar. Probar también dos tomas, asignación formal, cambio de prioridad y caso crítico. No hay llamadas de escritura ni envíos push reales desde el ensayo.

## Entregas y estado

| Bloque | Preparado | Pendiente de campo / operación |
| --- | --- | --- |
| Responsabilidades | Función, especialidad y sector comprobados en servidor; especialidades opcionales en editor de usuarios | Confirmar coordinadores y suplencias por turno |
| Atención | Incorporación, asignación, aceptación, inicio, espera, reanudación, diagnóstico, finalización, validación crítica y reapertura | Confirmar qué cierres requieren validación y quién los realiza |
| Relevo | Reasignación con responsable habilitado, motivo y próxima acción; conserva historial | Ensayar un relevo real y ausencia del asignado |
| Trazabilidad | Transición e historial en la misma transacción; revisión e idempotencia | Verificar con cuentas reales y red de planta |
| Vistas | Bandejas de trabajo, sin asignar, sin aceptar, en espera y por validar; ensayo aislado accesible a admin | Revisar 800×600, 1024×768 y móvil con usuarios |
| Borradores | Piloto conserva borradores locales por cuenta/tarea, avisa conflictos, permite reintentar confirmación sin duplicar | Desconexión y actualización con captura pendiente; no equivale a soporte offline de toda la aplicación |
| Consultas | Intervenciones activas y validaciones pendientes separadas de cierres de últimas 24 horas | Medir con volumen real; las tareas abiertas no se limitan para evitar ocultar urgencias |
| Concurrencia | 30 sesiones ficticias de roles mezclados en emuladores y conflictos sobre la misma tarea | No es una certificación de rendimiento de Firebase en planta |
| Recuperación | Generador de plan de exportación/restauración y auditoría de solo lectura | Bucket privado, respaldo de fotos, restauración y objetivos de recuperación comprobados |
| Monitoreo | Errores de transición registrados en servidor con código sin contenido de tareas; auditoría de responsables y vínculos | Alertas remotas, presupuesto/consumo y responsables de soporte configurados |

## Matriz propuesta sin cambiar cargos existentes

El cargo actual sigue existiendo. `especialidades` complementa la función en el nuevo circuito; no agrega sectores ni altera los permisos del flujo anterior.

| Función de atención | Cargo actual inicial | Especialidad predeterminada | Acción |
| --- | --- | --- | --- |
| Solicitante | Tejedor / supervisor / inspector | Según cargo | Reportar / solicitar conforme a permisos existentes |
| Técnico | Mecánico | MECANICO | Aceptar, iniciar, esperar, diagnosticar y completar su tarea |
| Técnico eléctrico del piloto | Mecánico con especialidad personalizada | ELECTRICO | Mismas acciones en tareas eléctricas; confirmar denominación definitiva del cargo el martes |
| Calidad | Inspector | CALIDAD | Ejecutar actuaciones de calidad asignadas a sí mismo |
| Coordinador | Supervisores y jefaturas | Mecánica/eléctrica según cargo; producción abarca las tres | Incorporar, asignar, transferir, validar críticos y reabrir |
| Administrador | Admin | Global | Configurar y preparar el piloto |

Un permiso personal explícito prevalece. Quien tiene permisos personalizados necesita `coordinarAtencion: true` para coordinar el piloto. La especialidad personalizada vacía deniega ejecución; sin personalización se usa la del cargo. Los sectores asignados y a cargo se verifican en servidor. El técnico asignado también debe estar en la lista de participantes del piloto.

## Compatibilidad y modelo

- `estado` conserva PENDIENTE / EN_PROCESO / COMPLETADO. Asignar y aceptar siguen en PENDIENTE; iniciar pasa a EN_PROCESO. Completar pasa a COMPLETADO; el nuevo estado distingue validación crítica pendiente de cierre confirmado.
- `atencionVersion: 1`, `atencionEstado`, `atencionRevision` y fechas de atención son adicionales. Solo el servidor escribe registros incorporados y su subcolección `eventos_atencion`.
- Asignar a otra persona durante una espera o ejecución es una entrega: exige motivo y próxima acción, vuelve a ASIGNADA y necesita nueva aceptación. No borra fechas iniciales ni eventos previos. El tiempo total desde el primer inicio no representa minutos efectivos de trabajo; estos se registran por separado.
- Solo se incorporan inicialmente tareas pendientes y sin asignado. No se modifica trabajo en curso por una migración automática.
- `reporteOrigenId` vincula explícitamente una falla; los trabajos nuevos se generan automáticamente bajo el piloto. Las transiciones actualizan el reporte y el cierre validado lo resuelve. Las relaciones con varios trabajos requieren una extensión posterior.
- Cada comando lleva revisión e identificador de operación. Transacción valida perfil/configuración actuales, responsable y estado; guarda el evento junto con el cambio. Reintentar el mismo comando confirmado devuelve su resultado sin duplicar. Reutilizar el identificador con otro comando se rechaza.
- Eventos se leen según el sector de la tarea. No se crean, editan ni eliminan desde clientes. Se muestran los últimos 30, conservando el resto en Firestore.
- Borrador local identificado por UID y tarea, caduca en siete días, conserva revisión original y se elimina tras confirmar. No se envía al servidor automáticamente. Un conflicto exige revisar y actualizar explícitamente la revisión del borrador.
- Notificaciones no se consideran aceptación ni confirmación. La bandeja y el registro son la referencia; escalamiento automático y entrega de notificaciones extremo a extremo quedan pendientes.

## Activación real, después de validar el flujo

1. Confirmar responsables, cuentas, especialidades y sector del grupo inicial (5–10 personas). Usar cuentas reales: la vista previa de admin no reproduce los permisos reales de Firebase.
2. Ejecutar auditoría de acceso existente y la nueva auditoría de atención con proyecto explícito y credenciales de servidor: `node scripts/check-attention-readiness.mjs --project=ID`. Es solo lectura y no imprime nombres, correos ni contenido de tareas.
3. Confirmar respaldo y ensayar restauración en otro proyecto. `node scripts/plan-recovery.mjs --project=ORIGEN --bucket=BUCKET_PRIVADO --test-project=DESTINO_DISTINTO` genera instrucciones sin ejecutarlas. Exportación de Firestore incluye subcolecciones, pero no fotos de Storage. El destino necesita sus propias reglas, configuración e índices.
4. Mantener el piloto deshabilitado. Desplegar las reglas verificadas, después `functions:transitionAttention,functions:createReportedWork,functions:notifyAttention` y Hosting compatible. Verificar índices y cuentas reales. Las Functions usan perfiles/configuración reales, sin privilegios enviados por el navegador.
5. Crear `config/attentionPilot` únicamente al iniciar el piloto autorizado: `enabled: true`, `version: 1`, `userIds: [UIDS_CONFIRMADOS]`, `sectors: [SECTOR_CONFIRMADO]`. Ausencia del documento, enabled falso, UID o sector no incluido impiden cualquier transición. No se creó ni activó esta configuración durante el desarrollo.
6. Los reportes nuevos posteriores al inicio generan su trabajo automáticamente. La incorporación manual de tareas pendientes antiguas sigue disponible para admin. Técnico toma libremente un trabajo disponible; coordinación asigna si corresponde. Ampliar gradualmente sin incorporar todo el historial.

## Guion para el martes

| Caso | Resultado obligatorio |
| --- | --- |
| Operador reporta → coordinador incorpora y vincula → técnico acepta | Identidades, vínculo y estados coherentes en ambas cuentas |
| Dos asignaciones sobre la misma revisión | Una confirma; la otra avisa conflicto; sin sobrescritura |
| Técnico intenta ejecutar fuera de su sector/especialidad | Rechazo de servidor |
| Espera por repuesto | Motivo, próxima acción y fecha de revisión visibles |
| Relevo / ausencia | Responsable nuevo recibe ASIGNADA y debe aceptar; historial preservado |
| Cierre normal / crítico | Normal cierra; crítico queda por validar, incluso después de 24 horas |
| Recarga / red interrumpida | Borrador recuperable; no mostrar éxito sin confirmación |
| Respuesta perdida después de guardar | Reintento del mismo identificador no duplica eventos |
| Actualización con formulario abierto | No perder la captura; registrar cualquier incidencia |
| Turno C y madrugada | Fecha de inicio del turno y tarea pendiente coherentes |

Registrar caso, rol, resolución, resultado y evidencia en un registro de prueba sin contraseñas. Expandir solo con cero pérdidas de captura, cero accesos indebidos, ningún crítico sin responsable, recuperación comprobada y tiempos aceptables medidos en los puestos antiguos.

## Reversión y suspensión

Hosting puede volver a una versión anterior mientras no existan tareas incorporadas. Después de incorporar tareas, conservar reglas y Function compatibles: los clientes antiguos deben seguir bloqueados para esas tareas. Revertir solo Hosting no transforma el nuevo modelo en el anterior.

Deshabilitar `enabled` suspende transiciones, incluidas tareas ya incorporadas; se mantienen consulta e historial. Por eso no usarlo como reversión rutinaria en medio de trabajos abiertos. Ante un incidente, coordinación debe asegurar continuidad manual, comunicar pendientes y decidir la recuperación. Rehabilitar o convertir datos requiere un procedimiento explícito y respaldo, nunca borrar marcadores para forzar compatibilidad.
