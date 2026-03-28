import { createRouter, createWebHistory } from 'vue-router'
import CargaNovedad from './components/CargaNovedad.vue'
import DashboardJefe from './components/DashboardJefe.vue'
import HistoricoNovedades from './components/HistoricoNovedades.vue'
import GestionMaquinas from './components/GestionMaquinas.vue'
import Usuarios from './components/Usuarios.vue'
import Traducciones from './components/Traducciones.vue'
import LoginView from './components/LoginView.vue'
import LlamarIntervencion from './components/LlamarIntervencion.vue'
import IntervencionesView from './components/IntervencionesView.vue'
import CodigosAdmin from './components/CodigosAdmin.vue'
import { authService, userRole } from './services/authService'
import { auth } from './firebase/config'

const routes = [
  { path: '/login', component: LoginView },
  { path: '/', component: CargaNovedad, meta: { requiresAuth: true } },
  { path: '/jefe', component: DashboardJefe, meta: { requiresAuth: true, role: ['admin', 'jefe_sector'] } },
  { path: '/historico', component: HistoricoNovedades, meta: { requiresAuth: true } },
  { path: '/maquinas', component: GestionMaquinas, meta: { requiresAuth: true } },
  { path: '/usuarios', component: Usuarios, meta: { requiresAuth: true, role: 'admin' } },
  { path: '/traducciones', component: Traducciones, meta: { requiresAuth: true, role: 'admin' } },
  { path: '/llamar', component: LlamarIntervencion, meta: { requiresAuth: true, role: ['admin', 'jefe_sector', 'supervisor', 'inspector'] } },
  { path: '/intervenciones', component: IntervencionesView, meta: { requiresAuth: true } },
  { path: '/codigos', component: CodigosAdmin, meta: { requiresAuth: true, role: 'admin' } },
]

export const router = createRouter({
  history: createWebHistory(),
  routes
})

// Guardia de navegación para revisar la autenticación y roles
router.beforeEach(async (to, from) => {
  const requiresAuth = to.matched.some(record => record.meta.requiresAuth);
  const requiredRole = to.meta.role;
  const currentUser = auth.currentUser;

  // Si requiere auth y no hay usuario, redirigir al login
  if (requiresAuth && !currentUser) {
    return '/login';
  } 
  
  // Si ya está logueado e intenta ir al login
  if (to.path === '/login' && currentUser) {
    return '/';
  }

  if (currentUser && !userRole.value) {
    userRole.value = await authService.getUsuarioRole(currentUser.uid);
  }

  // Validar Roles (si la ruta requiere uno específico)
  if (requiredRole) {
    const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!allowedRoles.includes(userRole.value)) {
      return '/';
    }
  }
  
  return true;
});
