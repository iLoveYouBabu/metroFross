import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A DOM fixture verifies app orchestration, not browser rendering or native IME.
class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.listeners = new Map(); this.value = ''; this.hidden = false; this.disabled = false; this.readOnly = false; this.open = false; this.isConnected = true; this.scrollLeft = 0; this.clientWidth = 640; this.clientHeight = 220; this.complete = true; this.naturalWidth = 62; const classes = new Set(); this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value), toggle: (value, force) => { const enabled = force ?? !classes.has(value); if (enabled) classes.add(value); else classes.delete(value); return enabled; } }; this.style.setProperty = (key, value) => { this.style[key] = value; }; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent ?? String(child)).join(''); }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'id') this.id = value; if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.text = ''; this.children = children; }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, fields = {}) { const event = { type, target: this, key: '', isComposing: false, preventDefault() { this.defaultPrevented = true; }, ...fields }; for (const listener of [...(this.listeners.get(type) || [])]) listener(event); return event; }
  focus() { document.activeElement = this; }
  blur() { if (document.activeElement === this) document.activeElement = null; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  matches(selector) { return selector === 'input[type=checkbox]' && this.tagName === 'INPUT' && this.type === 'checkbox'; }
  querySelectorAll(selector) { return this.children.flatMap(child => child instanceof Element ? [...((selector === 'input' && child.tagName === 'INPUT') ? [child] : []), ...child.querySelectorAll(selector)] : []); }
  getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight }; }
}

test('the main screen boots, partial play stays local, and a full completion alone submits a ranking', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const course = JSON.parse(await readFile(new URL('../dist/data/album-course.json', import.meta.url), 'utf8'));
  const sales = JSON.parse(await readFile(new URL('../dist/data/first-week-sales.json', import.meta.url), 'utf8'));
  const config = JSON.parse(await readFile(new URL('../dist/data/ranking-config.json', import.meta.url), 'utf8')); config.publishableKey = 'sb_publishable_test_fixture';
  const nodes = new Map([...html.matchAll(/<([a-z0-9]+)[^>]*\bid="([^"]+)"[^>]*>/gu)].map(match => [match[2], Object.assign(new Element(match[1]), { id: match[2], hidden: /\shidden(?:\s|>)/u.test(match[0]), disabled: /\sdisabled(?:\s|>)/u.test(match[0]) })]));
  const body = new Element('body'), brand = new Element('a');
  const tabs = ['week', 'all', 'personal'].map(period => { const tab = nodes.get(`records-${period}`); tab.dataset.period = period; return tab; });
  const documentFixture = Object.assign(new Element('document'), { body, documentElement: new Element('html'), hidden: false, activeElement: null, getElementById: id => nodes.get(id) || null, querySelector: selector => selector === '.brand' ? brand : null, querySelectorAll: selector => selector === '.record-tabs [role=tab]' ? tabs : [], createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), createDocumentFragment: () => new Element('fragment') });
  const saved = new Map(), storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  let now = 0, timerId = 0, backendReady = false;
  const timers = new Map(), requests = [];
  const schedule = (callback, delay = 0) => { timers.set(++timerId, { callback, at: now + delay }); return timerId; };
  const advance = milliseconds => { const end = now + milliseconds; while (true) { const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at).find(([, timer]) => timer.at <= end); if (!next) break; timers.delete(next[0]); now = next[1].at; next[1].callback(); } now = end; };
  const settle = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
  const result = (body, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body });
  const fakeFetch = async (url, options = {}) => {
    if (url === './data/album-course.json') return result(course);
    if (url === './data/first-week-sales.json') return result(sales);
    if (url === './data/ranking-config.json') return result(config);
    const body = JSON.parse(options.body || '{}'); requests.push({ url, body });
    if (url.endsWith('/auth/v1/signup')) return result({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, user: { id: 'fixture-user' } });
    if (!backendReady) return result({ code: 'PGRST202' }, false);
    if (url.endsWith('/fromis_leaderboard')) return result([]);
    if (url.endsWith('/fromis_set_nickname')) return result({ nickname: body.p_nickname });
    if (url.endsWith('/fromis_begin_run')) return result({ eligible: true, run_id: 'fixture-run' });
    if (url.endsWith('/fromis_finish_run')) return result({ eligible: true, record: { run_id: 'fixture-run' } });
    if (url.endsWith('/fromis_personal_records')) return result({ best: null, recent: [] });
    throw new Error('Unexpected fixture request');
  };
  const replacements = { document: documentFixture, window: Object.assign(new Element('window'), { visualViewport: null }), localStorage: storage, fetch: fakeFetch, performance: { now: () => now }, innerWidth: 1000, innerHeight: 800, matchMedia: () => ({ matches: false }), requestAnimationFrame: callback => callback(), setTimeout: schedule, clearTimeout: id => timers.delete(id), setInterval: () => 1, clearInterval: () => {} };
  const original = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  try {
    await import(`../dist/app.mjs?flow=${Date.now()}`); await settle();
    // WebCrypto completes outside the microtask queue.
    for (let attempt = 0; attempt < 20 && nodes.get('start-button').disabled; attempt++) { await new Promise(resolve => setImmediate(resolve)); await settle(); }
    assert.equal(nodes.get('load-error').hidden, true, nodes.get('load-error').textContent);
    assert.equal(nodes.get('home-screen').hidden, false); assert.equal(nodes.get('start-button').disabled, false);
    assert.match(nodes.get('records-content').textContent, /준비/u);
    nodes.get('clear-albums').emit('click'); assert.equal(nodes.get('start-button').disabled, true);
    const choice = nodes.get('home-albums').querySelectorAll('input').find(input => input.value === 'from-9');
    choice.checked = true; nodes.get('home-albums').emit('change', { target: choice }); assert.match(nodes.get('home-course-count').textContent, /1앨범 · 3곡/u);
    nodes.get('nickname-input').value = '테스트플로버'; nodes.get('start-button').emit('click'); await settle();
    assert.equal(nodes.get('countdown-number').textContent, '3'); advance(1000); assert.equal(nodes.get('countdown-number').textContent, '2'); advance(2000);
    const input = nodes.get('typing-input');
    for (const track of course.tracks.filter(track => track.albumId === 'from-9')) { advance(1000); input.value = track.title; input.emit('input'); }
    await settle(); assert.equal(nodes.get('result-panel').hidden, false); assert.match(nodes.get('ranking-result-status').textContent, /랭킹에는 포함되지/u);
    assert.equal(requests.filter(request => /fromis_begin_run|fromis_finish_run|auth\/v1\/signup/u.test(request.url)).length, 0);
    nodes.get('home-button').emit('click'); nodes.get('records-personal').emit('click'); await settle(); assert.match(nodes.get('records-content').textContent, /연습 완주/u);
    backendReady = true; nodes.get('select-all-albums').emit('click'); nodes.get('start-button').emit('click'); await settle(); advance(3000);
    for (const track of course.tracks) { advance(1000); input.value = track.title; input.emit('input'); }
    await settle();
    assert.match(nodes.get('ranking-result-status').textContent, /랭킹에 남겼/u);
    const submissions = requests.filter(request => request.url.endsWith('/fromis_finish_run'));
    assert.equal(submissions.length, 1); assert.equal(submissions[0].body.p_completed_track_count, 67);
    assert.equal(requests.filter(request => request.url.endsWith('/fromis_begin_run')).length, 1);
    const records = JSON.parse(storage.getItem('fromis-personal-records-v1')); assert.equal(records.length, 2); assert.equal(records.filter(record => record.isFullCourse).length, 1);
  } finally { for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
});
