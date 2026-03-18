import { createRouter, createWebHistory } from 'vue-router'
import CargaNovedad from './components/CargaNovedad.vue'
import DashboardJefe from './components/DashboardJefe.vue'
import HistoricoNovedades from './components/HistoricoNovedades.vue'
import GestionMaquinas from './components/GestionMaquinas.vue'
import Usuarios from './components/Usuarios.vue'
import LoginView from './components/LoginView.vue'
import { authService, auth, userRole } from './services/authService'

const routes = [
  { path: '/login', component: LoginView },
  { path: '/', component: CargaNovedad, meta: { requiresAuth: true } },
  { path: '/jefe', component: DashboardJefe, meta: { requiresAuth: true, role: 'admin' } },
  { path: '/historico', component: HistoricoNovedades, meta: { requiresAuth: true } },
  { path: '/maquinas', component: GestionMaquinas, meta: { requiresAuth: true } },
  { path: '/usuarios', component: Usuarios, meta: { requiresAuth: true, role: 'admin' } }
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

  // Validar Roles (si la ruta requiere uno específico)
  if (requiredRole && userRole.value !== requiredRole) {
    // Si no es admin y trata de entrar a algo de admin, mandarlo al home
    if (userRole.value !== 'admin') {
      return '/';
    }
  }
  
  return true;
});
