<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { X, Camera, SwitchCamera, ImagePlus } from 'lucide-vue-next';

const emit = defineEmits(['capture', 'cancel']);

const videoRef = ref(null);
const canvasRef = ref(null);
const stream = ref(null);
const error = ref('');
const facingMode = ref('environment');
const hasMulipleCameras = ref(false);
const isCapturing = ref(false);

const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 960;
const JPEG_QUALITY = 0.72;

const startCamera = async () => {
  error.value = '';
  // Detener stream anterior si existe
  stopCamera();

  try {
    const constraints = {
      video: {
        facingMode: facingMode.value,
        width: { ideal: CAPTURE_WIDTH },
        height: { ideal: CAPTURE_HEIGHT },
      },
      audio: false,
    };
    const s = await navigator.mediaDevices.getUserMedia(constraints);
    stream.value = s;
    if (videoRef.value) {
      videoRef.value.srcObject = s;
    }
  } catch (err) {
    console.error('Error accediendo a cámara:', err);
    if (err.name === 'NotAllowedError') {
      error.value = 'Permiso de cámara denegado. Habilítalo en la configuración del navegador.';
    } else if (err.name === 'NotFoundError') {
      error.value = 'No se encontró cámara en este dispositivo.';
    } else {
      error.value = 'No se pudo acceder a la cámara. Usa la galería.';
    }
  }
};

const stopCamera = () => {
  if (stream.value) {
    stream.value.getTracks().forEach(t => t.stop());
    stream.value = null;
  }
};

const switchCamera = async () => {
  facingMode.value = facingMode.value === 'environment' ? 'user' : 'environment';
  await startCamera();
};

const capturePhoto = () => {
  if (!videoRef.value || isCapturing.value) return;
  isCapturing.value = true;

  const video = videoRef.value;
  const canvas = canvasRef.value;
  // Usar dimensiones reales del video (puede ser menor que lo pedido)
  const w = video.videoWidth || CAPTURE_WIDTH;
  const h = video.videoHeight || CAPTURE_HEIGHT;
  // Limitar a CAPTURE_WIDTH si el video es más grande
  const scale = w > CAPTURE_WIDTH ? CAPTURE_WIDTH / w : 1;
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(
    (blob) => {
      stopCamera();
      isCapturing.value = false;
      if (blob) {
        emit('capture', blob);
      }
    },
    'image/jpeg',
    JPEG_QUALITY
  );
};

const openGallery = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      stopCamera();
      emit('capture', file);
    }
  };
  input.click();
};

const cancel = () => {
  stopCamera();
  emit('cancel');
};

onMounted(async () => {
  // Detectar si hay múltiples cámaras
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === 'videoinput');
    hasMulipleCameras.value = cameras.length > 1;
  } catch { /* ignore */ }
  await startCamera();
});

onUnmounted(() => {
  stopCamera();
});
</script>

<template>
  <!-- Overlay fullscreen -->
  <div class="fixed inset-0 z-[9999] bg-black flex flex-col">
    <!-- Video preview -->
    <div class="flex-1 relative overflow-hidden flex items-center justify-center bg-black">
      <video
        v-show="!error"
        ref="videoRef"
        autoplay
        playsinline
        muted
        class="w-full h-full object-cover"
      />
      <!-- Error -->
      <div v-if="error" class="text-center px-8">
        <Camera class="w-16 h-16 text-gray-500 mx-auto mb-4" />
        <p class="text-white text-sm mb-6">{{ error }}</p>
        <button @click="openGallery" class="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm">
          Elegir de galería
        </button>
      </div>
      <!-- Flash blanco al capturar -->
      <div v-if="isCapturing" class="absolute inset-0 bg-white/80 transition-opacity"></div>
    </div>

    <!-- Controles inferiores -->
    <div class="bg-black/90 backdrop-blur-sm px-6 py-5 pb-8 flex items-center justify-between safe-area-bottom">
      <!-- Cerrar -->
      <button @click="cancel" class="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20">
        <X class="w-6 h-6 text-white" />
      </button>

      <!-- Capturar -->
      <button
        v-if="!error"
        @click="capturePhoto"
        :disabled="isCapturing"
        class="w-18 h-18 rounded-full border-4 border-white flex items-center justify-center active:scale-90 transition-transform disabled:opacity-50"
      >
        <div class="w-14 h-14 rounded-full bg-white"></div>
      </button>
      <div v-else class="w-18 h-18"></div>

      <!-- Galería / Cambiar cámara -->
      <div class="flex gap-2">
        <button
          v-if="hasMulipleCameras && !error"
          @click="switchCamera"
          class="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20"
        >
          <SwitchCamera class="w-5 h-5 text-white" />
        </button>
        <button @click="openGallery" class="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20">
          <ImagePlus class="w-5 h-5 text-white" />
        </button>
      </div>
    </div>

    <!-- Canvas oculto -->
    <canvas ref="canvasRef" class="hidden" />
  </div>
</template>

<style scoped>
.safe-area-bottom {
  padding-bottom: max(2rem, env(safe-area-inset-bottom, 2rem));
}
</style>
