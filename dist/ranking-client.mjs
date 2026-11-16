export class RankingError extends Error {
  constructor(code, message) { super(message); this.name = 'RankingError'; this.code = code; }
}

// Same characters as kkobakGame; only the length limit is different.
export const NICKNAME_PATTERN = /^[ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎᄀ-ᄒ\x21-\x40\x5b-\x60\x7b-\x7e]{1,6}$/u;
export const NICKNAME_RULE = '닉네임은 초성·숫자·키보드 특수기호만 1~6글자로 입력해주세요.';

export function normalizeNickname(value) {
  const nickname = String(value ?? '').normalize('NFC').trim();
  if (!NICKNAME_PATTERN.test(nickname)) throw new RankingError('invalid-nickname', NICKNAME_RULE);
  return nickname;
}

function publicKey(value) {
  if (typeof value !== 'string' || !value) return false;
  if (value.startsWith('sb_publishable_')) return true;
  if (value.startsWith('sb_secret_')) return false;
  try { return JSON.parse(atob(value.split('.')[1].replace(/-/gu, '+').replace(/_/gu, '/'))).role === 'anon'; } catch { return false; }
}
const deviceName = value => value === 'mobile' ? 'mobile' : 'pc';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);

/** Nickname-based public ranking RPC client. No Supabase Auth or user session storage. */
export function createRankingClient(options = {}) {
  let url = '', nickname = '';
  try { const parsed = new URL(options.url); if (parsed.protocol === 'https:') url = parsed.origin; } catch {}
  try { if (options.nickname) nickname = normalizeNickname(options.nickname); } catch {}
  const configured = options.enabled !== false && Boolean(url && publicKey(options.publishableKey));
  const requestFetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const device = deviceName(options.device);
  const albumIds = Array.isArray(options.canonicalAlbumIds) ? [...options.canonicalAlbumIds] : [];
  const useNickname = value => { nickname = normalizeNickname(value); return nickname; };
  function selectedNickname(value = nickname) {
    if (!value) throw new RankingError('nickname-required', '닉네임을 먼저 입력해주세요.');
    return normalizeNickname(value);
  }
  async function rpc(name, body) {
    if (!configured || !requestFetch) throw new RankingError('not-configured', '온라인 랭킹 연결을 준비하고 있어요.');
    const headers = { apikey: options.publishableKey, 'Content-Type': 'application/json' };
    // Only the legacy public anon API key is a JWT. This is not a user session.
    if (options.publishableKey.split('.').length === 3) headers.Authorization = 'Bearer ' + options.publishableKey;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
    let response, payload;
    try {
      response = await requestFetch(url + '/rest/v1/rpc/' + name, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      try { payload = await response.json(); } catch { throw new RankingError('invalid-response', '랭킹 서버 응답을 확인하지 못했어요.'); }
    } catch (error) {
      if (error instanceof RankingError) throw error;
      throw new RankingError('network', controller.signal.aborted ? '랭킹 서버 응답이 늦어요. 잠시 후 다시 시도해주세요.' : '랭킹 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally { clearTimeout(timer); }
    if (response.ok) return payload;
    const code = payload?.code || '';
    const detail = String(payload?.message || payload?.msg || payload?.error_description || payload?.error || '');
    if (['PGRST202','42P01','42883'].includes(code)) throw new RankingError('backend-not-ready', '온라인 랭킹 설정을 마무리하고 있어요.');
    if (/INVALID_NICKNAME/u.test(detail)) throw new RankingError('invalid-nickname', NICKNAME_RULE);
    if (/NICKNAME_REQUIRED/u.test(detail)) throw new RankingError('nickname-required', '닉네임을 먼저 입력해주세요.');
    if (/FULL_COURSE_REQUIRED|COURSE_NOT_FOUND/u.test(detail)) throw new RankingError('course-mismatch', '전체 앨범 코스에서만 랭킹에 등록할 수 있어요.');
    if (/INVALID_RUN|INVALID_STATS|RUN_EXPIRED/u.test(detail) || code === '22P02') throw new RankingError('invalid-run', '기록의 코스나 시간을 확인하지 못했어요.');
    throw new RankingError('server', '랭킹 요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.');
  }
  const fullSelection = selected => Array.isArray(selected) && albumIds.length > 0 && selected.length === albumIds.length && selected.every((id, index) => id === albumIds[index]);

  return {
    configured, device, useNickname, getNickname: () => nickname,
    async leaderboard({ period = 'week', device: selectedDevice = device, limit = 10 } = {}) {
      if (!['week','all'].includes(period)) throw new RankingError('invalid-period', '랭킹 기간을 확인해주세요.');
      const result = await rpc('fromis_nickname_leaderboard', { p_period: period, p_device: deviceName(selectedDevice), p_limit: Math.min(50, Math.max(1, Number(limit) || 10)) });
      if (!Array.isArray(result)) throw new RankingError('invalid-response', '랭킹 목록을 확인하지 못했어요.');
      return result;
    },
    async finishRun({ runId, fullCourse, albumIds: selected, nickname: selectedName = nickname, device: selectedDevice = device, completedTrackCount, elapsedMs, correctStrokes, attemptedStrokes } = {}) {
      if (!fullCourse || !fullSelection(selected)) return { eligible: false, reason: 'practice' };
      if (completedTrackCount !== options.trackCount || !uuid(runId) || !Number.isFinite(elapsedMs) || Math.round(elapsedMs) <= 0 || elapsedMs > 14400000 || !Number.isSafeInteger(correctStrokes) || correctStrokes <= 0 || !Number.isSafeInteger(attemptedStrokes) || attemptedStrokes < correctStrokes || attemptedStrokes > 100000) throw new RankingError('invalid-run', '완주 기록을 확인하지 못했어요.');
      const result = await rpc('fromis_nickname_submit', { p_id: runId, p_nickname: selectedNickname(selectedName), p_device: deviceName(selectedDevice), p_album_ids: albumIds, p_completed_track_count: completedTrackCount, p_elapsed_ms: Math.round(elapsedMs), p_correct_strokes: correctStrokes, p_attempted_strokes: attemptedStrokes });
      if (result?.eligible !== true || typeof result.record?.run_id !== 'string' || result.record.run_id.toLowerCase() !== runId.toLowerCase()) throw new RankingError('invalid-response', '랭킹 저장 결과를 확인하지 못했어요.');
      return result;
    }
  };
}
