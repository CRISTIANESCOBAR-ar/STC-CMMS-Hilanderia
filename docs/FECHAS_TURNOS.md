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

## Pendiente antes de cerrar R2

Confirmar con planta si la planilla del turno C usa la fecha de inicio a las 22:00
o la fecha calendario de cada captura. Se conserva el criterio calendario existente
en patrullas, muestras, operarios y paros hasta recibir esa confirmación.
El helper `shiftSlot` soporta ambos criterios, pero todavía no cambia las escrituras.

Si se adopta fecha de inicio: implementar identificación/versionado de nuevos registros,
lectura compatible de patrullas legacy nocturnas y ensayo de relevo sin duplicados.
No reinterpretar fechas históricas ni migrarlas automáticamente. Revisar además
formularios abiertos al cambiar de turno: mostrar el turno de la captura y evitar
guardar inadvertidamente con constantes de una sesión anterior. No cambiar el turno
de una patrulla ya iniciada mientras se está editando una ronda.

## Verificación y reversión

Pruebas automatizadas de 06:00, 14:00, 22:00, medianoche, fin de mes/año,
29 de febrero, fechas inválidas y PC en UTC, Los Ángeles y Tokio.
El helper de inicio de turno se usa en calidad de sala; los filtros de IA usan
la misma zona. Los cachés IA nuevos llevan `v3_time_` para evitar reutilizar resúmenes
calculados con otra zona. No se modifican reglas, datos remotos ni cachés anteriores.

Revertir el commit de esta entrega y reconstruir el frontend permite recuperar el
cálculo anterior. Los registros creados no se deshacen con Git. Ensayar primero en
piloto; no desplegar esta rama en producción sin las puertas de S3 y R4.
