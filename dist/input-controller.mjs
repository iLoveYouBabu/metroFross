import { normalizeTitle } from './core.mjs';

/** Each title owns a native input, so a retired IME cannot edit the next title. */
export function attachInputController({ input, session, now = () => performance.now(), onInputReplaced = () => {}, onState = () => {}, onAnnounce = () => {}, canInput = () => true }) {
  let composing = false, blockedComposition = false, destroyed = false;
  let listeners = [];
  const current = () => session();
  const allowed = () => !destroyed && canInput() && ['ready', 'running'].includes(current()?.status);
  const detach = () => {
    for (const [node, type, listener] of listeners) node.removeEventListener(type, listener);
    listeners = [];
  };
  const listen = (type, callback) => {
    const node = input;
    const listener = event => { if (!destroyed && node === input) callback(event); };
    node.addEventListener(type, listener); listeners.push([node, type, listener]);
  };
  const focus = () => {
    if (allowed() && !input.disabled && !input.readOnly && input.isConnected !== false) input.focus({ preventScroll: true });
  };
  const syncValue = state => {
    // A native IME owns its live preedit. Rewriting it can lose the next jamo.
    if (destroyed || composing || blockedComposition) return;
    if (input.value !== state.input) input.value = state.input;
    if (!input.value) input.scrollLeft = 0;
  };
  const replaceInput = value => {
    const previous = input;
    // Removing or focusing an input can synchronously emit compositionend.
    // Detach first, and leave the old preedit value completely untouched.
    detach();
    const fresh = previous.cloneNode(false);
    fresh.value = value;
    fresh.scrollLeft = value ? previous.scrollLeft : 0;
    input = fresh; composing = false; blockedComposition = false;
    previous.replaceWith(fresh);
    onInputReplaced(fresh, previous);
    bind();
  };
  const accept = (value, nativeComposing) => {
    if (!allowed() || blockedComposition) return null;
    const engine = current(), timestamp = now();
    const track = engine.snapshot(timestamp).currentTrack;
    const exact = [track.title, ...(track.aliases || [])].some(title => normalizeTitle(title) === normalizeTitle(value));
    // A complete Korean title advances on its final keystroke, even when the
    // IME has not emitted compositionend. The old node owns that later event.
    composing = Boolean(nativeComposing && !exact);
    const state = engine.updateInput(value, timestamp, { isComposing: composing });
    if (state.advanced) replaceInput(state.input);
    onState(state);
    if (state.advanced) {
      onAnnounce(state.status === 'completed' ? '모든 앨범을 완주했어요.' : `${state.completedTrack.title} 완료. 다음 곡 ${state.currentTrack.title}`);
      // Keep focus in this user input task for mobile keyboards and fast typing.
      focus();
    }
    return state;
  };
  function bind() {
    listen('beforeinput', event => {
      if (!allowed() || blockedComposition || ['insertFromPaste', 'insertFromDrop'].includes(event.inputType)) event.preventDefault();
    });
    listen('compositionstart', () => { composing = true; blockedComposition = !allowed(); });
    listen('compositionend', () => {
      composing = false;
      if (blockedComposition) {
        replaceInput(current()?.input || '');
        focus();
        return;
      }
      if (allowed()) accept(input.value, false);
      else syncValue(current()?.snapshot(now()) || { input: '' });
    });
    listen('input', event => {
      const nativeComposing = composing || Boolean(event.isComposing) || event.inputType === 'insertCompositionText';
      // Some browsers deliver the first composition input before compositionstart.
      composing = nativeComposing;
      if (!allowed()) {
        if (nativeComposing) blockedComposition = true;
        else syncValue(current()?.snapshot(now()) || { input: '' });
        return;
      }
      accept(input.value, nativeComposing);
    });
    listen('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (!event.isComposing && !composing) flush();
    });
    listen('paste', event => { event.preventDefault(); onAnnounce('곡 제목을 직접 입력해주세요.'); });
    listen('drop', event => event.preventDefault());
  }
  function cancel() { if (!destroyed) replaceInput(current()?.input || ''); }
  function reset() { cancel(); }
  function flush() { return allowed() ? accept(input.value, false) : null; }
  bind();
  return {
    reset, cancel, flush, syncValue, isComposing: () => composing,
    destroy() { detach(); destroyed = true; composing = false; blockedComposition = false; }
  };
}
