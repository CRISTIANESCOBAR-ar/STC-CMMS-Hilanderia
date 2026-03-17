<script setup>
import { ref } from 'vue';
import { db } from '../firebase/config';
import { collection, writeBatch, doc } from 'firebase/firestore';

const isLoading = ref(false);
const showSuccess = ref(false);

const maquinasData = [
  { unidad: 5, maquina: 50201, local_fisico: 1, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA TRUTZSCHLER", lado: "U" },
  { unidad: 5, maquina: 50202, local_fisico: 2, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA TRUTZSCHLER", lado: "U" },
  { unidad: 5, maquina: 50203, local_fisico: 3, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA TRUTZSCHLER", lado: "U" },
  { unidad: 5, maquina: 50204, local_fisico: 4, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA TRUTZSCHLER", lado: "U" },
  { unidad: 5, maquina: 50205, local_fisico: 5, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA TRUTZSCHLER", lado: "U" },
  { unidad: 5, maquina: 50206, local_fisico: 6, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA TRUTZSCHLER", lado: "U" },
  { unidad: 5, maquina: 50207, local_fisico: 7, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA TRUTZSCHLER", lado: "U" },
  { unidad: 5, maquina: 50208, local_fisico: 8, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
  { unidad: 5, maquina: 50209, local_fisico: 9, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
  { unidad: 5, maquina: 50210, local_fisico: 10, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
  { unidad: 5, maquina: 50211, local_fisico: 11, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
  { unidad: 5, maquina: 50212, local_fisico: 12, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
  { unidad: 5, maquina: 50213, local_fisico: 13, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
  { unidad: 5, maquina: 50214, local_fisico: 14, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
  { unidad: 5, maquina: 50215, local_fisico: 15, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
  { unidad: 5, maquina: 50216, local_fisico: 16, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
  { unidad: 5, maquina: 50217, local_fisico: 17, nro_tipo: 2, tipo: "CARDA", nombre_maquina: "CARDA RIETER", lado: "U" },
  { unidad: 5, maquina: 50301, local_fisico: 1, nro_tipo: 3, tipo: "MANUAR", nombre_maquina: "MANUAR TRUTZSCHLER", lado: "U" },
  { unidad: 5, maquina: 50302, local_fisico: 2, nro_tipo: 3, tipo: "MANUAR", nombre_maquina: "MANUAR TRUTZSCHLER", lado: "U" },
  { unidad: 5, maquina: 50303, local_fisico: 3, nro_tipo: 3, tipo: "MANUAR", nombre_maquina: "MANUAR TRUTZSCHLER", lado: "U" },
  { unidad: 5, maquina: 50402, local_fisico: 2, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END II", lado: "A" },
  // 50402 aparece doble en la lista original (A y B), manejaremos ID único concatenado.
  { unidad: 5, maquina: 50402, local_fisico: 2, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END II", lado: "B" },
  { unidad: 5, maquina: 50403, local_fisico: 3, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END III", lado: "A" },
  { unidad: 5, maquina: 50403, local_fisico: 3, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END III", lado: "B" },
  { unidad: 5, maquina: 50405, local_fisico: 5, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END RIETER R-60", lado: "U" },
  { unidad: 5, maquina: 50406, local_fisico: 6, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END RIETER R60", lado: "U" },
  { unidad: 5, maquina: 50407, local_fisico: 7, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END R60", lado: "U" },
  { unidad: 5, maquina: 50408, local_fisico: 8, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END RIETER R60", lado: "U" },
  { unidad: 5, maquina: 50409, local_fisico: 9, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END RIETER R60", lado: "U" },
  { unidad: 5, maquina: 50410, local_fisico: 10, nro_tipo: 4, tipo: "OPEN END", nombre_maquina: "OPEN END RIETER R60", lado: "U" }
];

const inicializarMaquinas = async () => {
  isLoading.value = true;
  showSuccess.value = false;
  try {
    const batch = writeBatch(db);
    const maquinasRef = collection(db, 'maquinas');

    maquinasData.forEach((maquina) => {
      // Usamos el número de máquina + lado como ID del documento (ej. 50402_A, 50201_U)
      const docId = `${maquina.maquina}_${maquina.lado}`.replace(/\s+/g, '');
      const docRef = doc(maquinasRef, docId);
      batch.set(docRef, maquina);
    });

    await batch.commit();
    showSuccess.value = true;
  } catch(error) {
    console.error("Error inicializando máquinas", error);
    alert("Error al inicializar");
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <div class="p-8 max-w-lg mx-auto mt-10 bg-white rounded-xl shadow-md space-y-4">
    <h2 class="text-xl font-bold text-gray-800">Inicialización de Firestore</h2>
    <p class="text-sm text-gray-600">Este botón poblará la base de datos de Firebase (colección 'maquinas') con los 30 registros entregados.</p>
    
    <button 
      @click="inicializarMaquinas" 
      :disabled="isLoading"
      class="w-full bg-indigo-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-indigo-700 transition duration-200 disabled:opacity-50">
      {{ isLoading ? 'Cargando Datos...' : 'Poblar Datos de Máquinas' }}
    </button>

    <div v-if="showSuccess" class="bg-green-100 text-green-800 border-l-4 border-green-500 p-4 rounded mt-4">
      <p class="font-bold">¡Éxito!</p>
      <p>Las máquinas se han insertado en Firestore correctamente.</p>
    </div>
  </div>
</template>
