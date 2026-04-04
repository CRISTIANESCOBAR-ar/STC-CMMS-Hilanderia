export const DEFAULT_SECTOR = 'HILANDERIA';

export const SECTOR_OPTIONS = [
  'HILANDERIA',
  'TEJEDURIA'
];

export const ROLE_OPTIONS = [
  { value: 'mecanico', label: 'Mecánico' },
  { value: 'tejedor', label: 'Tejedor' },
  { value: 'inspector', label: 'Inspector' },
  { value: 'supervisor', label: 'Supervisor Producción' },
  { value: 'supervisor_mecanico', label: 'Supervisor Mecánico' },
  { value: 'supervisor_electrico', label: 'Supervisor Eléctrico' },
  { value: 'jefe_sector', label: 'Jefe de Mecánicos' },
  { value: 'jefe_electricos', label: 'Jefe de Eléctricos' },
  { value: 'jefe_produccion', label: 'Jefe de Producción' },
  { value: 'gerente_produccion', label: 'Gerente de Producción' },
  { value: 'admin', label: 'Administrador Global' },
];

export const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map(r => [r.value, r.label]));

// ── Vistas de la aplicación ──────────────────────────────────────
export const VISTA_OPTIONS = [
  { slug: 'carga_novedad',  label: 'Reportar Falla',         route: '/' },
  { slug: 'jefe',           label: 'Panel de Control',       route: '/jefe' },
  { slug: 'llamar',         label: 'Solicitar Intervención', route: '/llamar' },
  { slug: 'intervenciones', label: 'Intervenciones',         route: '/intervenciones' },
  { slug: 'historico',      label: 'Historial',              route: '/historico' },
  { slug: 'maquinas',       label: 'Gestión de Máquinas',    route: '/maquinas' },
  { slug: 'usuarios',       label: 'Usuarios',               route: '/usuarios' },
  { slug: 'traducciones',   label: 'Traducciones',           route: '/traducciones' },
  { slug: 'codigos',        label: 'Códigos de Falla',       route: '/codigos' },
  { slug: 'catalogo',       label: 'Catálogo de Máquinas',   route: '/catalogo' },
  { slug: 'sintomas',       label: 'Síntomas',               route: '/sintomas' },
  { slug: 'rondas',         label: 'Rutas de Ronda',         route: '/rondas' },
  { slug: 'patrulla',       label: 'Patrulla Calidad',       route: '/patrulla' },
  { slug: 'shiftreport',    label: 'Shift Report',            route: '/shiftreport' },
  { slug: 'eficiencia',       label: 'Registro Eficiencia',      route: '/eficiencia' },
  { slug: 'paros-anudado',   label: 'Paros / Anudados',        route: '/paros-anudado' },
];

export const VISTA_LABEL = Object.fromEntries(VISTA_OPTIONS.map(v => [v.slug, v.label]));

export const PERMISO_LABELS = {
  verCalidad: 'Ver Calidad',
  crearFalla: 'Crear Falla',
  cerrarOrden: 'Cerrar Orden',
  configSistema: 'Config. Sistema',
};

export const isJefeRole = (role) =>
  ['jefe_sector', 'jefe_electricos', 'jefe_produccion'].includes(role);

export const canDespacharIntervencion = (role) =>
  ['admin', 'gerente_produccion', 'jefe_sector', 'jefe_electricos', 'jefe_produccion', 'supervisor', 'supervisor_mecanico', 'supervisor_electrico', 'inspector'].includes(role);

// Sector por defecto según rol (override del DEFAULT_SECTOR genérico)
export const ROLE_SECTOR_DEFAULT = {
  inspector: 'TEJEDURIA',
  tejedor:   'TEJEDURIA',
};

export const normalizeSectorValue = (value) => {
  if (!value || typeof value !== 'string') return DEFAULT_SECTOR;
  return value.trim().toUpperCase();
};

export const sanitizeSectorList = (values, fallback = DEFAULT_SECTOR) => {
  const rawValues = Array.isArray(values) ? values : [fallback];
  const normalized = rawValues
    .map((value) => normalizeSectorValue(value))
    .filter(Boolean);

  return [...new Set(normalized.length ? normalized : [normalizeSectorValue(fallback)])];
};

export const canAccessJefePanel = (role) =>
  ['admin', 'gerente_produccion', 'jefe_sector', 'jefe_electricos', 'jefe_produccion'].includes(role);

// ── Perfiles de Rol ──────────────────────────────────────────────
// Metadata organizacional por rol: nivel jerárquico, descripción,
// vistas habilitadas (slugs de VISTA_OPTIONS) y matriz de permisos.
// Estos son los DEFAULTS; el admin puede sobreescribirlos desde Firestore.
export const ROLE_PROFILES = {
  tejedor: {
    nivel: 'operativo',
    descripcion: 'Opera telares; reporta fallas y paradas de máquina.',
    vistas: ['carga_novedad'],
    permisos: { verCalidad: false, crearFalla: true, cerrarOrden: false, configSistema: false },
  },
  inspector: {
    nivel: 'operativo',
    descripcion: 'Recorre planta, detecta anomalías y registra novedades de calidad.',
    vistas: ['llamar', 'intervenciones', 'carga_novedad', 'patrulla', 'shiftreport'],
    permisos: { verCalidad: true, crearFalla: true, cerrarOrden: false, configSistema: false },
  },
  mecanico: {
    nivel: 'operativo',
    descripcion: 'Ejecuta intervenciones correctivas y preventivas en máquinas.',
    vistas: ['intervenciones', 'historico'],
    permisos: { verCalidad: false, crearFalla: true, cerrarOrden: true, configSistema: false },
  },
  supervisor: {
    nivel: 'mandos',
    descripcion: 'Supervisa producción del turno; despacha y prioriza intervenciones.',
    vistas: ['carga_novedad', 'intervenciones', 'historico', 'llamar', 'eficiencia'],
    permisos: { verCalidad: true, crearFalla: true, cerrarOrden: false, configSistema: false },
  },
  supervisor_mecanico: {
    nivel: 'mandos',
    descripcion: 'Coordina mecánicos del turno; asigna y supervisa órdenes de trabajo.',
    vistas: ['carga_novedad', 'intervenciones', 'historico', 'llamar', 'eficiencia'],
    permisos: { verCalidad: true, crearFalla: true, cerrarOrden: true, configSistema: false },
  },
  supervisor_electrico: {
    nivel: 'mandos',
    descripcion: 'Coordina electricistas del turno; gestiona fallas eléctricas.',
    vistas: ['carga_novedad', 'intervenciones', 'historico', 'llamar'],
    permisos: { verCalidad: true, crearFalla: true, cerrarOrden: true, configSistema: false },
  },
  jefe_sector: {
    nivel: 'mandos',
    descripcion: 'Lidera equipo mecánico del sector; controla indicadores y recursos.',
    vistas: ['jefe', 'intervenciones', 'historico', 'llamar', 'maquinas'],
    permisos: { verCalidad: true, crearFalla: true, cerrarOrden: true, configSistema: false },
  },
  jefe_electricos: {
    nivel: 'mandos',
    descripcion: 'Lidera equipo eléctrico del sector; gestiona mantenimiento eléctrico.',
    vistas: ['jefe', 'intervenciones', 'historico', 'llamar', 'maquinas'],
    permisos: { verCalidad: true, crearFalla: true, cerrarOrden: true, configSistema: false },
  },
  jefe_produccion: {
    nivel: 'estrategico',
    descripcion: 'Dirige producción del sector; define prioridades y objetivos de planta.',
    vistas: ['jefe', 'intervenciones', 'historico', 'llamar', 'maquinas'],
    permisos: { verCalidad: true, crearFalla: true, cerrarOrden: true, configSistema: false },
  },
  gerente_produccion: {
    nivel: 'estrategico',
    descripcion: 'Visión global de producción; analiza KPIs y toma decisiones estratégicas.',
    vistas: ['jefe', 'intervenciones', 'historico', 'llamar', 'maquinas', 'usuarios'],
    permisos: { verCalidad: true, crearFalla: true, cerrarOrden: true, configSistema: false },
  },
  admin: {
    nivel: 'global',
    descripcion: 'Acceso total al sistema; configura roles, sectores y parámetros globales.',
    vistas: ['*'],
    permisos: { verCalidad: true, crearFalla: true, cerrarOrden: true, configSistema: true },
  },
};

// Niveles jerárquicos con metadata visual (colores para UI)
export const NIVEL_CONFIG = {
  operativo:   { label: 'Operativo',   color: 'blue' },
  mandos:      { label: 'Mandos Medios', color: 'violet' },
  estrategico: { label: 'Estratégico', color: 'emerald' },
  global:      { label: 'Global',      color: 'amber' },
};

// ── Helpers de permisos granulares ───────────────────────────────
const checkPerm = (role, perm) => ROLE_PROFILES[role]?.permisos?.[perm] ?? false;

export const canVerCalidad    = (role) => checkPerm(role, 'verCalidad');
export const canCrearFalla    = (role) => checkPerm(role, 'crearFalla');
export const canCerrarOrden   = (role) => checkPerm(role, 'cerrarOrden');
export const canConfigSistema = (role) => checkPerm(role, 'configSistema');

export const getRoleProfile = (role) => ROLE_PROFILES[role] || null;
export const getRoleNivel   = (role) => ROLE_PROFILES[role]?.nivel || 'operativo';

// ── Turnos ───────────────────────────────────────────────────────
export const TURNOS = [
  { id: 'A', label: 'Turno A', horaInicio: 6,  horaFin: 14 },
  { id: 'B', label: 'Turno B', horaInicio: 14, horaFin: 22 },
  { id: 'C', label: 'Turno C', horaInicio: 22, horaFin: 6  },
];

export const getTurnoActual = (fecha = new Date()) => {
  const h = fecha.getHours();
  if (h >= 6 && h < 14) return 'A';
  if (h >= 14 && h < 22) return 'B';
  return 'C';
};

export const getTurnoLabel = (id) => TURNOS.find(t => t.id === id)?.label || id;

// ── Acciones Rápidas por Rol ─────────────────────────────────────
// Cada acción: id único, icono (lucide name), label, route o action
export const ROLE_QUICK_ACTIONS = {
  tejedor: [
    { id: 'reportar', icon: 'AlertTriangle', label: 'Reportar Falla', action: 'stay' },
  ],
  inspector: [
    { id: 'reportar',     icon: 'AlertTriangle',  label: 'Reportar Falla',    action: 'stay' },
    { id: 'llamar',       icon: 'BellRing',       label: 'Solicitar Intv.',   route: '/llamar' },
    { id: 'roturas',      icon: 'ScanLine',       label: 'Control Roturas',   route: '/patrulla/roturas' },
    { id: 'trama_negra',  icon: 'Eye',            label: 'Trama Negra',       route: '/patrulla/trama' },
    { id: 'seguimiento',  icon: 'ClipboardCheck', label: 'Seguimiento',       route: '/patrulla/seguimiento' },
    { id: 'mi_patrulla',  icon: 'Route',          label: 'Mi Patrulla',       route: '/patrulla' },
  ],
  mecanico: [
    { id: 'intervenciones', icon: 'ClipboardList', label: 'Intervenciones', route: '/intervenciones' },
    { id: 'historico',      icon: 'History',        label: 'Historial',      route: '/historico' },
  ],
  supervisor: [
    { id: 'reportar',       icon: 'AlertTriangle',  label: 'Reportar Falla',   action: 'stay' },
    { id: 'llamar',         icon: 'BellRing',       label: 'Solicitar Intv.',  route: '/llamar' },
    { id: 'eficiencia',     icon: 'Gauge',          label: 'Eficiencia',       route: '/patrulla/eficiencia' },
    { id: 'calidad',        icon: 'ClipboardCheck', label: 'Calidad Sala',     route: '/calidad' },
    { id: 'intervenciones', icon: 'ClipboardList',  label: 'Intervenciones',   route: '/intervenciones' },
    { id: 'historico',      icon: 'History',         label: 'Historial',        route: '/historico' },
  ],
  supervisor_mecanico: [
    { id: 'llamar',         icon: 'BellRing',       label: 'Solicitar Intv.',  route: '/llamar' },
    { id: 'eficiencia',     icon: 'Gauge',          label: 'Eficiencia',       route: '/patrulla/eficiencia' },
    { id: 'calidad',        icon: 'ClipboardCheck', label: 'Calidad Sala',     route: '/calidad' },
    { id: 'intervenciones', icon: 'ClipboardList',  label: 'Intervenciones',   route: '/intervenciones' },
    { id: 'historico',      icon: 'History',         label: 'Historial',        route: '/historico' },
  ],
  supervisor_electrico: [
    { id: 'llamar',         icon: 'BellRing',       label: 'Solicitar Intv.',  route: '/llamar' },
    { id: 'calidad',        icon: 'ClipboardCheck', label: 'Calidad Sala',     route: '/calidad' },
    { id: 'intervenciones', icon: 'ClipboardList',  label: 'Intervenciones',   route: '/intervenciones' },
    { id: 'historico',      icon: 'History',         label: 'Historial',        route: '/historico' },
  ],
  jefe_sector: [
    { id: 'jefe',           icon: 'ShieldCheck',    label: 'Panel Control',    route: '/jefe' },
    { id: 'calidad',        icon: 'ClipboardCheck', label: 'Calidad Sala',     route: '/calidad' },
    { id: 'llamar',         icon: 'BellRing',       label: 'Solicitar Intv.',  route: '/llamar' },
    { id: 'intervenciones', icon: 'ClipboardList',  label: 'Intervenciones',   route: '/intervenciones' },
    { id: 'historico',      icon: 'History',         label: 'Historial',        route: '/historico' },
  ],
  jefe_electricos: [
    { id: 'jefe',           icon: 'ShieldCheck',    label: 'Panel Control',    route: '/jefe' },
    { id: 'calidad',        icon: 'ClipboardCheck', label: 'Calidad Sala',     route: '/calidad' },
    { id: 'llamar',         icon: 'BellRing',       label: 'Solicitar Intv.',  route: '/llamar' },
    { id: 'intervenciones', icon: 'ClipboardList',  label: 'Intervenciones',   route: '/intervenciones' },
    { id: 'historico',      icon: 'History',         label: 'Historial',        route: '/historico' },
  ],
  jefe_produccion: [
    { id: 'jefe',           icon: 'ShieldCheck',    label: 'Panel Control',    route: '/jefe' },
    { id: 'calidad',        icon: 'ClipboardCheck', label: 'Calidad Sala',     route: '/calidad' },
    { id: 'llamar',         icon: 'BellRing',       label: 'Solicitar Intv.',  route: '/llamar' },
    { id: 'intervenciones', icon: 'ClipboardList',  label: 'Intervenciones',   route: '/intervenciones' },
    { id: 'historico',      icon: 'History',         label: 'Historial',        route: '/historico' },
  ],
  gerente_produccion: [
    { id: 'jefe',           icon: 'ShieldCheck',    label: 'Panel Control',    route: '/jefe' },
    { id: 'calidad',        icon: 'ClipboardCheck', label: 'Calidad Sala',     route: '/calidad' },
    { id: 'intervenciones', icon: 'ClipboardList',  label: 'Intervenciones',   route: '/intervenciones' },
    { id: 'historico',      icon: 'History',         label: 'Historial',        route: '/historico' },
  ],
  admin: [
    { id: 'jefe',           icon: 'ShieldCheck',    label: 'Panel Control',    route: '/jefe' },
    { id: 'calidad',        icon: 'ClipboardCheck', label: 'Calidad Sala',     route: '/calidad' },
    { id: 'llamar',         icon: 'BellRing',       label: 'Solicitar Intv.',  route: '/llamar' },
    { id: 'intervenciones', icon: 'ClipboardList',  label: 'Intervenciones',   route: '/intervenciones' },
    { id: 'historico',      icon: 'History',         label: 'Historial',        route: '/historico' },
  ],
};

export const getQuickActions = (role) => ROLE_QUICK_ACTIONS[role] || [];

// ── Defectos de Trama Negra ──────────────────────────────────────
export const DEFECTOS_TRAMA = [
  { id: 'hilo_doble',          label: 'Hilo doble' },
  { id: 'hilo_estirado',       label: 'Hilo estirado' },
  { id: 'hilo_flojo',          label: 'Hilo flojo' },
  { id: 'hilo_roto',           label: 'Hilo roto' },
  { id: 'hilo_grueso',         label: 'Hilo grueso' },
  { id: 'hilo_fino',           label: 'Hilo fino' },
  { id: 'pasamiento_errado',   label: 'Pasamiento errado' },
  { id: 'templazo',            label: 'Templazo' },
  { id: 'peine_abierto',       label: 'Peine abierto' },
  { id: 'hilo_irregular',      label: 'Hilo irregular' },
  { id: 'marca_separador',     label: 'Marca de separador' },
  { id: 'falta_hilo',          label: 'Falta de hilo' },
];

// ── Estados de Telar para Rondas de Paro/Defecto (2, 4, 5) ──────
export const ESTADOS_TELAR = [
  { id: 'trabajando',      label: 'Trabajando',         icon: '✓', color: 'emerald' },
  { id: 'paro_mecanico',   label: 'Paro Mecánico',      icon: '🔧', color: 'red' },
  { id: 'paro_electrico',  label: 'Paro Eléctrico',     icon: '⚡', color: 'amber' },
  { id: 'cambio_articulo', label: 'Cambio de Artículo',  icon: '🔄', color: 'blue' },
  { id: 'sin_urdido',      label: 'Sin Urdido',         icon: '⏸', color: 'purple' },
  { id: 'paro_calidad',    label: 'Paro por Calidad',   icon: '🛑', color: 'rose' },
  { id: 'mantenimiento',   label: 'Mantenimiento Prev.', icon: '🛠', color: 'cyan' },
  { id: 'otro',            label: 'Otro',               icon: '•',  color: 'gray' },
];
