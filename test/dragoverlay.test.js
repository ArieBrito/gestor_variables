// Prueba del helper _bindFileDragOverlay (public/js/app.js) con un DOM simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('function _bindFileDragOverlay');
const end = src.indexOf('\n    }\n', start) + 6;
const helper = src.slice(start, end);

function setup() {
  const mk = () => {
    const l = {};
    return { l, addEventListener: (t, f) => (l[t] ||= []).push(f), fire: (t, e = {}) => (l[t] || []).forEach((f) => f(e)) };
  };
  const document = mk();
  const window = mk();
  const content = { ...mk(), contains: (n) => n === 'child' };
  const cls = new Set();
  const overlay = { classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) } };
  const bind = new Function('document', 'window', `${helper}; return _bindFileDragOverlay;`)(document, window);
  bind(content, overlay);
  const ev = (types) => ({ dataTransfer: { types, dropEffect: '' }, preventDefault() {}, stopPropagation() {}, relatedTarget: null });
  return { document, content, overlay, cls, ev };
}

test('un arrastre que no es de archivos NO activa el overlay', () => {
  const { content, cls, ev } = setup();
  content.fire('dragenter', ev(['text/plain']));
  content.fire('dragover', ev(['text/plain']));
  assert.equal(cls.has('active'), false);
});

test('un arrastre de archivos activa y drop lo apaga', () => {
  const { content, cls, ev } = setup();
  content.fire('dragenter', ev(['Files']));
  assert.equal(cls.has('active'), true);
  content.fire('drop', ev(['Files']));
  assert.equal(cls.has('active'), false);
});

test('si el overlay queda pegado, un movimiento del mouse lo apaga', () => {
  const { content, document, cls, ev } = setup();
  content.fire('dragenter', ev(['Files']));
  assert.equal(cls.has('active'), true);
  document.fire('mousemove', {});
  assert.equal(cls.has('active'), false);
});

test('dragleave a un hijo no lo apaga; salir del modal sí', () => {
  const { content, cls, ev } = setup();
  content.fire('dragenter', ev(['Files'])); // contenedor
  content.fire('dragenter', ev(['Files'])); // hijo
  const toChild = ev(['Files']);
  toChild.relatedTarget = 'child';
  content.fire('dragleave', toChild); // sale del hijo, sigue dentro
  assert.equal(cls.has('active'), true);
  content.fire('dragleave', ev(['Files'])); // sale del modal
  assert.equal(cls.has('active'), false);
});
