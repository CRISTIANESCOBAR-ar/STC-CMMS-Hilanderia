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
| S2 | Protección de perfiles | Pendiente | Creación sin privilegios; roles/sectores protegidos; emulador; login compatible |
| S3 | Permisos operativos y Storage | Pendiente | Matriz rol/sector/operación; datos y consultas compatibles; pruebas positivas/negativas |
| R1 | Sesión y configuración | Pendiente | Error de perfil no concede acceso; recuperación visible; lectura de configuración no escribe |
| R2 | Fechas y turnos de planta | Pendiente | Zona explícita; criterio nocturno; límites horarios probados; compatibilidad con historial |
| R3 | Concurrencia y trazabilidad | Pendiente | Sin doble toma de orden; transiciones válidas; actor y fecha registrados |
| R4 | Borradores, sincronización y PWA | Pendiente | Captura recuperable ante recarga/red caída; estado visible; actualización coherente |
| E1 | Consultas y rendimiento | Pendiente | Paginación real; listeners acotados; mediciones con volumen representativo |
| O1 | Operación y liberación | Pendiente | CI; entorno de prueba; monitoreo/alertas; backup/restauración y rollback ensayados |
| V1 | Sistema visual y navegación | Pendiente | Componentes compartidos y problemas críticos siempre visibles |
| V2 | Modernización de vistas | Pendiente | Cada vista validada en resoluciones de planta, zoom y teclado |
| G1 | Salida de beta | Pendiente | Piloto por roles; carga representativa; cero incidencias críticas; recuperación ensayada |

## Diseño posterior

- Moderno y minimalista, con prioridades y estados legibles sin depender solo del color.
- Mantener visibles sector, turno, filtros activos, problemas críticos y pendientes.
- Aprovechar el ancho con paneles/tablas adaptables, sin agrandar espacios vacíos.
- Matriz inicial: 1280×720, 1366×768, 1600×900 y 1920×1080; agregar resoluciones reales.
- Verificar zoom 125%/150% y conservar captura móvil.
- Orden: panel de control, intervenciones, reporte de falla, patrulla/seguimiento;
  luego informes, operarios, eficiencia y administración. Una entrega por vista.

## Puertas de producción

1. Permisos por rol, sector y operación probados; sin escalamiento de privilegios.
2. Login, reporte con foto, asignación/cierre, patrulla y relevo funcionan en piloto.
3. Desconexión, recarga, operadores simultáneos y turno nocturno probados.
4. Medir carga/guardado, errores y consumo con usuarios y datos representativos.
5. Definir concurrencia esperada y objetivos de disponibilidad, recuperación y pérdida de datos.
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
