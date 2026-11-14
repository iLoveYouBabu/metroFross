export function createPersonalRecords(storage, key = 'fromis-personal-records-v1') {
  const valid = record => record && typeof record.id === 'string' && typeof record.signature === 'string' && Array.isArray(record.albumIds) && typeof record.isFullCourse === 'boolean' && Number.isFinite(record.elapsedMs) && record.elapsedMs > 0 && Number.isFinite(record.cpm) && record.cpm >= 0 && Number.isFinite(record.accuracy) && record.accuracy >= 0 && record.accuracy <= 100 && Number.isFinite(Date.parse(record.completedAt));
  const list = () => { try { const rows = JSON.parse(storage?.getItem(key) || '[]'); return Array.isArray(rows) ? rows.filter(valid).sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)) : []; } catch { return []; } };
  const save = rows => { try { storage?.setItem(key, JSON.stringify(rows.slice(0, 50))); } catch {} };
  return {
    list,
    add(record) { if (!valid(record)) throw new TypeError('완주 기록이 올바르지 않아요.'); const rows = [record, ...list().filter(row => row.id !== record.id)]; save(rows); return record; },
    uploaded(id, runId) { save(list().map(row => row.id === id ? { ...row, rankRunId: runId, uploaded: true } : row)); }
  };
}
