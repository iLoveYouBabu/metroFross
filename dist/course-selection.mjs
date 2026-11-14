export function buildCourse(catalog, selectedAlbumIds = catalog.albums.map(album => album.id)) {
  if (!Array.isArray(catalog?.albums) || !Array.isArray(catalog?.tracks) || !Array.isArray(selectedAlbumIds)) throw new TypeError('앨범 목록과 선택 목록이 필요해요.');
  const allIds = new Set(catalog.albums.map(album => album.id));
  if (allIds.size !== catalog.albums.length || !allIds.size) throw new TypeError('앨범 목록이 올바르지 않아요.');
  const selected = new Set(selectedAlbumIds);
  if (!selected.size) throw new RangeError('앨범을 하나 이상 골라주세요.');
  for (const id of selected) if (!allIds.has(id)) throw new RangeError(`목록에 없는 앨범: ${id}`);
  const albums = catalog.albums.filter(album => selected.has(album.id));
  const tracks = catalog.tracks.filter(track => selected.has(track.albumId));
  for (const album of albums) if (!tracks.some(track => track.albumId === album.id)) throw new TypeError(`${album.id}: 수록곡이 없어요.`);
  const albumIds = albums.map(album => album.id);
  const signature = JSON.stringify({ rules: 'arrival-v1', albumIds, tracks: tracks.map(track => [track.id, track.title, track.aliases || []]) });
  return { albums, tracks, albumIds, isFullCourse: selected.size === allIds.size, trackCount: tracks.length, signature };
}

export async function catalogFingerprint(catalog) {
  if (!globalThis.crypto?.subtle) return null;
  const value = JSON.stringify({ albums: catalog.albums.map(album => album.id), tracks: catalog.tracks.map(track => ({ id: track.id, title: track.title, albumId: track.albumId, trackNumber: track.trackNumber, aliases: track.aliases || [] })) });
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function bestForCourse(records, signature, device, nickname) {
  return records.filter(record => record.signature === signature && record.device === device && (nickname === undefined || record.nickname === nickname) && Number.isFinite(record.elapsedMs) && record.elapsedMs > 0).sort((a, b) => a.elapsedMs - b.elapsedMs)[0] || null;
}
