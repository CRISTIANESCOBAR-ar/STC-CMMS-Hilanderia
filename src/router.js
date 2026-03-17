import { createRouter, createWebHistory } from 'vue-router'
import CargaNovedad from './components/CargaNovedad.vue'
import DashboardJefe from './components/DashboardJefe.vue'
import InitData from './components/InitData.vue'
import LoginView from './components/LoginView.vue'
import { authService } from './services/authService'

const routes = [
  { path: '/login', component: LoginView },
  { path: '/', component: CargaNovedad, meta: { requiresAuth: true } },
  { path: '/jefe', component: DashboardJefe, meta: { requiresAuth: true } },
  { path: '/init', component: InitData } // Oculto, temporal
]

export const router = createRouter({
  history: createWebHistory(),
  routes
})

// Guardia de navegación para revisar la autenticación
router.beforeEach((to, from, next) => {
  const requiresAuth = to.matched.some(record => record.meta.requiresAuth)
  
  // En vez de require, consultaremos authService directamente ya que lo importamos arriba
  import('./services/authService').then(module => {
    let currentUser = module.authService ? module.auth.currentUser : null;
    
    // Si requiere auth y no hay usuario, redirigir al login
    if (requiresAuth && !currentUser) {
      next('/login');
    } 
    // Si va a login y ya está logueado, redirigir al inicio
    else if (to.path === '/login' && currentUser) {
      next('/');
    } 
    else {
      next();
    }
  });
})
