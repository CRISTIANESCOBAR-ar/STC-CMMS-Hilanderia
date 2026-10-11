import tippy from 'tippy.js';

// Create instances only when requested: production sheets have many cells.
export function createTooltipDirective(createTooltip = tippy) {
  const states = new WeakMap();
  return {
    mounted(el, binding) {
      const state = { content: binding.value, instance: null };
      state.show = () => {
        if (!state.content) return;
        state.instance ??= createTooltip(el, {
          content: state.content, theme: 'light-border', placement: 'top',
          appendTo: () => document.body, delay: [250, 0], duration: [120, 80],
          maxWidth: 280, allowHTML: false, touch: false, hideOnClick: true,
          trigger: 'mouseenter focus',
        });
        state.instance.show();
      };
      state.hide = () => state.instance?.hide();
      el.addEventListener('mouseenter', state.show);
      el.addEventListener('focus', state.show);
      el.addEventListener('keydown', state.hide);
      el.addEventListener('input', state.hide);
      states.set(el, state);
    },
    updated(el, binding) {
      const state = states.get(el);
      if (!state) return;
      state.content = binding.value;
      state.instance?.setContent(binding.value || '');
      if (!binding.value) state.instance?.hide();
    },
    beforeUnmount(el) {
      const state = states.get(el);
      if (!state) return;
      el.removeEventListener('mouseenter', state.show);
      el.removeEventListener('focus', state.show);
      el.removeEventListener('keydown', state.hide);
      el.removeEventListener('input', state.hide);
      state.instance?.destroy();
      states.delete(el);
    },
  };
}

export const vTippy = createTooltipDirective();
