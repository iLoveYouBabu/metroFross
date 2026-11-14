import { normalizeTitle } from './core.mjs';

/** Keep native IME events at the input boundary; the scoring engine sees each committed title once. */
export function attachInputController({ input, session, now = () => performance.now(), onState = () => {}, onAnnounce = () => {}, canInput = () => true, defer = callback => setTimeout(callback, 0), cancelDefer = clearTimeout }) {
  let composing = false, timer = null, focusTimer = null, generation = 0, pending = null, tail = null, destroyed = false, compositionText = '', autoFinishing = false, blockedComposition = false, blockedValue = '';
  const listeners = [];
  const current = () => session();
  const allowed = () => !destroyed && canInput() && ['ready', 'running'].includes(current()?.status);
  const listen = (type, callback) => { input.addEventListener(type, callback); listeners.push([type, callback]); };
  const clearTimer = () => { generation += 1; if (timer !== null) cancelDefer(timer); timer = null; };
  const syncValue = state => {
    if (!composing && input.value !== state.input) input.value = state.input;
    if (!input.value) input.scrollLeft = 0;
  };
  const rememberTail = (engine, value, index, blocked = false) => {
    const lastWord = value.trim().split(/\s+/u).at(-1);
    const fragments = [...new Set([value, lastWord, compositionText, [...value].at(-1)])].filter(Boolean).sort((a, b) => b.length - a.length);
    tail = { engine, fragments, index, blocked };
  };
  const validTail = () => {
    if (tail && (tail.engine !== current() || tail.index !== current().index)) tail = null;
    return tail && !composing;
  };
  const isNewPrefix = value => {
    const track = current()?.snapshot(now()).currentTrack;
    const normalized = normalizeTitle(value);
    return track && [track.title, ...(track.aliases || [])].some(title => normalizeTitle(title).startsWith(normalized));
  };
  const cleanTail = value => {
    if (!validTail() || !value || (!tail.blocked && isNewPrefix(value))) return value;
    const live = current().input;
    // A delayed IME commit may replace the input, prepend its last word, or
    // arrive behind an English key already accepted for the next title.
    for (const fragment of tail.fragments) {
      if (value === fragment) return live;
      if (value.startsWith(fragment)) return value.slice(fragment.length);
      if (live && value.startsWith(live + fragment)) return live + value.slice(live.length + fragment.length);
    }
    return value;
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
  const requestFocus = () => {
    if (focusTimer !== null) cancelDefer(focusTimer);
    const engine = current(), index = engine.index;
    focusTimer = defer(() => { focusTimer = null; if (current() === engine && engine.index === index) focus(); });
  };
  const finishComposition = value => {
    const engine = current(), index = engine.index;
    clearTimer(); const run = generation; autoFinishing = true;
    // Blur commits most native IMEs. The fallback covers browsers that omit compositionend.
    timer = defer(() => {
      timer = null;
      if (run !== generation || !allowed() || current() !== engine || engine.index !== index) return;
      commit(value, false); autoFinishing = false; requestFocus();
    });
    input.blur();
    // Refocus after native composition events have had a chance to finish.
  };
  const accept = (value, isComposing) => {
    const state = commit(value, isComposing);
    if (state && isComposing && normalizeTitle(value) === normalizeTitle(state.target)) finishComposition(value);
    return state;
  };
  listen('beforeinput', event => {
    if (!allowed() || blockedComposition || ['insertFromPaste', 'insertFromDrop'].includes(event.inputType)) event.preventDefault();
    else if (validTail() && typeof event.data === 'string' && tail.fragments.includes(event.data) && !isNewPrefix(event.data)) event.preventDefault();
  });
  listen('compositionstart', () => {
    if (!allowed()) { blockedComposition = true; blockedValue = ''; composing = false; return; }
    blockedComposition = false; blockedValue = ''; tail = null; compositionText = ''; clearTimer(); composing = true;
  });
  listen('compositionupdate', event => { if (typeof event.data !== 'string') return; if (blockedComposition) blockedValue = event.data; else if (composing) compositionText = event.data; });
  listen('compositionend', event => {
    if (blockedComposition) {
      const value = input.value || blockedValue || event.data || '';
      blockedComposition = false; blockedValue = ''; composing = false; clearTimer();
      rememberTail(current(), value, current().index, true); input.value = current().input; return;
    }
    const rawValue = input.value, value = cleanTail(rawValue);
    if (value !== rawValue) { input.value = value; if (value === current().input) { composing = false; clearTimer(); return; } }
    const wasComposing = composing || current()?.isComposing;
    if (wasComposing && typeof event.data === 'string') compositionText = event.data;
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
    if (autoFinishing) { autoFinishing = false; requestFocus(); }
  });
  listen('input', event => {
    if (blockedComposition) { blockedValue = input.value; input.value = current().input; return; }
    const rawValue = input.value, value = cleanTail(rawValue);
    if (value !== rawValue) { input.value = value; if (value === current().input) return; }
    if (!allowed()) { syncValue(current()?.snapshot(now()) || { input: '' }); return; }
    composing = composing || Boolean(event.isComposing);
    if (composing && typeof event.data === 'string') compositionText = event.data;
    accept(input.value, composing);
  });
  listen('keydown', event => {
    if (tail?.blocked && !event.isComposing && (event.key?.length === 1 || event.key === 'Backspace' || event.key === 'Delete')) tail = null;
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!event.isComposing && !composing) flush();
  });
  listen('paste', event => { event.preventDefault(); onAnnounce('곡 제목을 직접 입력해주세요.'); });
  listen('drop', event => event.preventDefault());

  function cancel() { clearTimer(); if (focusTimer !== null) cancelDefer(focusTimer); focusTimer = null; autoFinishing = false; composing = false; if (current()) syncValue(current().snapshot(now())); }
  function reset() { cancel(); pending = null; tail = null; compositionText = ''; blockedComposition = false; blockedValue = ''; }
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
