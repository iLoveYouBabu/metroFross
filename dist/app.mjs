import { TypingSession, normalizeTitle } from './core.mjs';

const byId = id => document.getElementById(id);
const ui = Object.fromEntries(['album-cover','album-name','cpm','accuracy','elapsed','typing-input','target-text','typing-line','input-hint','state-label','track-counter','upcoming-tracks','course-progress','progress-fill','progress-position','journey-label','play-button','restart-button','game-board','result-panel','result-description','result-time','result-cpm','result-accuracy','best-message','album-memories','best-record','course-summary','error-message','announcement','catalog-dialog','catalog-list','catalog-scope','sources-list','catalog-updated','restart-dialog'].map(id => [id,byId(id)]));
const input = ui['typing-input'];
const storageKey = 'fromis-typing-best-v1';
let data, session, albums, signature, best = null, lastResult = null;
let composing = false, shownAlbum = null, lastFinished = false;
let catalogWasRunning = false, restartWasRunning = false, compositionTail = null, pendingCompositionCommit = null;
let tick = null;
const clock = () => performance.now();

function readStorage(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function writeStorage(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); } catch { /* Private browsing can disable storage. */ } }
function formatTime(milliseconds, precise = false) {
  const tenths = Math.max(0, Math.floor(milliseconds / 100));
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor(tenths / 10) % 60;
  return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}${precise ? '.' + tenths % 10 : ''}`;
}
function announce(text) { ui.announcement.textContent = text; }
function syncScroll() { ui['target-text'].style.transform = `translateX(${-input.scrollLeft}px)`; }
function focusInput() { if (session?.status === 'ready' || session?.status === 'running') input.focus({preventScroll:true}); }

function renderMetrics(state) {
  ui.cpm.textContent = String(Math.round(state.stats.cpm));
  ui.accuracy.textContent = Number(state.stats.accuracy.toFixed(1)).toString();
  ui.elapsed.textContent = formatTime(state.stats.elapsedMs);
}

function renderFeedback(state) {
  const fragment = document.createDocumentFragment();
  state.feedback.forEach(item => {
    const span = document.createElement('span');
    span.className = item.status;
    if (state.isComposing && item.typed && item.status === 'pending') span.classList.add('composing');
    span.textContent = item.char;
    fragment.append(span);
  });
  ui['target-text'].replaceChildren(fragment);
  input.setAttribute('aria-label', `곡 제목 따라 입력: ${state.target}`);
  requestAnimationFrame(syncScroll);
}

function updateAlbum(track) {
  const album = albums.get(track.albumId);
  if (shownAlbum === album.id) return;
  shownAlbum = album.id;
  ui['album-name'].textContent = album.title;
  ui['album-name'].title = album.title;
  const image = ui['album-cover'];
  image.hidden = true;
  image.onload = () => { image.hidden = false; };
  image.onerror = () => { image.hidden = true; };
  image.alt = `${album.title} 앨범 재킷`;
  image.src = album.cover;
  if (image.complete && image.naturalWidth > 0) image.hidden = false;
}

function updateUpcoming(state) {
  const tracks = data.tracks.slice(state.index + 1, state.index + 3);
  const fragment = document.createDocumentFragment();
  tracks.forEach((track,index) => {
    if (index) { const dot = document.createElement('span'); dot.className = 'separator'; dot.textContent = '·'; fragment.append(dot); }
    const span = document.createElement('span'); span.textContent = track.title; span.title = track.title; fragment.append(span);
  });
  if (!tracks.length) { const span = document.createElement('span'); span.textContent = '이 곡을 지나면 종점이에요.'; fragment.append(span); }
  ui['upcoming-tracks'].replaceChildren(fragment);
}

function render(state) {
  renderMetrics(state);
  if (state.status === 'completed') { finish(state); return; }
  ui['game-board'].hidden = false;
  ui['result-panel'].hidden = true;
  if (state.currentTrack) updateAlbum(state.currentTrack);
  input.disabled = false;
  input.readOnly = state.status === 'paused';
  if (!composing && input.value !== state.input) { input.value = state.input; if (!state.input) input.scrollLeft = 0; }
  renderFeedback(state);
  updateUpcoming(state);
  const progress = state.progress.ratio * 100;
  ui['progress-fill'].style.width = `${progress}%`;
  ui['progress-position'].style.left = `calc(${progress}% - 4px)`;
  ui['course-progress'].setAttribute('aria-valuenow', String(Math.round(progress)));
  ui['course-progress'].setAttribute('aria-valuetext', `${state.progress.total}곡 중 ${state.progress.completed}곡 완주`);
  ui['journey-label'].textContent = `전체 여정 · ${state.progress.completed} / ${state.progress.total}곡`;
  ui['track-counter'].textContent = `${state.index + 1} / ${state.progress.total}`;
  ui['input-hint'].classList.toggle('has-error', state.hasError);
  let hint;
  if (state.status === 'paused') hint = '잠시 쉬어가요. 계속하기를 누르면 이어서 칠 수 있어요.';
  else if (state.status === 'ready') hint = '보이는 제목을 입력하면 바로 시작해요.';
  else if (state.hasError) hint = '다르게 입력한 글자를 고쳐주세요.';
  else if (state.isComposing && normalizeTitle(state.input) === normalizeTitle(state.target)) hint = 'Enter로 마지막 한글을 확정해주세요.';
  else hint = '끝까지 입력하면 다음 곡으로 넘어가요.';
  ui['input-hint'].textContent = hint;
  ui['state-label'].textContent = ({ready:'준비',running:'입력 중',paused:'일시정지'})[state.status];
  ui['play-button'].textContent = ({ready:'시작하기',running:'일시정지',paused:'계속하기'})[state.status];
  ui['play-button'].disabled = false;
  ui['restart-button'].disabled = false;
}

function processInput(isComposing) {
  if (!session || session.status === 'paused' || session.status === 'completed') return null;
  const state = session.updateInput(input.value, clock(), {isComposing});
  if (state.advanced) {
    input.value = '';
    input.scrollLeft = 0;
    announce(state.status === 'completed' ? '모든 곡을 완주했어요.' : `${state.completedTrack.title} 완료. 다음 곡 ${state.currentTrack.title}`);
  }
  render(state);
  return state;
}

input.addEventListener('compositionstart', () => { composing = true; compositionTail = null; });
input.addEventListener('compositionend', () => {
  const committed = input.value;
  composing = false;
  if (session?.status === 'paused') { pendingCompositionCommit = committed; return; }
  const state = processInput(false);
  if (state?.advanced) compositionTail = {value:committed, until:clock()+100};
});
input.addEventListener('input', event => {
  if (compositionTail && clock() < compositionTail.until && input.value === compositionTail.value) { input.value = ''; compositionTail = null; syncScroll(); return; }
  processInput(composing || event.isComposing);
});
input.addEventListener('scroll', syncScroll);
input.addEventListener('paste', event => { event.preventDefault(); announce('곡 제목을 직접 입력해주세요.'); });
input.addEventListener('drop', event => event.preventDefault());
input.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.isComposing || composing) return;
  event.preventDefault();
  if (session?.status === 'ready') { render(session.start(clock())); }
  else if (session?.status === 'running') processInput(false);
});
ui['typing-line'].addEventListener('click', focusInput);

function pause() {
  if (!session || session.status !== 'running') return;
  render(session.pause(clock()));
}
function resume() {
  if (session?.status !== 'paused') return;
  render(session.resume(clock()));
  if (pendingCompositionCommit !== null) {
    input.value = pendingCompositionCommit;
    pendingCompositionCommit = null;
    processInput(false);
  }
  focusInput();
}
ui['play-button'].addEventListener('click', () => {
  if (session.status === 'running') pause();
  else if (session.status === 'paused') resume();
  else { render(session.start(clock())); focusInput(); }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.isComposing || composing || ui['catalog-dialog'].open || ui['restart-dialog'].open) return;
  if (session?.status === 'running') { event.preventDefault(); pause(); }
  else if (session?.status === 'paused') { event.preventDefault(); resume(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function reset() {
  composing = false; compositionTail = null; pendingCompositionCommit = null; shownAlbum = null; lastFinished = false; lastResult = null;
  input.value = ''; input.scrollLeft = 0;
  render(session.reset());
  focusInput();
  announce('처음 곡부터 새로운 여정을 시작해요.');
}
ui['restart-button'].addEventListener('click', () => {
  if (session.index === 0 && !session.input && session.status === 'ready') { reset(); return; }
  restartWasRunning = session.status === 'running';
  pause(); ui['restart-dialog'].showModal();
});
byId('cancel-restart').addEventListener('click', () => ui['restart-dialog'].close());
byId('confirm-restart').addEventListener('click', () => { restartWasRunning = false; ui['restart-dialog'].close(); reset(); });
ui['restart-dialog'].addEventListener('close', () => { if (restartWasRunning) resume(); restartWasRunning = false; });
byId('replay-button').addEventListener('click', reset);

function finish(state) {
  ui['game-board'].hidden = true;
  ui['result-panel'].hidden = false;
  if (lastFinished) return;
  lastFinished = true;
  const previous = best;
  const record = {signature,elapsedMs:state.stats.elapsedMs,cpm:Math.round(state.stats.cpm),accuracy:Number(state.stats.accuracy.toFixed(1)),completedAt:new Date().toISOString()};
  const isBest = !previous || record.elapsedMs < previous.elapsedMs;
  if (isBest) { best = record; writeStorage(storageKey,record); }
  lastResult = record;
  ui['result-description'].textContent = `${data.tracks.length}곡, ${new Set(data.tracks.map(track=>track.albumId)).size}장의 재킷을 지나 종점에 도착했어요.`;
  ui['result-time'].textContent = formatTime(record.elapsedMs,true);
  ui['result-cpm'].textContent = String(record.cpm);
  ui['result-accuracy'].textContent = `${record.accuracy}%`;
  ui['best-message'].textContent = isBest ? (previous ? `이전 최고 기록보다 ${((previous.elapsedMs-record.elapsedMs)/1000).toFixed(1)}초 빨라졌어요.` : '첫 완주 기록을 남겼어요. 이 브라우저에 저장했어요.') : `나의 최고 기록 ${formatTime(best.elapsedMs,true)}`;
  const fragment = document.createDocumentFragment();
  const used = new Set();
  data.tracks.forEach(track => {
    if (used.has(track.albumId)) return; used.add(track.albumId);
    const album = albums.get(track.albumId);
    const image = document.createElement('img'); image.src=album.cover; image.alt=album.title; image.title=album.title; image.width=33; image.height=33;
    image.onerror = () => { const fallback=document.createElement('span'); fallback.className='memory-fallback'; fallback.textContent='f9'; fallback.title=album.title; image.replaceWith(fallback); };
    fragment.append(image);
  });
  ui['album-memories'].replaceChildren(fragment);
  renderBest();
  byId('replay-button').focus({preventScroll:true});
}
function renderBest() { ui['best-record'].textContent = best ? `나의 최고 기록 ${formatTime(best.elapsedMs,true)}` : ''; }
byId('copy-button').addEventListener('click', async () => {
  if (!lastResult) return;
  const text = `fromis_9 typing journey\n${data.tracks.length}곡 완주 · ${formatTime(lastResult.elapsedMs,true)}\n${lastResult.cpm}타 · 정확도 ${lastResult.accuracy}%\n${location.href.split('?')[0]}`;
  try { await navigator.clipboard.writeText(text); byId('copy-button').textContent='복사했어요'; announce('완주 기록을 복사했어요.'); setTimeout(()=>byId('copy-button').textContent='기록 복사',1800); }
  catch { announce('기록을 복사하지 못했어요. 화면의 기록을 확인해주세요.'); }
});

function buildCatalog() {
  const fragment = document.createDocumentFragment();
  const grouped = new Map();
  data.tracks.forEach((track,index) => { if (!grouped.has(track.albumId)) grouped.set(track.albumId,[]); grouped.get(track.albumId).push({track,index}); });
  grouped.forEach((entries,albumId) => {
    const album = albums.get(albumId);
    const section = document.createElement('section'); section.className='catalog-album';
    const header = document.createElement('div'); header.className='catalog-album-header';
    const image = document.createElement('img'); image.src=album.cover; image.alt=''; image.width=34; image.height=34; image.loading='lazy'; image.onerror=()=>image.hidden=true;
    const copy = document.createElement('div'); const title=document.createElement('h3'); title.textContent=album.title; const date=document.createElement('p'); date.textContent=`${album.date} · ${entries.length}곡`; copy.append(title,date); header.append(image,copy);
    const list = document.createElement('ol'); list.className='catalog-tracks';
    entries.forEach(({track,index}) => { const item=document.createElement('li'); item.textContent=track.title; if (index<session.index) item.className='track-complete'; else if(index===session.index) {item.className='track-current';item.setAttribute('aria-current','step');} list.append(item); });
    section.append(header,list); fragment.append(section);
  });
  ui['catalog-list'].replaceChildren(fragment);
}
function openCatalog() {
  if (!session) return;
  catalogWasRunning = session.status === 'running'; pause(); buildCatalog(); ui['catalog-dialog'].showModal();
}
byId('catalog-button').addEventListener('click', openCatalog);
byId('sources-button').addEventListener('click', openCatalog);
byId('close-catalog').addEventListener('click', () => ui['catalog-dialog'].close());
ui['catalog-dialog'].addEventListener('close', () => { if(catalogWasRunning) resume(); else focusInput(); catalogWasRunning=false; });

function initializeTheme() {
  const stored = readStorage('fromis-typing-theme');
  if(stored==='light'||stored==='dark') document.documentElement.dataset.theme=stored;
  byId('theme-button').addEventListener('click', () => {
    const current=document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark':'light');
    const next=current==='dark'?'light':'dark'; document.documentElement.dataset.theme=next; writeStorage('fromis-typing-theme',next);
    byId('theme-button').setAttribute('aria-label',next==='dark'?'밝은 화면으로 변경':'어두운 화면으로 변경');
  });
}

async function initialize() {
  initializeTheme();
  try {
    const response=await fetch('./data/discography.json'); if(!response.ok) throw new Error('catalog');
    data=await response.json();
    if(!Array.isArray(data.tracks)||!data.tracks.length||!Array.isArray(data.albums)) throw new Error('catalog');
    albums=new Map(data.albums.map(album=>[album.id,album]));
    if(data.tracks.some(track=>!albums.has(track.albumId))) throw new Error('album');
    session=new TypingSession(data.tracks);
    signature=data.tracks.map(track=>track.id).join('|');
    const stored=readStorage(storageKey); best=stored?.signature===signature && Number.isFinite(stored.elapsedMs) ? stored : null;
    ui['course-summary'].textContent=`${data.tracks.length}곡 · 재수록·다른 언어 버전·Inst 제외`;
    ui['catalog-scope'].textContent=data.scope;
    ui['catalog-updated'].textContent=`곡 목록 확인: ${data.updatedAt}`;
    (data.sources || []).forEach(source=>{const li=document.createElement('li'); const a=document.createElement('a'); a.href=source.url; a.textContent=source.title; a.target='_blank'; a.rel='noopener noreferrer'; li.append(a); ui['sources-list'].append(li);});
    render(session.snapshot(clock())); renderBest();
    startTick();
  } catch (error) {
    console.error('게임을 불러오지 못했습니다.',error);
    ui['error-message'].hidden=false; ui['error-message'].textContent='곡 목록을 불러오지 못했어요. 페이지를 새로고침해주세요.';
    ui['album-name'].textContent='불러오기를 다시 시도해주세요.';
  }
}
function startTick() { if (!tick) tick=setInterval(()=>{if(session?.status==='running')renderMetrics(session.snapshot(clock()));},100); }
window.addEventListener('pagehide',()=>{if(tick)clearInterval(tick);tick=null;});
window.addEventListener('pageshow',()=>{if(session)startTick();});
initialize();
