import { createSalesAxis, salesToY } from './chart-axis.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
let nextViewId = 0;

function svgNode(name, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const knownSales = album => Number.isFinite(album?.firstWeekSales) && album.firstWeekSales > 0;

function salesMetric(album) {
  const record = album.salesRecord;
  if (record?.metricLabel) return record.metricLabel;
  return record?.chartSystem === 'oricon' ? '오리콘 첫 주' : '발매 첫 7일';
}

function salesTitle(album) {
  const record = album.salesRecord;
  const system = record?.chartSystem === 'hanteo' ? ' (한터)' : '';
  const unofficial = record?.sourceType === 'unofficial' ? ' · 팬 정리 자료' : '';
  return `${album.title} (${album.date || ''}) · ${salesMetric(album)}${system} ${album.approximate ? '약 ' : ''}${album.firstWeekSales.toLocaleString('ko-KR')}장${unofficial}`;
}

function compactNumber(value) {
  const rounded = number => Number(number.toFixed(1)).toString();
  if (value >= 10000) return `${rounded(value / 10000)}만`;
  if (value >= 1000) return `${rounded(value / 1000)}천`;
  return rounded(value);
}

function shortAlbumTitle(album, limit) {
  const title = String(album.chartLabel || album.shortTitle || album.title || album.id)
    .replace(/^from\s+our\s+/iu, '').replace(/^\[|\]$/gu, '').trim();
  const characters = Array.from(title);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : title;
}

// Clip actual line geometry rather than flattening off-screen values to the
// local y maximum. Unknown observations never enter this function.
function clippedLine(x1, y1, x2, y2, box) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let start = 0;
  let end = 1;
  for (const [p, q] of [[-dx, x1 - box.left], [dx, box.right - x1], [-dy, y1 - box.top], [dy, box.bottom - y1]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const amount = q / p;
    if (p < 0) start = Math.max(start, amount);
    else end = Math.min(end, amount);
    if (start > end) return null;
  }
  return [
    clamp(x1 + start * dx, box.left, box.right), clamp(y1 + start * dy, box.top, box.bottom),
    clamp(x1 + end * dx, box.left, box.right), clamp(y1 + end * dy, box.top, box.bottom)
  ];
}

export class SalesChartView {
  constructor({ svg, stage, albums }) {
    if (!svg || !stage || !Array.isArray(albums) || !albums.length) throw new TypeError('SalesChartView needs svg, stage, and album anchors.');
    this.svg = svg;
    this.stage = stage;
    this.albums = albums;
    this.overview = false;
    this._destroyed = false;
    this._albumIndex = -1;
    this._globalAxis = createSalesAxis(albums, { overview: true });
    this._localAxis = this._globalAxis;
    this._id = `sales-chart-${++nextViewId}`;
    this._lastSnapshot = {
      currentAlbum: albums[0], album: { index: 0, ratio: 0 },
      course: { completed: 0, total: 0, ratio: 0 },
      position: { plotIndex: 0, yValue: knownSales(albums[0]) ? albums[0].firstWeekSales : null, kind: 'anchor' }
    };
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-labelledby', `${this._id}-title ${this._id}-description`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    if (typeof ResizeObserver === 'function') {
      this._observer = new ResizeObserver(() => this._render());
      this._observer.observe(stage);
    }
    this._render();
  }

  update(chartSnapshot) {
    if (this._destroyed) return;
    if (!Number.isFinite(chartSnapshot?.position?.plotIndex)) throw new TypeError('A chart progress snapshot is required.');
    this._lastSnapshot = chartSnapshot;
    this._render();
  }

  setOverview(value) {
    if (this._destroyed) return;
    this.overview = Boolean(value);
    this._render();
  }

  destroy() {
    this._destroyed = true;
    this._observer?.disconnect();
  }

  _layout(snapshot) {
    const rectangle = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(this.stage.clientWidth || rectangle.width || this._lastWidth || 640));
    const height = Math.max(1, Math.round(this.stage.clientHeight || rectangle.height || this._lastHeight || 240));
    this._lastWidth = width;
    this._lastHeight = height;
    const albumIndex = clamp(snapshot.album?.index ?? 0, 0, this.albums.length - 1);
    if (albumIndex !== this._albumIndex) {
      this._albumIndex = albumIndex;
      this._localAxis = createSalesAxis(this.albums, { albumIndex, fallback: this._localAxis });
    }
    const count = this.albums.length;
    const span = this.overview ? count : Math.min(count, 3.3);
    const plotIndex = clamp(snapshot.position.plotIndex, 0, count);
    const start = this.overview ? 0 : clamp(plotIndex - span * .4, 0, Math.max(0, count - span));
    const top = height < 110 ? 10 : 20;
    const bottom = Math.max(top + 1, height - (height < 110 ? 31 : 39));
    const box = { left: Math.min(56, width * .22), right: Math.max(1, width - 16), top, bottom };
    if (box.right <= box.left) box.right = box.left + 1;
    const axis = this.overview ? this._globalAxis : this._localAxis;
    return {
      width, height, albumIndex, start, end: start + span, ...axis, box,
      x: index => box.left + (index - start) / span * (box.right - box.left),
      y: value => salesToY(value, axis, box.top, box.bottom),
      titleY: height - (height < 110 ? 17 : 23),
      yearY: height - (height < 110 ? 5 : 10)
    };
  }

  _render() {
    if (this._destroyed) return;
    const snapshot = this._lastSnapshot;
    const layout = this._layout(snapshot);
    const { width, height, box, minimum, maximum, x, y } = layout;
    const root = document.createDocumentFragment();
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.setAttribute('width', String(width));
    this.svg.setAttribute('height', String(height));
    this.svg.dataset.mode = this.overview ? 'overview' : 'follow';
    this.svg.dataset.yMin = String(minimum);
    this.svg.dataset.yMax = String(maximum);
    this.svg.dataset.windowStart = layout.start.toFixed(4);
    this.svg.dataset.windowEnd = layout.end.toFixed(4);
    this.svg.dataset.albumId = snapshot.currentAlbum?.id || this.albums[layout.albumIndex].id;

    root.append(svgNode('title', { id: `${this._id}-title` }, '프로미스나인 앨범 첫 주 판매량과 타이핑 진행'));
    root.append(svgNode('desc', { id: `${this._id}-description` },
      `${this.overview ? '전체 앨범 보기. 세로축은 0을 기준으로 합니다' : '현재 앨범 주변 보기. 세로축을 주변 판매량 범위로 확대하며 앨범이 바뀔 때만 범위를 조정합니다'}. ` +
      `가로축은 발매 순서, 세로축은 ${minimum.toLocaleString('ko-KR')}장부터 ${maximum.toLocaleString('ko-KR')}장까지 선형 눈금입니다. ` +
      '원은 앨범별 첫 주 판매량이며 약으로 표시한 값은 근삿값입니다. 오리콘 첫 주와 팬 정리 자료는 각 점의 설명에서 구분합니다. 움직이는 재킷은 타이핑 진행 위치이며 그 높이는 별도 판매량 측정치가 아닙니다. 미확인 구간의 선은 끊고 마지막 점선은 판매량 변화 없는 가상 완주 구간입니다.'));

    const ticks = height < 110 ? [minimum, maximum] : layout.ticks;
    for (const value of ticks) {
      const lineY = clamp(y(value), box.top, box.bottom);
      root.append(svgNode('line', { class: 'chart-grid', x1: box.left, y1: lineY, x2: box.right, y2: lineY, 'aria-hidden': 'true' }));
      root.append(svgNode('text', { class: 'chart-axis-label', x: Math.max(1, box.left - 7), y: clamp(lineY + 3, 10, height - 3), 'text-anchor': 'end', 'font-size': 10, 'data-axis-value': value }, value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })));
    }

    const pathParts = [];
    for (let index = 0; index < this.albums.length - 1; index += 1) {
      const left = this.albums[index];
      const right = this.albums[index + 1];
      if (!knownSales(left) || !knownSales(right)) continue;
      const segment = clippedLine(x(index), y(left.firstWeekSales), x(index + 1), y(right.firstWeekSales), box);
      if (segment) pathParts.push(`M${segment[0]},${segment[1]}L${segment[2]},${segment[3]}`);
    }
    if (pathParts.length) root.append(svgNode('path', { class: 'chart-path', d: pathParts.join(' '), fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'aria-hidden': 'true' }));

    const last = this.albums.at(-1);
    if (knownSales(last)) {
      const tail = clippedLine(x(this.albums.length - 1), y(last.firstWeekSales), x(this.albums.length), y(last.firstWeekSales), box);
      if (tail) root.append(svgNode('path', { class: 'chart-finish-path', d: `M${tail[0]},${tail[1]}L${tail[2]},${tail[3]}`, fill: 'none', 'stroke-dasharray': '4 4', 'aria-hidden': 'true' }));
    }

    const visible = [];
    let previousUnknownLabelX = -Infinity;
    for (let index = 0; index < this.albums.length; index += 1) {
      const album = this.albums[index];
      const pointX = x(index);
      if (pointX < box.left - .1 || pointX > box.right + .1) continue;
      const point = { album, index, x: clamp(pointX, box.left, box.right), y: knownSales(album) ? y(album.firstWeekSales) : null };
      visible.push(point);
      if (point.y === null) {
        const labelX = clamp(point.x, 23, width - 23);
        if (!this.overview && labelX - previousUnknownLabelX >= 50) {
          root.append(svgNode('text', { class: 'chart-unknown-text', x: labelX, y: (box.top + box.bottom) / 2, 'text-anchor': 'middle', 'font-size': 10 }, '미확인'));
          previousUnknownLabelX = labelX;
        }
      } else if (point.y >= box.top - .1 && point.y <= box.bottom + .1) {
        const circle = svgNode('circle', { class: 'chart-anchor', cx: point.x, cy: clamp(point.y, box.top, box.bottom), r: 3, 'data-album-id': album.id, 'data-sales': album.firstWeekSales, 'data-approximate': Boolean(album.approximate), 'data-chart-system': album.salesRecord?.chartSystem || 'unspecified' });
        circle.append(svgNode('title', {}, salesTitle(album)));
        root.append(circle);
      }
    }

    this._drawLabels(root, visible, layout);
    if (this.albums.length >= layout.start && this.albums.length <= layout.end) {
      root.append(svgNode('text', { class: 'chart-album-label', x: clamp(x(this.albums.length), 15, width - 15), y: layout.titleY, 'text-anchor': 'middle', 'font-size': 10 }, '완주'));
    }
    this._drawMarker(root, snapshot, layout);
    this.svg.replaceChildren(root);
  }

  _drawLabels(root, visible, layout) {
    const { width, height, box, x } = layout;
    let labelPoints = visible;
    if (this.overview) {
      const indices = new Set([0, this.albums.length - 1, layout.albumIndex, Math.floor((this.albums.length - 1) / 2)]);
      labelPoints = visible.filter(point => indices.has(point.index));
    }
    let previousLabelX = -Infinity;
    for (const point of labelPoints) {
      const labelX = clamp(point.x, 26, width - 26);
      if (labelX - previousLabelX < 52) continue;
      if (layout.end >= this.albums.length && x(this.albums.length) - labelX < 38) continue;
      const title = shortAlbumTitle(point.album, width < 420 ? 6 : 8);
      const text = svgNode('text', { class: 'chart-album-label', x: labelX, y: layout.titleY, 'text-anchor': 'middle', 'font-size': 10, 'data-current': point.index === layout.albumIndex }, title);
      text.append(svgNode('title', {}, point.album.title));
      root.append(text);
      root.append(svgNode('text', { class: 'chart-axis-label', x: labelX, y: layout.yearY, 'text-anchor': 'middle', 'font-size': 10 }, String(point.album.date || '').slice(0, 4)));
      previousLabelX = labelX;
    }

    if (height < 130) return;
    const known = visible.filter(point => point.y !== null && point.y >= box.top && point.y <= box.bottom);
    const priority = [...known].sort((a, b) => {
      if (a.index === layout.albumIndex) return -1;
      if (b.index === layout.albumIndex) return 1;
      return b.album.firstWeekSales - a.album.firstWeekSales;
    });
    const shown = [];
    for (const point of priority) {
      if (shown.length === 4) break;
      if (shown.some(other => Math.abs(point.x - other.x) < 64)) continue;
      const number = `${point.album.approximate ? '약 ' : ''}${compactNumber(point.album.firstWeekSales)}`;
      root.append(svgNode('text', { class: 'chart-axis-label', x: clamp(point.x, 26, width - 26), y: clamp(point.y - 9, 11, box.bottom - 7), 'text-anchor': 'middle', 'font-size': 10, 'data-value-label': point.album.id }, number));
      shown.push(point);
    }
  }

  _drawMarker(root, snapshot, layout) {
    const { width, height, box, x, y } = layout;
    const position = snapshot.position;
    const current = snapshot.currentAlbum || this.albums[layout.albumIndex];
    const markerX = clamp(x(position.plotIndex), box.left, box.right);
    const known = Number.isFinite(position.yValue) && position.yValue > 0;
    const markerY = known ? clamp(y(position.yValue), box.top, box.bottom) : (box.top + box.bottom) / 2;
    const frameSize = 28;
    const frameX = clamp(markerX - frameSize / 2, 2, Math.max(2, width - frameSize - 2));
    const above = markerY - frameSize - 9;
    const desiredY = above >= 2 ? above : markerY + 8;
    const frameY = clamp(desiredY, 2, Math.max(2, box.bottom - frameSize));
    const group = svgNode('g', { 'aria-label': `타이핑 진행: ${current.title}${known ? '' : ', 초동 미확인'}` });
    group.append(svgNode('title', {}, `타이핑 진행 · ${current.title}${known ? '' : ' · 초동 미확인'}`));
    if (known) {
      const frameEdgeY = frameY > markerY ? frameY : frameY + frameSize;
      group.append(svgNode('line', { class: 'chart-marker-line', x1: markerX, y1: markerY, x2: markerX, y2: frameEdgeY, 'aria-hidden': 'true' }));
      group.append(svgNode('circle', { class: 'chart-marker', cx: markerX, cy: markerY, r: 4.5, 'aria-hidden': 'true' }));
    }
    group.append(svgNode('rect', { class: 'chart-marker-cover-frame', x: frameX, y: frameY, width: frameSize, height: frameSize, rx: 3, 'aria-hidden': 'true' }));
    if (current.cover) group.append(svgNode('image', { href: current.cover, x: frameX + 1, y: frameY + 1, width: 26, height: 26, preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' }));
    else group.append(svgNode('text', { class: 'chart-album-label', x: frameX + frameSize / 2, y: frameY + 18, 'text-anchor': 'middle', 'font-size': 10 }, 'f9'));
    if (!known) {
      const belowY = frameY + frameSize + 13;
      const labelY = belowY < box.bottom ? belowY : frameY - 5;
      group.append(svgNode('text', { class: 'chart-unknown-text', x: clamp(markerX, 34, width - 34), y: clamp(labelY, 11, height - 3), 'text-anchor': 'middle', 'font-size': 10 }, '초동 미확인'));
    }
    root.append(group);
  }
}
