export class RankingError extends Error {
  constructor(code, message) { super(message); this.name = 'RankingError'; this.code = code; }
}

export function normalizeNickname(value) {
  const nickname = String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ');
  if ([...nickname].length < 2 || [...nickname].length > 16 || /[\u0000-\u001f\u007f<>]/u.test(nickname)) {
    throw new RankingError('invalid-nickname', '닉네임은 2~16자로 입력해주세요.');
  }
  return nickname;
}

function publicKey(value) {
  if (typeof value !== 'string' || !value) return false;
  if (value.startsWith('sb_publishable_')) return true;
  if (value.startsWith('sb_secret_')) return false;
  try {
    const encoded = value.split('.')[1].replace(/-/gu, '+').replace(/_/gu, '/');
    return JSON.parse(atob(encoded)).role === 'anon';
  } catch { return false; }
}

function defaultStorage() { try { return globalThis.localStorage; } catch { return null; } }
const deviceName = value => value === 'mobile' ? 'mobile' : 'pc';

/** Supabase REST client. Only a publishable/legacy anon key is accepted. */
export function createRankingClient(options = {}) {
  let url = '';
  try { const parsed = new URL(options.url); if (parsed.protocol === 'https:') url = parsed.origin; } catch {}
  const configured = options.enabled !== false && Boolean(url && publicKey(options.publishableKey) && options.courseVersion);
  const storage = options.storage ?? defaultStorage();
  const requestFetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const now = options.now ?? (() => Date.now());
  const device = deviceName(options.device);
  const storageKey = `fromis-ranking-auth-v1:${url ? new URL(url).host : 'unconfigured'}`;
  const albumIds = Array.isArray(options.canonicalAlbumIds) ? [...options.canonicalAlbumIds] : [];
  let session = null, pendingAuth = null;
  try { session = JSON.parse(storage?.getItem(storageKey) || 'null'); } catch {}

  function requireConfig() {
    if (!configured || !requestFetch) throw new RankingError('not-configured', '온라인 랭킹 연결을 준비하고 있어요.');
  }
  function saveSession(body) {
    const value = body.session || body;
    if (!value.access_token || !value.refresh_token || !value.user?.id) throw new RankingError('auth-failed', '인증 정보를 확인하지 못했어요.');
    session = { access_token: value.access_token, refresh_token: value.refresh_token, expires_at: value.expires_at || Math.floor(now() / 1000) + (value.expires_in || 3600), user: { id: value.user.id } };
    try { storage?.setItem(storageKey, JSON.stringify(session)); } catch {}
    return session;
  }
  function clearSession() { session = null; try { storage?.removeItem(storageKey); } catch {} }
  async function request(path, body, token) {
    requireConfig();
    const headers = { apikey: options.publishableKey, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (options.publishableKey.split('.').length === 3) headers.Authorization = `Bearer ${options.publishableKey}`;
    let response, payload;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
    try {
      response = await requestFetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      try { payload = await response.json(); } catch { throw new RankingError('invalid-response', '랭킹 서버 응답을 확인하지 못했어요.'); }
    } catch (error) {
      if (error instanceof RankingError) throw error;
      throw new RankingError('network', controller.signal.aborted ? '랭킹 서버 응답이 늦어요. 잠시 후 다시 시도해주세요.' : '랭킹 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally { clearTimeout(timer); }
    if (response.ok) return payload;
    const code = payload?.code || payload?.error_code || '';
    const detail = String(payload?.message || payload?.msg || payload?.error_description || payload?.error || '');
    if (['PGRST202', '42P01', '42883'].includes(code)) throw new RankingError('backend-not-ready', '온라인 랭킹 설정을 마무리하고 있어요.');
    if (code === 'anonymous_provider_disabled' || /anonymous.*disabled/iu.test(detail)) throw new RankingError('auth-not-enabled', '익명 로그인 설정을 활성화해주세요.');
    if (/NICKNAME_REQUIRED/u.test(detail)) throw new RankingError('nickname-required', '닉네임을 먼저 저장해주세요.');
    if (/FULL_COURSE_REQUIRED|COURSE_NOT_FOUND/u.test(detail)) throw new RankingError('course-mismatch', '전체 앨범 코스에서만 랭킹에 등록할 수 있어요.');
    if (/INVALID_RUN|INVALID_STATS|RUN_EXPIRED/u.test(detail)) throw new RankingError('invalid-run', '기록의 코스나 시간을 확인하지 못했어요.');
    if (response.status === 401 || response.status === 403 || /refresh_token|session_not_found|session_expired|bad_jwt/u.test(code)) throw new RankingError('auth-failed', '인증이 만료됐어요. 닉네임을 다시 저장해주세요.');
    throw new RankingError('server', '랭킹 요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.');
  }
  async function ensureSession({ create = true } = {}) {
    requireConfig();
    if (session?.access_token && session?.user?.id && session.expires_at * 1000 > now() + 60000) return session;
    if (pendingAuth) return pendingAuth;
    pendingAuth = (async () => {
      if (session?.refresh_token) {
        try { return saveSession(await request('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token })); }
        catch (error) { if (error.code !== 'auth-failed') throw error; clearSession(); }
      }
      if (!create) throw new RankingError('identity-required', '닉네임을 저장하면 이 브라우저의 개인 기록을 확인할 수 있어요.');
      return saveSession(await request('/auth/v1/signup', { data: {} }));
    })();
    try { return await pendingAuth; } finally { pendingAuth = null; }
  }
  async function rpc(name, body, authenticated = true) {
    let token;
    if (authenticated) token = (await ensureSession({ create: name !== 'fromis_personal_records' })).access_token;
    else if (session?.access_token && session.expires_at * 1000 > now() + 60000) token = session.access_token;
    return request(`/rest/v1/rpc/${name}`, body, token);
  }
  const fullSelection = selected => Array.isArray(selected) && albumIds.length > 0 && selected.length === albumIds.length && selected.every((id, index) => id === albumIds[index]);

  return {
    configured, courseVersion: options.courseVersion, device,
    isAuthenticated: () => Boolean(session?.user?.id),
    async setNickname(value) { const nickname = normalizeNickname(value); return rpc('fromis_set_nickname', { p_nickname: nickname }); },
    async leaderboard({ period = 'week', device: selectedDevice = device, limit = 10 } = {}) {
      if (!['week', 'all'].includes(period)) throw new RankingError('invalid-period', '랭킹 기간을 확인해주세요.');
      const result = await rpc('fromis_leaderboard', { p_course_version: options.courseVersion, p_period: period, p_device: deviceName(selectedDevice), p_limit: Math.min(50, Math.max(1, Number(limit) || 10)) }, false);
      if (!Array.isArray(result)) throw new RankingError('invalid-response', '랭킹 목록을 확인하지 못했어요.');
      return result;
    },
    personal({ device: selectedDevice = device } = {}) { return rpc('fromis_personal_records', { p_course_version: options.courseVersion, p_device: deviceName(selectedDevice) }); },
    async startRun({ albumIds: selected, fullCourse, device: selectedDevice = device } = {}) {
      if (!fullCourse || !fullSelection(selected)) return { eligible: false, reason: 'practice' };
      return rpc('fromis_begin_run', { p_course_version: options.courseVersion, p_album_ids: selected, p_device: deviceName(selectedDevice) });
    },
    async finishRun({ runId, fullCourse, completedTrackCount, elapsedMs, correctStrokes, attemptedStrokes } = {}) {
      if (!fullCourse) return { eligible: false, reason: 'practice' };
      if (completedTrackCount !== options.trackCount || !runId || !Number.isFinite(elapsedMs) || !Number.isInteger(correctStrokes) || !Number.isInteger(attemptedStrokes) || attemptedStrokes < correctStrokes) throw new RankingError('invalid-run', '완주 기록을 확인하지 못했어요.');
      return rpc('fromis_finish_run', { p_run_id: runId, p_completed_track_count: completedTrackCount, p_elapsed_ms: Math.round(elapsedMs), p_correct_strokes: correctStrokes, p_attempted_strokes: attemptedStrokes });
    }
  };
}
