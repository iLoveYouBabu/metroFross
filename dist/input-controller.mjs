import { normalizeTitle } from './core.mjs';

/** Keep native IME events at the input boundary; the scoring engine sees each committed title once. */
export function attachInputController({ input, session, now = () => performance.now(), onState = () => {}, onAnnounce = () => {}, canInput = () => true, defer = callback => setTimeout(callback, 0), cancelDefer = clearTimeout }) {
  let composing = false, timer = null, generation = 0, pending = null, tail = null, destroyed = false;
  const listeners = [];
  const current = () => session();
  const allowed = () => !destroyed && canInput() && ['ready', 'running'].includes(current()?.status);
  const listen = (type, callback) => { input.addEventListener(type, callback); listeners.push([type, callback]); };
  const clearTimer = () => { generation += 1; if (timer !== null) cancelDefer(timer); timer = null; };
  const syncValue = state => {
    if (!composing && input.value !== state.input) input.value = state.input;
    if (!input.value) input.scrollLeft = 0;
  };
  const rememberTail = (engine, value, index) => {
    tail = { engine, value, data: [...value].at(-1) || '', index, until: now() + 300 };
  };
  const discardTail = value => {
    if (!tail || tail.engine !== current() || tail.index !== current().index || now() > tail.until) { tail = null; return false; }
    if (value !== tail.value && value !== tail.data && value !== '') return false;
    input.value = current().input;
    input.scrollLeft = 0;
    return true;
  };
  const publish = (state, engine, value, wasComposing) => {
    if (state.advanced) {
      if (wasComposing) rememberTail(engine, value, state.index);
      input.value = ''; input.scrollLeft = 0;
    }
    onState(state);
    if (state.advanced) onAnnounce(state.status === 'completed' ? '모든 앨범을 완주했어요.' : `${state.completedTrack.title} 완료. 다음 곡 ${state.currentTrack.title}`);
    return state;
  };
  const commit = (value, isComposing) => {
    if (!allowed()) return null;
    const engine = current(), wasComposing = composing || engine.isComposing;
    if (!isComposing) { composing = false; clearTimer(); }
    const state = engine.updateInput(value, now(), { isComposing });
    return publish(state, engine, value, wasComposing);
  };
  const focus = () => { if (allowed() && !input.disabled && !input.readOnly && input.isConnected !== false) input.focus({ preventScroll: true }); };
  const finishComposition = value => {
    const engine = current(), index = engine.index;
    clearTimer(); const run = generation;
    // Blur commits most native IMEs. The fallback covers browsers that omit compositionend.
    timer = defer(() => {
      timer = null;
      if (run !== generation || !allowed() || current() !== engine || engine.index !== index) return;
      commit(value, false); focus();
    });
    input.blur();
    // Refocus in the same user-input event to retain the mobile keyboard where supported.
    focus();
  };
  const accept = (value, isComposing) => {
    const state = commit(value, isComposing);
    if (state && isComposing && normalizeTitle(value) === normalizeTitle(state.target)) finishComposition(value);
    return state;
  };
  listen('beforeinput', event => {
    if (!allowed() || ['insertFromPaste', 'insertFromDrop'].includes(event.inputType)) event.preventDefault();
  });
  listen('compositionstart', () => {
    if (!allowed()) { composing = false; return; }
    tail = null; clearTimer(); composing = true;
  });
  listen('compositionend', () => {
    const value = input.value;
    if (discardTail(value)) { composing = false; clearTimer(); return; }
    const wasComposing = composing || current()?.isComposing;
    composing = false; clearTimer();
    if (!allowed()) {
      if (current()?.status === 'paused') pending = { engine: current(), index: current().index, value, wasComposing };
      syncValue(current()?.snapshot(now()) || { input: '' });
      return;
    }
    // The committed browser value can be followed by a duplicate input event.
    const engine = current();
    const state = commit(value, false);
    if (state?.advanced && wasComposing) rememberTail(engine, value, state.index);
  });
  listen('input', event => {
    if (discardTail(input.value)) return;
    if (!allowed()) { syncValue(current()?.snapshot(now()) || { input: '' }); return; }
    composing = composing || Boolean(event.isComposing);
    accept(input.value, composing);
  });
  listen('keydown', event => {
    if (event.key?.length === 1 || event.key === 'Backspace' || event.key === 'Delete') tail = null;
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!event.isComposing && !composing) flush();
  });
  listen('paste', event => { event.preventDefault(); onAnnounce('곡 제목을 직접 입력해주세요.'); });
  listen('drop', event => event.preventDefault());

  function cancel() { clearTimer(); composing = false; if (current()) syncValue(current().snapshot(now())); }
  function reset() { cancel(); pending = null; tail = null; }
  function flush() {
    if (!allowed()) return null;
    if (pending) {
      const saved = pending; pending = null;
      if (saved.engine === current() && saved.index === current().index) {
        const state = commit(saved.value, false);
        if (state?.advanced && saved.wasComposing) rememberTail(saved.engine, saved.value, state.index);
        return state;
      }
    }
    return commit(input.value, false);
  }
  return { reset, cancel, flush, syncValue, isComposing: () => composing, destroy() { reset(); destroyed = true; for (const [type, callback] of listeners) input.removeEventListener(type, callback); } };
}
