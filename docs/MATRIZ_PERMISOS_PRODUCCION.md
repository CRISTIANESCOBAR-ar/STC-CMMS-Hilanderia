# Matriz de permisos para producción — S3

Estado: código y pruebas en rama de preparación. No desplegado en Firebase.
Todos los accesos operativos requieren cuenta identificada y perfil con rol reconocido.
Una cuenta nueva recibe `pendiente`; solo un administrador puede asignar rol y sectores.
Un administrador también puede devolver una cuenta a `pendiente` para retirar acceso.
Los perfiles existentes conservan su rol: no se realiza una migración automática.

## Alcance

- Admin: alcance global.
- Resto: `sectoresAsignados`; las jefaturas y gerente también usan `jefeDeSectores`.
- Sectores válidos: HILANDERIA y TEJEDURIA, con nombres exactos.
- Una vista o permiso personalizado no otorga acceso a sectores no asignados.
- Inventario de máquinas y catálogos: lectura compartida entre miembros aprobados;
  se considera información técnica común. Jefaturas editan máquinas de su sector;
  admin administra catálogo, altas/bajas y cambios de sector.
- Usuarios: perfil propio para cuentas pendientes; perfiles de compañeros para miembros
  aprobados (identificación operativa). Edición de privilegios solo admin.
- Producción de telares (`shift_reports`, `operarios_horarios`, `paros_telares`,
  `muestras_anudados`) pertenece a TEJEDURIA aunque los documentos antiguos no tengan sector.

## Valores predeterminados

| Rol | Reportar falla | Solicitar intervención | Ejecutar/cerrar orden | Calidad | Capturas de producción |
| --- | --- | --- | --- | --- | --- |
| Tejedor | Sí | No | No | No | No |
| Mecánico | Sí | No | Sí, asignada a sí mismo | No | No |
| Inspector | Sí | Sí | Solo CALIDAD, asignada a sí mismo | Lectura y rondas | Muestras |
| Auxiliar | No | No | No | Lectura | Shift Report y operarios |
| Supervisor producción | Sí | Sí | No | Lectura | Eficiencia |
| Supervisor mecánico | Sí | Sí | Sí, asignada a sí mismo | Lectura | Eficiencia |
| Supervisor eléctrico | Sí | Sí | Sí, asignada a sí mismo | Lectura | Por habilitación expresa |
| Jefaturas y gerente | Sí | Sí | Sí, asignada a sí mismo | Lectura | Por habilitación expresa |
| Admin | Sí | Sí | Sí, asignada a sí mismo | Todas | Todas |

La matriz respeta las configuraciones existentes: override individual → configuración
organizacional → valores predeterminados. Las vistas habilitan el módulo de captura;
`crearFalla`, `cerrarOrden` y `verCalidad` gobiernan las operaciones correspondientes.
Inspector conserva la excepción CALIDAD aunque su permiso general de cerrar órdenes sea falso.
Habilitar una vista de ejecución de calidad también requiere `verCalidad`.

## Reglas por operación

- Novedades: lectura en sectores asignados; creación con actor real, timestamp de
  servidor y estado pendiente. Actualización de estado/feedback para el panel de jefatura.
- Intervenciones: `PENDIENTE → EN_PROCESO → COMPLETADO`. La toma asigna al usuario
  que hace la operación; solo ese usuario puede registrar diagnóstico y cerrar.
  No se permite tomar una orden ya tomada, reasignarla ni reabrirla desde el cliente.
  Batch falla de forma atómica si alguna orden ya fue tomada. La experiencia ante
  conflictos y las transacciones del servicio se completarán en R3.
- Autor, sector, fecha de creación y asignación de identidad no se alteran desde capturas.
- Patrulla: `verCalidad` y sector para leer; vista patrulla para capturar. Inspectores
  pueden cubrir a otro inspector del mismo sector, conforme al flujo actual.
  Captura de eficiencia modifica solamente E1/E2/E3, no rondas de calidad.
- Notas de turno: autor real; lectura por sector; jefatura marca leída; admin elimina.
- Muestras: inspector habilitado en Tejeduría crea; solo admin corrige/elimina.
- Shift Report y operarios: auxiliar de Tejeduría o rol explícitamente habilitado captura;
  lecturas de producción compartidas con miembros del sector; eliminación solo admin.
- Paros/anudados: vista explícitamente habilitada captura; eliminación solo admin.
- Resúmenes: caché v2 con sectores explícitos; no se reutiliza caché legado sin alcance.

## Archivos

Nuevas fotos: `{novedades|intervenciones}/{sector}/{uid}/{nombre}`.
La cuenta aprobada debe tener permiso de la operación y ser propietaria de la subida.
JPEG, PNG y WebP menores a 10 MiB; archivos operativos no se sobrescriben.
SDK rechaza lectura de archivos de otro sector. Imágenes de procedimientos: crea admin.

Las vistas operativas descargan con getBlob autenticado y muestran URLs locales de blob,
que se revocan al cerrar/desmontar. Las URLs antiguas se interpretan como rutas; su
token se descarta, y no hay fallback a enlaces públicos.

La finalización de una captura revoca el token en servidor antes de guardar su ruta.
Un trigger protege subidas nuevas huérfanas; no toca automáticamente archivos legados.
El código está listo, pero requiere las nuevas Functions desplegadas y pruebas de CORS.
Documentación: https://firebase.google.com/docs/storage/web/download-files#download_data_directly_from_the_sdk

Para archivos existentes, el script migrate-operational-images.mjs inventaría referencias,
comprueba un único sector por archivo y elimina tokens solo con --apply y backup privado.
La ejecución remota aún está pendiente. Hasta entonces los enlaces antiguos que ya
circulan no están revocados; no afirmar aislamiento del entorno beta actual.

## Compatibilidad y despliegue piloto

1. Ejecutar la auditoría de solo lectura con proyecto explícito y credenciales de servidor:

   ```powershell
   node scripts/audit-production-access.mjs --project=ID_DEL_PROYECTO_DE_PRUEBA
   ```

   Imprime solo conteos agregados. No modifica datos. No se ejecutó contra planta.
   Código de salida 2 indica documentos incompatibles; pendientes de aprobación se
   cuentan aparte. Revisar participantes del piloto con un administrador.
2. Resolver sectores ausentes/incorrectos, perfiles incompletos y órdenes activas sin
   asignado. No inferir automáticamente el sector ni convertir usuarios desconocidos
   en mecánicos. Respaldar antes de cualquier migración.
3. Auditar imágenes en modo lectura y resolver referencias incompatibles:

   ```powershell
   node scripts/migrate-operational-images.mjs --project=ID --bucket=BUCKET
   ```

   Aplicación y rollback se preparan para una ventana piloto autorizada:

   ```powershell
   node scripts/migrate-operational-images.mjs --project=ID --bucket=BUCKET --apply --backup=.secrets/storage-s3.json
   node scripts/migrate-operational-images.mjs --project=ID --bucket=BUCKET --restore=.secrets/storage-s3.json
   ```

   El backup contiene tokens: no compartir ni versionar. Usa metageneraciones para
   evitar sobreescribir cambios ajenos. No se ejecutó ninguno de estos comandos en planta.
   Revisar CORS (storage.cors.json es referencia para los dominios conocidos), guardar
   configuración anterior y comprobar getBlob desde el sitio piloto. Los dominios
   de prueba adicionales deben declararse expresamente, sin ampliar a cualquier origen.
4. Publicar índices declarados y esperar que estén listos. El emulador no comprueba
   disponibilidad de índices compuestos en el servicio real.
5. Validar reglas/consultas en proyecto de prueba: cuentas por rol, fotos, patrulla,
   eficiencia, historial, toma múltiple y cierre; probar autorizaciones cruzadas
   Storage→Firestore en el entorno remoto. Desplegar finalizeOperationalUpload y revokeOperationalDownloadToken; confirmar bucket/región del trigger y runtime Node 22.
6. Publicar aplicación y reglas como release coordinada, en ventana piloto. Aplicación
   vieja usa rutas de imágenes y consultas incompatibles con reglas S3; no publicar
   reglas solas con clientes antiguos activos. Resolver PWA/actualización antes de ampliar.
7. Registrar versión por capa y release de Hosting para rollback. No restaurar reglas
   permisivas como procedimiento estándar. Revertir código no modifica datos existentes.

## Pendientes visibles

- Auditoría real de compatibilidad, reparación aprobada de datos e índices remotos.
- Validación de cuentas y flujo de aprobación en piloto.
- Ejecutar y ensayar la migración/reversión de metadata legada, Functions y CORS en entorno piloto.
- R2/R3/R4: turnos, conflictos, trazabilidad, recuperación y actualización de clientes.
- No se valida aún carga de 30 usuarios ni disponibilidad en puestos de planta.

## Limitación de prueba de revocación

La versión instalada del emulador Storage conserva downloadTokens en un array propio
al eliminar la clave de metadata por GCS. El test verifica que el finalizador rechaza
una revocación no confirmada y que la descarga autenticada funciona; no prueba la
revocación de un enlace real. Esa aceptación permanece obligatoria en el bucket piloto.
El servidor confirma metadata sin token antes de dar la finalización por exitosa.
