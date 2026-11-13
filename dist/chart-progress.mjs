const STATUSES = new Set(['ready', 'running', 'paused', 'completed']);

function clampRatio(value) {
  if (!Number.isFinite(value)) throw new TypeError('prefixRatio must be a finite number.');
  return Math.max(0, Math.min(1, value));
}

function prepareAlbums(albums) {
  if (!Array.isArray(albums) || albums.length === 0) throw new TypeError('The chart needs at least one album anchor.');
  const ids = new Set();
  return albums.map((album, index) => {
    if (!album || typeof album.id !== 'string' || !album.id.trim() || ids.has(album.id)) {
      throw new TypeError(`Album anchor ${index} needs a unique, non-empty id.`);
    }
    ids.add(album.id);
    const sales = album.firstWeekSales ?? null;
    // Missing observations are null. A fabricated zero must never become a
    // measured chart point or a downward line to the baseline.
    if (sales !== null && (!Number.isFinite(sales) || sales <= 0)) {
      throw new TypeError(`${album.id}: firstWeekSales must be a positive number or null.`);
    }
    return Object.freeze({ ...album, firstWeekSales: sales });
  });
}

/**
 * Pure course-to-chart mapping. Only album anchors are sales observations.
 * Intermediate yValue values locate the game cursor, not measured sales.
 */
export class ChartProgress {
  constructor({ albums, tracks }) {
    this.albums = prepareAlbums(albums);
    if (!Array.isArray(tracks) || tracks.length === 0) throw new TypeError('The chart course needs at least one track.');
    this.totalTracks = tracks.length;
    const albumIndices = new Map(this.albums.map((album, index) => [album.id, index]));
    this.groups = this.albums.map((album, index) => ({ album, index, start: -1, count: 0 }));
    this.trackGroups = [];
    let previousAlbumIndex = -1;

    tracks.forEach((track, trackIndex) => {
      const albumIndex = albumIndices.get(track?.albumId);
      if (albumIndex === undefined) throw new TypeError(`Track ${trackIndex} has no chart album anchor.`);
      if (albumIndex < previousAlbumIndex) throw new TypeError('Tracks must follow the chart album order without returning to earlier albums.');
      const group = this.groups[albumIndex];
      if (group.start === -1) group.start = trackIndex;
      group.count += 1;
      this.trackGroups.push(group);
      previousAlbumIndex = albumIndex;
    });
    for (const group of this.groups) {
      if (group.count === 0) throw new TypeError(`${group.album.id}: every chart album needs at least one course track.`);
    }
    this.reset();
  }

  reset() {
    this.status = 'ready';
    this.index = 0;
    this.prefixRatio = 0;
    return this.snapshot();
  }

  update({ index = 0, prefixRatio = 0, status = 'running' } = {}) {
    if (!STATUSES.has(status)) throw new TypeError(`Unknown chart status: ${status}`);
    if (!Number.isInteger(index) || index < 0 || index > this.totalTracks) throw new RangeError('index must be a course track index, or totalTracks at completion.');
    const prefix = clampRatio(prefixRatio);
    if (this.status === 'completed') return this.snapshot();

    if (status === 'paused' || status === 'ready') {
      this.status = status;
      return this.snapshot();
    }
    if (status === 'completed' || index === this.totalTracks) {
      this.status = 'completed';
      this.index = this.totalTracks;
      this.prefixRatio = 0;
      return this.snapshot();
    }

    this.status = 'running';
    if (index > this.index) {
      this.index = index;
      this.prefixRatio = prefix;
    } else if (index === this.index) {
      this.prefixRatio = Math.max(this.prefixRatio, prefix);
    }
    return this.snapshot();
  }

  snapshot() {
    const completed = this.index === this.totalTracks;
    const group = completed ? this.groups.at(-1) : this.trackGroups[this.index];
    const trackOffset = completed ? group.count : this.index - group.start;
    const albumRatio = completed ? 1 : Math.min(1, (trackOffset + this.prefixRatio) / group.count);
    const courseRatio = completed ? 1 : (this.index + this.prefixRatio) / this.totalTracks;
    const next = this.albums[group.index + 1] || null;
    const current = group.album;
    const plotIndex = group.index + albumRatio;
    let yValue = null;
    let kind;
    let anchorAlbumId = null;

    if (!next) {
      // A dotted, non-measured finish tail gives the last album its own course
      // interval. It repeats the last y; it does not add a sales observation.
      yValue = current.firstWeekSales;
      kind = 'finish-tail';
      if (albumRatio === 0) anchorAlbumId = current.id;
    } else if (albumRatio === 0) {
      yValue = current.firstWeekSales;
      kind = yValue === null ? 'unknown' : 'anchor';
      anchorAlbumId = current.id;
    } else if (albumRatio === 1) {
      yValue = next.firstWeekSales;
      kind = yValue === null ? 'unknown' : 'anchor';
      anchorAlbumId = next.id;
    } else if (current.firstWeekSales !== null && next.firstWeekSales !== null) {
      yValue = current.firstWeekSales + (next.firstWeekSales - current.firstWeekSales) * albumRatio;
      kind = 'interpolated';
    } else {
      // Neither the cursor nor a line segment may imply zero for unknown data.
      kind = 'unknown';
    }

    return {
      status: this.status,
      course: { completed: this.index, total: this.totalTracks, ratio: courseRatio },
      currentAlbum: current,
      album: { index: group.index, trackOffset, trackCount: group.count, ratio: albumRatio },
      position: {
        plotIndex,
        xRatio: plotIndex / this.albums.length,
        fromAlbumId: current.id,
        toAlbumId: next?.id ?? null,
        intervalRatio: albumRatio,
        yValue,
        kind,
        anchorAlbumId,
        hasKnownY: yValue !== null
      }
    };
  }
}
