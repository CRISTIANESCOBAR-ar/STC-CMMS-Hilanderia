<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { authService } from '../services/authService';
import { UserCircle, Loader2, RefreshCw, Wrench } from 'lucide-vue-next';

// Hora del build incrustada por Vite
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'Desconocido';

const router = useRouter();
const isLoading = ref('');
const errorMsg = ref('');
const hasUpdate = ref(false);

onMounted(async () => {
  if ('serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (let reg of regs) {
        // Detectar si ya hay un update en cola
        if (reg.waiting) {
          hasUpdate.value = true;
        }
        // Escuchar si llega un update mientras la pantalla de login está abierta
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              hasUpdate.value = true;
            }
          });
        });
      }
    } catch (err) {
      console.warn('Check update sw error', err);
    }
  }
});

const handleGoogleLogin = async () => {
  isLoading.value = 'google';
  errorMsg.value = '';
  try {
    await authService.loginConGoogle();
    router.push('/'); // Redirigir siempre a la Carga de Novedades (default view)
  } catch (error) {
    errorMsg.value = 'Error al ingresar con Google. Verifica tu conexión.';
  } finally {
    isLoading.value = '';
  }
};

const handleAnonLogin = async () => {
  isLoading.value = 'anon';
  errorMsg.value = '';
  try {
    await authService.loginAnonimo();
    router.push('/'); 
  } catch (error) {
    errorMsg.value = 'No se pudo ingresar como invitado.';
  } finally {
    isLoading.value = '';
  }
};

const limpiarCacheYActualizar = async () => {
  isLoading.value = 'update';
  try {
    // 1. Desregistrar Service Workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (let registration of registrations) {
        await registration.unregister();
      }
    }
    // 2. Limpiar Caches de la PWA
    if ('caches' in window) {
      const keys = await caches.keys();
      for (let key of keys) {
        await caches.delete(key);
      }
    }
    // 3. Recargar la página forzando la red
    window.location.reload(true);
  } catch (err) {
    console.error("Error al limpiar caché:", err);
    errorMsg.value = "No se pudo actualizar. Intenta borrar caché del navegador manualmente.";
    isLoading.value = '';
  }
};
</script>

<template>
  <div class="h-dvh overflow-hidden bg-gray-50 flex flex-col pt-2 pb-4 sm:px-6 lg:px-8">
    
    <!-- Logo Superior -->
    <div class="shrink-0 flex justify-center w-full mt-2">
      <img src="/LogoSantana.jpg" alt="Santana Textiles" class="h-16 sm:h-20 object-contain mix-blend-multiply opacity-95 hover:opacity-100 transition-opacity" />
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col justify-center w-full sm:mx-auto sm:max-w-md">
      
      <!-- Titulo e Icono -->
      <div class="text-center mb-4">
        <div class="mx-auto h-12 w-12 bg-blue-600 rounded-xl rotate-3 flex items-center justify-center shadow-lg border-2 border-gray-50 mb-3 transition-transform hover:rotate-0 duration-300">
          <Wrench class="w-8 h-8 text-white -rotate-3" stroke-width="2.5" />
        </div>
        <h2 class="text-3xl font-black text-gray-900 tracking-tight">CMMS Hilandería</h2>
        <p class="mt-2 text-sm font-medium text-gray-500 tracking-widest">
          Reporte de Mantenimiento
        </p>
      </div>

      <!-- Tarjeta -->
      <div class="bg-white py-6 px-4 shadow-xl sm:rounded-3xl rounded-2xl mx-4 sm:mx-0 sm:px-10 border border-gray-100 relative overflow-hidden">
        
        <!-- Banner de Novedad (Aparece si hay actualización y decora la caja) -->
        <div v-if="hasUpdate" class="absolute top-0 inset-x-0 h-1 bg-green-500 animate-pulse"></div>

        <div v-if="errorMsg" class="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm text-center font-medium">
          {{ errorMsg }}
        </div>

        <div class="space-y-4">
          <!-- Google Auth -->
          <button
            @click="handleGoogleLogin"
            :disabled="isLoading !== ''"
            class="w-full flex justify-center items-center py-4 px-4 border border-gray-200 rounded-xl shadow-sm bg-white text-base font-bold text-gray-700 hover:bg-gray-50 hover:border-gray-300 hover:shadow transition active:scale-[0.98] duration-150 disabled:opacity-50"
          >
            <Loader2 v-if="isLoading === 'google'" class="w-5 h-5 mr-3 animate-spin text-blue-600" />
            <svg v-else class="w-5 h-5 mr-3" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            <span>Continuar con Google</span>
          </button>

          <div class="py-2 flex items-center justify-between">
            <span class="w-1/4 border-b border-gray-100"></span>
            <span class="text-[10px] text-center text-gray-400 tracking-widest font-bold px-2">Invitado</span>
            <span class="w-1/4 border-b border-gray-100"></span>
          </div>

          <!-- Anonymous Auth -->
          <button
            @click="handleAnonLogin"
            :disabled="isLoading !== ''"
            class="w-full flex justify-center items-center py-4 px-4 border border-transparent rounded-xl shadow-[0_4px_14px_0_rgba(37,99,235,0.39)] text-base font-bold text-white bg-blue-600 hover:bg-blue-700 hover:shadow-[0_6px_20px_rgba(37,99,235,0.23)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all active:scale-[0.98] duration-150 disabled:opacity-50 disabled:shadow-none"
          >
            <Loader2 v-if="isLoading === 'anon'" class="w-5 h-5 mr-3 animate-spin text-white" />
            <UserCircle v-else class="w-6 h-6 mr-3 text-white opacity-90" />
            Entrar al Panel
          </button>
        </div>
      </div>
    </div>

    <!-- Area Inferior: Footer y Notificador de Actualizaciones -->
    <div class="shrink-0 w-full flex flex-col items-center justify-end mt-auto space-y-2 pb-4 px-4">
      
      <!-- Notificador de Versión Nueva -->
      <transition 
        enter-active-class="transform transition ease-out duration-500" 
        enter-from-class="translate-y-4 opacity-0" 
        enter-to-class="translate-y-0 opacity-100" 
        leave-active-class="transition ease-in duration-300"
        leave-from-class="opacity-100" 
        leave-to-class="opacity-0">
        
        <div v-if="hasUpdate" class="w-full max-w-sm bg-green-50 rounded-2xl border border-green-200 p-4 shadow-sm">
          <p class="text-sm text-green-800 text-center font-semibold mb-3">Nueva versión disponible</p>
          <button 
            @click="limpiarCacheYActualizar"
            :disabled="isLoading !== ''"
            class="w-full flex justify-center items-center py-3 px-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold transition shadow-sm active:scale-95"
          >
            <RefreshCw class="w-4 h-4 mr-2" :class="{ 'animate-spin': isLoading === 'update' }" />
            Actualizar ahora
          </button>
        </div>
      </transition>

      <!-- Botón Manual (Si No Hay Notificación Automática) -->
      <button 
        v-if="!hasUpdate"
        @click="limpiarCacheYActualizar"
        :disabled="isLoading !== ''"
        class="inline-flex items-center text-xs font-semibold text-gray-400 hover:text-gray-700 bg-gray-100/50 hover:bg-gray-100 py-2 px-4 rounded-full transition-colors"
      >
        <RefreshCw class="w-3 h-3 mr-2" :class="{ 'animate-spin': isLoading === 'update' }" />
        Actualización manual
      </button>

      <!-- Build Info -->
      <p class="text-[10px] text-gray-400 font-mono tracking-wider opacity-70">
        v{{ BUILD_TIME }}
      </p>
    </div>
  </div>
</template>
