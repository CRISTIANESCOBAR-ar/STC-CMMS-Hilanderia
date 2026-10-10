# Fechas y turnos de planta

La zona de cálculo es `America/Argentina/Buenos_Aires`, independiente de la zona
configurada en la PC. El reloj del equipo debe estar sincronizado; elegir una zona
explícita no corrige un reloj adelantado o atrasado.

- A: 06:00 inclusive hasta 14:00 exclusiva.
- B: 14:00 inclusive hasta 22:00 exclusiva.
- C: 22:00 inclusive hasta 06:00 exclusiva; su inicio siempre es a las 22:00 previas.

Los informes diarios y filtros del histórico usan día calendario de planta,
desde medianoche hasta la siguiente medianoche. Un informe de 7 días incluye
exactamente 7 fechas calendario. El reporte CSV mantiene su fecha explícita y su
valor inicial de ayer. Las fechas de documentos siguen usando sus formatos existentes.
Los timestamps ISO de eventos siguen representando instantes UTC; no deben convertirse
en fechas de planilla mediante `toISOString().slice(0, 10)`.

## Criterio nocturno confirmado

Planta confirmó fecha de inicio a las 22:00. Martes 02:00 corresponde a C del lunes.
Patrullas, muestras y paros nuevos llevan `fechaCriterio: inicio-turno-v1`.
Las lecturas C consultan fecha de inicio y fecha siguiente; registros legacy con
`createdAt` coherente con el turno se normalizan solo en memoria, conservando
`fechaOriginal`. Sin timestamp o con turno contradictorio mantienen su fecha:
requieren revisión en piloto. No hay migración automática ni escrituras durante lecturas.

Las patrullas activas se reutilizan durante medianoche. Si legacy ya creó duplicados,
seguimiento muestra cada registro y la captura propia retoma la más antigua activa.
La creación simultánea desde dos PCs corresponde a R3. Historial mantiene paginación
por fecha almacenada: normalizar la visualización no corrige su orden legacy (E1).
Paros conserva la ruta original para editar/eliminar registros. Operarios inicia con
fecha operativa y mantiene selector/documentos históricos explícitos: no se fusionan
horarios basándose en `updatedAt`, que puede corresponder a una edición posterior.

Muestras y formularios nuevos de paros impiden guardar después de un cambio de turno,
conservan los datos en pantalla y avisan antes de reabrir. Edición de paros conserva
el turno original. Patrulla y eficiencia muestran el turno de su documento sin cambiar
una ronda abierta. Seguimiento/paros actualizan reloj cada 15 segundos y al enfocar,
liberándolo al salir. Persistencia de borradores al recargar sigue pendiente en R4.

Los informes ejecutivos filtrados por turno usan fechas de inicio: C incluye madrugada
siguiente. Los informes diarios sin turno conservan día calendario.

## Verificación y reversión

Pruebas automatizadas de 06:00, 14:00, 22:00, medianoche, fin de mes/año,
29 de febrero, fechas inválidas y PC en UTC, Los Ángeles y Tokio.
El helper de inicio de turno se usa en calidad de sala; los filtros de IA usan
la misma zona. Los cachés IA nuevos llevan `v3_time_` para evitar reutilizar resúmenes
calculados con otra zona. No se modifican reglas, datos remotos ni cachés anteriores.

Antes de producción: ensayar 21:59→22:00, 23:59→00:00 y 05:59→06:00 con formularios
abiertos, inspector/supervisor y datos legacy. Comprobar índices reales: emuladores
no verifican índices compuestos. Coordinar actualización de clientes (R4), porque
un cliente antiguo todavía puede escribir fechas con el criterio anterior.

Revertir el commit de esta entrega y reconstruir el frontend permite recuperar el
cálculo anterior. Revertir primero el commit nocturno y luego el de zona si corresponde.
Los registros creados no se deshacen con Git y clientes anteriores no interpretan la
nueva fecha: revisar registros desde el cambio y evitar duplicados antes de rehabilitar
captura nocturna tras rollback. Ensayar en piloto; puertas de S3 y R4 siguen vigentes.
