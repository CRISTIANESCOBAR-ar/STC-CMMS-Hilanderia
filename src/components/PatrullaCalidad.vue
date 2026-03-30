<script setup>
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { userProfile, userRole } from '../services/authService';
import { getTurnoActual, getTurnoLabel, ROLE_LABEL } from '../constants/organization';
import { ArrowLeft, ScanLine, Eye, ClipboardCheck, Route as RouteIcon, Construction } from 'lucide-vue-next';
import RegistroRoturas from './RegistroRoturas.vue';
import PruebaTramaNegra from './PruebaTramaNegra.vue';

const router = useRouter();
const route = useRoute();

const turnoActual = ref(getTurnoActual());
const subVista = computed(() => route.params.sub || null);

const secciones = [
  { id: 'roturas',      icon: ScanLine,       label: 'Control de Roturas',   desc: 'Registrar Ro.U y Ro.T por telar (Rondas 1 y 6)', color: 'blue' },
  { id: 'trama',        icon: Eye,            label: 'Prueba Trama Negra',   desc: 'Inspección con trama blanca en telares negros (Ronda 3)', color: 'amber' },
  { id: 'seguimiento',  icon: ClipboardCheck, label: 'Seguimiento Defectos', desc: 'Evaluar mejoró / empeoró / sigue igual (Ronda 7)', color: 'emerald' },
];

const seccionActiva = computed(() => secciones.find(s => s.id === subVista.value));
</script>

<template>
  <div class="h-[calc(100vh-110px)] bg-gray-50 flex flex-col overflow-hidden">
    <main class="flex-1 max-w-lg mx-auto w-full px-3 pt-3 pb-4 flex flex-col space-y-3 overflow-y-auto">

      <!-- Header compacto -->
      <div class="flex items-center gap-3 px-1">
        <button @click="subVista ? router.push('/patrulla') : router.back()" class="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-all">
          <ArrowLeft class="w-5 h-5 text-gray-600" />
        </button>
        <span class="text-[11px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded">{{ getTurnoLabel(turnoActual) }}</span>
        <span class="text-xs text-gray-500 font-bold">{{ userProfile?.nombre || 'Inspector' }}</span>
      </div>

      <!-- Hub: lista de secciones (cuando no hay sub-vista) -->
      <template v-if="!subVista">
        <div
          v-for="sec in secciones"
          :key="sec.id"
          @click="router.push('/patrulla/' + sec.id)"
          class="bg-white p-4 rounded-xl shadow-sm border border-gray-200 hover:border-indigo-200 transition-all cursor-pointer active:scale-[0.99] flex items-center gap-4"
        >
          <div class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
               :class="{
                 'bg-blue-100 text-blue-600': sec.color === 'blue',
                 'bg-amber-100 text-amber-600': sec.color === 'amber',
                 'bg-emerald-100 text-emerald-600': sec.color === 'emerald',
               }">
            <component :is="sec.icon" class="w-5 h-5" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-black text-gray-800">{{ sec.label }}</p>
            <p class="text-[11px] text-gray-500 font-medium mt-0.5">{{ sec.desc }}</p>
          </div>
          <ArrowLeft class="w-4 h-4 text-gray-300 rotate-180 shrink-0" />
        </div>
      </template>

      <!-- Sub-vista: Roturas -->
      <template v-else-if="subVista === 'roturas'">
        <RegistroRoturas />
      </template>

      <!-- Sub-vista: Trama Negra -->
      <template v-else-if="subVista === 'trama'">
        <PruebaTramaNegra />
      </template>

      <!-- Sub-vista placeholder (seguimiento) -->
      <template v-else>
        <div class="flex-1 flex flex-col items-center justify-center text-center space-y-4 py-12">
          <div class="w-16 h-16 rounded-2xl bg-indigo-100 flex items-center justify-center">
            <Construction class="w-8 h-8 text-indigo-500" />
          </div>
          <div>
            <p class="text-lg font-black text-gray-700">En desarrollo</p>
            <p class="text-sm text-gray-400 font-medium mt-1">
              {{ seccionActiva?.desc || 'Esta sección se implementará próximamente.' }}
            </p>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>
