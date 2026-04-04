import { createRouter, createWebHistory } from 'vue-router'
import { authService, userRole, authReady } from './services/authService'
import { auth } from './firebase/config'
import { loadProfiles, canAccessRoute, getDefaultRoute } from './services/profileService'

// Login se carga inmediato (primera pantalla), el resto lazy
import LoginView from './components/LoginView.vue'

const routes = [
  { path: '/login', component: LoginView },
  { path: '/', component: () => import('./components/CargaNovedad.vue'), meta: { requiresAuth: true } },
  { path: '/jefe', component: () => import('./components/DashboardJefe.vue'), meta: { requiresAuth: true, role: ['admin', 'gerente_produccion', 'jefe_sector', 'jefe_electricos', 'jefe_produccion'] } },
  { path: '/historico', component: () => import('./components/HistoricoNovedades.vue'), meta: { requiresAuth: true } },
  { path: '/maquinas', component: () => import('./components/GestionMaquinas.vue'), meta: { requiresAuth: true } },
  { path: '/usuarios', component: () => import('./components/Usuarios.vue'), meta: { requiresAuth: true, role: 'admin' } },
  { path: '/traducciones', component: () => import('./components/Traducciones.vue'), meta: { requiresAuth: true, role: 'admin' } },
  { path: '/llamar', component: () => import('./components/LlamarIntervencion.vue'), meta: { requiresAuth: true, role: ['admin', 'gerente_produccion', 'jefe_sector', 'jefe_electricos', 'jefe_produccion', 'supervisor', 'supervisor_mecanico', 'supervisor_electrico', 'inspector'] } },
  { path: '/intervenciones', component: () => import('./components/IntervencionesView.vue'), meta: { requiresAuth: true } },
  { path: '/codigos', component: () => import('./components/CodigosAdmin.vue'), meta: { requiresAuth: true, role: 'admin' } },
  { path: '/catalogo', component: () => import('./components/CatalogoExplorer.vue'), meta: { requiresAuth: true, role: 'admin' } },
  { path: '/sintomas', component: () => import('./components/SintomasAdmin.vue'), meta: { requiresAuth: true, role: 'admin' } },
  { path: '/intervenciones/:id', component: () => import('./components/IntervencionDetalle.vue'), meta: { requiresAuth: true } },
  { path: '/patrulla', component: () => import('./components/PatrullaCalidad.vue'), meta: { requiresAuth: true } },
  { path: '/patrulla/:sub', component: () => import('./components/PatrullaCalidad.vue'), meta: { requiresAuth: true } },
  { path: '/patrulla-historial', component: () => import('./components/HistorialPatrullas.vue'), meta: { requiresAuth: true } },
  { path: '/calidad', component: () => import('./components/CalidadSala.vue'), meta: { requiresAuth: true } },
  { path: '/shiftreport', component: () => import('./components/ShiftReport.vue'), meta: { requiresAuth: true } },
  { path: '/eficiencia', component: () => import('./components/RegistroEficiencia.vue'), meta: { requiresAuth: true } },
  { path: '/paros-anudado', component: () => import('./components/ParosAnudado.vue'), meta: { requiresAuth: true } },
  { path: '/operarios', component: () => import('./components/OperariosTejeduria.vue'), meta: { requiresAuth: true } },
]

export const router = createRouter({
  history: createWebHistory(),
  routes
})

// Guardia de navegación: auth + control de vistas por perfil
router.beforeEach(async (to, from) => {
  // Esperar a que Firebase Auth restaure la sesión desde IndexedDB
  // sin esto, auth.currentUser es null al recargar y redirige a /login
  await authReady;

  const requiresAuth = to.matched.some(record => record.meta.requiresAuth);
  const currentUser = auth.currentUser;

  if (requiresAuth && !currentUser) {
    return '/login';
  }

  if (currentUser) {
    if (!userRole.value) {
      userRole.value = await authService.getUsuarioRole(currentUser.uid);
    }
    await loadProfiles();

    if (to.path === '/login') {
      return getDefaultRoute(userRole.value);
    }
    if (requiresAuth && !canAccessRoute(userRole.value, to.path)) {
      const fallback = getDefaultRoute(userRole.value);
      if (fallback === to.path) return true;
      return fallback;
    }
  }

  return true;
});
