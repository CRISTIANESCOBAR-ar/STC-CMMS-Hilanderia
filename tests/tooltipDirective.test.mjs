import test from 'node:test';
import assert from 'node:assert/strict';
import { createTooltipDirective } from '../src/utils/tooltipDirective.js';

test('tooltips initialize on demand, update live content and release listeners', () => {
  const listeners = new Map();
  const el = {
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name, handler) { assert.equal(listeners.get(name), handler); listeners.delete(name); },
  };
  let created = 0, shown = 0, hidden = 0, destroyed = 0, cancelled = 0, content;
  const directive = createTooltipDirective((target, options) => {
    assert.equal(target, el);
    assert.equal(options.allowHTML, false);
    content = options.content;
    created++;
    return { show() { shown++; }, hide() { hidden++; }, clearDelayTimeouts() { cancelled++; }, destroy() { destroyed++; }, setContent(value) { content = value; } };
  });
  directive.mounted(el, { value: 'Pendiente' });
  assert.equal(created, 0);
  directive.updated(el, { value: 'Guardando' });
  listeners.get('focus')();
  assert.equal(content, 'Guardando');
  listeners.get('mouseenter')();
  assert.equal(created, 1);
  assert.equal(shown, 2);
  directive.updated(el, { value: 'Sin pendientes' });
  assert.equal(content, 'Sin pendientes');
  listeners.get('input')();
  assert.equal(hidden, 1);
  listeners.get('pointerdown')();
  listeners.get('click')();
  listeners.get('blur')();
  listeners.get('mouseleave')();
  assert.equal(hidden, 5);
  assert.equal(cancelled, 5, 'click and focus changes cancel queued tooltip displays');
  directive.beforeUnmount(el);
  assert.equal(destroyed, 1);
  assert.equal(listeners.size, 0);
});
