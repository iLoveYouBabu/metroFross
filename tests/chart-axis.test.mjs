import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesAxis, salesToY } from '../dist/chart-axis.mjs';
import { SalesChartView } from '../dist/chart-view.mjs';

const albums = values => values.map((firstWeekSales, index) => ({
  id: `album-${index}`, title: `Album ${index}`, date: '2026-01-01', firstWeekSales
}));

test('follow mode magnifies a non-zero range while containing every -2..+3 neighbour', () => {
  const anchors = albums([1, 900, 1000, 1010, 1020, 1030, 1040, 100000]);
  const original = structuredClone(anchors);
  const axis = createSalesAxis(anchors, { albumIndex: 3 });
  assert.equal(axis.referenceStart, 1);
  assert.equal(axis.referenceEnd, 7);
  assert.ok(axis.minimum > 0);
  assert.ok(axis.minimum < 900);
  assert.ok(axis.maximum > 1040);
  for (const album of anchors.slice(1, 7)) {
    const y = salesToY(album.firstWeekSales, axis, 20, 180);
    assert.ok(y > 20 && y < 180, `${album.id} is clipped`);
  }
  assert.equal(salesToY(axis.minimum, axis, 20, 180), 180);
  assert.equal(salesToY(axis.maximum, axis, 20, 180), 20);
  assert.deepEqual(anchors, original, 'zoom must not change the sales observations');
});

test('overview retains a zero baseline and contains outliers outside the follow window', () => {
  const anchors = albums([1000, 1010, 1020, 1030, 1040, 1000000]);
  const follow = createSalesAxis(anchors);
  const overview = createSalesAxis(anchors, { overview: true });
  assert.ok(follow.minimum > 0);
  assert.ok(follow.maximum < 1000000);
  assert.equal(overview.minimum, 0);
  assert.ok(overview.maximum >= 1000000);
  assert.equal(overview.ticks[0], 0);
});

test('one observation, equal values, and unknown windows never create a zero span or fake point', () => {
  for (const values of [[42000], [42000, 42000], [null, 42000, null]]) {
    const axis = createSalesAxis(albums(values));
    assert.ok(axis.minimum < 42000 && axis.maximum > 42000);
    assert.ok(Number.isFinite(salesToY(42000, axis, 0, 100)));
  }
  const fallback = createSalesAxis(albums([40000, 50000]));
  const unknown = createSalesAxis(albums([null, null]), { fallback });
  assert.equal(unknown.minimum, fallback.minimum);
  assert.equal(unknown.maximum, fallback.maximum);
  const empty = createSalesAxis(albums([null]));
  assert.equal(empty.minimum, 0);
  assert.equal(empty.maximum, 1);
});

class SvgElement {
  constructor(name) { this.name = name; this.attributes = {}; this.dataset = {}; this.children = []; this.textContent = ''; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
}

function viewFixture(t, anchors) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElementNS: (_namespace, name) => new SvgElement(name),
    createDocumentFragment: () => new SvgElement('fragment')
  };
  t.after(() => { globalThis.document = previousDocument; });
  const svg = new SvgElement('svg');
  const stage = { clientWidth: 360, clientHeight: 210, getBoundingClientRect: () => ({ width: 360, height: 210 }) };
  const view = new SalesChartView({ svg, stage, albums: anchors });
  const update = (index, ratio) => view.update({
    currentAlbum: anchors[index], album: { index, ratio },
    position: { plotIndex: index + ratio, yValue: anchors[index].firstWeekSales, kind: 'anchor' }
  });
  const nodes = () => {
    const result = [];
    const visit = node => { result.push(node); node.children.forEach(visit); };
    visit(svg);
    return result;
  };
  return { svg, stage, view, update, nodes };
}

test('typing and resizing keep the scale fixed until the album changes, and overview restores correctly', t => {
  const anchors = albums([1000, 1010, 1020, 1030, 1040, 1000000]);
  const { svg, stage, view, update, nodes } = viewFixture(t, anchors);
  const initial = { min: svg.dataset.yMin, max: svg.dataset.yMax };
  update(0, .95);
  stage.clientWidth = 290;
  view.update(view._lastSnapshot);
  assert.deepEqual({ min: svg.dataset.yMin, max: svg.dataset.yMax }, initial);
  assert.match(nodes().find(node => node.name === 'desc').textContent, /세로축을.*확대/);
  const tickLabels = nodes().filter(node => node.attributes['data-axis-value'] !== undefined);
  assert.equal(Number(tickLabels[0].attributes['data-axis-value']), Number(initial.min));
  assert.equal(tickLabels[0].textContent, Number(initial.min).toLocaleString('ko-KR'));
  view.setOverview(true);
  assert.equal(svg.dataset.yMin, '0');
  view.setOverview(false);
  assert.deepEqual({ min: svg.dataset.yMin, max: svg.dataset.yMax }, initial);
  update(2, 0);
  assert.notEqual(svg.dataset.yMax, initial.max, 'the newly neighbouring outlier changes the next album scale');
});

test('anchor descriptions distinguish Oricon, fan sources, and unspecified counting systems', t => {
  const anchors = albums([1000, 1020, 1040]);
  anchors[0].salesRecord = { chartSystem: 'oricon', metricLabel: '오리콘 첫 주', sourceType: 'unofficial' };
  anchors[1].salesRecord = { chartSystem: 'unspecified', metricLabel: '발매 첫 7일' };
  anchors[2].salesRecord = { chartSystem: 'hanteo', metricLabel: '발매 첫 7일' };
  const { nodes } = viewFixture(t, anchors);
  const titles = nodes().filter(node => node.attributes.class === 'chart-anchor').map(node => node.children[0].textContent);
  assert.match(titles[0], /오리콘 첫 주.*1,000장.*팬 정리 자료/);
  assert.doesNotMatch(titles[1], /한터|오리콘/);
  assert.match(titles[2], /발매 첫 7일 \(한터\)/);
});
