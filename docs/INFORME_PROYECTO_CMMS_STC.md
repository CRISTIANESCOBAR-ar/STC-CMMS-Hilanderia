
<!-- ═══════════════════════════════════════════════════════════════════════════
     INFORME DE PROYECTO — CMMS STC
     Santana Textiles · Hilandería & Tejeduría
     Fuentes recomendadas para Word: Títulos → Segoe UI Light / Cuerpo → Ubuntu
     ═══════════════════════════════════════════════════════════════════════════ -->

---

# 🏭 CMMS STC — Sistema de Gestión de Mantenimiento

### Santana Textiles · Hilandería & Tejeduría

**Plataforma:** Aplicación Web Progresiva (PWA)  
**Acceso:** [https://stc-cmms.web.app](https://stc-cmms.web.app)  
**Versión:** 1.0 · Marzo 2026  
**Tecnología:** Vue 3 · Firebase · Google Gemini AI

---

## 📋 Índice

1. [Resumen Ejecutivo](#-resumen-ejecutivo)
2. [Arquitectura del Sistema](#-arquitectura-del-sistema)
3. [Roles y Permisos](#-roles-y-permisos)
4. [Módulos Implementados](#-módulos-implementados)
5. [Inteligencia Artificial](#-inteligencia-artificial--gemini)
6. [Módulos en Desarrollo](#-módulos-en-desarrollo--roadmap)
7. [Beneficios Clave](#-beneficios-clave)
8. [Indicadores de Impacto](#-indicadores-de-impacto-esperados)

---

## 🎯 Resumen Ejecutivo

**CMMS STC** es un sistema de gestión de mantenimiento computarizado diseñado específicamente para las operaciones de **Santana Textiles**, cubriendo los sectores de **Hilandería** y **Tejeduría**.

La plataforma digitaliza completamente el ciclo de vida del mantenimiento:

> 📝 **Reporte** → 🔔 **Solicitud** → ⚙️ **Intervención** → ✅ **Cierre** → 📊 **Análisis**

Se trata de una **Progressive Web App (PWA)** que funciona como aplicación nativa en celulares y tablets sin necesidad de instalarse desde tiendas de aplicaciones. Opera en **tiempo real**, con **notificaciones push** y capacidad **offline**.

**Datos clave:**

| Concepto | Detalle |
|:---------|:--------|
| 🖥️ Plataforma | PWA (funciona en cualquier navegador) |
| 📱 Dispositivos | Celular, tablet, PC |
| 👥 Roles definidos | 11 roles jerárquicos |
| 🏭 Sectores | Hilandería · Tejeduría |
| 🔄 Turnos | A (06–14h) · B (14–22h) · C (22–06h) |
| 🤖 IA integrada | Google Gemini 2.5 Flash |
| ☁️ Infraestructura | Google Firebase (99.95% SLA) |

---

## 🏗️ Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────┐
│                   📱 FRONTEND                       │
│          Vue 3 · TailwindCSS · Lucide Icons         │
│              PWA con Service Workers                │
├─────────────────────────────────────────────────────┤
│                  ☁️ FIREBASE                         │
│  🔐 Auth    📦 Firestore    🖼️ Storage    📨 FCM    │
├─────────────────────────────────────────────────────┤
│                  🤖 GOOGLE AI                        │
│            Gemini 2.5 Flash · Análisis              │
└─────────────────────────────────────────────────────┘
```

**Características técnicas:**

- ⚡ **Tiempo real** — Los cambios se reflejan instantáneamente en todos los dispositivos conectados
- 📴 **Offline** — Funciona sin conexión gracias a IndexedDB y Service Workers
- 🔔 **Push Notifications** — Alertas en tiempo real para roles de supervisión y jefatura
- 🔒 **Autenticación Google** — Inicio de sesión seguro con cuentas de Google (migración a Microsoft 365 planificada)
- 📸 **Compresión de imágenes** — Optimización automática de fotos adjuntas
- 📊 **Exportación Excel** — Datos exportables para análisis externo

---

## 👥 Roles y Permisos

El sistema implementa un modelo de **control de acceso basado en roles (RBAC)** con 11 perfiles organizados en 4 niveles jerárquicos:

### 🟢 Nivel Operativo

| Rol | Descripción | Vistas principales |
|:----|:------------|:-------------------|
| 🧵 **Tejedor** | Opera telares; reporta fallas y paradas | Reportar Falla |
| 🔍 **Inspector** | Recorre planta; detecta anomalías; controla calidad | Solicitar Intervención · Intervenciones · Patrulla Calidad · Reportar Falla |
| 🔧 **Mecánico** | Ejecuta intervenciones correctivas y preventivas | Intervenciones · Historial |

### 🟡 Mandos Medios

| Rol | Descripción | Vistas principales |
|:----|:------------|:-------------------|
| 👷 **Supervisor Producción** | Supervisa turno; despacha intervenciones | Reportar Falla · Solicitar Intv. · Intervenciones · Historial |
| 🔩 **Supervisor Mecánico** | Coordina mecánicos del turno | Solicitar Intv. · Intervenciones · Historial |
| ⚡ **Supervisor Eléctrico** | Coordina electricistas del turno | Solicitar Intv. · Intervenciones · Historial |

### 🟠 Jefaturas

| Rol | Descripción | Vistas principales |
|:----|:------------|:-------------------|
| 🛠️ **Jefe de Mecánicos** | Lidera equipo mecánico; controla indicadores | Panel de Control · Intervenciones · Máquinas |
| ⚡ **Jefe de Eléctricos** | Lidera equipo eléctrico | Panel de Control · Intervenciones · Máquinas |
| 📋 **Jefe de Producción** | Dirige producción; define prioridades | Panel de Control · Intervenciones · Máquinas |

### 🔴 Nivel Estratégico

| Rol | Descripción | Vistas principales |
|:----|:------------|:-------------------|
| 📈 **Gerente de Producción** | Visión global; análisis de KPIs; decisiones estratégicas | Panel de Control · Intervenciones · Historial · Máquinas |
| ⚙️ **Administrador** | Acceso total al sistema; configura roles y parámetros | Todas las vistas |

### 🔐 Matriz de Permisos

| Permiso | 🧵 Tejedor | 🔍 Inspector | 🔧 Mecánico | 👷 Supervisores | 🛠️ Jefaturas | 📈 Gerente | ⚙️ Admin |
|:--------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Ver Calidad | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Crear Falla | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cerrar Orden | ❌ | ❌ | ✅ | Parcial | ✅ | ✅ | ✅ |
| Config Sistema | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Tomar Intv. Calidad | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Tomar Intv. Mec/Elec | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## ✅ Módulos Implementados

### 1. 📝 Reporte de Fallas

> *"Cualquier operario puede reportar un problema en segundos"*

| Característica | Detalle |
|:---------------|:--------|
| 🎯 Selección de máquina | Cascada: Tipo → Grupo → Máquina → GM |
| 📋 Clasificación | Mecánico · Eléctrico |
| 🚨 Criticidad | Flag manual + automático si máquina parada |
| 📸 Foto adjunta | Con compresión automática |
| 💬 Observaciones | Campo de texto libre |
| 🏭 Sector | Asignado según perfil del usuario |

**Flujo:**
```
👷 Operario detecta problema
    → 📱 Abre la app
        → 📝 Selecciona máquina y describe falla
            → 📸 Adjunta foto (opcional)
                → ✅ Envía reporte
                    → 🔔 Notificación a supervisores
```

---

### 2. 🔔 Solicitud de Intervención

> *"Formaliza el pedido de trabajo con toda la información necesaria"*

| Característica | Detalle |
|:---------------|:--------|
| 🔧 Tipo intervención | Mecánico · Eléctrico · Calidad |
| 🏭 Selección inteligente | Filtra máquinas por sector del usuario |
| 🚦 Estado de máquina | En marcha · Con problema · Parada |
| 🩺 Síntomas (Tejeduría) | Catálogo especializado de síntomas textiles |
| 🚨 Crítico automático | Si la máquina está parada → Crítico forzado |
| 📸 Foto | Con barra de progreso de carga |
| 🔍 Inspector | Tipo TELAR preseleccionado · Sector Tejeduría automático |

**Priorización automática:**

| Prioridad | Condición | Visual |
|:----------|:----------|:-------|
| 🔴 P1 — URGENTE | Máquina PARADA | Rojo pulsante |
| 🟠 P2 — ALTA | Con problema + Crítico | Naranja |
| 🟡 P3 — MEDIA | Con problema | Amarillo |
| ⚪ P4 — NORMAL | En marcha | Gris |

---

### 3. ⚙️ Gestión de Intervenciones

> *"Tablero en tiempo real para tomar, gestionar y cerrar órdenes de trabajo"*

| Característica | Detalle |
|:---------------|:--------|
| 📊 Tabs de estado | Pendientes · En Proceso · Cerradas · Todo |
| 🔄 Tiempo real | Actualización instantánea vía Firestore |
| 👤 Asignación | Tomar individual o batch por máquina |
| 📱 Agrupación | Por máquina con collapse/expand |
| 🔍 Inspector | Ve todas, solo toma las de Calidad |
| ⏱️ Antigüedad | Indicador visual de tiempo transcurrido |

**Ciclo de vida:**
```
📥 PENDIENTE → ⚙️ EN PROCESO → ✅ COMPLETADO
                    │
                    └→ 🔍 Inspector verifica calidad
```

---

### 4. 🏭 Patrulla de Calidad

> *"Digitalización de las rondas de inspección del turno"*

El módulo de Patrulla Calidad estructura las 7 rondas del inspector en un flujo digital:

#### 📊 Ronda 1 y 6 — Control de Roturas

| Característica | Detalle |
|:---------------|:--------|
| 📐 Grilla interactiva | Toyota N · Grupo N · GM N |
| 🔢 Entrada decimal | Ro.U (Urdimbre) y Ro.T (Trama) con separador coma |
| 🚨 Umbrales | Ro.U > 2 → Alerta · Ro.T > 3 → Alerta |
| 🔴 Alerta visual | Celdas rojas cuando supera umbral |
| 🔔 Intervención rápida | Botón por fila para solicitar intervención con datos precargados |
| 🔍 Filtro por grupo | Dropdown con todos los grupos disponibles |
| ⏰ Hora automática | Se registra al primer input por telar |
| 📈 Solo telares activos | Filtra los 80 telares activos del sector |

#### 🧪 Ronda 3 — Prueba de Trama Negra

| Característica | Detalle |
|:---------------|:--------|
| 📋 Lista de telares | Con badges de estado (✅ OK · ⚠️ Defectos · — Pendiente) |
| 📱 Bottom sheet | Se abre al tocar un telar |
| 🏷️ Chips de defectos | 8 tipos seleccionables (multi-selección) |
| ✅ Sin defectos | Marca exclusiva que limpia selección |
| 📏 Metros del contador | Input numérico por telar |
| 💾 Guardado por telar | Se persiste al cerrar el bottom sheet |
| ⏰ Hora automática | Al primer input |

**8 tipos de defectos:**

| Defecto | Categoría |
|:--------|:----------|
| 🔀 Hilo doble | Hilo |
| ↔️ Hilo estirado | Hilo |
| 〰️ Hilo flojo | Hilo |
| ✂️ Hilo roto | Hilo |
| ⬛ Hilo grueso | Hilo |
| ▫️ Hilo fino | Hilo |
| 🛢️ Mancha de aceite | Ambiental |
| ❌ Trama faltante | Trama |

#### 📋 Ronda 7 — Seguimiento de Defectos *(en desarrollo)*

---

### 5. 📊 Panel de Control (Dashboard)

> *"Visión ejecutiva para jefaturas y gerencia"*

| Característica | Detalle |
|:---------------|:--------|
| 📈 KPIs del día | Fallas totales · Pendientes vs Completadas · Críticos |
| 🔄 Turno actual | Identificación automática (A/B/C) |
| 🤖 Resumen IA | Análisis diario generado por Gemini |
| 📋 Copiar resumen | Formato optimizado para WhatsApp |
| 📱 Diseño responsivo | Optimizado para celular |

---

### 6. 📜 Histórico de Novedades

> *"Todo el historial de fallas con filtros avanzados y exportación"*

| Característica | Detalle |
|:---------------|:--------|
| 🔍 Filtros avanzados | Tipo · Estado · Fecha · Sector · Búsqueda libre |
| 📄 Paginación | 25 registros por página |
| 📥 Exportar Excel | Datos formateados con cabeceras y estilos |
| 🤖 Resumen IA | Análisis ejecutivo por fecha |
| 🎨 Indicadores visuales | Coloreado por tipo y severidad |

---

### 7. 🏭 Gestión de Máquinas

> *"Inventario completo del parque de maquinaria"*

| Característica | Detalle |
|:---------------|:--------|
| 📦 Inventario | Alta · Edición · Baja de máquinas |
| 📋 Datos por máquina | Tipo · Modelo · Ubicación · Grupo · Sector · Estado |
| 📁 Catálogo R-60 | Puntos de control y procedimientos paso a paso |
| 📸 Procedimientos | Instrucciones con fotos por paso |
| 📥 Import/Export | Carga masiva CSV · Exportación Excel |
| 🔍 Filtrado | Por tipo, sector, estado activo |

---

### 8. ⚙️ Administración

> *"Configuración centralizada del sistema"*

| Módulo | Funcionalidad |
|:-------|:-------------|
| 👥 **Usuarios** | Gestión de roles · Sectores · Permisos por usuario |
| 📋 **Códigos de Falla** | Catálogo de defectos textiles (Trama/Urdimbre) y paradas |
| 🩺 **Síntomas** | Biblioteca de síntomas de tejeduría |
| 🌐 **Traducciones** | Personalización de etiquetas del sistema |
| 👁️ **Vista Previa** | El admin puede simular cualquier rol para verificar la experiencia |

---

### 9. 🔔 Notificaciones Push

> *"Alertas en tiempo real para roles de supervisión"*

| Característica | Detalle |
|:---------------|:--------|
| 📨 Firebase Cloud Messaging | Notificaciones nativas del navegador |
| 🔕 Foreground | Alertas dentro de la app (toast) |
| 📱 Background | Notificaciones del sistema cuando la app está cerrada |
| 🔐 Opt-in | El usuario autoriza la recepción |

---

### 10. 📱 Experiencia PWA

> *"Se instala como una app nativa desde el navegador"*

| Característica | Detalle |
|:---------------|:--------|
| 📲 Instalable | Agregar a pantalla de inicio sin tienda de apps |
| 📴 Offline | Funciona sin conexión con cache local |
| ⚡ Performance | Carga instantánea con Service Workers |
| 🔄 Auto-update | Detección automática de nuevas versiones |
| 📱 Standalone | Se abre como app independiente (sin barra del navegador) |

---

## 🤖 Inteligencia Artificial — Gemini

### ✅ Ya implementado

| Funcionalidad | Detalle |
|:--------------|:--------|
| 📊 **Resumen Diario** | Gemini analiza todas las fallas del día y genera un informe ejecutivo |
| 🔍 **Clasificación automática** | Separa fallas mecánicas vs eléctricas con conteo |
| 🚨 **Detección de cuellos de botella** | Identifica máquinas con fallas repetitivas |
| 📋 **Plan de acción** | Genera 2-3 acciones prioritarias para el equipo |
| 💬 **Formato WhatsApp** | Resumen optimizado para compartir por mensajería |
| 💾 **Cache inteligente** | Almacena resúmenes en Firestore, regenera bajo demanda |

### 🔮 Roadmap IA — Próximas implementaciones

#### 🧠 Análisis Predictivo

| Funcionalidad | Descripción | Impacto esperado |
|:--------------|:------------|:-----------------|
| 📈 **Predicción de fallas** | Identificación de patrones temporales y estacionales en fallas por máquina | ⬇️ Reducir fallas inesperadas 20-30% |
| 🔄 **Detección de ciclos** | Reconocer intervalos de recurrencia (ej: "Máquina 35 falla cada 15 días") | 📅 Programar preventivos inteligentes |
| ⚠️ **Alertas tempranas** | Notificación proactiva cuando una máquina se acerca a su umbral de falla | 🚫 Prevenir paradas no programadas |
| 🏭 **Health Score** | Índice de salud por máquina basado en historial de intervenciones | 📊 Priorización basada en datos |

#### 📊 Análisis Avanzado

| Funcionalidad | Descripción | Impacto esperado |
|:--------------|:------------|:-----------------|
| 📉 **Tendencias por turno** | Comparar rendimiento y fallas entre turnos A, B y C | 👥 Identificar necesidades de capacitación |
| 🔧 **Análisis de causa raíz** | IA sugiere causas probables basado en historial de síntomas y defectos | ⏱️ Reducir tiempo de diagnóstico |
| 📋 **Resumen semanal/mensual** | Informes ejecutivos periódicos automáticos con evolución de KPIs | 📈 Visibilidad gerencial continua |
| 🗺️ **Mapa de calor** | Visualización geográfica de fallas en planta por zona/grupo | 🎯 Focalizar mantenimiento preventivo |

#### 🤝 Asistencia Inteligente

| Funcionalidad | Descripción | Impacto esperado |
|:--------------|:------------|:-----------------|
| 💬 **Chatbot de mantenimiento** | Consultas en lenguaje natural sobre procedimientos y catálogo | 📚 Acceso inmediato al conocimiento |
| 📸 **Análisis de imagen** | Identificar defectos textiles desde foto con IA visual | 🔍 Clasificación objetiva y consistente |
| 📝 **Auto-clasificación** | Categorización automática de fallas al momento del reporte | ⚡ Reducir errores de carga |
| 🎓 **Recomendaciones** | Sugerir acciones basadas en intervenciones exitosas previas | 📈 Transferir conocimiento entre equipos |

#### 📈 Business Intelligence

| Funcionalidad | Descripción | Impacto esperado |
|:--------------|:------------|:-----------------|
| 💰 **Costo por falla** | Estimación del impacto económico de cada tipo de falla | 💵 Justificar inversiones preventivas |
| 📊 **OEE conectado** | Alimentar indicadores de Eficiencia Global de Equipos | 🏆 Benchmark con estándares industriales |
| 🔮 **Simulación what-if** | Proyectar impacto de cambios en mantenimiento preventivo | 📐 Toma de decisiones informada |
| 📋 **Reportes automáticos** | Generación y envío programado de informes a gerencia | ⏰ Cero esfuerzo en reporting |

---

## 🚧 Módulos en Desarrollo — Roadmap

### Fase Actual (Q1 2026) ✅

| Módulo | Estado |
|:-------|:-------|
| ✅ Reporte de Fallas | Implementado |
| ✅ Solicitud de Intervención | Implementado |
| ✅ Gestión de Intervenciones | Implementado |
| ✅ Control de Roturas (Ronda 1 y 6) | Implementado |
| ✅ Prueba Trama Negra (Ronda 3) | Implementado |
| ✅ Panel de Control con IA | Implementado |
| ✅ Histórico con exportación Excel | Implementado |
| ✅ Gestión de Máquinas y Catálogo R-60 | Implementado |
| ✅ 11 Roles con RBAC completo | Implementado |
| ✅ PWA con notificaciones push | Implementado |
| ✅ Vista Previa de roles (admin) | Implementado |
| ✅ Resumen IA diario (Gemini) | Implementado |

### Fase 2 (Q2 2026) 🔄

| Módulo | Descripción | Prioridad |
|:-------|:------------|:----------|
| 📋 **Seguimiento Defectos (Ronda 7)** | Evaluar mejoró / empeoró / sigue igual tras intervención | 🔴 Alta |
| 📈 **Dashboard KPI avanzado** | Gráficos de tendencia, MTBF, MTTR, disponibilidad | 🔴 Alta |
| 🧠 **IA: Predicción de fallas** | Modelos predictivos basados en historial | 🟡 Media |
| 📊 **IA: Análisis por turno** | Comparativa de rendimiento entre turnos | 🟡 Media |
| 🔔 **Escalamiento automático** | Si no se atiende en X min → notifica al superior | 🔴 Alta |

### Fase 3 (Q3-Q4 2026) 🔮

| Módulo | Descripción | Prioridad |
|:-------|:------------|:----------|
| 📸 **IA Visual** | Análisis de defectos textiles por foto | 🟡 Media |
| 💬 **Chatbot IA** | Asistente de mantenimiento en lenguaje natural | 🟡 Media |
| 💰 **Análisis de costos** | Impacto económico por falla y máquina | 🟢 Planificada |
| 📊 **OEE integrado** | Eficiencia Global de Equipos conectada al sistema | 🟢 Planificada |
| 📱 **App nativa** | Versión compilada para Play Store (si se requiere) | 🟢 Planificada |
| 🔐 **Login Microsoft 365** | Autenticación con cuentas corporativas de Microsoft | 🔴 Alta |

---

## 💡 Beneficios Clave

### Para la Operación

| Beneficio | Antes | Ahora con CMMS STC |
|:----------|:------|:--------------------|
| 📝 Reporte de fallas | Papel / verbal / radio | 📱 Digital en segundos con foto |
| ⏱️ Tiempo de respuesta | Variable, sin tracking | ⏰ Medido y priorizado automáticamente |
| 📊 Visibilidad | Ninguna en tiempo real | 🔄 Dashboard en vivo para jefaturas |
| 📋 Historial | Carpetas físicas / Excel | 🔍 Búsqueda instantánea + exportación |
| 🔍 Calidad | Planillas papel | 📱 Patrullas digitales con alertas |

### Para la Gerencia

| Beneficio | Detalle |
|:----------|:--------|
| 🤖 **Decisiones basadas en datos** | IA analiza patrones y sugiere acciones |
| 📈 **KPIs automáticos** | Sin esfuerzo manual de consolidación |
| 🔮 **Mantenimiento predictivo** | Anticipar fallas antes de que ocurran |
| 💰 **Reducción de costos** | Menos paradas no programadas |
| 📱 **Acceso remoto** | Monitoreo desde cualquier lugar |

### Para el Equipo Técnico

| Beneficio | Detalle |
|:----------|:--------|
| 📋 **Órdenes claras** | Prioridad, máquina, síntoma y foto desde el inicio |
| 📚 **Catálogo digital** | Procedimientos paso a paso con imágenes |
| 📊 **Historial por máquina** | Consultar intervenciones previas al diagnosticar |
| 🔔 **Sin interrupciones** | Notificaciones push reemplazan radio/teléfono |

---

## 📊 Indicadores de Impacto Esperados

| Indicador | Meta |
|:----------|:-----|
| ⬇️ Tiempo promedio de respuesta (MTTR) | Reducción del 30% |
| ⬆️ Disponibilidad de máquinas | Incremento del 15% |
| ⬇️ Fallas no reportadas | Reducción a < 5% |
| ⬆️ Eficiencia del inspector | +40% telares revisados por turno |
| ⬇️ Papel y planillas físicas | Eliminación del 100% |
| 🤖 Tiempo en generación de reportes | De horas a segundos (IA) |
| 📈 Visibilidad gerencial | De fin de mes → Tiempo real |

---

## 🔒 Seguridad y Confiabilidad

| Aspecto | Implementación |
|:--------|:---------------|
| 🔐 Autenticación | Google OAuth 2.0 (actual) · Microsoft 365 (planificado) |
| 👥 Autorización | RBAC con 11 roles y permisos granulares |
| ☁️ Infraestructura | Google Firebase (99.95% SLA) |
| 📦 Base de datos | Firestore con reglas de seguridad |
| 🔄 Respaldo | Automático por Firebase |
| 📱 Actualizaciones | Despliegue instantáneo sin instalar nada |

---

## 🏭 Colecciones de Datos

| Colección | Contenido | Tiempo de vida |
|:----------|:----------|:---------------|
| 👥 `usuarios` | Perfiles, roles, sectores | Persistente |
| 📝 `novedades` | Reportes de falla | Persistente |
| ⚙️ `intervenciones` | Órdenes de trabajo | Persistente |
| 🏭 `maquinas` | Inventario de equipos | Persistente |
| 🔍 `patrullas` | Sesiones de inspección | Persistente |
| 📋 `catalogo_puestos_control` | Procedimientos R-60 | Persistente |
| 🏷️ `codigos_defectos` | Catálogo de defectos | Persistente |
| 🤖 `ai_summaries` | Resúmenes generados por IA | Persistente |
| 🔔 `fcm_tokens` | Tokens de notificación | Se actualiza por login |
| ⚙️ `config` | Parámetros del sistema | Persistente |

---

> 📌 **CMMS STC** transforma el mantenimiento de reactivo a proactivo, poniendo la inteligencia artificial al servicio de la operación industrial.

---

*Documento generado: Marzo 2026*  
*Santana Textiles — Hilandería & Tejeduría*  
*Plataforma: [https://stc-cmms.web.app](https://stc-cmms.web.app)*

