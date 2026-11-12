import test from 'node:test';
import assert from 'node:assert/strict';
import { TypingSession, normalizeTitle, countStrokes } from '../dist/core.mjs';

const track = (title, aliases = []) => ({ id: title, title, aliases });

test('normalization accepts case, repeated whitespace, full-width forms, and typographic punctuation', () => {
  assert.equal(normalizeTitle('  ＤＭ  '), 'dm');
  assert.equal(normalizeTitle(' Don’t   Care — Now '), "don't care - now");
  const session = new TypingSession([track("Don't Care - Now")]);
  const result = session.updateInput('  DON’T   CARE — NOW  ', 1000);
  assert.equal(result.status, 'completed');
  assert.equal(result.stats.accuracy, 100);
});

test('each exact title advances once, clears input, and finishes the entire course', () => {
  const session = new TypingSession([track('DM'), track('WE GO')]);
  session.start(0);
  const first = session.updateInput('dm', 1000);
  assert.equal(first.advanced, true);
  assert.equal(first.completedTrack.id, 'DM');
  assert.equal(first.index, 1);
  assert.equal(first.currentTrack.title, 'WE GO');
  assert.equal(first.input, '');
  const last = session.updateInput('we go', 2000);
  assert.equal(last.status, 'completed');
  assert.equal(last.currentTrack, null);
  assert.deepEqual(last.progress, { completed: 2, total: 2, ratio: 1 });
  assert.equal(last.stats.correctStrokes, 7);
  assert.equal(last.stats.cpm, 210);
});

test('aliases are accepted and feedback follows the alias being typed', () => {
  const session = new TypingSession([track('두근두근 (DKDK)', ['두근두근', 'DKDK'])]);
  const partial = session.updateInput('dk', 0);
  assert.equal(partial.target, 'DKDK');
  assert.deepEqual(partial.feedback.map(item => item.status), ['correct', 'correct', 'pending', 'pending']);
  const complete = session.updateInput('dKdK', 1000);
  assert.equal(complete.status, 'completed');
  assert.equal(complete.stats.accuracy, 100);
});

test('IME composition does not complete prematurely or repeatedly score candidate replacements', () => {
  const session = new TypingSession([track('두근두근'), track('DM')]);
  session.start(0);
  for (const value of ['ㄷ', '두', '두ㄱ', '두그', '두근', '두근ㄷ', '두근두', '두근두근']) {
    const state = session.updateInput(value, 1000, { isComposing: true });
    assert.equal(state.index, 0);
    assert.equal(state.advanced, false);
    assert.equal(state.stats.attemptedStrokes, 0);
    assert.equal(state.hasError, false);
  }
  const end = session.updateInput('두근두근', 2000, { isComposing: false });
  assert.equal(end.index, 1);
  assert.equal(end.stats.correctStrokes, 10);
  assert.equal(end.stats.attemptedStrokes, 10);
  assert.equal(end.stats.accuracy, 100);
});

test('two-set Korean strokes include compound vowels and final consonants', () => {
  assert.equal(countStrokes('가'), 2);
  assert.equal(countStrokes('각'), 3);
  assert.equal(countStrokes('값'), 4);
  assert.equal(countStrokes('과'), 3);
  assert.equal(countStrokes('괜'), 4);
  assert.equal(countStrokes('똠'), 3);
  assert.equal(countStrokes('Love is Around'), 14);
});

test('typos remain editable; deletion costs nothing and correction keeps the original error in accuracy', () => {
  const session = new TypingSession([track('DM')]);
  session.start(0);
  session.updateInput('d', 100);
  const error = session.updateInput('dx', 200);
  assert.equal(error.hasError, true);
  assert.equal(error.input, 'dx');
  assert.deepEqual(error.feedback.map(item => item.status), ['correct', 'incorrect']);
  const deleted = session.updateInput('d', 300);
  assert.equal(deleted.stats.attemptedStrokes, 2);
  const done = session.updateInput('dm', 1000);
  assert.equal(done.stats.correctStrokes, 2);
  assert.equal(done.stats.attemptedStrokes, 3);
  assert.equal(done.stats.errors, 1);
  assert.ok(Math.abs(done.stats.accuracy - 200 / 3) < 1e-10);
});

test('a retained word separator is not counted again after deleting a typo', () => {
  const session = new TypingSession([track('WE GO')]);
  session.start(0);
  session.updateInput('we ', 100);
  session.updateInput('we x', 200);
  session.updateInput('we ', 300);
  const done = session.updateInput('we go', 1000);
  assert.equal(done.stats.attemptedStrokes, 6);
  assert.equal(done.stats.correctStrokes, 5);
  assert.equal(done.stats.errors, 1);
});

test('feedback preserves raw glyphs and whitespace so the native input caret stays aligned', () => {
  const session = new TypingSession([track('WE GO')]);
  const raw = '  ＷＥ   ';
  const state = session.updateInput(raw, 1000);
  assert.equal(state.feedback.filter(item => item.typed).map(item => item.char).join(''), raw);
  assert.equal(state.feedback.map(item => item.char).join(''), raw + 'GO');
  assert.deepEqual(state.feedback.slice(-2).map(item => item.status), ['pending', 'pending']);
  assert.equal(state.hasError, false);
  assert.equal(state.stats.attemptedStrokes, 3);
});

test('feedback shows the actual typo and excess characters instead of the expected glyph', () => {
  const session = new TypingSession([track('DM')]);
  const state = session.updateInput('dxx', 1000);
  assert.equal(state.feedback.map(item => item.char).join(''), 'dxx');
  assert.deepEqual(state.feedback.map(item => item.status), ['correct', 'incorrect', 'incorrect']);
  assert.equal(state.feedback[2].extra, true);
});

test('non-composing syllable extension adds only its new key, not the whole syllable', () => {
  const session = new TypingSession([track('각')]);
  session.start(0);
  session.updateInput('가', 100);
  const done = session.updateInput('각', 1000);
  assert.equal(done.stats.correctStrokes, 3);
  assert.equal(done.stats.attemptedStrokes, 3);
});

test('pause excludes idle time, ignores paused input, and completion freezes elapsed time', () => {
  const session = new TypingSession([track('AB')]);
  session.start(0);
  session.updateInput('a', 1000);
  session.pause(1500);
  assert.equal(session.snapshot(4000).stats.elapsedMs, 1500);
  assert.equal(session.updateInput('ab', 4500).status, 'paused');
  assert.equal(session.index, 0);
  session.resume(5000);
  const done = session.updateInput('ab', 5500);
  assert.equal(done.stats.elapsedMs, 2000);
  assert.equal(done.stats.cpm, 60);
  assert.equal(session.snapshot(100000).stats.elapsedMs, 2000);
  assert.equal(session.updateInput('ab', 100001).advanced, false);
});

test('reset restores a fresh course and zeroes all recorded statistics', () => {
  const session = new TypingSession([track('DM')]);
  session.start(0);
  session.updateInput('dx', 1000);
  const reset = session.reset();
  assert.equal(reset.status, 'ready');
  assert.equal(reset.input, '');
  assert.equal(reset.index, 0);
  assert.equal(reset.stats.elapsedMs, 0);
  assert.equal(reset.stats.attemptedStrokes, 0);
  assert.equal(reset.stats.accuracy, 100);
  assert.equal(session.updateInput('DM', 5000).status, 'completed');
});

test('empty courses and malformed titles fail early', () => {
  assert.throws(() => new TypingSession([]), /at least one/);
  assert.throws(() => new TypingSession([track(' ')]), /non-empty title/);
});
