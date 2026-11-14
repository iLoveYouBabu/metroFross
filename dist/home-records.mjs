import { bestForCourse } from './course-selection.mjs';

const time = value => { const tenths = Math.max(0, Math.floor(Number(value) / 100)); return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`; };
const date = value => { try { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return ''; } };
const node = (tag, className, text) => { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; };

export function createHomeRecords({ client, records, fullSignature, currentDevice }) {
  const byId = id => document.getElementById(id);
  const content = byId('records-content'), status = byId('ranking-connection-status'), device = byId('ranking-device');
  const tabs = [...document.querySelectorAll('.record-tabs [role=tab]')];
  let period = 'week', requestId = 0;
  device.value = currentDevice;
  function summary(remoteBest = null) {
    const rows = records.list().filter(row => row.device === device.value);
    const local = bestForCourse(rows, fullSignature, device.value);
    const values = [local?.elapsedMs, remoteBest?.elapsed_ms].filter(value => Number.isFinite(value) && value > 0);
    byId('personal-best-time').textContent = values.length ? time(Math.min(...values)) : '—';
    byId('personal-run-count').textContent = `${rows.length}회`;
  }
  function showRows(rows, personal = false) {
    const list = node('ol', 'record-list');
    for (const [index, row] of rows.entries()) {
      const item = node('li', `record-row${row.is_me ? ' is-me' : ''}`);
      item.append(node('span', 'record-place', personal ? '—' : String(row.rank ?? index + 1)));
      const copy = node('div');
      const title = node('div', 'record-name', personal ? (row.isFullCourse ? '전체 앨범 완주' : `${row.albumIds?.length || 0}앨범 연습 완주`) : row.nickname);
      if (personal) title.append(node('span', `record-tag${row.isFullCourse ? ' ranked' : ''}`, row.isFullCourse ? '전체 코스' : '랭킹 제외'));
      copy.append(title);
      const cpm = Math.round(Number(row.cpm) || 0), accuracy = Number(Number(row.accuracy ?? 100).toFixed(1));
      copy.append(node('span', 'record-detail', `${personal ? date(row.completedAt) + ' · ' : ''}${cpm}타 · 정확도 ${accuracy}%`));
      if (personal && row.albumTitles?.length) copy.append(node('span', 'record-detail', row.albumTitles.join(' · ')));
      item.append(copy, node('strong', 'record-time', time(row.elapsedMs ?? row.elapsed_ms))); list.append(item);
    }
    content.replaceChildren(list);
  }
  function empty(message) { content.replaceChildren(node('p', 'records-empty', message)); }
  async function refresh() {
    const id = ++requestId, selectedDevice = device.value; summary();
    byId('records-period-label').textContent = period === 'week' ? '최근 7일 · 전체 코스' : period === 'all' ? '전체 기간 · 전체 코스' : '선택 코스 포함 · 내 완주 기록';
    if (period === 'personal') {
      const local = records.list().filter(row => row.device === selectedDevice);
      if (local.length) showRows(local.slice(0, 12), true); else empty('이 기기에 아직 완주 기록이 없어요. 앨범을 골라 첫 여정을 시작해요.');
      status.textContent = '선택 앨범의 연습 기록도 이 기기에 남아요.';
      try {
        const remote = await client.personal({ device: selectedDevice });
        if (id !== requestId) return; summary(remote.best);
        const remoteRows = (remote.recent || []).filter(row => !local.some(record => record.rankRunId === row.run_id || (record.elapsedMs === row.elapsed_ms && Math.abs(Date.parse(record.completedAt) - Date.parse(row.finished_at)) < 10000))).map(row => ({ ...row, isFullCourse: true, albumIds: [], completedAt: row.finished_at, elapsedMs: row.elapsed_ms }));
        const merged = [...local, ...remoteRows].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)).slice(0, 12);
        if (merged.length) showRows(merged, true);
        status.textContent = '온라인 전체 코스 기록과 이 기기의 연습 기록이에요.';
      } catch (error) { if (id !== requestId) return; if (error.code !== 'identity-required') status.textContent = '온라인 기록 연결 준비 중 · 이 기기 기록은 계속 저장돼요.'; }
      return;
    }
    empty('랭킹을 불러오고 있어요.'); status.textContent = '';
    try {
      const rows = await client.leaderboard({ period, device: selectedDevice, limit: period === 'week' ? 10 : 20 });
      if (id !== requestId) return;
      if (rows.length) showRows(rows); else empty('아직 등록된 전체 코스 기록이 없어요. 첫 완주 기록을 남겨봐요.');
      status.textContent = '플레이어별 최고 기록 · PC/모바일 구분';
    } catch (error) {
      if (id !== requestId) return;
      const preparing = ['not-configured', 'backend-not-ready', 'auth-not-enabled'].includes(error.code);
      empty(preparing ? '온라인 랭킹을 준비하고 있어요.\n개인 기록은 지금도 이 기기에 남길 수 있어요.' : '랭킹에 연결하지 못했어요. 잠시 후 새로고침해주세요.');
      status.textContent = '모든 앨범을 선택한 완주 기록만 랭킹에 반영돼요.';
    }
  }
  function select(tab) { period = tab.dataset.period; for (const item of tabs) { item.setAttribute('aria-selected', String(item === tab)); item.tabIndex = item === tab ? 0 : -1; } content.setAttribute('aria-labelledby', tab.id); refresh(); }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => { const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0; if (!offset && !['Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length]; next.focus(); select(next); });
  });
  device.addEventListener('change', refresh); byId('refresh-records').addEventListener('click', refresh);
  return { refresh, summary, selectPersonal() { select(byId('records-personal')); } };
}
