import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRankingClient, normalizeNickname } from '../dist/ranking-client.mjs';

const base = { enabled: true, url: 'https://test-project.supabase.co', publishableKey: 'sb_publishable_test', courseVersion: 'test-course', canonicalAlbumIds: ['a','b'], trackCount: 3, device: 'pc' };
const auth = { access_token: 'user-access-token', refresh_token: 'user-refresh-token', expires_at: 9999999999, user: { id: 'test-user-id' } };
function storage(initial = {}) { const values = new Map(Object.entries(initial)); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values }; }
const reply = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
function fixture(responses = [], extra = {}) {
  const calls = [], saved = extra.storage || storage();
  const client = createRankingClient({ ...base, ...extra, storage: saved, fetch: async (url, options) => { calls.push({ url, options, body: JSON.parse(options.body) }); const next = responses.shift(); if (next instanceof Error) throw next; if (!next) throw new Error('Unexpected request'); return next; } });
  return { client, calls, saved };
}

test('practice and a partial selection never authenticate or submit to the server', async () => {
  const f = fixture();
  assert.deepEqual(await f.client.startRun({ albumIds: ['a'], fullCourse: false }), { eligible: false, reason: 'practice' });
  assert.deepEqual(await f.client.startRun({ albumIds: ['a'], fullCourse: true }), { eligible: false, reason: 'practice' });
  assert.deepEqual(await f.client.startRun({ albumIds: ['b','a'], fullCourse: true }), { eligible: false, reason: 'practice' });
  assert.deepEqual(await f.client.finishRun({ fullCourse: false }), { eligible: false, reason: 'practice' });
  assert.equal(f.calls.length, 0);
});

test('missing SQL is a setup error, not an empty leaderboard or an anonymous signup', async () => {
  const f = fixture([reply({ code: 'PGRST202', message: 'function was not found' }, 404)]);
  await assert.rejects(f.client.leaderboard(), { code: 'backend-not-ready' });
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].url, /\/rpc\/fromis_leaderboard$/u);
  assert.equal(f.calls[0].options.headers.Authorization, undefined);
  assert.equal(f.calls[0].options.headers.apikey, base.publishableKey);
});

test('a successful public leaderboard returns the actual rows without creating an identity', async () => {
  const rows = [{ rank: 1, nickname: '플로버', elapsed_ms: 123456, cpm: 350, accuracy: 99, is_me: false }];
  const f = fixture([reply(rows)]); assert.deepEqual(await f.client.leaderboard({ period: 'all', device: 'mobile' }), rows);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body.p_period, 'all'); assert.equal(f.calls[0].body.p_device, 'mobile');
});

test('nickname save signs in once and stores an isolated anonymous session', async () => {
  const f = fixture([reply(auth), reply({ nickname: '우리 플로버' })]);
  assert.deepEqual(await f.client.setNickname(' 우리   플로버 '), { nickname: '우리 플로버' });
  assert.match(f.calls[0].url, /\/auth\/v1\/signup$/u); assert.deepEqual(f.calls[0].body, { data: {} });
  assert.equal(f.calls[1].options.headers.Authorization, `Bearer ${auth.access_token}`);
  assert.equal(f.calls[1].body.p_nickname, '우리 플로버');
  assert.deepEqual([...f.saved.values.keys()], ['fromis-ranking-auth-v1:test-project.supabase.co']);
  assert.equal(f.client.isAuthenticated(), true);
});

test('personal records do not silently create a new anonymous identity', async () => {
  const f = fixture(); await assert.rejects(f.client.personal(), { code: 'identity-required' }); assert.equal(f.calls.length, 0);
});

test('an expired session refreshes before loading the same user personal records', async () => {
  const saved = storage({ 'fromis-ranking-auth-v1:test-project.supabase.co': JSON.stringify({ ...auth, expires_at: 1 }) });
  const result = { nickname: '플로버', best: null, weekBest: null, completedRuns: 0, recent: [] };
  const f = fixture([reply(auth), reply(result)], { storage: saved });
  assert.deepEqual(await f.client.personal(), result); assert.match(f.calls[0].url, /token\?grant_type=refresh_token$/u);
  assert.equal(f.calls[0].body.refresh_token, auth.refresh_token); assert.equal(f.calls[1].body.p_course_version, 'test-course');
});

test('full-course begin and finish preserve active elapsed time and server-issued run id', async () => {
  const runId = '00000000-0000-4000-8000-000000000001';
  const saved = storage({ 'fromis-ranking-auth-v1:test-project.supabase.co': JSON.stringify(auth) });
  const f = fixture([reply({ eligible: true, run_id: runId }), reply({ eligible: true, duplicate: false, record: { run_id: runId, elapsed_ms: 54321 } })], { storage: saved });
  const run = await f.client.startRun({ albumIds: ['a','b'], fullCourse: true }); assert.equal(run.run_id, runId);
  await f.client.finishRun({ runId, fullCourse: true, completedTrackCount: 3, elapsedMs: 54321.2, correctStrokes: 654, attemptedStrokes: 660 });
  assert.equal(f.calls[1].body.p_elapsed_ms, 54321); assert.equal(f.calls[1].body.p_run_id, runId);
  assert.equal(f.calls[1].body.p_completed_track_count, 3);
});

test('incomplete counts and impossible counters cannot create a finish request', async () => {
  const f = fixture();
  await assert.rejects(f.client.finishRun({ runId: 'id', fullCourse: true, completedTrackCount: 2, elapsedMs: 100, correctStrokes: 50, attemptedStrokes: 60 }), { code: 'invalid-run' });
  await assert.rejects(f.client.finishRun({ runId: 'id', fullCourse: true, completedTrackCount: 3, elapsedMs: 100, correctStrokes: 50, attemptedStrokes: 40 }), { code: 'invalid-run' });
  assert.equal(f.calls.length, 0);
});

test('unconfigured or privileged keys do not make network calls', async () => {
  const fakeService = ['header', Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url'), 'signature'].join('.');
  for (const key of ['', 'sb_secret_test', fakeService]) { const f = fixture([], { publishableKey: key }); assert.equal(f.client.configured, false); await assert.rejects(f.client.leaderboard(), { code: 'not-configured' }); assert.equal(f.calls.length, 0); }
});

test('network and disabled anonymous auth remain explicit errors', async () => {
  await assert.rejects(fixture([new TypeError('offline')]).client.leaderboard(), { code: 'network' });
  await assert.rejects(fixture([reply({ error_code: 'anonymous_provider_disabled', msg: 'Anonymous sign-ins are disabled' }, 422)]).client.setNickname('플로버'), { code: 'auth-not-enabled' });
});

test('nickname validation handles Korean and Unicode length without permitting markup', () => {
  assert.equal(normalizeNickname('  플로버  '), '플로버'); assert.equal(normalizeNickname('🎵🎶'), '🎵🎶');
  for (const value of ['가', '<img>', '가'.repeat(17)]) assert.throws(() => normalizeNickname(value), { code: 'invalid-nickname' });
});

test('registered ranking version matches the complete catalog and its accepted typing rules', async () => {
  const root = new URL('../', import.meta.url);
  const [course, config] = await Promise.all(['dist/data/album-course.json','dist/data/ranking-config.json'].map(async path => JSON.parse(await readFile(new URL(path, root), 'utf8'))));
  const canonical = JSON.stringify({ albums: course.albums.map(album => album.id), tracks: course.tracks.map(track => ({ id: track.id, title: track.title, albumId: track.albumId, trackNumber: track.trackNumber, aliases: track.aliases || [] })) });
  const hash = createHash('sha256').update(canonical).digest('hex');
  assert.equal(config.catalogHash, hash); assert.equal(config.courseVersion, `fromis-full-v1-${hash.slice(0,16)}`);
  assert.deepEqual(config.canonicalAlbumIds, course.albums.map(album => album.id)); assert.equal(config.trackCount, course.tracks.length);
});
