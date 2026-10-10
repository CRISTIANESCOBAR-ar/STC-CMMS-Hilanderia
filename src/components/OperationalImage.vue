<script setup>
import { ref, watch, onUnmounted } from 'vue';
import { sessionUser } from '../services/authService';
import { loadOperationalImage } from '../services/operationalImageService';
const props = defineProps({ src: { type: String, required: true } });
const imageUrl = ref(null);
const failed = ref(false);
let generation = 0;
function clearImage() {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
  imageUrl.value = null;
}
watch([() => props.src, () => sessionUser.value?.uid], async () => {
  const current = ++generation;
  clearImage();
  failed.value = false;
  if (!sessionUser.value) return;
  try {
    const url = await loadOperationalImage(props.src);
    if (generation !== current) { URL.revokeObjectURL(url); return; }
    imageUrl.value = url;
  } catch { if (generation === current) failed.value = true; }
}, { immediate: true });
onUnmounted(() => { generation++; clearImage(); });
</script>
<template>
  <img v-if="imageUrl" :src="imageUrl" alt="Foto de la incidencia" />
  <span v-else role="status" class="block p-2 text-xs text-gray-400">{{ failed ? 'Foto no disponible' : 'Cargando foto…' }}</span>
</template>
