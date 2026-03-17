import { createRouter, createWebHistory } from 'vue-router'
import CargaNovedad from './components/CargaNovedad.vue'
import DashboardJefe from './components/DashboardJefe.vue'
import HistoricoNovedades from './components/HistoricoNovedades.vue'
import GestionMaquinas from './components/GestionMaquinas.vue'
import LoginView from './components/LoginView.vue'
import { authService, auth } from './services/authService'

const routes = [
  { path: '/login', component: LoginView },
  { path: '/', component: CargaNovedad, meta: { requiresAuth: true } },
  { path: '/jefe', component: DashboardJefe, meta: { requiresAuth: true } },
  { path: '/historico', component: HistoricoNovedades, meta: { requiresAuth: true } },
  { path: '/maquinas', component: GestionMaquinas, meta: { requiresAuth: true } }
]

export const router = createRouter({
  history: createWebHistory(),
  routes
})

// Guardia de navegación para revisar la autenticación
router.beforeEach((to, from) => {
  const requiresAuth = to.matched.some(record => record.meta.requiresAuth);
  const currentUser = auth.currentUser;

  // Si requiere auth y no hay usuario, redirigir al login
  if (requiresAuth && !currentUser) {
    return '/login';
  } 
  // Si va a login y ya está logueado, redirigir al inicio
  else if (to.path === '/login' && currentUser) {
    return '/';
  } 
  
  // En cualquier otro caso, permitir la navegación
  return true;
});
