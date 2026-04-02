# Catálogo BENNINGER (Máquina Indigo) — Instrucciones para completar datos

## ¿Qué es esto?

El sistema CMMS ya tiene cargado el catálogo de repuestos de la máquina **Open End R-60**. El objetivo es incorporar el catálogo de la máquina **BENNINGER (Indigo)** para poder consultarlo desde la aplicación, generar órdenes de trabajo y exportarlo a Excel.

---

## Lo que ya fue identificado

Se recibieron las **28 secciones** de la máquina BENNINGER con sus códigos numéricos. Analizando el patrón de esos códigos se definió la siguiente **división en 8 grupos funcionales** (esto ya está definido y no necesita aportarse):

| Grupo funcional | Código secciones incluidas | Descripción |
|---|---|---|
| AUXILIARES GENERALES | 25010, 25011, 25012, 25015, 25016 | Puente grúa, gaiolas, cocinas de indigo |
| CAJA ENTRADA | 25100 | Caja de entrada D100 |
| CAJAS LAVADO INFERIOR | 25220, 25240 | Cajas de lavado D220 y D240 |
| CAJAS TEÑIDO | 25400, 25420, 25440, 25460, 25480, 25490 | Todas las cajas de teñido D400 a D490 |
| CAJAS LAVADO SUPERIOR | 25600, 25620, 25640 | Cajas de lavado D600 a D640 |
| SECADO Y ENCOLADO | 25700, 25750, 25760 | Torre de pre-secado, acumulador móvil, cocina de encolado |
| CAJA GOMA Y CABEZAL | 25800, 25800-1, 25800-2, 25855, 25860 | Caja goma S500, bombas recirculación, post-encerado, cabezal S800 |
| ELECTRICIDAD Y CONTROL | 25900, 25950, 25975 | Profibus, tableros eléctricos, campo seco |

---

## Lo que FALTA: los componentes de cada sección

Cada sección tiene componentes internos (repuestos, piezas, elementos de mantenimiento). Esa es la información que se necesita ahora.

### Formato requerido

Los datos deben entregarse en un **archivo Excel** (`.xlsx`) con una hoja llamada `Catalogo` y las siguientes columnas **en ese orden exacto**:

| # | Nombre columna | Descripción | Ejemplo |
|---|---|---|---|
| 1 | **Marca** | Siempre `BENNINGER` | `BENNINGER` |
| 2 | **Modelo** | Siempre `BENNINGER` | `BENNINGER` |
| 3 | **Asignación** | Código o referencia interna de asignación (puede quedar vacío) | `25400` |
| 4 | **Sección** | Nombre del grupo funcional (ver tabla de arriba) | `CAJAS TEÑIDO` |
| 5 | **Abreviado** | Abreviatura corta para la sección | `TEÑIDO` |
| 6 | **Grupo** | Código numérico de la sección exacta donde está el componente | `25400` |
| 7 | **Sub Grupo** | Subdivisión dentro del grupo (si no hay, dejar `-`) | `25420` |
| 8 | **Denominación** | Nombre del componente o repuesto | `BOMBA CENTRÍFUGA 2" INOX` |
| 9 | **Número Catálogo** | Número de catálogo del fabricante (si no hay, dejar `-`) | `BNG-2401` |
| 10 | **Número Artículo** | Número de artículo/parte (si no hay, dejar `-`) | `10345678` |
| 11 | **Tiempo** | Tiempo estimado de intervención en horas (puede quedar vacío) | `2h` |
| 12 | **Observación** | Notas adicionales (puede quedar vacío) | `Revisar sello mecánico` |

---

## Ejemplo de cómo deben verse las filas

| Marca | Modelo | Asignación | Sección | Abreviado | Grupo | Sub Grupo | Denominación | Nro Catálogo | Nro Artículo | Tiempo | Observación |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BENNINGER | BENNINGER | | CAJAS TEÑIDO | TEÑIDO | 25400 | - | BOMBA RECIRCULACIÓN TINTE | BNG-400-BP | 10345678 | 1.5h | |
| BENNINGER | BENNINGER | | CAJAS TEÑIDO | TEÑIDO | 25420 | - | RODILLO DE TEÑIDO D420 | BNG-420-RD | 10345699 | | |
| BENNINGER | BENNINGER | | CAJA ENTRADA | ENTRADA | 25100 | - | GUÍA DE HILO ENTRADA | BNG-100-GH | - | | |
| BENNINGER | BENNINGER | | AUXILIARES GENERALES | AUX | 25010 | - | CABLE DE ACERO PUENTE GRÚA | - | - | | Verificar desgaste semestral |

---

## Reglas importantes

1. **Una fila = un componente**. Si una sección tiene 30 componentes, van 30 filas.
2. **Columna "Modelo" siempre `BENNINGER`** — esto es lo que le dice al sistema a qué máquina pertenece.
3. **Columna "Grupo"** debe ser el código numérico exacto (ej: `25400`, `25440`), no el nombre.
4. **Columna "Sección"** debe coincidir con alguno de los 8 nombres de la tabla de arriba. Si hay dudas, usar el grupo funcional correspondiente.
5. Los campos **Nro Catálogo, Nro Artículo, Tiempo y Observación** son opcionales. Si no se tiene el dato, dejar la celda vacía o poner `-`.
6. **No mezclar con otras máquinas** en el mismo archivo (no mezclar con R-60 ni JA2S).

---

## Qué pasa cuando lleguen los datos

Una vez recibido el Excel completo, el equipo de sistemas:

1. Valida el archivo con un **dry run** (previsualización sin escribir) para verificar que el formato sea correcto.
2. Carga los datos en Firestore con el script `import-catalogo-excel.mjs --apply`.
3. En la aplicación, al abrir **Gestión de Máquinas → Ver catálogo**, aparecerá un selector de modelo con `R-60` y `BENNINGER`.
4. El catálogo BENNINGER queda disponible para consulta, exportación a Excel y eventual vinculación a órdenes de trabajo.

---

## Prioridad sugerida de secciones

Si no es posible entregar todo de una vez, se sugiere comenzar por las secciones de mayor intervención:

1. **CAJAS TEÑIDO** (mayor frecuencia de mantenimiento)
2. **CAJA GOMA Y CABEZAL**
3. **CAJAS LAVADO SUPERIOR e INFERIOR**
4. **AUXILIARES GENERALES**
5. **ELECTRICIDAD Y CONTROL**
6. El resto

---

*Documento generado el 01/04/2026 — Sistema CMMS STC Hilandería*
