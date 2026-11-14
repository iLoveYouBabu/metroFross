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
  return { engine, input, controller, tasks, states, announcements, drain, type, lock(value) { locked = value; }, wait(milliseconds) { time += milliseconds; } };
}

test('switching to English after a delay does not restore the last Korean syllable', () => {
  const f = fixture(['나에게로 오는 길', 'Feel Good']);
  f.input.emit('compositionstart'); f.type('나에게로 오는 길', true); f.drain();
  f.wait(1500); f.input.emit('keydown', { key: 'HangulMode' }); f.input.emit('keydown', { key: 'F' });
  f.input.value = '길'; f.input.emit('input', { data: '길', inputType: 'insertText', isComposing: false });
  assert.equal(f.engine.input, ''); assert.equal(f.input.value, '');
  f.type('F'); assert.equal(f.engine.input, 'F'); assert.equal(f.engine.snapshot(2000).stats.errors, 0);
});

test('mixed Korean residue and the next English key retain the actual English key', () => {
  for (const residue of ['트', '하트', '투 하트']) {
    const f = fixture(['투 하트', 'Feel Good']);
    f.input.emit('compositionstart'); f.type('투 하트', true); f.drain(); f.wait(1500);
    f.input.emit('keydown', { key: 'F' }); f.input.value = `${residue}F`;
    f.input.emit('input', { data: 'F', inputType: 'insertText' });
    assert.equal(f.engine.input, 'F', residue); assert.equal(f.input.value, 'F', residue);
    f.type('Feel Good'); assert.equal(f.engine.status, 'completed'); assert.equal(f.engine.snapshot(2000).stats.accuracy, 100);
  }
});

test('a late Korean commit after the first English key preserves existing English input', () => {
  const f = fixture(['투 하트', 'Feel Good']);
  f.input.emit('compositionstart'); f.type('투 하트', true); f.drain(); f.type('F'); f.wait(1500);
  f.input.value = 'F트'; f.input.emit('input', { data: '트', inputType: 'insertFromComposition' });
  assert.equal(f.engine.input, 'F'); assert.equal(f.input.value, 'F');
  f.type('Fe'); assert.equal(f.engine.input, 'Fe'); assert.equal(f.engine.snapshot(2000).stats.errors, 0);
});

test('beforeinput blocks a stale Korean commit while allowing the new English key', () => {
  const f = fixture(['투 하트', 'Feel Good']);
  f.input.emit('compositionstart'); f.type('투 하트', true); f.drain(); f.wait(1500);
  assert.equal(f.input.emit('beforeinput', { data: '트', inputType: 'insertText' }).defaultPrevented, true);
  assert.equal(f.input.emit('beforeinput', { data: 'F', inputType: 'insertText' }).defaultPrevented, false);
});
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

test('an IME started during countdown stays blocked when its commit arrives after the countdown', () => {
  const f = fixture(); f.lock(true); f.input.emit('compositionstart'); f.type('투 하트', true);
  f.lock(false); f.input.value = '투 하트'; f.input.emit('compositionend', { data: '트' });
  f.type('투 하트', false); f.drain(); assert.equal(f.engine.index, 0); assert.equal(f.engine.status, 'ready');
  f.input.emit('compositionstart'); f.type('투 하트', true); f.drain(); assert.equal(f.engine.index, 1);
});

test('cancelling after native confirmation prevents the queued refocus from stealing focus', () => {
  const f = fixture(); f.input.nativeEnd = true; f.input.emit('compositionstart'); f.type('투 하트', true);
  assert.equal(f.input.focused, false); f.controller.cancel(); f.engine.pause(100); f.drain();
  assert.equal(f.input.focused, false); assert.equal(f.engine.index, 1);
});
test('a restart invalidates stale confirmation callbacks and the next identical syllable is accepted', () => {
  const f = fixture(['가', '가나']); f.input.emit('compositionstart'); f.type('가', true); const stale = [...f.tasks.values()][0];
  f.engine.reset(); f.controller.reset(); stale(); assert.equal(f.engine.index, 0);
  f.input.emit('compositionstart'); f.type('가', true); f.drain(); f.input.emit('compositionstart'); f.type('가', true);
  assert.equal(f.engine.input, '가'); assert.equal(f.engine.index, 1);
});
