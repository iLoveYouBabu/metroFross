const INITIAL_KEYS = ['r', 'R', 's', 'e', 'E', 'f', 'a', 'q', 'Q', 't', 'T', 'd', 'w', 'W', 'c', 'z', 'x', 'v', 'g'];
const VOWEL_KEYS = ['k', 'o', 'i', 'O', 'j', 'p', 'u', 'P', 'h', 'hk', 'ho', 'hl', 'y', 'n', 'nj', 'np', 'nl', 'b', 'm', 'ml', 'l'];
const FINAL_KEYS = ['', 'r', 'R', 'rt', 's', 'sw', 'sg', 'e', 'f', 'fr', 'fa', 'fq', 'ft', 'fx', 'fv', 'fg', 'a', 'q', 'qt', 't', 'T', 'd', 'w', 'c', 'z', 'x', 'v', 'g'];
const JAMO_KEYS = new Map();
INITIAL_KEYS.forEach((keys, index) => JAMO_KEYS.set(String.fromCodePoint(0x1100 + index), keys));
VOWEL_KEYS.forEach((keys, index) => JAMO_KEYS.set(String.fromCodePoint(0x1161 + index), keys));
FINAL_KEYS.slice(1).forEach((keys, index) => JAMO_KEYS.set(String.fromCodePoint(0x11a8 + index), keys));

function canonicalize(value) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u2018\u2019\u201a\u201b\u2032\u02bc]/gu, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/gu, '"')
    .replace(/[\u2010-\u2015\u2212]/gu, '-')
    .replace(/\s+/gu, ' ');
}

/** Comparison is case-insensitive; punctuation stays part of the title. */
export function normalizeTitle(value) {
  return canonicalize(value).trim().toLowerCase();
}

function measurementText(value) {
  // Preserve a real word-separating space while the next word is being typed.
  return canonicalize(value).replace(/^ +/u, '').toLowerCase();
}

function characterTokens(character) {
  const code = character.codePointAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const syllable = code - 0xac00;
    const initial = Math.floor(syllable / 588);
    const vowel = Math.floor((syllable % 588) / 28);
    const final = syllable % 28;
    return [...(INITIAL_KEYS[initial] + VOWEL_KEYS[vowel] + FINAL_KEYS[final])].map(key => `ko:${key}`);
  }
  if (JAMO_KEYS.has(character)) return [...JAMO_KEYS.get(character)].map(key => `ko:${key}`);
  return [`char:${character}`];
}

function inputTokens(value) {
  return [...value.normalize('NFKC')].flatMap(characterTokens);
}

/** Two-set Korean keyboard strokes. Shifted jamo count once; compound jamo twice. */
export function countStrokes(value) {
  return inputTokens(canonicalize(value)).length;
}

function prefixLength(left, right) {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) length += 1;
  return length;
}

function prepareTrack(track, index) {
  if (!track || typeof track.title !== 'string' || !track.title.trim()) {
    throw new TypeError(`Track ${index} must have a non-empty title.`);
  }
  const candidates = [];
  const seen = new Set();
  for (const title of [track.title, ...(Array.isArray(track.aliases) ? track.aliases : [])]) {
    if (typeof title !== 'string' || !title.trim()) continue;
    const normalized = normalizeTitle(title);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push({ title: canonicalize(title).trim(), normalized, tokens: inputTokens(normalized) });
  }
  return { track: { ...track }, candidates };
}

function bestCandidate(candidates, value) {
  const normalized = normalizeTitle(value);
  const tokens = inputTokens(measurementText(value));
  let best = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    const prefix = prefixLength(tokens, candidate.tokens);
    const exact = normalized === candidate.normalized;
    const cleanPrefix = prefix === tokens.length && tokens.length <= candidate.tokens.length;
    const score = (exact ? 1e7 : 0) + (cleanPrefix ? 1e6 : 0) + prefix;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

const graphemeSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;
function graphemes(value) {
  return graphemeSegmenter ? [...graphemeSegmenter.segment(value)].map(item => item.segment) : [...value];
}

function feedbackFor(candidate, value, composing) {
  const raw = graphemes(String(value));
  const target = graphemes(candidate.title);
  const expected = graphemes(candidate.normalized);
  const feedback = [];
  let prefix = '';
  let previous = [];
  let current = [];

  // Render the raw input exactly so a native input caret stays aligned with its
  // overlay, even when case, curly quotes, full-width letters or spaces differ.
  for (let rawIndex = 0; rawIndex < raw.length; rawIndex += 1) {
    const char = raw[rawIndex];
    prefix += char;
    current = graphemes(measurementText(prefix));
    const changedStart = prefixLength(previous, current);
    let status = 'correct';
    let extra = false;
    for (let index = changedStart; index < current.length; index += 1) {
      if (index >= expected.length && current[index] === ' ' && normalizeTitle(prefix) === candidate.normalized) continue;
      if (current[index] === expected[index]) continue;
      const actualKeys = inputTokens(current[index]);
      const targetKeys = expected[index] ? inputTokens(expected[index]) : [];
      const partialSyllable = composing && rawIndex === raw.length - 1 && index === current.length - 1 &&
        actualKeys.length < targetKeys.length && prefixLength(actualKeys, targetKeys) === actualKeys.length;
      if (partialSyllable && status !== 'incorrect') status = 'pending';
      else {
        status = 'incorrect';
        if (index >= expected.length) extra = true;
      }
    }
    feedback.push({ char, typed: char, status, ...(extra ? { extra: true } : {}) });
    previous = current;
  }
  for (const char of target.slice(current.length)) feedback.push({ char, typed: '', status: 'pending' });
  return feedback;
}

function timestamp(value) {
  if (!Number.isFinite(value)) throw new TypeError('Pass a finite performance.now() timestamp in milliseconds.');
  return value;
}

export class TypingSession {
  constructor(tracks) {
    if (!Array.isArray(tracks) || tracks.length === 0) throw new TypeError('A typing course needs at least one track.');
    this.course = tracks.map(prepareTrack);
    this.reset();
  }

  reset() {
    this.status = 'ready';
    this.index = 0;
    this.input = '';
    this.isComposing = false;
    this.correctStrokes = 0;
    this.attemptedStrokes = 0;
    this._committedTokens = [];
    this._activeSince = null;
    this._elapsed = 0;
    return this.snapshot(0);
  }

  start(now) {
    timestamp(now);
    if (this.status === 'ready') {
      this.status = 'running';
      this._activeSince = now;
    }
    return this.snapshot(now);
  }

  pause(now) {
    timestamp(now);
    if (this.status === 'running') {
      this._elapsed += Math.max(0, now - this._activeSince);
      this._activeSince = null;
      this.status = 'paused';
    }
    return this.snapshot(now);
  }

  resume(now) {
    timestamp(now);
    if (this.status === 'paused') {
      this._activeSince = now;
      this.status = 'running';
    }
    return this.snapshot(now);
  }

  updateInput(value, now, { isComposing = false } = {}) {
    timestamp(now);
    const rawValue = String(value ?? '');
    if (this.status === 'ready' && rawValue.length > 0) this.start(now);
    if (this.status !== 'running') return { ...this.snapshot(now), advanced: false, completedTrack: null };

    this.input = rawValue;
    this.isComposing = Boolean(isComposing);
    const current = this.course[this.index];
    const candidate = bestCandidate(current.candidates, rawValue);
    const exact = normalizeTitle(rawValue) === candidate.normalized;

    // An IME may replace one syllable many times. Score its committed result once.
    if (!this.isComposing) {
      const measured = exact ? measurementText(rawValue).trimEnd() : measurementText(rawValue);
      const newTokens = inputTokens(measured);
      const oldTokens = this._committedTokens;
      const prefix = prefixLength(oldTokens, newTokens);
      let suffix = 0;
      while (suffix < oldTokens.length - prefix && suffix < newTokens.length - prefix &&
        oldTokens[oldTokens.length - suffix - 1] === newTokens[newTokens.length - suffix - 1]) suffix += 1;
      for (let position = prefix; position < newTokens.length - suffix; position += 1) {
        this.attemptedStrokes += 1;
        if (newTokens[position] === candidate.tokens[position]) this.correctStrokes += 1;
      }
      this._committedTokens = newTokens;
    }

    if (!this.isComposing && exact) {
      const completedTrack = current.track;
      this.index += 1;
      this.input = '';
      this._committedTokens = [];
      if (this.index === this.course.length) {
        this._elapsed += Math.max(0, now - this._activeSince);
        this._activeSince = null;
        this.status = 'completed';
      }
      return { ...this.snapshot(now), advanced: true, completedTrack };
    }
    return { ...this.snapshot(now), advanced: false, completedTrack: null };
  }

  snapshot(now) {
    timestamp(now);
    const elapsedMs = this._elapsed + (this.status === 'running' ? Math.max(0, now - this._activeSince) : 0);
    const current = this.course[this.index] || null;
    const candidate = current ? bestCandidate(current.candidates, this.input) : null;
    const feedback = candidate ? feedbackFor(candidate, this.input, this.isComposing) : [];
    return {
      status: this.status,
      index: this.index,
      currentTrack: current?.track || null,
      input: this.input,
      isComposing: this.isComposing,
      target: candidate?.title || '',
      feedback,
      hasError: feedback.some(character => character.status === 'incorrect'),
      stats: {
        elapsedMs,
        cpm: elapsedMs > 0 ? this.correctStrokes * 60000 / elapsedMs : 0,
        accuracy: this.attemptedStrokes > 0 ? this.correctStrokes / this.attemptedStrokes * 100 : 100,
        errors: this.attemptedStrokes - this.correctStrokes,
        correctStrokes: this.correctStrokes,
        attemptedStrokes: this.attemptedStrokes
      },
      progress: { completed: this.index, total: this.course.length, ratio: this.index / this.course.length }
    };
  }
}
