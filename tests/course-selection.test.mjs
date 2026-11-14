import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCourse, catalogFingerprint, bestForCourse } from '../dist/course-selection.mjs';

const catalog = { albums: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], tracks: [{ id: 'a1', title: '가', albumId: 'a' }, { id: 'b1', title: '나', albumId: 'b' }, { id: 'b2', title: '다', albumId: 'b' }, { id: 'c1', title: '라', albumId: 'c' }] };
test('selected albums always follow release order and partial courses are ineligible', () => {
  const partial = buildCourse(catalog, ['c', 'a', 'c']);
  assert.deepEqual(partial.albumIds, ['a', 'c']); assert.deepEqual(partial.tracks.map(track => track.id), ['a1', 'c1']); assert.equal(partial.isFullCourse, false);
  assert.equal(buildCourse(catalog, ['c', 'b', 'a']).isFullCourse, true); assert.equal(buildCourse(catalog, ['b']).trackCount, 2);
});
test('empty and unknown selections are rejected and course records stay separated', () => {
  assert.throws(() => buildCourse(catalog, []), RangeError); assert.throws(() => buildCourse(catalog, ['unknown']), RangeError);
  const full = buildCourse(catalog), partial = buildCourse(catalog, ['a']);
  assert.notEqual(full.signature, partial.signature);
  const records = [{ signature: full.signature, device: 'desktop', elapsedMs: 120 }, { signature: partial.signature, device: 'desktop', elapsedMs: 10 }, { signature: full.signature, device: 'mobile', elapsedMs: 90 }];
  assert.equal(bestForCourse(records, full.signature, 'desktop').elapsedMs, 120);
});
test('the catalog fingerprint covers the complete ordered title and alias rules', async () => {
  const real = JSON.parse(await readFile(new URL('../dist/data/album-course.json', import.meta.url), 'utf8'));
  assert.equal(await catalogFingerprint(real), '34b55b7a16952c88c15ec97000d0a0881d037c632a2e5a24c292fcd22563b7f5');
  const changed = structuredClone(real); changed.tracks[0].title += '!'; assert.notEqual(await catalogFingerprint(changed), await catalogFingerprint(real));
});
