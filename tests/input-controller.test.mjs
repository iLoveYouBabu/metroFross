import test from 'node:test';
import assert from 'node:assert/strict';
import { TypingSession } from '../dist/core.mjs';
import { attachInputController } from '../dist/input-controller.mjs';

class Input extends EventTarget {
  value = ''; scrollLeft = 0; disabled = false; readOnly = false; isConnected = true; nativeEnd = false; focused = true;
  emit(type, fields = {}) { const event = new Event(type, { cancelable: true }); for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, { value }); this.dispatchEvent(event); return event; }
  focus() { this.focused = true; }
  blur() { this.focused = false; if (this.nativeEnd) this.emit('compositionend'); }
}
function fixture(titles = ['투 하트', '두근두근', '클로버']) {
  const engine = new TypingSession(titles.map((title, id) => ({ id, title })));
  const input = new Input(), tasks = new Map(), states = [], announcements = [];
  let locked = false, id = 0, time = 0;
  const controller = attachInputController({ input, session: () => engine, now: () => ++time, canInput: () => !locked, onState: state => { states.push(state); controller.syncValue(state); }, onAnnounce: text => announcements.push(text), defer: callback => { tasks.set(++id, callback); return id; }, cancelDefer: key => tasks.delete(key) });
  const drain = () => { while (tasks.size) { const [key, callback] = tasks.entries().next().value; tasks.delete(key); callback(); } };
  const type = (value, isComposing = false) => { input.value = value; input.emit('input', { isComposing }); };
  return { engine, input, controller, tasks, states, announcements, drain, type, lock(value) { locked = value; } };
}
test('an exact ordinary input advances without Enter and preserves the next first key', () => {
  const f = fixture(); f.type('투 하트'); assert.equal(f.engine.index, 1); assert.equal(f.input.value, '');
  f.type('두'); assert.equal(f.engine.input, '두'); assert.equal(f.engine.index, 1);
});
test('native compositionend caused by automatic confirmation advances exactly once', () => {
  const f = fixture(); f.input.nativeEnd = true; f.input.emit('compositionstart'); f.type('투 하트', true); f.drain();
  assert.equal(f.engine.index, 1); assert.equal(f.announcements.length, 1); assert.equal(f.input.focused, true);
  f.type('투 하트', false); assert.equal(f.input.value, ''); assert.equal(f.engine.input, '');
  f.input.emit('compositionstart'); f.type('두', true); assert.equal(f.engine.input, '두');
});
test('a missing native compositionend uses fallback and late IME tails do not enter the next song', () => {
  const f = fixture(); f.input.emit('compositionstart'); f.type('투 하트', true); assert.equal(f.engine.index, 0); f.drain();
  assert.equal(f.engine.index, 1); f.input.value = '트'; f.input.emit('compositionend'); f.type('트', false);
  assert.equal(f.engine.input, ''); assert.equal(f.announcements.length, 1);
  f.input.emit('compositionstart'); f.type('두근두근', true); f.drain(); assert.equal(f.engine.index, 2);
});
test('partial syllables and typos remain editable, and only an exact composed title is confirmed', () => {
  const f = fixture(['클로버', '위고']); f.input.emit('compositionstart'); f.type('클로ㅂ', true); f.drain(); assert.equal(f.engine.index, 0);
  f.type('클로버', true); f.drain(); assert.equal(f.engine.index, 1); assert.equal(f.engine.snapshot(100).stats.accuracy, 100);
});
test('pause cancels queued automatic advancement and resumes one saved native commit', () => {
  const f = fixture(); f.input.emit('compositionstart'); f.type('투 하트', true); f.controller.cancel(); f.engine.pause(100);
  f.input.emit('compositionend'); f.drain(); assert.equal(f.engine.index, 0);
  f.engine.resume(200); f.controller.flush(); assert.equal(f.engine.index, 1); f.controller.flush(); assert.equal(f.engine.index, 1);
});
test('countdown blocks input without retaining a title to submit when it ends', () => {
  const f = fixture(); f.lock(true); assert.equal(f.input.emit('beforeinput', { inputType: 'insertText' }).defaultPrevented, true);
  f.type('투 하트'); f.input.emit('compositionend'); f.drain(); assert.equal(f.engine.status, 'ready');
  f.lock(false); f.controller.flush(); assert.equal(f.engine.index, 0); assert.equal(f.input.value, ''); f.type('투 하트'); assert.equal(f.engine.index, 1);
});
test('a restart invalidates stale confirmation callbacks and the next identical syllable is accepted', () => {
  const f = fixture(['가', '가나']); f.input.emit('compositionstart'); f.type('가', true); const stale = [...f.tasks.values()][0];
  f.engine.reset(); f.controller.reset(); stale(); assert.equal(f.engine.index, 0);
  f.input.emit('compositionstart'); f.type('가', true); f.drain(); f.input.emit('compositionstart'); f.type('가', true);
  assert.equal(f.engine.input, '가'); assert.equal(f.engine.index, 1);
});
