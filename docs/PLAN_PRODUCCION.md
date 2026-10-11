# Preparación para producción

Inicio: 10 de octubre de 2026. Rama: `codex/preparacion-produccion`.
Base: `045e2866b61a864f8ad5ef421a30b3dd4c24dfc9`.

## Seguimiento

Estados: pendiente → en curso → verificado localmente → validado en piloto → producción.
Un commit o un build correcto no significa que la versión esté validada en planta.
Cada entrega registra cambio, pruebas, limitaciones y reversión. Separar migraciones,
reglas y diseño visual en distintas entregas y despliegues.

| ID | Entrega | Estado | Criterio de salida |
| --- | --- | --- | --- |
| P0 | Plan y procedimiento reversible | Verificado localmente | Rama aislada, guía y commit publicado |
| S1 | IA solo en servidor y contenido seguro | Verificado localmente | Sin clave Gemini en frontend; errores controlados; HTML externo escapado; pruebas y build |
| S2 | Protección de perfiles | Verificado localmente | Creación sin privilegios; roles/sectores protegidos; emulador; login compatible |
| S3 | Permisos operativos y Storage | Verificado localmente; piloto pendiente | Matriz rol/sector/operación; datos y consultas compatibles; pruebas positivas/negativas |
| R1 | Sesión y configuración | Verificado localmente | Error de perfil no concede acceso; recuperación visible; lectura de configuración no escribe |
| R2 | Fechas y turnos de planta | Verificado localmente; piloto de relevo pendiente | Zona explícita; criterio nocturno; límites horarios probados; compatibilidad con historial |
| R3 | Concurrencia y trazabilidad | Pendiente | Sin doble toma de orden; transiciones válidas; actor y fecha registrados |
| R4 | Borradores, sincronización y PWA | Pendiente | Captura recuperable ante recarga/red caída; estado visible; actualización coherente |
| D1 | Dependencias y avisos de seguridad | En curso | Actualizaciones compatibles verificadas; clasificar/resolver avisos restantes antes de producción |
| E1 | Consultas y rendimiento | Pendiente | Paginación real; listeners acotados; mediciones con volumen representativo |
| O1 | Operación y liberación | En curso | CI; entorno de prueba; monitoreo/alertas; backup/restauración y rollback ensayados |
| V1 | Sistema visual y navegación | Pendiente | Componentes compartidos y problemas críticos siempre visibles |
| V2 | Modernización de vistas | Pendiente | Cada vista validada en resoluciones de planta, zoom y teclado |
| G1 | Salida de beta | Pendiente | Piloto por roles; carga representativa; cero incidencias críticas; recuperación ensayada |

## Diseño posterior

- Moderno y minimalista, con prioridades y estados legibles sin depender solo del color.
- Mantener visibles sector, turno, filtros activos, problemas críticos y pendientes.
- Aprovechar el ancho con paneles/tablas adaptables, sin agrandar espacios vacíos.
- Matriz de planta confirmada: 1024×768 como referencia principal, PC antiguas y algunas resoluciones menores. Probar 800×600 como caso reducido por confirmar, y 1366×768/1920×1080 para expansión.
- Verificar zoom 125%/150% y conservar captura móvil.
- Orden: panel de control, intervenciones, reporte de falla, patrulla/seguimiento;
  luego informes, operarios, eficiencia y administración. Una entrega por vista.

## Puertas de producción

1. Permisos por rol, sector y operación probados; sin escalamiento de privilegios.
2. Login, reporte con foto, asignación/cierre, patrulla y relevo funcionan en piloto.
3. Desconexión, recarga, operadores simultáneos y turno nocturno probados.
4. Medir carga/guardado, errores y consumo con usuarios y datos representativos.
5. Carga informada: unos 10 usuarios por turno, ampliable a 30. Validar 30 sesiones concurrentes con roles mezclados y operaciones representativas; disponibilidad, recuperación y pérdida de datos aún por definir.
6. Backups, restauración, monitoreo, responsables y rollback verificados.
7. Ampliar usuarios por grupos; detener expansión ante pérdida de captura, conflictos,
   errores de permisos o degradación sostenida.

No prometer ausencia absoluta de caídas: preparar prevención, detección y recuperación.

## Registro de entregas

Consultar hashes con `git log --oneline` en la rama. Procedimiento:
[DESPLIEGUE_REVERSIBLE.md](DESPLIEGUE_REVERSIBLE.md).

### P0 — Plan y reversión

- Base conservada y rama propia.
- Cambios preexistentes en `.firebase/hosting.ZGlzdA.cache` y `.continue/` fuera de los commits.
- Push a rama de trabajo; despliegue, migraciones y merge tienen puertas separadas.

### S1 — IA y contenido seguro

- Eliminado fallback de Gemini en navegador; preservados errores de permisos y cuotas.
- Resúmenes escapan HTML externo y mantienen negrita/cursiva/saltos de línea.
- Backend exige cuenta identificada y perfil con rol reconocido; valida modelo, texto,
  imágenes OCR, configuración y tamaño; limita a 12 solicitudes por usuario/10 minutos.
- Timeout de proveedor 90 segundos; salida máxima 8192 tokens; 10 instancias máximas.
- Validación: 10 pruebas automatizadas, sintaxis Functions y build correctos;
  sin referencias de clave/endpoint Gemini en los assets del frontend.
- Pendiente: prueba real de Functions/OCR con secret en entorno de prueba; límites
  iniciales sujetos a medición de carga. No se desplegó ni se probó el servicio remoto.
- Rollback: revertir commit S1; mantener backend compatible mientras se restaura Hosting.
  No reactivar el fallback con una clave privada como procedimiento de recuperación.

### Dimensionamiento confirmado

- 10 usuarios por turno como operación habitual; crecimiento previsto a 30.
- Se adopta 30 concurrentes como escenario de prueba, sin afirmar que ya esté validado.
- Hardware antiguo, resolución habitual 1024×768 e incluso menor.
- Priorizar render liviano, carga diferida, tablas compactas y detalles desplegables;
  mantener problemas críticos y acciones visibles. Medir en una PC real de planta.

### S2 — Perfiles y sesión

- Acceso anónimo eliminado de login y rechazado en Firestore/Storage.
- Nuevos perfiles solo con valores iniciales sin privilegios; no se obtiene admin por correo fijo.
- Usuarios solo pueden modificar su nombre; roles, sectores, permisos, identidad y fechas
  los administra un admin existente. Se comprueba compatibilidad con documentos legacy.
- Login no reescribe sectores/roles; carga de sesión única, con timeout y sin rol de fallback.
- Respuestas de perfiles anteriores no restauran privilegios tras logout/cambio de cuenta.
- Validación: 15 pruebas unitarias y 9 pruebas de Firestore/Storage en emuladores pasaron;
  build correcto. Emuladores requieren Java 21 HotSpot; Java OpenJ9 local es incompatible.
- Pendiente antes del piloto: comprobar cuentas Google por rol, admin existente y conexión
  del puesto; usuarios beta anónimos deben usar cuentas identificadas.
- S3 sigue pendiente: usuarios identificados aún conservan permisos operativos amplios.
- Rollback: revertir commit S2 y desplegar versión aprobada por capa; frontend y reglas
  deben coordinarse para no restaurar un login incompatible con las reglas activas.
- R1 parcial: resuelta sesión; aún falta carga de configuración y recuperación de perfiles
  organizacionales sin almacenar como éxito una lectura fallida.

### R1 — Configuración y recuperación

- Cargar umbrales de patrulla es lectura pura: usa defaults para campos ausentes,
  conserva valores configurados y no intenta migrar como inspector.
- Lecturas fallidas de perfiles organizacionales se propagan y permiten reintento;
  la sesión no se habilita hasta cargarlos. Guardar cambios publica estado local
  solo después de confirmación de Firestore.
- Validación acumulada: 15 pruebas unitarias y 10 de reglas, build correcto.
- Pendiente: ensayo manual de corte de red y recuperación en puesto de planta.
- Rollback: revertir commit R1; no hubo cambios ni migraciones de datos remotos.

### D1 — Actualizaciones compatibles iniciales

- Actualizadas versiones dentro de rangos declarados mediante audit fix sin force.
- Avisos totales: 37 → 24 (11 moderados, 13 altos); eliminado aviso crítico.
- Vite 7.3.7 y Vue 3.5.43; lockfile fija el árbol usado en las verificaciones.
- Validación tras actualizar: 15 unitarias, 10 de reglas y build correctos.
- Pendiente: revisar gRPC/Firebase (uso Node), PDF.js en scripts, UUID/ExcelJS y
  dependencias del CLI. No degradar Firebase ni ExcelJS para eliminar un aviso.
  No se habilita producción mientras falte evaluar exposición y resolver riesgos.
- Rollback: revertir commit D1 y ejecutar npm ci sobre el lockfile aprobado.

### O1 — Verificación automática inicial

- GitHub Actions en push de main/codex y pull requests: npm ci, pruebas unitarias,
  emuladores Firestore/Storage, sintaxis Functions y build sin secretos reales.
- El pipeline tiene permisos de lectura y no despliega.
- Monitoreo, alertas, backups/restauración, entorno piloto y pruebas de carga siguen pendientes.
- Primer pipeline remoto correcto (SHA b9abf88): [ejecución 38087403013](https://github.com/CRISTIANESCOBAR-ar/STC-CMMS-Hilanderia/actions/runs/38087403013). Acciones actualizadas a versiones oficiales vigentes y runner Ubuntu 24.04 para evitar cambios implícitos del entorno.
- Rollback: revertir commit del workflow; no modifica aplicaciones ni datos de Firebase.

## Checkpoints publicados

| Commit | Entrega | Verificación |
| --- | --- | --- |
| 4cfefdd | P0: plan y rollback | Documentación |
| 544ccd8 | S1: IA en servidor y resúmenes seguros | 10 unitarias y build |
| bf4361a | S2: perfiles y sesión | 15 unitarias, 9 emulador y build |
| ed33ef3 | R1: configuración | 15 unitarias, 10 emulador y build |
| ca6503b | D1: actualizaciones compatibles | Mismas pruebas; avisos restantes registrados |
| b9abf88 | O1: CI inicial | Instalación limpia, 25 pruebas y build en GitHub |

Los commits están publicados en `origin/codex/preparacion-produccion`. Ninguna de
estas entregas modifica Firebase remoto. Antes del despliegue de Functions revisar
bucket/región del trigger. El runtime se actualizó a Node 22 en S3; completar
pruebas del servicio en entorno piloto.

### S3 — Permisos operativos, consultas y compatibilidad

- Implementada aprobación de nuevas cuentas, alcance por sector y operaciones en servidor.
- Consultas de novedades/patrullas/IA/historial acotan sector antes de descargar.
- Identidad inmutable; toma/cierre de órdenes por actor asignado; inspector limitado a CALIDAD.
- Permisos personalizados/organizacionales efectivos en reglas; verCalidad restringe patrullas.
- Fotos nuevas con sector/propietario, validación MIME/tamaño y sin sobrescritura.
- Caché IA v2 aislada por sectores; índices de consultas declarados.
- Auditoría solo lectura de datos antiguos, con proyecto explícito y conteos agregados.
- Matriz y procedimiento: [MATRIZ_PERMISOS_PRODUCCION.md](MATRIZ_PERMISOS_PRODUCCION.md).
- Fotos operativas se descargan con autenticación; nueva captura guarda ruta y revoca token en backend antes de registrar. Migración/rollback de metadata legada preparados, sin ejecutar.
- Validación acumulada: 25 pruebas unitarias, 46 de reglas (71 en total), build y carga de exports Functions correctos.
- Pendiente de piloto: desplegar Functions, verificar CORS y ejecutar/ensayar migración de imágenes legadas. Los enlaces ya emitidos en beta siguen vigentes hasta esa migración.
- No se ejecutó auditoría contra Firebase real ni se publicaron índices, reglas o datos.
- Puerta piloto: compatibilidad e índices reales, aprobación de cuentas, imágenes y
  actualización coordinada de clientes; detalles en la matriz.

- Limitación comprobada del emulador Storage: firebase-tools conserva un array de tokens
  separado cuando el SDK GCS elimina la clave de metadata. Se prueba que la finalización
  rechaza ese resultado, no que el emulador revoca el enlace. La aceptación de revocación
  real debe ensayarse en el bucket piloto. No se usa fallback público para ocultar el fallo.
- Backend Node 22 con lockfile propio. Instalación inicial reportó 9 avisos moderados;
  quedan dentro de D1 y no se desplegó el backend. CI ahora instala e importa Functions.

### R2 — Fechas y turnos de planta

- Zona IANA explícita; independencia de la zona configurada en la PC.
- Planta confirmó turno C con fecha de inicio a las 22:00, estable durante medianoche.
- Patrullas/muestras/paros nuevos versionan criterio; lecturas legacy compatibles sin reescritura.
- Capturas abiertas al relevo avisan antes de guardar; edición conserva identidad y turno.
- Informes diarios calendario e informes por turno con madrugada completa; 7 días exactos.
- Validación: 31 pruebas unitarias y 47 de reglas (78 total); build correcto.
- Commit inicial de zona: `7292f64`; complemento nocturno separado y reversible.
- Piloto pendiente: relevo real, índices compuestos y datos legacy ambiguos; R3 sigue a cargo de concurrencia y R4 de borradores/actualización.
- Detalles y límites de rollback: [FECHAS_TURNOS.md](FECHAS_TURNOS.md). Sin despliegue ni modificación de datos remotos.

### R4 — Corrección inicial del aviso repetido de actualización

- FCM se registra en `/firebase-messaging/`, separado del worker raíz `/sw.js`.
- Sin registro FCM válido no se permite que getToken cree otro worker raíz implícitamente.
- Avisos solo del worker de aplicación; la misma instancia pendiente se anuncia una vez por sesión.
- Actualización espera `activated`, con timeout/error; no borra cachés globales ni recarga tras 300 ms.
- Worker de aplicación espera confirmación para reemplazar un controlador existente; limpieza limitada a `cmms-cache-*`.
- Login libera sus listeners al desmontarse. Eliminado log del token FCM.
- Validación: 34 pruebas unitarias y build correctos. Pendiente prueba real de actualización y recepción FCM tras regenerar token con nuevo ámbito.
- El despliegue anterior conserva la lógica vieja hasta cargar esta versión. No se desplegó automáticamente.
- R4 completo sigue pendiente: borradores, sincronización y ensayo de múltiples pestañas/recuperación.

### Corrección de carga del catálogo

- Máquinas y catálogo tienen espera máxima de 15 segundos, error visible y reintento en escritorio y móvil.
- No se muestra un fallo de permisos/conexión como un catálogo vacío.
- Selección más reciente gana; respuestas pendientes se descartan al cambiar tipo/modelo o salir.
- Ordenamiento tolera campos legacy ausentes, nulos o numéricos.
- Validación: 38 pruebas unitarias; build de frontend. La causa concreta en el despliegue requiere modelo/rol y respuesta real de Firestore; no se modificaron permisos ni datos remotos.

### Diagnóstico del renderizado del catálogo

- Consola reportada: `index-CYgqgMnK.js`, error Vue `emitsOptions` durante parcheo con Teleport.
- Verificación de lectura el 10/10/2026: ambos sitios configurados sirven ese mismo bundle con Vue 3.5.30. La rama actual usa Vue 3.5.43; no se puede dar por desplegada una corrección solo porque se hizo push.
- Prueba del SFC real compilado con renderer Vue en memoria, iconos reales y servicios simulados: carga, datos, cambio de modelo y desmontaje con admin sin errores. No reproduce el fallo del navegador antiguo ni prueba DOM/extensiones/transiciones CSS.
- El rol admin depende del perfil Firestore y no del proveedor Gmail. No se inspeccionó ni cambió el perfil remoto de la cuenta del usuario.
- `node scripts/verify-hosting-release.mjs main` (o `legacy`) compara el bundle servido con dist/index.html; solo lectura, no despliega. Ejecutar después del build/despliegue correcto y antes de atribuir un fallo a caché del navegador.
- No afirmar que actualizar Vue corrige específicamente este stack sin reproducción. Pendiente verificar comando/carpeta de despliegue y repetir en cliente con build actual.

### Corrección comprobada de /maquinas (Teleport)

- Ruta confirmada por el usuario: `/maquinas` corresponde a GestionMaquinas, no a CatalogoExplorer.
- GestionMaquinas e HistoricoNovedades usan Teleport hacia `#navbar-actions`, eliminado/inexistente en App.vue. Se restaura antes de router-view, estable y visible en escritorio.
- Prueba del SFC real de GestionMaquinas con rol admin reproduce exactamente `Cannot read properties of null (reading emitsOptions)` al resolver máquinas sin destino de Teleport. Con el destino presente, carga y renderiza registros sin errores.
- 40 pruebas unitarias correctas. El renderer de prueba no valida CSS, extensiones ni navegador real; comprobar escritorio/tablet y navegación al salir en piloto.
- No cambia roles ni reglas. El perfil mostrado por el usuario es Administrador Global; TEJEDURIA no limita el alcance del rol admin.
- El sitio público debe recibir un nuevo build para incorporar la corrección; no se desplegó automáticamente.

### V1 — Primera vista: Gestión de Máquinas

- Tabla inicial, ancho completo sin max-width y alto ajustado al espacio del shell (sin restar 120 px).
- Identificación y nombre primero, estado de producción a continuación. ID fijo al desplazar horizontalmente; cabecera fija y paginación fuera del área de desplazamiento.
- Tipografía Inter/system de 13 px en tabla, filas de 45 px, separadores suaves y estados legibles sin bajar la opacidad de toda la fila.
- Cabecera única para escritorio y pantallas pequeñas; botones de 36 px, acción principal Agregar, catálogo secundario y exportaciones agrupadas.
- Tarjetas distribuidas por ancho disponible, acciones accesibles sin depender del hover; selector de 25/50/100 filas y mensaje al no encontrar resultados.
- Filtros tolerantes a datos legacy; búsqueda incluye ubicación. Cambio de tamaño de página reinicia la paginación y reducción de resultados limita la página actual.
- Prueba del componente real: carga, tabla, tarjetas, filtros vacíos, apertura del formulario y desmontaje, incluso sin portal de escritorio. No cambia reglas, roles ni datos remotos.
- Validación funcional: 40 pruebas unitarias; build de frontend. Advertencias de tamaño de bundles preexistentes permanecen en E1.
- Validación visual pendiente en 1920×1200, 1360×768, 1024×768 y 800×600: el navegador integrado no conecta con el servidor local (timeout). No considerar V1 aprobado visualmente hasta el ensayo del usuario.
- Patrón para siguientes vistas: padding 8/12/20 px según ancho, área de datos flex con min-height:0, desplazamiento interno, controles de 36 px y botones con icono más texto cuando haya espacio.
- Próximos bloques: aprobar esta vista; trasladar el patrón a históricos/órdenes; revisar formularios y paneles. R3 y recuperación ante cortes siguen pendientes antes de ampliar producción.
- Reversión: revertir únicamente el commit de V1, compilar y desplegar hosting:main; no requiere rollback de base de datos.

### V1 — Ajustes tras prueba en PC

- Corregida la reserva de 56 px para navegación móvil que se aplicaba también en escritorio; la reserva para vista previa de roles se mantiene cuando corresponde.
- En /maquinas, desde 768 px se usa navegación lateral compacta y se ocultan cabecera/barra rápida móviles. Otras vistas mantienen su comportamiento hasta adaptar sus portales.
- Exportar se cierra antes de ejecutar la descarga, al pulsar fuera y con Escape; Escape devuelve el foco al botón. Listeners liberados al salir de la vista.
- 40 pruebas correctas, incluyendo selección de exportación, cierre exterior y Escape. Validación visual del ajuste pendiente en las PC del usuario.

### V1 — Modal Ver catálogo

- Diálogo limitado al espacio de pantalla, con ancho máximo de 1440 px y alto máximo de 900 px.
- Tabla en panel interior con márgenes, borde y scroll propio en ambos ejes; cabecera, filtros y pie permanecen visibles. Se elimina el alto fijo de tabla de 384 px.
- Tipografía Inter/system, datos de 13 px, encabezados de 12 px, botones comunes de 36 px y controles de edición uniformes.
- Filtros con columnas flexibles que no ensanchan el modal; distribución reducida para pantallas pequeñas. Denominaciones extensas pueden partirse dentro de la celda.
- Prueba del componente real incluye apertura del catálogo, registro con texto extenso, edición/cancelación, filtros vacíos y cierre sin errores Vue. 40 pruebas correctas y build correcto.
- Ensayo visual pendiente en las resoluciones de planta; cambios de presentación, sin modificación de permisos o datos remotos.

### V1 — Distribución de columnas del catálogo

- Anchos definidos con colgroup y table-layout fixed para impedir que Denominación absorba el espacio de los códigos.
- Sección ocupa 22%; Grupo/Sub-G y Catálogo/Artículo tienen anchos propios. Sección y Denominación parten por palabras, códigos permanecen en una línea.
- Tabla de al menos 980 px, con desplazamiento horizontal dentro del modal en pantallas reducidas; edición respeta los anchos de celda.
- 40 pruebas correctas; ajuste visual pendiente de revisión en navegador del usuario.

### V1 — Anchos basados en datos reales

- Consulta de solo lectura a Firestore: 1.674 registros de 12 modelos. Máximos por columna/modelo en [CATALOGO_COLUMNAS.md](CATALOGO_COLUMNAS.md).
- Distribución calculada con el ancho del texto de todos los registros cargados del modelo; cache de mediciones y actualización al completar la carga de fuentes.
- Los filtros no alteran los anchos; códigos completos, descripciones limitadas para permitir varias líneas, espacio sobrante proporcional y acciones de 104 px.
- 42 pruebas correctas y build correcto. Pendiente validación visual por el usuario; sin escrituras en Firestore.
