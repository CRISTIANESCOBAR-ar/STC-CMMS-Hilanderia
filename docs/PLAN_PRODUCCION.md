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

### V1 — Corrección de quiebres persistentes

- Eliminados los límites de ancho de Sección, Grupo y Sub-G; se dimensionan con todo el texto y permanecen en una línea.
- Solo Denominación permite envolver texto, con ancho base máximo de 320 px.
- Porcentajes simples en colgroup que suman 100%, reemplazando calc() y sus anchos mixtos; acciones participa del reparto proporcional.
- 43 pruebas correctas; pendiente revisión visual en navegador tras publicar.

### V1 — Procedimientos

- Acción en catálogo: libro índigo cuando hay pasos; símbolo + atenuado y borde discontinuo cuando no hay procedimiento. Tooltip y nombre accesible explican ambos estados; agregar permanece habilitado.
- Modal Procedimiento unificado con catálogo: tipografía, botones de 36 px, cabecera y pie fijos, alto/ancho acotados, scroll interior, tarjetas numeradas e imágenes contenidas.
- Acciones de eliminar paso/quitar imagen y campos con nombres accesibles; adjuntar imagen admite foco de teclado.
- Prueba real cubre procedimiento vacío, agregar/eliminar paso, abrir con texto e imagen y cancelar sin modificar el registro cargado. 43 pruebas correctas; validación visual pendiente en PC.

### V2 — Shift Report: primera planilla desktop

- Criterio para próximas vistas rediseñadas: usar Tippy para ayudas contextuales, sin atributos HTML title. Directiva reutilizable en src/utils/tooltipDirective.js: contenido de texto, estilo light-border, instancia bajo demanda y limpieza al desmontar; nombres accesibles se mantienen separados del tooltip.

- Desde 768 px: tabla con una fila por telar, grupos A/B/C y Pts, Rot T, Rot U, Rot O, RPM. Cabecera y Telar fijos, ancho completo y scroll interior. En pantallas menores se conserva carga por tarjeta.
- Pts en miles: 261 representa 261.000 picks. Entrada manual de tres dígitos, sin multiplicar el valor en el TXT existente.
- Avance automático: Pts y RPM al tercer dígito; roturas al segundo (límites existentes). Continúa al campo siguiente incluso si ya tiene valor; importados se omiten al avanzar automáticamente. Último campo lleva a Guardar.
- Enter y flechas izquierda/derecha navegan campos en horizontal; arriba/abajo recorren la columna en desktop. Al terminar una fila, Enter avanza al primer campo de la siguiente. Tab/Shift+Tab conservan navegación nativa. Cada foco selecciona todo el valor; comportamiento de selección y flechas disponible también en la tarjeta móvil.
- Borradores en memoria separados mediante baseline por registro; snapshots conservan registros editados. Cambios pendientes visibles, guardar explícito y descartar para recuperar los datos remotos recibidos.
- Guardado transaccional atómico de registros editados: compara baseline con el servidor y rechaza conflictos sobre el mismo telar/turno sin escritura parcial. Crear reportes simultáneamente conserva registros independientes.
- Cambiar fecha/importar/exportar exige resolver cambios pendientes. Navegar fuera confirma descarte y cerrar/recargar advierte; no hay recuperación automática de borradores después de cerrar el navegador todavía.
- Importados de CSV siguen en solo lectura. TXT conserva columnas, tabulaciones, orden, nombre y valores anteriores; el generador no fue modificado.
- Pruebas: componente Vue real para salto/selección, snapshots y fallos de guardado; emuladores para concurrencia/atomicidad; regresión del TXT. Validación visual pendiente en PC y ensayo real desktop+móvil antes de ampliar producción.
- Pendientes siguientes: pegar bloques de Excel, corrección explícita de importados, validación de completitud para exportación, comparación de archivo con importador real y ensayo de 10–30 usuarios.
- El rollback de este bloque no requiere migración de datos ni reglas nuevas; solo revertir el commit, compilar y desplegar hosting:main.
- Validación final de V2: 48 pruebas unitarias y 49 de reglas/transacciones (97 total); build correcto. Se conservan alertas visuales existentes de Trama >10 y Urdimbre >5 también en la planilla.
- Entrada con ceros iniciales preservada durante la carga (001/000): permite completar los tres dígitos para el salto, manteniendo el valor numérico 1/0 en los registros y TXT.

### V3 — Reportar Falla en desktop

- Formulario y tabla lado a lado desde 981 px; formulario de 320 px en PC de 1024 px. Entre 768 y 980 px el formulario conserva 320 px de ancho a la izquierda; los eventos se muestran como tarjetas a la derecha, con scroll independiente. Ambos paneles permanecen visibles, sin pestañas ni expansión del formulario. Mobile conserva su formulario y barra de acciones.
- En desktop las acciones de carga están dentro del formulario. Categoría con texto, botones y fuentes uniformes, tooltips Tippy claros; detalle de evento con descripción completa, foto, foco de teclado y cierre con Escape.
- Consulta por sector autorizado, turno actual por defecto, Hoy, últimos 7 días, pendientes anteriores o rango personalizado de hasta 31 días. El calendario respeta la fecha de planta y el turno C conserva el día de inicio.
- Páginas de 50 mediante cursor; primera página en tiempo real, páginas adicionales bajo demanda. Cambios en la primera página reinician las adicionales para no conservar filas obsoletas ni cursors inconsistentes.
- Mecánico/Eléctrico y Estado filtran en servidor; orden ascendente por ingreso o descendente. Búsqueda textual y Otras/sin categoría filtran filas cargadas, indicado en el pie. Categorías nuevas de carga siguen pendientes de definición funcional.
- Guardado mantiene borrador ante fallo, bloquea envíos simultáneos y edición durante subida, actualiza la tabla al confirmar, advierte al salir/recargar con datos pendientes. La tabla no altera los campos del reporte.
- Índices agregados para consultas globales por estado y combinaciones de categoría/estado/sector con fecha en ambos órdenes. No cambian documentos, reglas ni Functions. Rollback: revertir commit y desplegar Hosting; los índices adicionales pueden permanecer.
- Pruebas de ventanas nocturnas/rangos, filtros, render de componentes Vue reales, actualizaciones/páginas atrasadas, error de guardado/envío doble y alcance de consultas en emuladores. Pendiente aprobación visual en 1920×1200, 1360×768, 1024×768 y 800×600 y ensayo de carga de 10–30 usuarios.

### V4 — Solicitar intervención (/llamar)

- Formulario siempre visible junto al panel de solicitudes: 320 px hasta 1200 px de pantalla, ancho de 350–390 px en pantallas amplias. Tarjetas de eventos entre 768–980 px y tabla en anchos mayores; scroll independiente, sin pestañas ni expansión del formulario. Mobile conserva la carga y barra inferior.
- Acciones integradas dentro del formulario en desktop, Observaciones aprovecha el alto disponible, categorías con botones de fondo claro y texto/íconos consistentes, estado de máquina y criticidad visibles, tooltips Tippy y nombres accesibles.
- Panel y consultas de eventos reutilizados mediante configuración explícita faults/interventions. /llamar lee intervenciones y usa MECANICO/ELECTRICO/CALIDAD, PENDIENTE/EN_PROCESO/COMPLETADO; no altera los documentos ni los estados existentes de novedades. Filtros de categoría/estado en servidor, alcance por sector, turno/fechas, calendario personalizado, orden y cursor de 50 filas.
- Detalle de solicitud con foto, descripción, estado de máquina, asignado y Grupo/GM. La gestión de tomar/cerrar órdenes sigue en su vista existente.
- Guardado bloquea envíos repetidos y edición durante subida; preserva datos ante error; PARADA fuerza criticidad en el payload. Precarga desde Patrulla/Roturas y retorno conservados. Navegación/cierre advierten sobre solicitudes sin enviar.
- Desktop confirma en una franja con acción manual Compartir, sin diálogo obligatorio por cada envío. Mobile mantiene su diálogo. Un fallo al compartir se distingue del guardado confirmado; no se vuelve a registrar la solicitud.
- Diez índices adicionales para filtros globales y combinados de intervenciones; no se despliegan reglas, Functions ni migraciones. Rollback: revertir los commits y desplegar Hosting; índices aditivos pueden permanecer.
- Validación: 58 pruebas unitarias/componentes y 51 en emuladores (109 total), build correcto. Pendiente revisión visual real y ensayo de 10–30 usuarios antes de declarar preparación completa para producción.

### V5 — Gestión de intervenciones (/intervenciones)

- Tabla desde 981 px, con ancho completo y scroll vertical dentro del espacio disponible. Tarjetas en dos columnas entre 768 y 980 px; mobile conserva la agrupación y acciones existentes.
- Prioridad y grupos por máquina conservados. Tabla con número corto, categoría, estado de máquina y solicitud, descripción, asignado/solicitante, antigüedad y acciones. Detalle y diagnóstico se abren en la ruta existente.
- Filtros de categoría, sector permitido, asignadas a mí/sin asignar y búsqueda sin distinción de acentos sobre la suscripción actual. Las cerradas siguen limitadas a las últimas 24 horas en el resultado del servicio.
- Tomar grupo selecciona únicamente las solicitudes que el usuario puede ejecutar; acciones bloqueadas mientras se procesa una escritura. Confirmación con texto seguro. Error de carga con reintento y protección contra callbacks de suscripciones anteriores.
- La consulta existente por sector sigue leyendo documentos del sector antes de filtrar cerradas en cliente; queda pendiente acotar esa lectura en servidor como bloque de rendimiento, sin confundirlo con paginación ya implementada en /llamar.
- Prueba del componente Vue real: filtros, agrupación, permisos mixtos, envío duplicado, error/reintento y respuesta atrasada. No cambian reglas, índices ni estructura de documentos. Rollback mediante revert del commit y despliegue de Hosting.
- Pendiente revisión visual del usuario en las resoluciones de planta. Patrulla se posterga hasta disponer del registro del inspector.

### V6 — Intervenciones por especialidad

- Selector Tabla / Por especialidad con preferencia local al navegador; Tabla es inicial. Usa la misma suscripción y acciones, sin duplicar lecturas al cambiar presentación.
- Tres columnas Mecánico, Eléctrico y Calidad desde 981 px, con scroll independiente y tarjetas agrupadas por máquina, ordenadas por prioridad dentro de cada especialidad. Estilo compacto entre 981 y 1199 px. Categorías antiguas no reconocidas se muestran en una sección adicional, sin ocultar solicitudes.
- Por debajo de 981 px, selector de especialidad con cantidades y una columna visible; aprovecha el espacio sin comprimir tres tarjetas lado a lado. Los filtros comunes de estado, sector, asignación y búsqueda se conservan; el filtro de categoría solo aplica a Tabla y conserva su selección al volver.
- Las tarjetas muestran número corto de máquina, prioridad, estado, síntoma, observaciones resumidas, asignado, antigüedad y foto disponible; Detalle abre la descripción completa en la ruta existente. Tomar grupo se limita a la máquina y especialidad visibles, respetando permisos.
- Prueba del componente real ampliada para verificar distribución por especialidad, persistencia, reutilización de suscripción, conservación del filtro y recuperación de categorías antiguas. Pendiente aprobación visual del usuario; rollback mediante revert y Hosting.

### V7 — Tablas por especialidad y detalle modal

- Las columnas por especialidad muestran tablas compactas de máquina, prioridad, síntoma/estado y acceso al detalle; conservan agrupación, filtros, permisos y selección de especialidad en anchos pequeños. La tabla general permanece disponible.
- Detalle abre un modal sobre la lista, sin cambiar de ruta ni perder filtros. La URL directa /intervenciones/:id utiliza el mismo componente y vuelve a la lista al cerrar.
- Solicitud, metadatos y foto a la izquierda; diagnóstico, tiempos, catálogo y procedimiento a la derecha. En pantallas de hasta 800 px se ordenan verticalmente, con scroll interno y acciones al pie.
- Se mantienen Tomar, guardar diagnóstico y completar, condicionadas al estado, permisos y usuario asignado. Bloqueo de acciones repetidas, datos conservados ante error, advertencia de cambios pendientes al cerrar/salir y protección del borrador frente a snapshots.
- Carga con error y reintento, estados de documento no encontrado, catálogo con reintento. Foto ampliable, procedimiento contenido, foco inicial/retorno al botón de origen, recorrido de teclado y Escape; fondo de la lista inerte mientras se consulta el detalle.
- Prueba del componente real para edición vacía frente a snapshots, guardado fallido, clic duplicado, cierre pendiente, guardado confirmado, solo lectura y documento inexistente. Pendiente aprobación visual en las PC de planta; rollback con revert y Hosting, sin migraciones ni cambios de reglas.

### V8 — Histórico de novedades (/historico)

- Tabla a todo el ancho/alto disponible, con encabezado fijo y filas compactas. Número corto de máquina, lado junto al tipo/sector, categoría, reporte resumido, estado y detalle. Tabla compacta desde 768 px; mobile permite desplazamiento horizontal para mantener la lectura de columnas.
- Filtros locales uniformes y Tippy claro: período inicial últimos 7 días, Hoy o rango de hasta 31 días con calendarios personalizados; sector autorizado, estado y categoría. Se reutiliza la consulta de eventos, descendente, con cursor y páginas de 50; no se descarga el historial completo al entrar. Búsqueda sin acentos y Otras/sin categoría filtran los registros cargados, indicado en la interfaz.
- Detalle modal con descripción completa, reportante, criticidad, punto de control, subgrupo, catálogo/artículo y foto ampliable. Conserva filtros y posición de tabla; foco, Escape y fondo inerte.
- Administración puede cambiar estado con confirmación, timestamp de servidor y transacción que verifica el estado previo; no sobrescribe un cambio concurrente. Errores conservan el detalle y bloquean acciones repetidas; usuarios operativos mantienen consulta. Se validaron las reglas existentes, sin modificarlas.
- Exportación distingue registros cargados y todo el período filtrado. La segunda recorre todas las páginas; ambas aplican los filtros capturados, preservan identificador completo, metadatos y textos completos. Si cambian filtros/perfil durante la generación se cancela la descarga. ExcelJS se carga bajo demanda.
- IA se consulta explícitamente desde un modal, por día y sectores seleccionados; no aplica búsqueda/estado/categoría, indicado junto al análisis. Seleccionar fechas no genera solicitudes automáticamente. Respuestas antiguas se descartan y el contenido HTML se escapa con el formateador compartido; copiar/regenerar son acciones manuales.
- Validación: 62 pruebas unitarias/componentes y 52 de emuladores (114 total), exportación real reabierta y verificada, índices existentes de novedades listos y ocho consultas de producción verificadas en solo lectura. Pendiente aprobación visual y ensayo de carga de 10–30 usuarios. Rollback con revert y despliegue de Hosting; no requiere migración ni índices adicionales.
### V9 — Catálogo de síntomas (/sintomas)

- Tabla a todo el ancho y alto disponible desde 768 px, encabezado fijo, columnas compactas, descripción con salto de línea y acciones homogéneas. Tarjetas opcionales conservan edición, eliminación y orden; mobile mantiene tabla desplazable o tarjetas. Se suma /sintomas al marco desktop para evitar navegación mobile en PC de 800×600.
- Barra compacta con sector, máquina, búsqueda sin acentos, categoría, derivación y estado. Tippy claro en las acciones, indicador discreto de destacado/activo, recuento al pie y error con reintento. Consulta limitada al sector/tipo seleccionado, descartando respuestas antiguas.
- Nuevo/Editar en modal con descripción ampliada, guardado explícito de todos los campos, bloqueo de clics duplicados, borrador conservado ante error, confirmación para descartar, protección al salir, foco y teclado. Reemplaza el autoguardado que cancelaba cambios de otros campos durante el mismo intervalo.
- Edición mantiene los IDs vinculados a reportes existentes; creación transaccional rechaza IDs duplicados. Edición/eliminación comparan campos con el estado leído para impedir sobreescrituras concurrentes. Ordenamiento transaccional normaliza números repetidos/ausentes y comprueba el orden previo; se habilita sin filtros. Permisos admin en interfaz, servicio y reglas existentes.
- Exportación XLSX de los registros visibles, incluyendo textos e IDs completos, encabezado congelado y autofiltro. ExcelJS bajo demanda. Sin migraciones, modificaciones de reglas ni datos de producción durante las pruebas.
- Validación: 64 pruebas unitarias/componentes y 53 de emuladores (117 en total); consultas de producción por TEJEDURIA/TELAR y cuatro tipos de HILANDERIA verificadas en solo lectura. Pruebas de emuladores para consulta y transacciones de admin y rechazo de escrituras operativas. Pendiente revisión visual del usuario en planta.
- Reversión: git revert del commit de este bloque, compilación y despliegue de Hosting main. No modifica el formato de documentos ni requiere restaurar datos para revertir la presentación.

### V10 — Administración de rutas de patrulla (/rondas)

- Se elimina el ancho máximo de 768 px: tabla inicial a todo el ancho/alto, encabezado fijo, búsqueda, filtros de sector/tipo/estado y recuento. Se incluye /rondas en el marco desktop desde 768 px para PC de 800×600.
- Al editar, lista lateral y editor ocupan el espacio restante. Configuración compacta arriba y mapa/lista de disponibles junto a secuencia en pantalla amplia; por debajo de 1200 px se apilan dentro del editor. Guardar, Volver y Eliminar al pie, sin desaparecer al reducir la pantalla. Mobile apila lista y editor.
- Mapa original de 8×10 conservado, números cortos en cada posición y código completo en Tippy claro. Celdas expanden con el alto disponible, con estados disponible/en ruta/sin máquina. Hilandería conserva códigos completos y suma búsqueda entre máquinas disponibles. Secuencia en tabla con encabezado fijo y desplazamiento interno.
- Corrección del orden de máquinas: intercambia la posición real del array y renumera antes de guardar; anteriormente podía volver al orden previo al persistir. No permite duplicar máquinas ni modificar el formulario durante guardado. Conserva IDs de rutas, campos y reglas existentes, incluyendo obligatoriedad y selección por defecto.
- Confirmación al descartar borrador, cambiar de ruta o sector; protección al salir/recargar y bloqueo de clics duplicados. Errores de carga con reintento y fallos de guardado conservan editor. Si se crea una ruta y falla un paso posterior, retiene su ID para no crear otra al reintentar.
- Validación: 69 pruebas unitarias/componentes y compilación de producción. Se verifican filtros, orden persistido, borrador fallido, descarte cancelado, cambio de sector, exclusión de máquinas inactivas, clic duplicado y reintento sin duplicar la ruta. Pendiente revisión visual en las resoluciones de planta. Sin migraciones ni cambios de reglas; el guardado de obligatoriedad conserva la secuencia de escrituras existente.
- Reversión mediante git revert del commit de este bloque y despliegue de Hosting main.

### V11 — Operarios de Tejeduría (/operarios)

- Se elimina el ancho máximo: tabla de horarios utiliza el espacio disponible, encabezado fijo y desplazamiento interno. Barra compacta con calendario personalizado, navegación de fechas, turnos A/B/C, búsqueda sin acentos, pertenencia al turno y selector tabla/tarjetas. Columnas reducen ancho y padding en PC menores; mobile conserva tarjetas o tabla desplazable.
- Se agrega /operarios al marco desktop desde 768 px. Tarjetas distribuidas según ancho con cuatro horarios legibles, sin truncar nombres. Estados de asignado, otro turno y no registrado mantienen identificación por texto, borde y badges discretos. Botones uniformes y Tippy claro; fecha del turno C sigue siendo el día de inicio.
- Gestión del maestro en modal amplio con tabla de encabezado fijo, filtros de turno/búsqueda y formulario para agregar o editar nombre, puesto y turno. Mantiene legajos al editar. Cierre/descarte confirmado, foco/teclado y protección de borradores; formulario se conserva si falla el guardado. Maestro limitado a admin, de acuerdo con las reglas existentes; la carga de horarios conserva permisos de producción para Tejeduría.
- Carga con error/reintento y protección frente a respuestas antiguas. OCR espera una sola carga coherente del día/turno detectados antes de aplicar horarios; bloquea cambios de contexto durante procesamiento. Valida fecha/horas de lectura y escapa nombres en confirmación. No muestra éxito si falla Firestore: retiene lectura con Guardar/Descartar y protege la salida/recarga mientras está pendiente.
- Limpiar horarios requiere confirmación y restaura los datos visibles ante error. Alta/baja/edición del maestro actualiza la lista local tras guardar, no antes; convertir un extra en asignado no duplica su fila y conserva sus horarios.
- Validación: 71 pruebas unitarias/componentes y 54 en emuladores (125 total), compilación de producción. Verificados permisos de maestro/horarios y vaciado real del mapa de horarios; no se enviaron imágenes ni datos operativos a IA durante pruebas. Pendiente revisión visual en planta. No cambia reglas ni formato de documentos; la escritura de maestro mantiene el documento compartido existente, por lo que su edición simultánea sigue siendo un punto a reforzar antes de producción general.
- Reversión mediante git revert del commit de este bloque y despliegue de Hosting main.

### V12 — Paros y anudados (/paros-anudado)

- Se elimina el ancho máximo y la duplicación desktop de tarjetas más tabla. Una presentación seleccionable ocupa todo el ancho/alto: tabla inicial de encabezado fijo y desplazamiento interno o tarjetas distribuidas según resolución. Se incluye la ruta en el marco desktop desde 768 px.
- Barra compacta con calendario personalizado, días anterior/siguiente, turno actual informativo y filtros de turno/código/estado. Búsqueda por telar corto o completo, artículo, color, partida, plegador y personal. Indicadores en línea representan totales del día, separados de los filtros locales; Tippy claro explica su alcance.
- Tabla agrupa los tres horarios, artículo/color, partida/plegador y personal para evitar columnas excesivas. Conserva telar corto, código 101/102, turno, duración, hilos cruzados, anudadores, revisor y supervisor. Columnas/padding reducen en PC pequeñas; mobile permite tarjetas o tabla desplazable.
- Nuevo/Editar en modal de dos secciones, apiladas en mobile; scroll del cuerpo con acciones al pie. Se mantienen normalización de partida, saltos automáticos de horas/artículo/color/plegador/legajos, duración cruzando medianoche y turno C del día de inicio. El salto selecciona el destino para facilitar reemplazo. Horas incompletas o inválidas no reutilizan silenciosamente el valor anterior.
- Borrador conservado ante fallo, confirmación para descartar, bloqueo de envíos repetidos y salida/recarga durante guardado, foco/teclado/Escape y fondo inerte. Consulta sin permisos de escritura abre detalle de solo lectura; eliminar permanece limitado a admin. Edición de registros nocturnos conserva fechaDocumento y turno originales.
- Suscripción con error/reintento, limpieza de listeners y descarte de respuestas antiguas al cambiar fecha. Se agrega callback de error opcional al servicio sin cambiar consultas ni su normalización de registros legacy.
- Validación: 73 pruebas unitarias/componentes y compilación de producción. Verificados filtros, suma de duraciones legacy, horas inválidas, guardado fallido/duplicado, documento de turno C, consulta sin escritura y errores/limpieza de suscripción. Pendiente revisión visual en planta. Sin cambios de reglas, índices o formato de documentos.
- Reversión mediante git revert del commit de este bloque y despliegue de Hosting main.

### V13 — Administración de usuarios (/usuarios)

- Lista de usuarios en tabla a todo el ancho/alto, encabezado fijo, búsqueda sin acentos y filtros de rol/sector. Muestra identidad/correo, rol, sector principal/asignados/a cargo, alcance y acceso personalizado. Se agrega al marco desktop desde 768 px; mobile conserva tabla desplazable sin ocultar datos.
- Se elimina la duplicación de editor desktop/drawer móvil: un modal completo para todas las resoluciones, con cuerpo de desplazamiento y acciones al pie. Conserva nombre/apellido, rol, sectores, alcance, jefatura, vistas y permisos personalizados. En pantalla amplia distribuye secciones en dos columnas; en anchos menores se apilan.
- El borrador se copia separado de la lista y solo actualiza la fila tras confirmar Firestore. Error conserva edición, bloqueo de clics repetidos y controles durante guardado, descarte confirmado al cerrar/salir, protección al recargar y foco/teclado/Escape. No se cambian los campos persistidos ni las reglas de autorización.
- Pestañas Usuarios/Perfiles de Rol/Configuración compactas. Tablas de perfiles mantienen descripciones completas y Tippy claro; paneles de configuración ocupan el ancho en dos columnas o se apilan. Radios y tipografía unificados, textos pequeños reforzados, botones y controles adaptados al patrón usado en otras vistas.
- Consulta de usuarios incluye documentos sin createdAt y ordena las fechas existentes localmente, evitando omisiones de cuentas legacy. Un rol ausente se presenta como pendiente, sin asumir acceso operativo. Fallo de carga/configuración muestra reintento y bloquea edición de valores incompletos; no se escribieron perfiles ni permisos de producción durante las pruebas.
- Validación: 74 pruebas unitarias/componentes y compilación de producción. El componente real verifica las tres pestañas, filtros, documentos legacy, aislamiento de borrador, descarte cancelado, error/éxito de guardado, rechazo de escritura no admin y reintento de carga. Pendiente revisión visual en planta. Guardado automático de perfiles/configuración conserva su comportamiento existente; endurecimiento de sus escrituras concurrentes y administración de roles/sectores dinámicos queda pendiente del bloque de preparación de producción.
- Reversión mediante git revert del commit de este bloque y despliegue de Hosting main.

### V14 — Perfil y simulación de accesos unificados

- Un solo botón inferior en sidebar abre Mi perfil y vista previa para administración; otros usuarios consultan Mi perfil. Elimina el botón/dropdown de simulación separado y reutiliza el panel también en menú móvil.
- Panel con identidad de la sesión real, selector de rol y sector, vistas habilitadas y permisos efectivos del rol según configuración. Permite iniciar/cambiar simulación y volver a administrador. Tippy claro, foco, teclado/Escape y fondo inerte.
- Durante simulación, rol, sector principal/asignados/jefatura y alcance del perfil en memoria corresponden a la selección. No hereda vistas ni permisos personalizados de la cuenta admin. Se restaura su perfil completo al salir y se revierte el cambio si una navegación se cancela por borrador pendiente.
- Indicador inferior compacto muestra rol/sector activos y acceso a Cambiar/Salir. Mantiene altura reservada de 40 px. Nueva sesión/cierre de sesión invalida la copia admin; una navegación tardía no puede restaurarla después de logout o cambio de identidad.
- Alcance explícito del panel: simula interfaz, menús y consultas por sector; Firebase mantiene autenticación de administrador y acciones habilitadas usan datos reales. No valida reglas del servidor como un usuario real ni crea una cuenta de prueba. No se modifican perfiles persistidos.
- Validación: 76 pruebas unitarias/componentes y compilación de producción. Configuración efectiva visible, autorización de simulación, sectores, eliminación de overrides admin, restauración al salir/cancelar y ausencia de restauración tras logout. Pendiente revisión visual del panel en planta.
- Reversión mediante git revert del commit de este bloque y despliegue de Hosting main.
