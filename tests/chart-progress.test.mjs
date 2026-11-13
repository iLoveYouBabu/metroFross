import test from 'node:test';
import assert from 'node:assert/strict';
import { ChartProgress } from '../dist/chart-progress.mjs';

const anchors = [
  { id: 'a', title: 'Album A', date: '2020-01-01', firstWeekSales: 100, cover: 'a.jpg' },
  { id: 'b', title: 'Album B', date: '2021-01-01', firstWeekSales: 300, cover: 'b.jpg' },
  { id: 'c', title: 'Album C', date: '2022-01-01', firstWeekSales: 200, cover: 'c.jpg' }
];
const tracks = ['a', 'a', 'b', 'c', 'c', 'c'].map((albumId, index) => ({ id: `track-${index}`, albumId, title: `Track ${index}` }));
const course = (albums = anchors, items = tracks) => new ChartProgress({ albums, tracks: items });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('the initial position is the first measured anchor and has no autonomous movement', () => {
  const chart = course();
  const initial = chart.snapshot();
  assert.equal(initial.status, 'ready');
  assert.equal(initial.currentAlbum.id, 'a');
  assert.equal(initial.position.plotIndex, 0);
  assert.equal(initial.position.xRatio, 0);
  assert.equal(initial.position.yValue, 100);
  assert.equal(initial.position.kind, 'anchor');
  assert.deepEqual(chart.snapshot(), initial);
});

test('album-local progress accounts for different numbers of tracks', () => {
  const chart = course();
  const quarter = chart.update({ index: 0, prefixRatio: .5 });
  assert.equal(quarter.album.trackCount, 2);
  assert.equal(quarter.album.ratio, .25);
  assert.equal(quarter.position.plotIndex, .25);
  close(quarter.position.xRatio, 1 / 12);
  assert.equal(quarter.position.yValue, 150);
  assert.equal(quarter.position.kind, 'interpolated');
  assert.equal(quarter.position.anchorAlbumId, null);
  const half = chart.update({ index: 1 });
  assert.equal(half.album.ratio, .5);
  assert.equal(half.position.yValue, 200);
  const shorterAlbum = chart.update({ index: 2, prefixRatio: .5 });
  assert.equal(shorterAlbum.album.trackCount, 1);
  assert.equal(shorterAlbum.album.ratio, .5);
  assert.equal(shorterAlbum.position.plotIndex, 1.5);
  assert.equal(shorterAlbum.position.yValue, 250);
});

test('a fully typed pending title reaches the next anchor before current-album metadata changes', () => {
  const chart = course();
  const pendingCommit = chart.update({ index: 1, prefixRatio: 1 });
  assert.equal(pendingCommit.currentAlbum.id, 'a');
  assert.equal(pendingCommit.course.completed, 1);
  assert.equal(pendingCommit.album.ratio, 1);
  assert.equal(pendingCommit.position.anchorAlbumId, 'b');
  assert.equal(pendingCommit.position.yValue, 300);
  assert.equal(pendingCommit.position.kind, 'anchor');
  const nextAlbum = chart.update({ index: 2 });
  assert.equal(nextAlbum.currentAlbum.id, 'b');
  assert.equal(nextAlbum.album.ratio, 0);
  assert.equal(nextAlbum.position.plotIndex, pendingCommit.position.plotIndex);
  assert.equal(nextAlbum.position.yValue, pendingCommit.position.yValue);
});

test('lower next-album sales move y downward while x and course progress stay forward', () => {
  const chart = course();
  const start = chart.update({ index: 2 });
  const later = chart.update({ index: 2, prefixRatio: .8 });
  assert.ok(later.position.yValue < start.position.yValue);
  assert.ok(later.position.xRatio > start.position.xRatio);
  assert.ok(later.course.ratio > start.course.ratio);
});

test('the last album advances along a non-measured, constant-y finish tail', () => {
  const chart = course();
  const start = chart.update({ index: 3 });
  assert.equal(start.currentAlbum.id, 'c');
  assert.equal(start.position.plotIndex, 2);
  assert.equal(start.position.kind, 'finish-tail');
  assert.equal(start.position.toAlbumId, null);
  const nearEnd = chart.update({ index: 5, prefixRatio: .5 });
  close(nearEnd.album.ratio, 5 / 6);
  close(nearEnd.position.plotIndex, 2 + 5 / 6);
  assert.equal(nearEnd.position.yValue, 200);
  assert.equal(nearEnd.position.kind, 'finish-tail');
  assert.equal(nearEnd.position.anchorAlbumId, null);
  const complete = chart.update({ index: tracks.length, status: 'completed' });
  assert.equal(complete.position.plotIndex, anchors.length);
  assert.equal(complete.position.xRatio, 1);
  assert.equal(complete.position.yValue, 200);
  assert.equal(complete.course.ratio, 1);
  assert.equal(complete.album.ratio, 1);
});

test('typo correction, backspace, and stale updates cannot move the cursor backward', () => {
  const chart = course();
  const before = chart.update({ index: 1, prefixRatio: .8 });
  const deleted = chart.update({ index: 1, prefixRatio: .2 });
  assert.deepEqual(deleted, before);
  const stale = chart.update({ index: 0, prefixRatio: 1 });
  assert.deepEqual(stale, before);
  const next = chart.update({ index: 2 });
  assert.ok(next.course.ratio > before.course.ratio);
  assert.ok(next.position.plotIndex > before.position.plotIndex);
});

test('paused and ready updates freeze the existing coordinates until running input resumes', () => {
  const chart = course();
  assert.equal(chart.update({ index: 2, prefixRatio: .9, status: 'ready' }).position.plotIndex, 0);
  const before = chart.update({ index: 1, prefixRatio: .2 });
  const paused = chart.update({ index: 2, prefixRatio: 1, status: 'paused' });
  assert.equal(paused.status, 'paused');
  assert.deepEqual(paused.position, before.position);
  const resumed = chart.update({ index: 1, prefixRatio: .7, status: 'running' });
  assert.ok(resumed.position.plotIndex > before.position.plotIndex);
});

test('completed state freezes, and only reset returns to the first anchor', () => {
  const chart = course();
  const complete = chart.update({ index: tracks.length, status: 'completed' });
  assert.deepEqual(chart.update({ index: 0, status: 'running' }), complete);
  assert.deepEqual(chart.update({ index: 0, status: 'paused' }), complete);
  const reset = chart.reset();
  assert.equal(reset.status, 'ready');
  assert.equal(reset.course.completed, 0);
  assert.equal(reset.course.ratio, 0);
  assert.equal(reset.position.plotIndex, 0);
  assert.equal(reset.position.yValue, 100);
});

test('unknown middle sales leave a gap instead of inventing a zero or interpolated value', () => {
  const chart = course(anchors.map(album => album.id === 'b' ? { ...album, firstWeekSales: null } : album));
  assert.equal(chart.snapshot().position.yValue, 100);
  const gapBefore = chart.update({ index: 0, prefixRatio: .5 });
  assert.equal(gapBefore.position.kind, 'unknown');
  assert.equal(gapBefore.position.yValue, null);
  assert.equal(gapBefore.position.hasKnownY, false);
  const gapAfter = chart.update({ index: 2, prefixRatio: .5 });
  assert.equal(gapAfter.position.yValue, null);
  const knownEnd = chart.update({ index: 2, prefixRatio: 1 });
  assert.equal(knownEnd.position.yValue, 200);
  assert.equal(knownEnd.position.anchorAlbumId, 'c');
  assert.equal(knownEnd.position.kind, 'anchor');
});

test('a missing final observation keeps the finish tail unknown', () => {
  const chart = course(anchors.map(album => album.id === 'c' ? { ...album, firstWeekSales: null } : album));
  const tail = chart.update({ index: 4, prefixRatio: .5 });
  assert.equal(tail.position.kind, 'finish-tail');
  assert.equal(tail.position.yValue, null);
  const complete = chart.update({ index: tracks.length, status: 'completed' });
  assert.equal(complete.position.xRatio, 1);
  assert.equal(complete.position.yValue, null);
});

test('a single-album course still moves toward its virtual finish without adding sales data', () => {
  const chart = course([anchors[0]], tracks.filter(track => track.albumId === 'a'));
  const middle = chart.update({ index: 0, prefixRatio: 1 });
  assert.equal(middle.position.plotIndex, .5);
  assert.equal(middle.position.xRatio, .5);
  assert.equal(middle.position.kind, 'finish-tail');
  assert.equal(middle.position.yValue, 100);
  assert.equal(chart.albums.length, 1);
  assert.equal(chart.update({ index: 2, status: 'completed' }).position.xRatio, 1);
});

test('zero sales, invalid observations, missing albums, and out-of-order tracks fail early', () => {
  assert.throws(() => course([{ ...anchors[0], firstWeekSales: 0 }], tracks.slice(0, 2)), /positive number or null/);
  assert.throws(() => course([{ ...anchors[0], firstWeekSales: Number.NaN }], tracks.slice(0, 2)), /positive number or null/);
  assert.throws(() => course(anchors, [{ albumId: 'missing' }]), /no chart album/);
  assert.throws(() => course(anchors, [tracks[2], tracks[0], tracks[3]]), /chart album order/);
  assert.throws(() => course(anchors, tracks.slice(0, 3)), /at least one course track/);
  assert.throws(() => course([anchors[0], anchors[0]], tracks.slice(0, 2)), /unique/);
  assert.throws(() => course([], []), /at least one album/);
});

test('prefix values clamp safely and invalid input is rejected without moving the cursor', () => {
  const chart = course();
  assert.equal(chart.update({ prefixRatio: -1 }).position.plotIndex, 0);
  assert.equal(chart.update({ prefixRatio: 2 }).album.ratio, .5);
  const before = chart.snapshot();
  assert.throws(() => chart.update({ index: -1 }), /course track index/);
  assert.throws(() => chart.update({ prefixRatio: Number.NaN }), /finite/);
  assert.throws(() => chart.update({ status: 'unknown' }), /Unknown chart status/);
  assert.deepEqual(chart.snapshot(), before);
});
