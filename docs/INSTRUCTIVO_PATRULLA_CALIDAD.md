# Instructivo — Vista Patrulla de Calidad

**Sistema:** STC-CMMS Hilandería  
**Fecha:** Abril 2026  
**Roles involucrados:** Inspector, Supervisor, Jefe de Sector, Admin

---

## ¿Qué es la Patrulla de Calidad?

Es el módulo de seguimiento de turno para el inspector de tejeduría. Organiza el trabajo en **7 rondas secuenciales** que deben completarse en orden durante el turno. Cada ronda registra un tipo de información diferente sobre el estado de los telares.

---

## Requisitos previos

- Tener usuario activo con rol `inspector` (para operar) o rol de supervisión (para observar).
- La patrulla se activa automáticamente para el inspector del turno en curso.

---

## Perfiles de usuario

| Rol | Acceso |
|---|---|
| `inspector` | Opera su propia patrulla, puede editar todas las rondas |
| `supervisor`, `jefe_sector`, `admin`, etc. | Solo lectura (modo observador). Puede activar modo cobertura para editar |

---

## Pantalla principal — Hub de rondas

Al ingresar a `/patrulla` se muestra la pantalla central con:

### 1. Barra superior (header)
- **Botón ←**: vuelve a la pantalla anterior
- **Badge de turno**: muestra el turno actual (`Turno A`, `Turno B`, etc.)
- **Nombre del inspector** conectado
- **Botón violeta** *(solo para observadores dentro de una ronda)*: colapsa/expande el banner de modo de visualización

### 2. Accesos rápidos
- **Muestras de Anudados** (tarjeta rosa): registro diario de muestras. Acceso directo, independiente de las rondas.
- **Ver historial** (tarjeta gris): patrullas de turnos anteriores (solo lectura).
- **Registro de Eficiencia** (tarjeta violeta): visible solo para supervisores y admins.

### 3. Timeline de 7 rondas
Las rondas se muestran como una lista vertical con línea conectora. Cada tarjeta indica:

| Indicador | Significado |
|---|---|
| Círculo con número | Ronda pendiente y disponible |
| Círculo azul pulsante + "En curso" | Ronda iniciada pero no finalizada |
| Círculo verde + "✓ Hecha" | Ronda completada — muestra hora de cierre |
| Candado gris | Ronda bloqueada (la anterior no está completa) |

#### Reglas de desbloqueo
- **Ronda 1**: siempre disponible al iniciar turno.
- **Rondas 2 a 6**: se desbloquean cuando la ronda anterior está completada.
- **Ronda 7** (Evaluación): requiere que Ronda 1 **y** Ronda 6 estén ambas completadas.

---

## Las 7 rondas

| N° | Nombre | Tipo | Descripción |
|---|---|---|---|
| 1 | Roturas | `roturas` | Registro de roturas de urdido y trama |
| 2 | Paros / Defectos | `paro_defecto` | Recorrida de observación de estado de telares |
| 3 | Trama Negra | `trama_negra` | Inspección de trama en producción de blanco |
| 4 | Paros / Defectos | `paro_defecto` | Segunda recorrida de observación |
| 5 | Paros / Defectos | `paro_defecto` | Tercera recorrida de observación |
| 6 | Roturas | `roturas` | Segundo registro de roturas del turno |
| 7 | Evaluación | `evaluacion` | Seguimiento: mejoró / empeoró / igual |

---

## Cómo completar una ronda

### Paso 1 — Tocar la tarjeta de la ronda
Si la ronda está desbloqueada, tocar la tarjeta navega al formulario correspondiente. Si está bloqueada (candado), primero hay que completar la ronda anterior.

### Paso 2 — Completar el formulario de la ronda
Cada tipo de ronda tiene su propio formulario:

#### Rondas de Roturas (R1 y R6)
- Se lista cada telar del grupo.
- Se ingresan las roturas de urdido y trama para cada telar.
- Al finalizar, se toca **"Completar ronda"**.

#### Rondas de Paros / Defectos (R2, R4, R5)

> Ver sección detallada más abajo: **"Ronda de Paros/Defectos paso a paso"**

#### Ronda de Trama Negra (R3)
- Se inspecciona cada telar en producción de tela blanca buscando pasadas de trama negra mezcladas.
- Se marca si hay o no presencia de trama negra.

#### Ronda de Evaluación (R7)
- Se revisa el seguimiento de roturas comparando R1 vs R6.
- Se registra si el telar mejoró, empeoró o se mantuvo igual.

### Paso 3 — Volver al hub
Al completar la ronda, la app vuelve automáticamente al hub. La tarjeta de esa ronda cambia a estado "✓ Hecha" con horario de cierre y la siguiente ronda se desbloquea.

---

## Ronda de Paros / Defectos — Paso a paso detallado

Esta es la ronda más compleja. Se usa para las Rondas 2, 4 y 5.

### Barra de resumen (encabezado sticky)
En la parte superior del listado siempre visible:
- **Badge verde**: cantidad de telares registrados como "trabajando"
- **Badge naranja/rojo**: cantidad de paros detectados
- **Contador N/80**: avance total de la recorrida
- **Selector "Ruta de patrulla"** (borde violeta): permite elegir la ruta Firestore asignada para esta recorrida
- **Selector "Grupo"**: filtra los telares por grupo (si hay más de uno disponible)

### Listado de telares
Cada fila muestra:
- **Punto de color** a la izquierda: indica el estado registrado
  - Gris: sin registrar aún
  - Verde: trabajando
  - Naranja/Rojo: paro o defecto
  - Punto naranja pequeño superpuesto: se solicitó intervención para este telar
- **Número y nombre del telar**
- **Badge de estado** a la derecha (ej: "Paro mecánico", "Trabajando")
- **Sub-badge** de defecto de calidad (si aplica, en rosa)

### Registrar el estado de un telar

**Paso 1**: Tocar la fila del telar → se expande la tarjeta de ese telar.

**Paso 2**: En la grilla **"¿Cómo está?"**, tocar el estado que corresponde:

| Estado | Color | Descripción |
|---|---|---|
| 🟢 Trabajando | Verde | Telar en funcionamiento normal |
| 🟠 Paro mecánico | Naranja | Parado por falla mecánica |
| 🔵 Paro eléctrico | Azul | Parado por falla eléctrica |
| 🔴 Paro calidad | Rojo | Parado por problema de calidad |
| 🟡 Paro preparación | Amarillo | En preparación / cambio de artículo |
| ⚫ Sin tarea asignada | Gris oscuro | Sin producción asignada |
| 🔵 Cambio artículo | Índigo | Cambio de artículo en proceso |
| 🟤 Detenido programado | Marrón | Parada planificada |

**Paso 3** *(según el estado)*:
- Si el estado es **Paro calidad** → aparece la grilla de defectos (ver abajo).
- Si el estado NO es "trabajando" → aparece un campo de **observación** para comentarios libres.
- Si el estado es **Paro mecánico** o **Paro eléctrico** → aparece el botón azul/ámbar **"Solicitar Intervención"**.

**Paso 4**: Tocar **"Listo — Siguiente >"** para guardar y avanzar automáticamente al próximo telar sin registrar. La vista hace scroll automático.

### Grilla de defectos de calidad
Aparece cuando el estado es "Paro calidad". Muestra 12 tipos de defectos de trama en una grilla de 2 columnas. Se puede seleccionar uno. El defecto elegido queda visible como sub-badge en la fila del telar en el listado.

### Solicitar intervención (Paro mecánico / Paro eléctrico)

**Paso 1**: Tocar **"Solicitar Intervención"** en la tarjeta expandida del telar.

**Paso 2**: La app navega al formulario **Llamar Intervención** (`/llamar`) con los datos del telar pre-cargados:
- Número y tipo de máquina
- Grupo
- Observación como síntoma inicial
- Tipo de intervención (mecánica o eléctrica)

**Paso 3**: Completar y enviar el formulario de intervención.

**Paso 4**: Al confirmar, la app vuelve automáticamente a la ronda (**"Volver a la Ronda"**). El telar retomado muestra:
- **Banner azul/ámbar** dentro de la tarjeta con el síntoma y la observación enviados
- **Punto naranja** superpuesto en la fila del listado
- El campo de observación del telar se rellena automáticamente con los datos de la intervención
- La intervención se guarda junto con la ronda en Firestore

### Completar la ronda de Paros/Defectos
Cuando todos los telares tienen estado registrado, aparece el botón **"Completar Ronda"** (o se activa el botón de guardar). Al tocarlo:
- Se guarda el resultado completo en Firestore bajo el ID de la patrulla activa.
- Se registra la hora, la ruta de patrulla seleccionada y el grupo.
- La app vuelve al hub de rondas y desbloquea la siguiente.

---

## Modo cobertura (para supervisores)

Cuando un supervisor o jefe ingresa a la vista, accede en **modo solo lectura** por defecto.

### Acceder al banner de modo
Dentro de una sub-ronda, aparece un **botón violeta** en la esquina derecha del header:
- Colapsado (por defecto): muestra icono + etiqueta **"Obs."** o **"Cobertura"** + flecha
- Expandido: muestra el banner completo con opciones

### Activar modo cobertura
1. Expandir el header tocando el botón violeta.
2. En el banner, tocar **"Cubrir Inspector"**.
3. El banner cambia a ámbar — ya se puede editar la ronda como si fuera el inspector.
4. Para desactivar, tocar **"Cancelar cobertura"**.

### Ver patrulla de otro inspector
Si hay más de un inspector activo en el turno, el banner desplegado muestra un **selector de patrulla** donde se puede elegir qué inspector visualizar.

---

## Reapertura de rondas completadas

Solo disponible para roles `supervisor`, `supervisor_mecanico` y `admin`.

**Paso 1**: En el hub, localizar la ronda completada (estado "✓ Hecha").  
**Paso 2**: Tocar el ícono de **RotateCcw** (flecha circular) que aparece en la tarjeta de esa ronda.  
**Paso 3**: Confirmar en el modal. Los datos cargados se **conservan**; solo se quita el estado "completada".  
**Paso 4**: La ronda vuelve a estar editable.

---

## Historial de patrullas

Accesible desde el hub tocando **"Ver historial"**. Muestra patrullas de turnos anteriores con todas las rondas en modo solo lectura.

---

## Muestras de Anudados

Accesible desde el hub tocando la tarjeta rosa **"Muestras de Anudados"**. Es independiente de las 7 rondas y puede completarse en cualquier momento del turno. Registra el conteo diario de muestras de control de anudados.

---

## Flujo resumido del turno (inspector)

```
Ingresar a /patrulla
     │
     ├─ [Opcional] Registrar Muestras de Anudados
     │
     ▼
  Ronda 1 — Roturas (desbloqueada desde el inicio)
     ▼ (completar)
  Ronda 2 — Paros/Defectos
     ▼ (completar)
  Ronda 3 — Trama Negra
     ▼ (completar)
  Ronda 4 — Paros/Defectos
     ▼ (completar)
  Ronda 5 — Paros/Defectos
     ▼ (completar)
  Ronda 6 — Roturas
     ▼ (completar) ← desbloquea Ronda 7
  Ronda 7 — Evaluación (requiere R1 + R6 completas)
     ▼ (completar)
  Patrulla finalizada ✓
```

---

## Preguntas frecuentes

**¿Qué pasa si salgo de la app en medio de una ronda?**  
Los datos se guardan automáticamente (auto-save) mientras se van registrando telares. Al volver, el estado se recupera desde Firestore.

**¿Puedo registrar el mismo telar varias veces?**  
Sí, tocando la fila del telar se reabre la tarjeta y se puede cambiar el estado o la observación.

**¿Las intervenciones solicitadas quedan guardadas?**  
Sí. Cada intervención se guarda dentro de los datos de la ronda en Firestore, asociada al telar y con hora de registro.

**¿Qué pasa con las rondas si el turno cambia?**  
Cada patrulla está vinculada a un turno específico. Al cambiar de turno, el inspector inicia una nueva patrulla desde cero.
