import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalRecords } from '../dist/personal-records.mjs';
import { bestForCourse } from '../dist/course-selection.mjs';
const storage = () => { const rows = new Map(); return { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value) }; };
const record = (id, full = true) => ({ id, signature: full ? 'full' : 'practice', albumIds: full ? ['a', 'b'] : ['a'], isFullCourse: full, device: 'pc', elapsedMs: full ? 1000 : 100, cpm: 400, accuracy: 100, completedAt: '2026-11-14T00:00:00Z' });
test('practice and full completions persist independently and cannot replace the full best', () => {
  const disk = storage(), rows = createPersonalRecords(disk); rows.add(record('full')); rows.add(record('practice', false));
  const reloaded = createPersonalRecords(disk).list(); assert.equal(reloaded.length, 2); assert.equal(bestForCourse(reloaded, 'full', 'pc').elapsedMs, 1000);
  rows.uploaded('full', 'server-id'); assert.equal(rows.list().find(row => row.id === 'full').uploaded, true); assert.equal(rows.list().find(row => row.id === 'practice').uploaded, undefined);
});
test('malformed storage and invalid completion values do not create personal records', () => {
  const disk = storage(); disk.setItem('fromis-personal-records-v1', '{invalid'); const rows = createPersonalRecords(disk);
  assert.deepEqual(rows.list(), []); assert.throws(() => rows.add({ ...record('bad'), elapsedMs: 0 }), TypeError);
});
