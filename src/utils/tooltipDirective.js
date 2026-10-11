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
      state.hide = () => {
        state.instance?.clearDelayTimeouts?.();
        state.instance?.hide();
      };
      el.addEventListener('mouseenter', state.show);
      el.addEventListener('focus', state.show);
      el.addEventListener('keydown', state.hide);
      el.addEventListener('input', state.hide);
      el.addEventListener('mouseleave', state.hide);
      el.addEventListener('blur', state.hide);
      el.addEventListener('pointerdown', state.hide);
      // Hide before a Vue click handler opens a modal and makes this element inert.
      el.addEventListener('click', state.hide, true);
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
      el.removeEventListener('mouseleave', state.hide);
      el.removeEventListener('blur', state.hide);
      el.removeEventListener('pointerdown', state.hide);
      el.removeEventListener('click', state.hide, true);
      state.instance?.destroy();
      states.delete(el);
    },
  };
}

export const vTippy = createTooltipDirective();
