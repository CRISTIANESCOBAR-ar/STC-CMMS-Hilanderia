export const NAVIGATION_ITEMS = [
  { slug:'jefe',label:'Panel de control',route:'/jefe',icon:'ShieldCheck',group:'operation' },
  { slug:'carga_novedad',label:'Reportar falla',route:'/',icon:'Wrench',group:'operation' },
  { slug:'llamar',label:'Solicitar intervención',route:'/llamar',icon:'BellRing',group:'operation' },
  { slug:'intervenciones',label:'Intervenciones',route:'/intervenciones',icon:'ClipboardList',group:'operation' },
  { slug:'patrulla',label:'Patrulla de calidad',route:'/patrulla',icon:'ScanSearch',group:'operation' },
  { slug:'shiftreport',label:'Puntos por turno',route:'/shiftreport',icon:'FileText',group:'production' },
  { slug:'operarios',label:'Operarios Tejeduría',route:'/operarios',icon:'Users',group:'production' },
  { slug:'eficiencia',label:'Registro de eficiencia',route:'/eficiencia',icon:'Gauge',group:'production' },
  { slug:'paros-anudado',label:'Paros / Anudados',route:'/paros-anudado',icon:'Scissors',group:'production' },
  { slug:'patrulla_seguimiento',label:'Seguimiento de patrulla',route:'/patrulla-seguimiento',icon:'Eye',group:'production' },
  { slug:'historico',label:'Historial de novedades',route:'/historico',icon:'History',group:'reference' },
  { slug:'catalogo',label:'Catálogo y procedimientos',route:'/catalogo',icon:'BookMarked',group:'reference' },
  { slug:'maquinas',label:'Gestión de máquinas',route:'/maquinas',icon:'Settings2',group:'administration' },
  { slug:'usuarios',label:'Usuarios y perfiles',route:'/usuarios',icon:'Users',group:'administration' },
  { slug:'sintomas',label:'Síntomas',route:'/sintomas',icon:'Stethoscope',group:'administration' },
  { slug:'codigos',label:'Códigos de falla y paradas',route:'/codigos',icon:'ListFilter',group:'administration' },
  { slug:'rondas',label:'Rutas de ronda',route:'/rondas',icon:'Route',group:'administration' },
  { slug:'traducciones',label:'Traducciones de catálogo',route:'/traducciones',icon:'Languages',group:'administration' },
];
const CORE=['jefe','carga_novedad','llamar','intervenciones','patrulla'];
const GROUPS=[{ id:'operation',label:'Operación',icon:'Wrench' },{ id:'production',label:'Producción',icon:'Factory' },{ id:'reference',label:'Consultas',icon:'BookOpen' },{ id:'administration',label:'Administración',icon:'Settings2' }];
export function buildNavigation(role,allowed) {
  const daily=role==='auxiliar' ? ['shiftreport','operarios','patrulla_seguimiento']
    : role?.startsWith('supervisor') ? [...CORE,'eficiencia']:CORE;
  const items=NAVIGATION_ITEMS.filter(item=>allowed(item.slug)),primary=daily.map(slug=>items.find(item=>item.slug===slug)).filter(Boolean);
  const used=new Set(primary.map(item=>item.slug));
  return { primary,groups:GROUPS.map(group=>({ ...group,items:items.filter(item=>item.group===group.id && !used.has(item.slug)) })).filter(group=>group.items.length) };
}
export function navigationActive(path,item) { return item.route==='/' ? path==='/':path===item.route || path.startsWith(item.route+'/'); }
