import { ref, onMounted, onUnmounted } from 'vue';

export function usePlantClock() {
  const now = ref(new Date());
  const refresh = () => { now.value = new Date(); };
  let timer;
  onMounted(() => {
    timer = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
  });
  onUnmounted(() => {
    clearInterval(timer);
    window.removeEventListener('focus', refresh);
  });
  return now;
}
