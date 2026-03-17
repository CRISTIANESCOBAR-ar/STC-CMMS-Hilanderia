<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { authService } from '../services/authService';
import { UserCircle, LogIn, Loader2 } from 'lucide-vue-next';

const router = useRouter();
const isLoading = ref('');
const errorMsg = ref('');

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
</script>

<template>
  <div class="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
    <div class="sm:mx-auto sm:w-full sm:max-w-md">
      <!-- Logo o Título -->
      <div class="text-center">
        <div class="mx-auto h-16 w-16 bg-blue-600 rounded-full flex items-center justify-center shadow-lg border-4 border-white">
          <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
          </svg>
        </div>
        <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">CMMS Hilandería</h2>
        <p class="mt-2 text-center text-sm text-gray-600">
          Sistema de Reporte de Mantenimiento
        </p>
      </div>

      <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div class="bg-white py-8 px-4 shadow-xl sm:rounded-2xl sm:px-10 border border-gray-100">
          
          <div v-if="errorMsg" class="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm text-center font-medium">
            {{ errorMsg }}
          </div>

          <div class="space-y-4">
            <!-- Google Auth -->
            <button
              @click="handleGoogleLogin"
              :disabled="isLoading !== ''"
              class="w-full flex justify-center items-center py-4 px-4 border border-gray-300 rounded-xl shadow-sm bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none transition active:scale-95 duration-150 disabled:opacity-50"
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

            <div class="mt-6 flex items-center justify-between">
              <span class="w-1/5 border-b border-gray-200"></span>
              <span class="text-xs text-center text-gray-500 uppercase tracking-widest font-semibold px-2">Alternativa</span>
              <span class="w-1/5 border-b border-gray-200"></span>
            </div>

            <!-- Anonymous Auth -->
            <button
              @click="handleAnonLogin"
              :disabled="isLoading !== ''"
              class="w-full flex justify-center items-center py-4 px-4 border border-transparent rounded-xl shadow-sm text-base font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none ring-2 ring-offset-2 ring-blue-500 transition active:scale-95 duration-150 disabled:opacity-50"
            >
              <Loader2 v-if="isLoading === 'anon'" class="w-5 h-5 mr-3 animate-spin text-white" />
              <UserCircle v-else class="w-6 h-6 mr-3 text-white opacity-80" />
              Entrar como Invitado
            </button>

          </div>
        </div>
      </div>
    </div>
  </div>
</template>
