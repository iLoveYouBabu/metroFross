import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TypingSession, normalizeTitle, countStrokes } from '../dist/core.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(projectRoot, 'dist');
const catalogPath = resolve(distRoot, 'data', 'discography.json');
const CATEGORY_DEFINITIONS = {
  album: { labels: ['정규 앨범'], mainCourse: true },
  ep: { labels: ['미니 앨범', '일본 EP'], mainCourse: true },
  single: { labels: ['싱글'], mainCourse: true },
  ost: { labels: ['OST'], mainCourse: false },
  project: { labels: ['프로젝트'], mainCourse: false },
  performance: { labels: ['방송 경연'], mainCourse: false }
};

function nonEmpty(value, label) {
  assert.equal(typeof value, 'string', `${label}: 문자열이어야 합니다.`);
  assert.ok(value.trim(), `${label}: 비어 있습니다.`);
}

function calendarDate(value, label) {
  assert.match(value ?? '', /^\d{4}-\d{2}-\d{2}$/u, `${label}: YYYY-MM-DD 날짜가 필요합니다.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  assert.ok(Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value, `${label}: 실제 달력 날짜가 아닙니다.`);
  return value;
}

function httpsUrl(value, label) {
  nonEmpty(value, label);
  let parsed;
  try { parsed = new URL(value); } catch { assert.fail(`${label}: 올바른 URL이 아닙니다.`); }
  assert.equal(parsed.protocol, 'https:', `${label}: HTTPS 출처가 필요합니다.`);
  assert.ok(parsed.hostname, `${label}: 호스트가 없습니다.`);
}

async function checkCover(album) {
  nonEmpty(album.cover, `${album.id} 재킷 경로`);
  assert.ok(!isAbsolute(album.cover) && !/^[a-z][a-z\d+.-]*:/iu.test(album.cover), `${album.id}: 재킷은 dist 내부 상대 경로여야 합니다.`);
  const coverPath = resolve(distRoot, album.cover);
  const withinDist = relative(distRoot, coverPath);
  assert.ok(withinDist && withinDist !== '..' && !withinDist.startsWith(`..${sep}`) && !isAbsolute(withinDist), `${album.id}: 재킷 경로가 dist 밖으로 나갑니다.`);
  const info = await stat(coverPath);
  assert.ok(info.isFile(), `${album.id}: 재킷 파일이 아닙니다.`);
  const bytes = await readFile(coverPath);
  let format = null;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) format = 'jpeg';
  else if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) format = 'png';
  else if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') format = 'webp';
  assert.ok(format, `${album.id}: JPEG/PNG/WebP 시그니처가 없는 재킷입니다.`);
  const extension = extname(coverPath).toLowerCase();
  const supported = { jpeg: ['.jpg', '.jpeg'], png: ['.png'], webp: ['.webp'] };
  assert.ok(supported[format].includes(extension), `${album.id}: 재킷 확장자와 실제 포맷이 다릅니다.`);
}

function checkCourseRoundtrip(tracks) {
  const session = new TypingSession(tracks);
  let now = 0;
  let imeTrackCount = 0;
  let pausedOnce = false;
  session.start(now);
  const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });

  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    assert.equal(session.snapshot(now).currentTrack.id, track.id, `${track.id}: 곡 진행 순서가 다릅니다.`);
    const glyphs = [...segmenter.segment(track.title)].map(item => item.segment);
    const simulateIme = /[\uac00-\ud7a3]/u.test(track.title) && imeTrackCount < 3;
    if (simulateIme) imeTrackCount += 1;
    let prefix = '';
    let result;

    for (let glyphIndex = 0; glyphIndex < glyphs.length; glyphIndex += 1) {
      const glyph = glyphs[glyphIndex];
      now += 80;
      const code = glyph.codePointAt(0);
      if (simulateIme && code >= 0xac00 && code <= 0xd7a3) {
        const initial = String.fromCodePoint(0x1100 + Math.floor((code - 0xac00) / 588));
        const before = session.snapshot(now).stats.attemptedStrokes;
        for (const candidate of [prefix + initial, prefix + glyph]) {
          const pending = session.updateInput(candidate, now, { isComposing: true });
          assert.equal(pending.advanced, false, `${track.id}: IME 조합 중에 다음 곡으로 넘어갔습니다.`);
          assert.equal(pending.stats.attemptedStrokes, before, `${track.id}: IME 후보를 중복 집계했습니다.`);
          assert.equal(pending.hasError, false, `${track.id}: 올바른 한글 조합을 오타로 표시했습니다.`);
        }
      }
      prefix += glyph;
      result = session.updateInput(prefix, now, { isComposing: false });
      assert.equal(result.hasError, false, `${track.id}: 원제 입력을 오타로 처리했습니다.`);
      assert.equal(result.advanced, glyphIndex === glyphs.length - 1, `${track.id}: 원제를 전부 치기 전에 끝나거나 마지막 글자에서 끝나지 않았습니다.`);
    }
    assert.equal(result.completedTrack.id, track.id, `${track.id}: 완료 이벤트가 잘못된 곡을 반환했습니다.`);
    assert.equal(result.input, '', `${track.id}: 다음 곡 입력칸이 비워지지 않았습니다.`);
    assert.equal(result.progress.completed, index + 1, `${track.id}: 완료 곡 수가 다릅니다.`);

    if (!pausedOnce && index < tracks.length - 1 && index >= Math.floor(tracks.length / 2)) {
      const beforePause = session.pause(now).stats.elapsedMs;
      now += 10000;
      assert.equal(session.snapshot(now).stats.elapsedMs, beforePause, '일시정지 시간을 완주 시간에 포함했습니다.');
      assert.equal(session.updateInput('paused input', now).input, '', '일시정지 중에 입력을 받았습니다.');
      session.resume(now);
      pausedOnce = true;
    }
  }

  const final = session.snapshot(now);
  const expectedStrokes = tracks.reduce((total, track) => total + countStrokes(normalizeTitle(track.title)), 0);
  assert.equal(final.status, 'completed', '전체 곡 입력 후 완주하지 못했습니다.');
  assert.equal(final.progress.ratio, 1, '완주 진행률이 100%가 아닙니다.');
  assert.equal(final.currentTrack, null, '완주 뒤에 현재 곡이 남았습니다.');
  assert.equal(final.stats.correctStrokes, expectedStrokes, '전체 원제의 정확한 타수가 누락/중복 집계되었습니다.');
  assert.equal(final.stats.attemptedStrokes, expectedStrokes, '오타 없는 완주 입력의 총 타수가 다릅니다.');
  assert.equal(final.stats.errors, 0, '오타 없는 완주에 오류가 집계되었습니다.');
  assert.equal(final.stats.accuracy, 100, '오타 없는 완주 정확도가 100%가 아닙니다.');
  assert.equal(session.snapshot(now + 10000).stats.elapsedMs, final.stats.elapsedMs, '완주 뒤에도 시간이 흘렀습니다.');

  let aliasCount = 0;
  for (const track of tracks) {
    for (const alias of track.aliases ?? []) {
      const aliasSession = new TypingSession([track]);
      const result = aliasSession.updateInput(alias, 0);
      assert.equal(result.status, 'completed', `${track.id}: 별칭 ${alias}를 정답으로 처리하지 못했습니다.`);
      assert.equal(result.stats.accuracy, 100, `${track.id}: 정식 별칭에 오타가 집계되었습니다.`);
      aliasCount += 1;
    }
  }
  return { imeTrackCount, aliasCount, expectedStrokes };
}

async function main() {
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const updatedAt = calendarDate(catalog.updatedAt, '카탈로그 확인일');
  nonEmpty(catalog.scope, '카탈로그 범위');
  assert.ok(Array.isArray(catalog.albums) && catalog.albums.length > 0, '앨범 목록이 비어 있습니다.');
  assert.ok(Array.isArray(catalog.tracks) && catalog.tracks.length > 0, '곡 목록이 비어 있습니다.');
  assert.ok(Array.isArray(catalog.sources) && catalog.sources.length > 0, '카탈로그 출처가 비어 있습니다.');
  for (const [index, source] of catalog.sources.entries()) {
    nonEmpty(source.title, `출처 ${index + 1} 제목`);
    httpsUrl(source.url, `출처 ${index + 1}`);
  }

  const albums = new Map();
  let previousDate = '';
  for (const [index, album] of catalog.albums.entries()) {
    nonEmpty(album.id, `앨범 ${index + 1} ID`);
    nonEmpty(album.title, `${album.id} 앨범명`);
    assert.ok(!albums.has(album.id), `앨범 ID 중복: ${album.id}`);
    nonEmpty(album.category, `${album.id} 발매 분류`);
    const category = Object.hasOwn(CATEGORY_DEFINITIONS, album.category) ? CATEGORY_DEFINITIONS[album.category] : null;
    assert.ok(category, `${album.id}: 허용되지 않은 발매 분류 ${album.category}`);
    nonEmpty(album.categoryLabel, `${album.id} 분류 표시명`);
    assert.ok(category.labels.includes(album.categoryLabel), `${album.id}: ${album.category}에 맞지 않는 분류 표시명 ${album.categoryLabel}`);
    calendarDate(album.date, `${album.id} 발매일`);
    assert.ok(album.date >= previousDate, `${album.id}: 앨범 발매일이 오름차순이 아닙니다.`);
    assert.ok(album.date <= updatedAt, `${album.id}: 확인일 뒤의 발매일입니다.`);
    assert.ok(Array.isArray(album.sources) && album.sources.length > 0, `${album.id}: 앨범 출처가 없습니다.`);
    album.sources.forEach((url, sourceIndex) => httpsUrl(url, `${album.id} 출처 ${sourceIndex + 1}`));
    if (album.coverUrl) httpsUrl(album.coverUrl, `${album.id} 원본 재킷 URL`);
    albums.set(album.id, { ...album, order: index, count: 0, lastTrackNumber: 0 });
    previousDate = album.date;
  }

  const trackIds = new Set();
  const normalizedTitles = new Map();
  let previousAlbumOrder = -1;
  for (const [index, track] of catalog.tracks.entries()) {
    nonEmpty(track.id, `곡 ${index + 1} ID`);
    nonEmpty(track.title, `${track.id} 곡 제목`);
    assert.ok(!trackIds.has(track.id), `곡 ID 중복: ${track.id}`);
    trackIds.add(track.id);
    const normalized = normalizeTitle(track.title);
    assert.ok(!normalizedTitles.has(normalized), `정규화된 곡 제목 중복: ${track.title} / ${normalizedTitles.get(normalized)}`);
    normalizedTitles.set(normalized, track.id);
    const album = albums.get(track.albumId);
    assert.ok(album, `${track.id}: 존재하지 않는 앨범 ${track.albumId}`);
    assert.ok(album.order >= previousAlbumOrder, `${track.id}: 곡의 앨범 발매 순서가 역행합니다.`);
    assert.ok(Number.isInteger(track.trackNumber) && track.trackNumber > 0, `${track.id}: 실제 트랙 번호가 양의 정수가 아닙니다.`);
    assert.ok(track.trackNumber > album.lastTrackNumber, `${track.id}: 앨범 내 실제 트랙 번호가 오름차순이 아니거나 중복되었습니다.`);
    if (track.date) {
      calendarDate(track.date, `${track.id} 발매일`);
      assert.ok(track.date <= updatedAt, `${track.id}: 확인일 뒤의 발매일입니다.`);
    }
    if (track.aliases !== undefined) {
      assert.ok(Array.isArray(track.aliases), `${track.id}: aliases가 배열이 아닙니다.`);
      track.aliases.forEach((alias, aliasIndex) => nonEmpty(alias, `${track.id} 별칭 ${aliasIndex + 1}`));
    }
    album.lastTrackNumber = track.trackNumber;
    album.count += 1;
    previousAlbumOrder = album.order;
  }
  for (const album of albums.values()) assert.ok(album.count > 0, `${album.id}: 연결된 곡이 없습니다.`);
  await Promise.all(catalog.albums.map(checkCover));
  const roundtrip = checkCourseRoundtrip(catalog.tracks);
  const mainTracks = catalog.tracks.filter(track => CATEGORY_DEFINITIONS[albums.get(track.albumId).category].mainCourse);
  assert.ok(mainTracks.length > 0, '앨범·EP·싱글 본편 코스가 비어 있습니다.');
  const mainRoundtrip = checkCourseRoundtrip(mainTracks);
  console.log(`카탈로그 검사 통과: ${catalog.tracks.length}곡 · ${catalog.albums.length}개 앨범/싱글 · 로컬 재킷 ${catalog.albums.length}장`);
  console.log(`전체 원제 완주 통과: ${roundtrip.expectedStrokes}타 · IME ${roundtrip.imeTrackCount}곡 · 별칭 ${roundtrip.aliasCount}개 · 일시정지/완주 시간 고정`);
  console.log(`본편 코스 완주 통과: ${mainTracks.length}곡 · ${mainRoundtrip.expectedStrokes}타 · IME ${mainRoundtrip.imeTrackCount}곡 · 별칭 ${mainRoundtrip.aliasCount}개`);
}

try { await main(); }
catch (error) {
  console.error(`검사 실패: ${error.message}`);
  process.exitCode = 1;
}
