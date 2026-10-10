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
| R2 | Fechas y turnos de planta | En curso; zona y límites verificados, criterio nocturno pendiente | Zona explícita; criterio nocturno; límites horarios probados; compatibilidad con historial |
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
