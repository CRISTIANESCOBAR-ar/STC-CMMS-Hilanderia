# Checklist de pruebas — Patrulla y toma de puntos (redeploy junio 2026)

**Módulos críticos:** Patrulla de Calidad (`/patrulla`) · Toma de puntos en rondas R2, R4 y R5 (Paros/Defectos)  
**Rama de seguridad:** `feat/seguridad-gemini-jun2026` (reglas Firestore Fase 1)  
**Referencia operativa:** `docs/INSTRUCTIVO_PATRULLA_CALIDAD.md`

---

## Antes de empezar

| # | Verificación | OK |
|---|--------------|:--:|
| 0.1 | Usuario **inspector** de Tejeduría con `sectorDefault` / `sectoresAsignados` correctos | ☐ |
| 0.2 | Usuario **supervisor** (o jefe) para pruebas de solo lectura y cobertura | ☐ |
| 0.3 | Catálogo `maquinas`: telares activos con `orden_patrulla` y `grp_tear` poblados | ☐ |
| 0.4 | Al menos una **ruta de patrulla** en `rutas_patrulla` (admin → Rutas de Ronda) | ☐ |
| 0.5 | Códigos de defectos/paradas activos si se usan badges en ronda | ☐ |
| 0.6 | Dispositivo de prueba: celular Android + red Wi‑Fi planta (y una prueba en 4G) | ☐ |
| 0.7 | Tras deploy de reglas: sin errores `permission-denied` en consola al abrir patrulla | ☐ |

**Rollback si fallan reglas:** ver `docs/DESPLIEGUE_REVERSIBLE.md` → sección Firestore.

---

## Bloque A — Acceso y hub (`/patrulla`)

### A.1 Inspector (operador principal)

| # | Prueba | Resultado esperado | OK |
|---|--------|-------------------|:--:|
| A.1.1 | Login → menú → **Patrulla de Calidad** | Carga hub sin error | ☐ |
| A.1.2 | Primera entrada del turno | Se crea o recupera patrulla `en_curso` con fecha/turno correctos | ☐ |
| A.1.3 | Header: turno, nombre inspector | Coincide con usuario y hora local (A/B/C) | ☐ |
| A.1.4 | Timeline: **R1 desbloqueada**, R2–R7 con candado (salvo progreso previo) | Secuencia visual correcta | ☐ |
| A.1.5 | Recargar página (F5) en hub | Patrulla y progreso de rondas persisten | ☐ |
| A.1.6 | Cerrar app y reabrir (PWA) | Misma patrulla activa del día/turno | ☐ |

### A.2 Supervisor / jefe (observador)

| # | Prueba | Resultado esperado | OK |
|---|--------|-------------------|:--:|
| A.2.1 | Ingreso a `/patrulla` | Ve patrulla(s) del turno; **no puede editar** sin cobertura | ☐ |
| A.2.2 | Selector de inspector (si hay 2+ activos) | Cambia datos al seleccionar otra patrulla | ☐ |
| A.2.3 | `/patrulla-seguimiento` (vista global) | Lista coherente con turno actual | ☐ |
| A.2.4 | `/patrulla-historial` | Patrullas cerradas en solo lectura | ☐ |

---

## Bloque B — Toma de puntos (R2, R4, R5) — **prioridad junio**

Rutas: `/patrulla/paro2` · `/patrulla/paro4` · `/patrulla/paro5`  
Componente: `RegistroParoDefecto.vue`

### B.1 Carga y recorrido

| # | Prueba | Resultado esperado | OK |
|---|--------|-------------------|:--:|
| B.1.1 | Entrar a **R2** desde hub (R1 completada o en piloto forzado) | Listado de telares carga en &lt; 10 s | ☐ |
| B.1.2 | Barra resumen: contador **N/total**, badges trabajando/paros | Actualizan al registrar | ☐ |
| B.1.3 | Selector **Ruta de patrulla** | Filtra y ordena telares según ruta Firestore | ☐ |
| B.1.4 | Selector **Grupo** (`grp_tear`) | Filtra subconjunto correcto | ☐ |
| B.1.5 | Punto gris en fila sin registrar | Visible antes de tocar | ☐ |

### B.2 Registro por telar (toma de punto)

| # | Prueba | Resultado esperado | OK |
|---|--------|-------------------|:--:|
| B.2.1 | Tocar fila → expandir tarjeta | Muestra grilla «¿Cómo está?» | ☐ |
| B.2.2 | Estado **Trabajando** → «Listo — Siguiente» | Guarda, punto verde, avanza al siguiente telar | ☐ |
| B.2.3 | Estado **Paro mecánico** + observación | Guarda; badge naranja; campo observación visible | ☐ |
| B.2.4 | **Paro eléctrico** | Igual flujo; tipo distinto en badge | ☐ |
| B.2.5 | **Paro calidad** → elegir defecto de trama | Sub-badge rosa en fila del listado | ☐ |
| B.2.6 | Scroll automático al siguiente sin registrar | Funciona en 5+ telares seguidos | ☐ |
| B.2.7 | Volver a un telar ya registrado | Permite corregir estado (modo edición inspector) | ☐ |

### B.3 Auto-guardado y persistencia

| # | Prueba | Resultado esperado | OK |
|---|--------|-------------------|:--:|
| B.3.1 | Registrar 10 telares y **recargar** la página en mitad de ronda | Datos parciales restaurados (`ultimoGuardado`) | ☐ |
| B.3.2 | Indicador de guardado (nube / guardando) | Aparece sin bloquear UI | ☐ |
| B.3.3 | Completar **todos** los telares de la ruta | Botón **Completar ronda** habilitado | ☐ |
| B.3.4 | Completar R2 → volver al hub | R2 ✓ Hecha + hora; **R3 desbloqueada** | ☐ |
| B.3.5 | Repetir flujo en **R4** y **R5** (misma patrulla) | Tres rondas independientes en `patrullas/{id}.rondas` | ☐ |

### B.4 Intervención desde paro (integración crítica)

| # | Prueba | Resultado esperado | OK |
|---|--------|-------------------|:--:|
| B.4.1 | Paro mecánico → **Solicitar intervención** | Navega a `/llamar` con telar precargado | ☐ |
| B.4.2 | Enviar intervención | Vuelve a ronda; banner en tarjeta del telar | ☐ |
| B.4.3 | Punto naranja superpuesto en listado | Visible en fila del telar | ☐ |
| B.4.4 | Intervención visible en `/intervenciones` | Estado PENDIENTE/EN_PROCESO según flujo | ☐ |
| B.4.5 | Completar ronda con intervención pendiente | Ronda se cierra igual; datos de intv. en documento patrulla | ☐ |

### B.5 Reglas Firestore (post-deploy seguridad)

| # | Prueba | Resultado esperado | OK |
|---|--------|-------------------|:--:|
| B.5.1 | Inspector: `update` en `patrullas/{id}` durante toma de puntos | Sin `permission-denied` | ☐ |
| B.5.2 | Inspector: lectura `maquinas`, `rutas_patrulla`, `sintomas` | Listado completo | ☐ |
| B.5.3 | Usuario sin login | No accede a `/patrulla` (redirect login) | ☐ |
| B.5.4 | Rol mecánico (no inspector): acceso según `vistasPersonalizadas` | Coherente con configuración | ☐ |

### B.6 Red y rendimiento en planta

| # | Prueba | Resultado esperado | OK |
|---|--------|-------------------|:--:|
| B.6.1 | Recorrida completa R2 (~80 telares) en Wi‑Fi | Sin cuelgues &gt; 3 s entre guardados | ☐ |
| B.6.2 | Pérdida de red 30 s mid-ronda → recuperar | Auto-guardado recupera al volver red | ☐ |
| B.6.3 | Dos inspectores simultáneos (turnos distintos o misma fecha) | Patrullas separadas por `inspectorUid` | ☐ |

---

## Bloque C — Rondas complementarias (flujo completo turno)

### C.1 Roturas (R1 y R6)

| # | Prueba | OK |
|---|--------|:--:|
| C.1.1 | R1: cargar telares, ingresar roturas U/T, completar | ☐ |
| C.1.2 | Hub: R2 desbloqueada tras R1 | ☐ |
| C.1.3 | R6 tras R5: segundo registro roturas, completar | ☐ |

### C.2 Trama negra (R3)

| # | Prueba | OK |
|---|--------|:--:|
| C.2.1 | Solo telares en blanco listados | ☐ |
| C.2.2 | Marcar presencia/ausencia trama negra por telar | ☐ |
| C.2.3 | Completar → desbloquea R4 | ☐ |

### C.3 Evaluación (R7)

| # | Prueba | OK |
|---|--------|:--:|
| C.3.1 | Con R1 y R6 completas: R7 disponible | ☐ |
| C.3.2 | Auto-evaluación o manual: mejoró/empeoró/igual | ☐ |
| C.3.3 | R7 completada en hub | ☐ |

### C.4 Cierre de patrulla

| # | Prueba | OK |
|---|--------|:--:|
| C.4.1 | Las 7 rondas ✓ → estado patrulla coherente | ☐ |
| C.4.2 | Historial muestra patrulla del día | ☐ |

---

## Bloque D — Modo cobertura y supervisión

| # | Prueba | OK |
|---|--------|:--:|
| D.1 | Supervisor en sub-ronda: banner «Obs.» solo lectura | ☐ |
| D.2 | Activar **Cubrir Inspector** → editar toma de punto | ☐ |
| D.3 | Cancelar cobertura → vuelve solo lectura | ☐ |
| D.4 | Admin/supervisor: **reabrir** ronda completada (si aplica) | ☐ |
| D.5 | Tras reabrir: inspector puede volver a tomar puntos | ☐ |

---

## Bloque E — Regresión rápida post-deploy (15 min)

Ejecutar en **un turno piloto** el día del redeploy:

1. Inspector: R1 mínima (3 telares) → **R2 toma de puntos completa** (ruta piloto 10 telares) → completar.  
2. Supervisor: observar misma patrulla sin editar.  
3. Supervisor: cobertura → corregir 1 telar en R2.  
4. Verificar documento en Firebase Console: `patrullas/{id}` → `rondas.ronda_2.datos`.  
5. Mecánico: abrir intervención generada desde B.4.

| Criterio de go / no-go | |
|------------------------|---|
| **GO** | 100 % Bloque B sin `permission-denied`; auto-guardado OK; hub desbloquea rondas |
| **NO-GO** | Falla B.3.1, B.5.1 o B.6.2 → rollback reglas + reportar |

---

## Registro de ejecución (rellenar en planta)

| Campo | Valor |
|-------|-------|
| Fecha prueba | |
| Turno | A / B / C |
| Inspector prueba | |
| Supervisor prueba | |
| Build / commit | |
| Reglas Firestore desplegadas | Sí / No |
| Dispositivo | |
| Red | Wi‑Fi / 4G |
| Resultado global | GO / NO-GO |
| Incidencias | |

---

## Notas para junio 2026

- **Priorizar UAT del Bloque B** antes que módulos secundarios (IA, catálogo admin).  
- La toma de puntos es la ruta con más escrituras a `patrullas` → validar siempre tras cambios en `firestore.rules`.  
- Si el piloto es solo Tejeduría, confirmar que usuarios tengan `TEJEDURIA` en perfil.  
- Rutas de ronda deben estar actualizadas antes del primer día de producción (script `update-gcmest-orden-patrulla` si aplica).
