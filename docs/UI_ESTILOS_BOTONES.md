# Guia de estilos UI - Botones y Controles

Patron extraido de `ResumenEnsayos.vue` (stc-produccion-v2) — fuente de verdad visual para ambos proyectos.

---

## Border-radius global (style.css)

**Causa raíz**: Tailwind v4 usa valores estándar más pronunciados. El proyecto `stc-produccion-v2` los reduce globalmente en `style.css`. Para que ambas apps tengan el mismo aspecto, **copiar este bloque en `src/style.css` de cualquier proyecto nuevo**:

```css
/* Global border-radius tuning: mirrors stc-produccion-v2 visual language */
.rounded-2xl { border-radius: 0.5rem !important; }    /* 8px  (Tailwind: 16px) */
.rounded-xl  { border-radius: 0.375rem !important; }   /* 6px  (Tailwind: 12px) */
.rounded-lg  { border-radius: 0.25rem !important; }    /* 4px  (Tailwind: 8px)  */
.rounded-md  { border-radius: 0.1875rem !important; }  /* 3px  (Tailwind: 6px)  */
.rounded     { border-radius: 0.125rem !important; }   /* 2px  (Tailwind: 4px)  */
.rounded-full { border-radius: 9999px !important; }    /* sin cambio */
```

> Ya aplicado en `STC-CMMS-Hilanderia/src/style.css`.

---

## Objetivo visual

- Base clara: controles sobre fondo blanco.
- Borde fino slate: `border-slate-200` separa sin recargar.
- Sombra suave: `shadow-sm` en reposo, `hover:shadow-md` al pasar el cursor.
- Estado activo con color de accion: azul, verde, rojo segun semantica.
- Radio: `rounded-lg` = 4px efectivos (con override global aplicado).

## Tokens recomendados

- Color base control: `bg-white`
- Borde base: `border border-slate-200`
- Texto base: `text-slate-700`
- Hover base: `hover:bg-slate-50`
- Focus base: `focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400`
- Sombra base: `shadow-sm`
- Sombra hover: `hover:shadow-md`
- Transicion: `transition-colors duration-150`
- Radio: `rounded-lg` (4px efectivos con override)

## Patron de boton neutro (filtros, utilidades, acciones)

Fuente: ResumenEnsayos.vue — clase exacta:

```
inline-flex items-center gap-1 px-2 py-1
border border-slate-200 bg-white text-slate-700
rounded-lg text-sm font-medium
hover:bg-slate-50 transition-colors duration-150
shadow-sm hover:shadow-md
```

**Aplicado a:** filtros (Todas/Activas/Inactivas), vista (Tarjetas/Tabla), acciones (Agregar, Exportar, Refrescar).

## Segmentados (Estado y Vista)

Contenedor:

```
flex border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm
```

Botón inactivo:

```
px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-150
```

Botón activo — azul:

```
px-2 py-1 text-sm font-medium bg-blue-50 text-blue-700
```

Botón activo — verde:

```
px-2 py-1 text-sm font-medium bg-green-50 text-green-700
```

Botón activo — rojo:

```
px-2 py-1 text-sm font-medium bg-red-50 text-red-700
```

Separador interno entre botones: `border-l border-slate-200`

## Inputs y Selects

```
bg-white border border-slate-200 rounded-lg text-sm text-slate-700
shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none
```

## Icono de sección (header)

```
bg-indigo-500 p-1 rounded-md text-white shadow-sm
```

## Tooltips (Tippy)

```js
tippy('[data-tippy-content]', {
  theme: 'light-border',
  duration: [120, 100]
});
```

Import CSS: `import 'tippy.js/themes/light-border.css'`

## Regla de consistencia

- Si un control en header es claro, todos los controles hermanos deben ser claros.
- No mezclar fondos oscuros con claros dentro de la misma barra funcional.
- Aplicar siempre el bloque de override de `border-radius` en `style.css` para mantener paridad visual con stc-produccion-v2.


## Tokens recomendados

- Color base control: `bg-white`
- Borde base: `border border-slate-100` (ligero, no agresivo)
- Texto base: `text-slate-700`
- Hover base: `hover:bg-slate-50`
- Focus base: `focus:ring-2 focus:ring-blue-500 focus:border-blue-500`
- Sombra base: `shadow-sm`
- Sombra hover: `hover:shadow-md`
- Radio: `rounded-md` (GestionMaquinas) / `rounded-lg` (ResumenEnsayos)

## Patron de boton neutro (filtros, utilidades, acciones)

Fuente: ResumenEnsayos.vue

```
inline-flex items-center gap-1 px-2 py-1
border border-slate-200 bg-white text-slate-700
rounded-lg text-sm font-medium
hover:bg-slate-50 transition-colors duration-150
shadow-sm hover:shadow-md
```

**Aplicado a:**
- Botones de filtro (Todos, Activas, Inactivas)
- Botones de utilidad (Refrescar, Exportar, Agregar)
- Botones de vista (Tarjetas, Tabla)
- Listbox (tipo de máquina)

## Sombra botones de accion

## Segmentados (Estado y Vista)

Contenedor:

```
flex border border-slate-100 rounded-md overflow-hidden bg-white shadow-sm
```

### Primer botón (sin borde izquierdo)

Inactivo:

```
text-slate-700 hover:bg-slate-50 px-3 py-1.5 text-sm font-medium transition-colors
```

Activo (ejemplo azul):

```
bg-blue-50 text-blue-700 px-3 py-1.5 text-sm font-medium transition-colors
```

### Botones subsiguientes (con borde izquierdo)

Inactivo (base):

```
border-l border-slate-100 text-slate-700 hover:bg-slate-50 px-3 py-1.5 text-sm font-medium transition-colors
```

Activo (ejemplo verde con borde):

```
bg-green-50 text-emerald-700 px-3 py-1.5 text-sm font-medium transition-colors border-l border-slate-100
```

**Nota**: El `border-l` permanece en `border-slate-100` incluso en estado activo. Solo cambia fondo y color de texto.

## Inputs y Selects

Input con búsqueda:

```
bg-white border border-slate-100 rounded-md text-xs text-gray-700 shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100
```

Select (listbox):

```
bg-white border border-slate-100 text-gray-700 text-xs font-bold rounded-md shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100
```

## Icono Catálogo (header)

```
bg-indigo-500 p-1 rounded-md text-white shadow-sm
```

Select sugerido:

```
bg-white border border-gray-200 rounded-md text-xs font-bold text-gray-700 shadow-[0_1px_2px_rgba(15,23,42,0.10)] focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100
```

## Tooltips (Tippy)

Tema recomendado para look claro:

- light-border

Configuracion sugerida:

```
tippy('[data-tippy-content]', {
  theme: 'light-border',
  duration: [120, 100]
});
```

## Regla de consistencia

Si un control en header es claro, todos los controles hermanos deben ser claros.
No mezclar fondos oscuros con claros dentro de la misma barra funcional.
