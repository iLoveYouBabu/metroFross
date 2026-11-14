import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TypingSession, normalizeTitle, countStrokes } from '../dist/core.mjs';
import { ChartProgress } from '../dist/chart-progress.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(projectRoot, 'dist');
const physicalCategories = new Set(['album', 'ep', 'single']);
const sourceTypes = new Set(['official', 'reported', 'unofficial', 'unverified']);
const chartSystems = new Set(['hanteo', 'oricon', 'unspecified']);
const typingNames = new Map([
  ['to-heart-01', '나에게로 오는 길'], ['to-heart-02', '투 하트'],
  ['to-day-03', '두근두근'], ['to-day-05', '클로버'],
  ['from-9-01', '럽밤'], ['from-9-02', '댄싱 퀸'],
  ['fun-factory-02', '러브 럼펌펌'], ['my-little-society-01', 'Feel Good'],
  ['9-way-ticket-01', '에어플레인 모드'], ['9-way-ticket-02', '위고'],
  ['talk-and-talk-01', '톡앤톡'], ['from-our-memento-box-01', '업앤'],
  ['unlock-my-world-02', '미나우'], ['supersonic-01', '슈퍼소닉'],
  ['from-our-20s-03', '러브 디제스터']
]);
const digitalOnlyIds = new Set(['glass-shoes', 'from', 'white-memories']);

function nonEmpty(value, label) {
  assert.equal(typeof value, 'string', `${label}: 문자열이어야 합니다.`);
  assert.ok(value.trim(), `${label}: 비어 있습니다.`);
}

function date(value, label) {
  assert.match(value ?? '', /^\d{4}-\d{2}-\d{2}$/u, `${label}: YYYY-MM-DD 날짜가 필요합니다.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  assert.ok(Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value, `${label}: 실제 달력 날짜가 아닙니다.`);
  return value;
}

function sevenDayEnd(start) {
  const parsed = new Date(`${start}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 6);
  return parsed.toISOString().slice(0, 10);
}

function releaseCalendarWeekStart(releaseDate) {
  const parsed = new Date(`${releaseDate}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - ((parsed.getUTCDay() + 6) % 7));
  return parsed.toISOString().slice(0, 10);
}

function https(value, label) {
  nonEmpty(value, label);
  let parsed;
  try { parsed = new URL(value); } catch { assert.fail(`${label}: 올바른 URL이 아닙니다.`); }
  assert.equal(parsed.protocol, 'https:', `${label}: HTTPS 출처가 필요합니다.`);
  assert.ok(parsed.hostname, `${label}: 호스트가 없습니다.`);
}

function sources(values, label, objects = false) {
  assert.ok(Array.isArray(values) && values.length > 0, `${label}: 출처가 없습니다.`);
  for (const [index, value] of values.entries()) {
    if (objects) nonEmpty(value?.title, `${label} ${index + 1} 제목`);
    https(objects ? value?.url : value, `${label} ${index + 1}`);
  }
}

async function readJson(name) {
  try { return JSON.parse(await readFile(resolve(distRoot, 'data', name), 'utf8')); }
  catch (error) { throw new Error(`${name}: ${error.message}`); }
}

async function checkCover(album) {
  nonEmpty(album.cover, `${album.id} 재킷 경로`);
  assert.ok(!isAbsolute(album.cover), `${album.id}: 재킷은 dist 상대 경로여야 합니다.`);
  const target = resolve(distRoot, album.cover);
  const rel = relative(distRoot, target);
  assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), `${album.id}: 재킷이 dist 밖을 가리킵니다.`);
  assert.ok((await stat(target)).isFile(), `${album.id}: 재킷이 파일이 아닙니다.`);
  const bytes = await readFile(target);
  const extension = extname(target).toLowerCase();
  let valid = false;
  if (extension === '.jpg' || extension === '.jpeg') valid = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === '.png') valid = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === '.webp') valid = bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  assert.ok(bytes.length > 100 && valid, `${album.id}: 재킷 확장자와 실제 이미지 시그니처가 일치하지 않습니다.`);
}

async function checkCourse(course, master) {
  const checkedAt = date(course.updatedAt, '실물 코스 확인일');
  nonEmpty(course.scope, '실물 코스 범위');
  sources(course.sources, '실물 코스 공통 출처', true);
  assert.ok(Array.isArray(course.albums) && course.albums.length > 0, '실물 앨범이 없습니다.');
  assert.ok(Array.isArray(course.tracks) && course.tracks.length > 0, '실물 코스 곡이 없습니다.');
  assert.ok(Array.isArray(course.excluded), '제외 사유 목록이 필요합니다.');
  assert.ok(Array.isArray(master.albums) && Array.isArray(master.tracks), '보존된 원본 카탈로그가 필요합니다.');
  const masterAlbums = new Map(master.albums.map(album => [album.id, album]));
  const masterTracks = new Map(master.tracks.map(track => [track.id, track]));
  const prohibited = new Set(master.albums.filter(album => !physicalCategories.has(album.category)).map(album => album.id));
  for (const id of digitalOnlyIds) prohibited.add(id);
  const albumMap = new Map();
  let previousDate = '';
  for (const [index, album] of course.albums.entries()) {
    nonEmpty(album.id, '앨범 ID');
    assert.ok(!albumMap.has(album.id), `실물 앨범 ID 중복: ${album.id}`);
    assert.ok(!prohibited.has(album.id), `${album.id}: 디지털·OST·프로젝트·경연 발매는 실물 코스에 포함할 수 없습니다.`);
    assert.equal(album.physical, true, `${album.id}: physical:true가 필요합니다.`);
    assert.ok(physicalCategories.has(album.category), `${album.id}: 실물 코스에 허용되지 않는 분류입니다.`);
    nonEmpty(album.categoryLabel, `${album.id} 분류 표시명`);
    nonEmpty(album.title, `${album.id} 앨범명`);
    nonEmpty(album.physicalFormat, `${album.id} 실물 매체`);
    const original = masterAlbums.get(album.id);
    assert.ok(original, `${album.id}: 보존 원본에 없는 앨범입니다.`);
    assert.equal(normalizeTitle(album.title), normalizeTitle(original.title), `${album.id}: 원본 앨범명이 바뀌었습니다.`);
    assert.equal(date(album.date, `${album.id} 발매일`), original.date, `${album.id}: 최초 발매일이 원본과 다릅니다.`);
    assert.ok(album.date >= previousDate && album.date <= checkedAt, `${album.id}: 앨범 발매 순서 또는 확인일이 잘못됐습니다.`);
    sources(album.sources, `${album.id} 출처`);
    if (album.coverUrl) https(album.coverUrl, `${album.id} 재킷 출처`);
    nonEmpty(album.physicalEvidence?.publisher, `${album.id} 실물 근거 발행자`);
    nonEmpty(album.physicalEvidence?.details, `${album.id} 실물 포함 근거`);
    https(album.physicalEvidence?.url, `${album.id} 실물 근거 URL`);
    assert.ok(album.sources.includes(album.physicalEvidence.url), `${album.id}: 실물 근거가 앨범 출처에도 있어야 합니다.`);
    albumMap.set(album.id, { ...album, order: index, count: 0, lastTrackNumber: 0, start: -1 });
    previousDate = album.date;
  }
  const trackIds = new Set();
  const normalizedTitles = new Set();
  let previousAlbumOrder = -1;
  for (const [index, track] of course.tracks.entries()) {
    nonEmpty(track.id, '곡 ID');
    nonEmpty(track.title, `${track.id} 제목`);
    assert.ok(!trackIds.has(track.id), `곡 ID 중복: ${track.id}`);
    trackIds.add(track.id);
    const normalized = normalizeTitle(track.title);
    assert.ok(!normalizedTitles.has(normalized), `정규화된 제목 중복: ${track.title}`);
    normalizedTitles.add(normalized);
    const album = albumMap.get(track.albumId);
    assert.ok(album, `${track.id}: 존재하지 않는 실물 앨범입니다.`);
    assert.ok(album.order >= previousAlbumOrder, `${track.id}: 곡의 앨범 순서가 역행합니다.`);
    assert.ok(Number.isInteger(track.trackNumber) && track.trackNumber > album.lastTrackNumber, `${track.id}: 실제 트랙 번호가 오름차순 양의 정수가 아닙니다.`);
    if (track.aliases !== undefined) {
      assert.ok(Array.isArray(track.aliases), `${track.id}: 별칭은 배열이어야 합니다.`);
      track.aliases.forEach(alias => nonEmpty(alias, `${track.id} 별칭`));
    }
    const originalTrack = masterTracks.get(track.id);
    if (originalTrack) {
      assert.equal(track.albumId, originalTrack.albumId, `${track.id}: 원본 앨범 ID가 바뀌었습니다.`);
      assert.equal(track.trackNumber, originalTrack.trackNumber, `${track.id}: 원본 트랙 번호가 바뀌었습니다.`);
      if (track.title !== originalTrack.title) {
        assert.equal(track.originalTitle, originalTrack.title, `${track.id}: 사용자 표기를 적용해도 정확한 원제를 보존해야 합니다.`);
        assert.ok(track.aliases?.includes(originalTrack.title), `${track.id}: 원제를 입력 별칭에도 보존해야 합니다.`);
      }
    }
    if (typingNames.has(track.id)) assert.equal(track.title, typingNames.get(track.id), `${track.id}: 사용자 지정 입력 표기가 다릅니다.`);
    if (track.sources) sources(track.sources, `${track.id} 출처`);
    if (album.start === -1) album.start = index;
    album.lastTrackNumber = track.trackNumber;
    album.count += 1;
    previousAlbumOrder = album.order;
  }
  for (const album of albumMap.values()) {
    assert.ok(album.count > 0, `${album.id}: 연결된 곡이 없습니다.`);
    if (album.courseTrackCount !== undefined) assert.equal(album.courseTrackCount, album.count, `${album.id}: 수록 수 메타데이터가 실제 코스와 다릅니다.`);
  }
  for (const track of master.tracks.filter(track => albumMap.has(track.albumId))) {
    assert.ok(trackIds.has(track.id), `${track.id}: 선택된 앨범의 원래 고유 곡이 사라졌습니다.`);
  }
  for (const id of typingNames.keys()) assert.ok(trackIds.has(id), `${id}: 사용자 지정 곡이 코스에서 사라졌습니다.`);
  for (const item of course.excluded) {
    nonEmpty(item.id, '제외 항목 ID');
    nonEmpty(item.title, `${item.id} 제외 제목`);
    nonEmpty(item.reason, `${item.id} 제외 사유`);
    sources(item.sources, `${item.id} 제외 근거`);
    assert.ok(!trackIds.has(item.id) && !albumMap.has(item.id), `${item.id}: 포함·제외 목록이 충돌합니다.`);
  }
  if (albumMap.has('to-heart')) {
    const originalGlass = master.tracks.find(track => track.id === 'glass-shoes-01');
    assert.ok(originalGlass, '원본 디지털 선공개 유리구두의 보존 정보가 없습니다.');
    const glass = course.tracks.find(track => track.id === 'to-heart-06');
    assert.ok(glass, '디지털 선공개를 제외해도 To. Heart 실물 6번 유리구두는 포함해야 합니다.');
    assert.equal(glass.albumId, 'to-heart');
    assert.equal(glass.trackNumber, 6);
    assert.equal(glass.title, originalGlass.title);
    assert.equal(glass.originalTrackId, originalGlass.id);
    assert.equal(glass.versionTitle, '유리구두 (MAMA Ver.)');
    assert.ok(glass.aliases.includes(glass.versionTitle), '유리구두의 실제 MAMA 판본 별칭을 보존해야 합니다.');
    sources(glass.sources, '유리구두 실물판 근거');
    assert.equal(course.tracks.filter(track => normalizeTitle(track.title) === normalizeTitle(originalGlass.title)).length, 1);
  }
  if (masterAlbums.has('like-you-better-japanese')) {
    assert.ok(albumMap.has('like-you-better-japanese'), '실물 일본 EP는 초동 수치 유무와 무관하게 코스 메타데이터에 남겨야 합니다.');
    const japaneseTracks = course.tracks.filter(track => track.albumId === 'like-you-better-japanese');
    assert.equal(japaneseTracks.length, 1, '일본 EP는 기존 곡의 언어별 버전·반주를 제외한 고유 신곡만 포함합니다.');
    assert.equal(japaneseTracks[0].title, 'Sky Runner');
    assert.equal(japaneseTracks[0].trackNumber, 3);
  }
  await Promise.all(course.albums.map(checkCover));
  return albumMap;
}

function checkSales(data, albumMap) {
  date(data.updatedAt, '초동 자료 확인일');
  assert.equal(data.metric, 'reported-first-week-sales', '앨범별 첫 주 판매량이라는 지표를 명시해야 합니다. 보도·비공식 자료를 한터 공식 원자료로 단정하면 안 됩니다.');
  assert.equal(data.unit, 'copies', '음반지수·순위 대신 판매 장수를 사용해야 합니다.');
  nonEmpty(data.definition, '초동 지표 정의');
  assert.match(data.definition, /7일/u, '발매일부터 7일이라는 지표 정의가 필요합니다.');
  sources(data.sources, '초동 공통 출처', true);
  assert.ok(Array.isArray(data.albums), '초동 자료의 albums가 없습니다.');
  const rows = new Map();
  for (const row of data.albums) {
    nonEmpty(row.albumId, '초동 앨범 ID');
    assert.ok(!rows.has(row.albumId), `초동 앨범 ID 중복: ${row.albumId}`);
    const album = albumMap.get(row.albumId);
    assert.ok(album, `${row.albumId}: 실물 코스에 없는 초동 자료입니다.`);
    assert.equal(normalizeTitle(row.title), normalizeTitle(album.title), `${row.albumId}: 초동 앨범명이 코스와 다릅니다.`);
    assert.equal(date(row.releaseDate, `${row.albumId} 초동 발매일`), album.date);
    assert.ok(Object.hasOwn(row, 'sales'), `${row.albumId}: 미확인은 sales:null로 명시해야 합니다.`);
    assert.ok(row.sales === null || (Number.isSafeInteger(row.sales) && row.sales > 0), `${row.albumId}: 판매량은 양의 정수 또는 null이어야 합니다. 0은 미확인 표시가 아닙니다.`);
    assert.equal(typeof row.approximate, 'boolean', `${row.albumId}: approximate는 boolean이어야 합니다.`);
    assert.ok(sourceTypes.has(row.sourceType), `${row.albumId}: 알 수 없는 출처 유형입니다.`);
    assert.ok(chartSystems.has(row.chartSystem), `${row.albumId}: 집계기관을 구분해야 합니다.`);
    assert.ok(['release-first-seven-days', 'oricon-first-week'].includes(row.metric), `${row.albumId}: 집계 지표를 명시해야 합니다.`);
    nonEmpty(row.metricLabel, `${row.albumId} 집계 표시명`);
    sources(row.sources, `${row.albumId} 초동 출처`, true);
    nonEmpty(row.note, `${row.albumId} 집계 설명`);
    if (row.sourceType === 'unofficial') assert.match(row.note, /비공식/u, `${row.albumId}: 비공식 수치를 공식 확인값으로 설명하면 안 됩니다.`);
    if (row.metric === 'oricon-first-week') {
      assert.equal(row.albumId, 'like-you-better-japanese', '다른 앨범에 일본 EP의 오리콘 주간 예외를 적용하면 안 됩니다.');
      assert.equal(row.chartSystem, 'oricon');
      assert.equal(row.metricLabel, '오리콘 첫 주');
      assert.ok(row.sources.some(source => new URL(source.url).hostname.endsWith('oricon.co.jp')), '오리콘 주간 기간을 확인할 공식 출처가 필요합니다.');
    } else {
      assert.notEqual(row.chartSystem, 'oricon', `${row.albumId}: 오리콘과 발매 첫 7일 지표를 혼동하면 안 됩니다.`);
      assert.equal(row.metricLabel, '발매 첫 7일');
    }
    if (row.sales !== null) {
      assert.ok(['official', 'reported', 'unofficial'].includes(row.sourceType), `${row.albumId}: 미확인 출처로 판매량을 확정할 수 없습니다.`);
      const expectedStart = row.metric === 'oricon-first-week' ? releaseCalendarWeekStart(album.date) : album.date;
      assert.equal(date(row.periodStart, `${row.albumId} 집계 시작일`), expectedStart, `${row.albumId}: 명시한 집계 지표의 시작일과 다릅니다.`);
      assert.equal(date(row.periodEnd, `${row.albumId} 집계 종료일`), sevenDayEnd(expectedStart), `${row.albumId}: 명시한 집계 지표의 정확한 7일이어야 합니다.`);
      if (row.metric === 'oricon-first-week') assert.match(row.note, /달력 주간/u, '오리콘은 발매일부터 연속 7일이 아닌 달력 주간임을 설명해야 합니다.');
    } else {
      assert.equal(row.sourceType, 'unverified', `${row.albumId}: null 판매량은 unverified로 명시해야 합니다.`);
      assert.equal(row.approximate, false, `${row.albumId}: 미확인은 근사치가 아닙니다.`);
      if (row.periodStart !== undefined || row.periodEnd !== undefined) {
        assert.equal(date(row.periodStart, `${row.albumId} 미확인 구간 시작일`), album.date);
        assert.equal(date(row.periodEnd, `${row.albumId} 미확인 구간 종료일`), sevenDayEnd(album.date));
      }
    }
    rows.set(row.albumId, row);
  }
  assert.deepEqual([...rows.keys()].sort(), [...albumMap.keys()].sort(), '초동 자료와 실물 코스의 앨범 ID는 정확히 1:1이어야 합니다.');
  return rows;
}

function prefixRatio(state) {
  const target = [...normalizeTitle(state.target)];
  const typed = [...normalizeTitle(state.input)];
  let matching = 0;
  while (matching < typed.length && matching < target.length && typed[matching] === target[matching]) matching += 1;
  return target.length ? matching / target.length : 0;
}

function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
}

function checkIntegration(course, albumMap, rows) {
  const anchors = course.albums.map(album => ({ ...album, firstWeekSales: rows.get(album.id).sales, approximate: rows.get(album.id).approximate }));
  const observedBefore = anchors.map(album => ({ id: album.id, sales: album.firstWeekSales }));
  const chart = new ChartProgress({ albums: anchors, tracks: course.tracks });
  const session = new TypingSession(course.tracks);
  let now = 0;
  let priorX = 0;
  let interpolated = 0;
  let unknown = 0;
  let finishTail = 0;
  let checkedBoundaries = 0;
  const noMovement = (before, after, label) => assert.deepEqual(after.position, before.position, label);
  function examine(point) {
    const current = albumMap.get(point.currentAlbum.id);
    const next = course.albums[current.order + 1] || null;
    const from = rows.get(current.id).sales;
    const to = next ? rows.get(next.id).sales : null;
    assert.ok(point.position.xRatio >= priorX, '오타 수정·Backspace·재입력으로 진행 위치가 뒤로 가면 안 됩니다.');
    priorX = point.position.xRatio;
    close(point.position.plotIndex, current.order + point.album.ratio, '앨범 구간 위치');
    close(point.position.xRatio, point.position.plotIndex / course.albums.length, '차트 전체 위치');
    assert.equal(point.position.hasKnownY, point.position.yValue !== null);
    assert.equal(point.currentAlbum.firstWeekSales, from, '현재 앨범의 실판매량을 중간 보간값으로 바꾸면 안 됩니다.');
    if (point.position.kind === 'interpolated') {
      interpolated += 1;
      assert.ok(next && from !== null && to !== null);
      assert.equal(point.position.anchorAlbumId, null, '중간 위치는 실제 판매 관측점이 아닙니다.');
      assert.ok(point.position.intervalRatio > 0 && point.position.intervalRatio < 1);
      close(point.position.yValue, from + (to - from) * point.position.intervalRatio, '보간된 이동 위치');
    } else if (point.position.kind === 'unknown') {
      unknown += 1;
      assert.equal(point.position.yValue, null, '미확인 판매량을 0이나 추정 수치로 연결하면 안 됩니다.');
      if (point.position.anchorAlbumId) assert.equal(rows.get(point.position.anchorAlbumId).sales, null);
    } else if (point.position.kind === 'anchor') {
      const observed = rows.get(point.position.anchorAlbumId);
      assert.ok(observed && observed.sales !== null);
      assert.equal(point.position.yValue, observed.sales, '관측점의 값은 해당 앨범의 출처 있는 판매량이어야 합니다.');
      assert.ok(point.position.intervalRatio === 0 || point.position.intervalRatio === 1);
    } else if (point.position.kind === 'finish-tail') {
      finishTail += 1;
      assert.equal(current.order, course.albums.length - 1);
      assert.equal(point.position.toAlbumId, null);
      assert.equal(point.position.yValue, from, '완주용 꼬리 구간에 새 판매량을 만들면 안 됩니다.');
      if (point.album.ratio > 0) assert.equal(point.position.anchorAlbumId, null);
    } else assert.fail(`알 수 없는 차트 위치 유형: ${point.position.kind}`);
    return point;
  }
  const couple = state => examine(chart.update({ index: state.index, prefixRatio: prefixRatio(state), status: state.status }));
  const initial = chart.snapshot();
  assert.equal(initial.status, 'ready');
  assert.equal(initial.position.plotIndex, 0);
  noMovement(initial, chart.snapshot(), '시작 전 자동 이동은 없어야 합니다.');
  let state = session.start(now);
  couple(state);
  for (const [index, track] of course.tracks.entries()) {
    assert.equal(state.currentTrack.id, track.id);
    const album = albumMap.get(track.albumId);
    const atAlbumStart = index === album.start;
    const atTrackStart = couple(state);
    if (atAlbumStart) {
      checkedBoundaries += 1;
      assert.equal(atTrackStart.currentAlbum.id, track.albumId);
      assert.equal(atTrackStart.album.ratio, 0);
      assert.equal(atTrackStart.position.plotIndex, album.order);
      assert.equal(atTrackStart.position.anchorAlbumId, track.albumId);
    }
    const stopped = couple(session.snapshot(now += 1000));
    noMovement(atTrackStart, stopped, '타이핑을 멈추면 차트도 제자리에 있어야 합니다.');
    const glyphs = [...track.title];
    if (atAlbumStart && glyphs.length > 1) {
      const goodPrefix = glyphs[0];
      const progressed = couple(session.updateInput(goodPrefix, now += 10));
      state = session.updateInput(`${goodPrefix}☃`, now += 10);
      assert.equal(state.hasError, true);
      noMovement(progressed, couple(state), '오타 자체가 차트를 전진시키면 안 됩니다.');
      state = session.updateInput('', now += 10);
      noMovement(progressed, couple(state), 'Backspace로 진행 위치가 뒤로 가면 안 됩니다.');
      const pausedState = session.pause(now += 10);
      const paused = couple(pausedState);
      noMovement(progressed, paused, '일시정지로 위치가 바뀌면 안 됩니다.');
      const ignored = session.updateInput('☃', now += 900);
      assert.equal(ignored.stats.elapsedMs, pausedState.stats.elapsedMs);
      assert.equal(ignored.input, pausedState.input);
      noMovement(paused, couple(ignored), '일시정지 중 입력과 시간으로 움직이면 안 됩니다.');
      state = session.resume(now += 10);
      noMovement(paused, couple(state), '재개 직후 자동으로 전진하면 안 됩니다.');
    }
    for (let length = 1; length <= glyphs.length; length += 1) {
      const value = glyphs.slice(0, length).join('');
      const pendingIme = length === glyphs.length && /[가-힣]$/u.test(value);
      state = session.updateInput(value, now += 10, { isComposing: pendingIme });
      const point = couple(state);
      if (pendingIme) {
        assert.equal(state.index, index, '한글 조합 중에는 다음 곡으로 넘어가면 안 됩니다.');
        assert.equal(state.advanced, false);
        if (index === album.start + album.count - 1) {
          close(point.position.plotIndex, album.order + 1, '마지막 글자 조합이 끝난 앨범 경계');
        }
        state = session.updateInput(value, now += 10, { isComposing: false });
        couple(state);
      }
    }
    assert.equal(state.index, index + 1, `${track.title}: 정답은 정확히 한 곡만 전진해야 합니다.`);
    assert.equal(state.advanced, true);
    assert.equal(state.completedTrack.id, track.id);
  }
  assert.equal(checkedBoundaries, course.albums.length);
  assert.equal(state.status, 'completed');
  const done = chart.snapshot();
  assert.equal(done.status, 'completed');
  assert.equal(done.course.completed, course.tracks.length);
  assert.equal(done.course.ratio, 1);
  assert.equal(done.position.plotIndex, course.albums.length);
  assert.equal(done.position.xRatio, 1);
  assert.equal(done.position.kind, 'finish-tail');
  assert.equal(done.position.anchorAlbumId, null, '종점은 새로운 초동 관측점이 아닙니다.');
  assert.ok(finishTail > 0);
  assert.deepEqual(chart.albums.map(album => ({ id: album.id, sales: album.firstWeekSales })), observedBefore, '게임 이동이 원래 판매 관측값을 수정하면 안 됩니다.');
  assert.equal(chart.albums.length, course.albums.length, '가상 완주 꼬리를 실제 앨범 관측점에 추가하면 안 됩니다.');
  noMovement(done, chart.update({ index: 0, prefixRatio: 0, status: 'running' }), '완주 후에는 위치를 고정해야 합니다.');
  const frozen = session.snapshot(now += 1000);
  assert.equal(frozen.stats.elapsedMs, state.stats.elapsedMs);
  const reset = chart.reset();
  assert.equal(reset.position.plotIndex, 0);
  assert.equal(session.reset().status, 'ready');

  const cleanSession = new TypingSession(course.tracks);
  cleanSession.start(0);
  let clean;
  for (const [index, track] of course.tracks.entries()) clean = cleanSession.updateInput(track.title, (index + 1) * 100);
  assert.equal(clean.status, 'completed');
  assert.equal(clean.stats.accuracy, 100);
  const expectedStrokes = course.tracks.reduce((sum, track) => sum + countStrokes(track.title), 0);
  assert.equal(clean.stats.correctStrokes, expectedStrokes);
  return { expectedStrokes, interpolated, unknown, finishTail, checkedBoundaries };
}

async function main() {
  const [course, sales, master] = await Promise.all(['album-course.json', 'first-week-sales.json', 'discography.json'].map(readJson));
  const albumMap = await checkCourse(course, master);
  const rows = checkSales(sales, albumMap);
  const integration = checkIntegration(course, albumMap, rows);
  const records = [...rows.values()];
  const known = records.filter(row => row.sales !== null);
  const unofficial = known.filter(row => row.sourceType === 'unofficial');
  const oricon = records.filter(row => row.metric === 'oricon-first-week');
  console.log(`차트 자료 검사 통과: 실물 ${course.albums.length}앨범 · ${course.tracks.length}곡 · 재킷 ${course.albums.length}장`);
  console.log(`판매량 ID 1:1 · 수치 ${known.length}건(근사치 ${known.filter(row => row.approximate).length}, 비공식 ${unofficial.length}) · 미확인 ${records.length - known.length}건(null)`);
  console.log(`기간 검사 통과: 발매 첫 7일 ${records.length - oricon.length}건 · 오리콘 달력 첫 주 ${oricon.length}건${oricon.map(row => ` (${row.periodStart}~${row.periodEnd})`).join('')}`);
  console.log(`전체 입력 표기 완주 ${integration.expectedStrokes}타 · 사용자 표기 ${typingNames.size}곡 · 앨범 경계 ${integration.checkedBoundaries}회 · prefix/정지/오타/Backspace/일시정지/완주 고정 통과`);
  console.log(`이동 위치 분리: 보간 ${integration.interpolated}회 · 미확인 ${integration.unknown}회 · 가상 완주 꼬리 ${integration.finishTail}회 · 판매 관측값 불변`);
}

try { await main(); }
catch (error) {
  console.error(`차트 자료 검사 실패: ${error.message}`);
  process.exitCode = 1;
}
