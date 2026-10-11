# Anchos del catálogo

Consulta de solo lectura a Firestore `catalogo_puestos_control`, proyecto `stc-cmms-hilanderia`, el 10/10/2026. 1674 registros y 12 modelos. Máximos en caracteres Unicode, incluidos espacios almacenados.

| Modelo | Registros | Sección | Grupo | Sub-G | Denominación | Catálogo | Artículo |
|---|---:|---:|---:|---:|---:|---:|---:|
| BENNINGER | 65 | 22 | 5 | 7 | 52 | 14 | 1 |
| BO-A | 7 | 21 | 7 | 1 | 48 | 1 | 12 |
| BR-F/FD | 5 | 21 | 10 | 1 | 35 | 1 | 1 |
| C60 | 3 | 9 | 2 | 1 | 20 | 1 | 1 |
| CBA-4 | 5 | 9 | 2 | 2 | 19 | 1 | 1 |
| CL-C3 | 6 | 20 | 8 | 1 | 48 | 1 | 1 |
| FD-S | 5 | 16 | 7 | 1 | 38 | 1 | 1 |
| FD-T | 4 | 21 | 7 | 1 | 33 | 1 | 1 |
| JA2S-190TP-EF-T710 | 1438 | 30 | 24 | 33 | 32 | 14 | 11 |
| R-37 | 12 | 22 | 7 | 1 | 51 | 1 | 1 |
| R-60 | 114 | 19 | 3 | 5 | 37 | 8 | 8 |
| TC7 | 10 | 16 | 3 | 1 | 25 | 1 | 1 |

La UI calcula anchos por modelo con los registros cargados, antes de aplicar filtros. Mide los textos con canvas y la fuente de datos de 13 px; usa estimación solo cuando el navegador aún no permite medir. Vuelve a medir después de cargar las fuentes. No necesita consultas adicionales para calcular la distribución.

Los anchos incluyen encabezado y 28 px de margen interior. Sección, Grupo y Sub-G conservan su contenido completo en una línea, sin límites de ancho. Solo Denominación limita su ancho base a 320 px y permite varias líneas. Los códigos de catálogo/artículo se dimensionan completos y no parten. El espacio extra se reparte proporcionalmente entre columnas de datos; Acciones parte de 104 px. Los anchos se expresan como porcentajes simples cuya suma es 100%, sin calc() en colgroup. El ancho mínimo es la suma de los anchos calculados; el desplazamiento queda dentro del modal.

No se escribe en Firestore. Los máximos pueden cambiar con futuras altas o cambios; la distribución se recalcula con el catálogo cargado. Validación visual pendiente en las PC de planta.
