import { TypingSession, normalizeTitle } from './core.mjs';
import { ChartProgress } from './chart-progress.mjs';
import { SalesChartView } from './chart-view.mjs';

const byId = id => document.getElementById(id);
const ui = Object.fromEntries(['album-cover','album-name','album-sales','cpm','accuracy','elapsed','typing-input','target-text','typing-line','input-hint','state-label','track-counter','upcoming-tracks','course-progress','progress-fill','progress-percentage','journey-label','play-button','restart-button','game-board','result-panel','result-description','result-time','result-cpm','result-accuracy','best-message','album-memories','best-record','course-summary','course-count','chart-note','chart-view-label','chart-view-button','error-message','announcement','catalog-dialog','catalog-list','catalog-scope','sales-definition','sources-list','excluded-summary','catalog-updated','restart-dialog'].map(id => [id,byId(id)]));
const input = ui['typing-input'];
const clock = () => performance.now();
const storageKey = 'fromis-chart-best-v1';
let catalog, salesData, albums, courseTracks, session, chartModel, chartView, signature;
let best = null, lastResult = null, composing = false, shownAlbum = null, lastFinished = false, overview = false;
let catalogWasRunning = false, restartWasRunning = false, compositionTail = null, pendingCompositionCommit = null, tick = null;

function readStorage(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function writeStorage(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); } catch {} }
function announce(text) { ui.announcement.textContent = text; }
function formatTime(milliseconds, precise = false) {
  const tenths = Math.max(0,Math.floor(milliseconds/100));
  return `${String(Math.floor(tenths/600)).padStart(2,'0')}:${String(Math.floor(tenths/10)%60).padStart(2,'0')}${precise ? '.' + tenths%10 : ''}`;
}
function formatSales(album) { return album.firstWeekSales === null ? '자료 미확인' : `${album.approximate ? '약 ' : ''}${album.firstWeekSales.toLocaleString('ko-KR')}장`; }
function focusInput() { if(session?.status==='ready'||session?.status==='running') input.focus({preventScroll:true}); }
function syncScroll() { ui['target-text'].style.transform=`translateX(${-input.scrollLeft}px)`; }
function renderMetrics(state) {
  ui.cpm.textContent=String(Math.round(state.stats.cpm));
  ui.accuracy.textContent=Number(state.stats.accuracy.toFixed(1)).toString();
  ui.elapsed.textContent=formatTime(state.stats.elapsedMs);
}
function updateAlbum(track) {
  const album=albums.get(track.albumId);
  if(shownAlbum===album.id)return;
  shownAlbum=album.id;
  ui['album-name'].textContent=album.title;ui['album-name'].title=album.title;
  ui['album-sales'].textContent=formatSales(album);ui['album-sales'].classList.toggle('unknown',album.firstWeekSales===null);
  ui['album-sales'].title=album.salesRecord?.note||'';
  const image=ui['album-cover'];image.hidden=true;
  image.onload=()=>{image.hidden=false;};image.onerror=()=>{image.hidden=true;};
  image.alt=`${album.title} 앨범 재킷`;image.src=album.cover;
  if(image.complete&&image.naturalWidth>0)image.hidden=false;
}
function renderFeedback(state) {
  const fragment=document.createDocumentFragment();
  state.feedback.forEach(item=>{const span=document.createElement('span');span.className=item.status;if(state.isComposing&&item.typed&&item.status==='pending')span.classList.add('composing');span.textContent=item.char;fragment.append(span);});
  ui['target-text'].replaceChildren(fragment);
  input.setAttribute('aria-label',`곡 제목 따라 입력: ${state.target}`);
  requestAnimationFrame(syncScroll);
}
function renderUpcoming(state) {
  const tracks=courseTracks.slice(state.index+1,state.index+3),fragment=document.createDocumentFragment();
  tracks.forEach((track,index)=>{if(index){const dot=document.createElement('span');dot.className='separator';dot.textContent='·';fragment.append(dot);}const span=document.createElement('span');span.textContent=track.title;span.title=track.title;fragment.append(span);});
  if(!tracks.length){const span=document.createElement('span');span.textContent='이 곡을 치면 완주예요.';fragment.append(span);}
  ui['upcoming-tracks'].replaceChildren(fragment);
}
function prefixRatio(state) {
  const target=Array.from(normalizeTitle(state.target)),typed=Array.from(normalizeTitle(state.input));
  let count=0;while(count<typed.length&&count<target.length&&typed[count]===target[count])count++;
  return target.length?count/target.length:0;
}
function renderProgress(state) {
  const snapshot=chartModel.update({index:state.index,prefixRatio:prefixRatio(state),status:state.status});
  chartView.update(snapshot);
  const progress=snapshot.course.ratio*100;
  ui['progress-fill'].style.width=`${progress}%`;ui['progress-percentage'].textContent=`${Math.floor(progress)}%`;
  ui['course-progress'].setAttribute('aria-valuenow',String(Math.round(progress)));
  ui['course-progress'].setAttribute('aria-valuetext',`${state.progress.total}곡 중 ${state.progress.completed}곡 완료`);
  ui['journey-label'].textContent=`앨범 여정 · ${state.progress.completed} / ${state.progress.total}곡`;
  ui['chart-note'].textContent=snapshot.position.hasKnownY?'점은 앨범별 초동, 재킷은 타이핑 위치예요.':'초동 미확인 구간 · 숫자를 추정해서 연결하지 않아요.';
}
function render(state) {
  renderMetrics(state);
  if(state.status==='completed'){finish(state);return;}
  ui['game-board'].hidden=false;ui['game-board'].classList.remove('is-completed');ui['result-panel'].hidden=true;
  updateAlbum(state.currentTrack);
  input.disabled=false;input.readOnly=state.status==='paused';
  if(!composing&&input.value!==state.input){input.value=state.input;if(!state.input)input.scrollLeft=0;}
  renderFeedback(state);renderUpcoming(state);renderProgress(state);
  ui['track-counter'].textContent=`${state.index+1} / ${state.progress.total}`;
  let hint='제목을 끝까지 치면 다음 곡으로 넘어가요.';
  if(state.status==='ready')hint='보이는 제목을 입력하면 시작해요.';
  else if(state.status==='paused')hint='계속하기를 누르면 이어서 칠 수 있어요.';
  else if(state.hasError)hint='빨간 글자를 고쳐주세요.';
  else if(state.isComposing&&normalizeTitle(state.input)===normalizeTitle(state.target))hint='Enter로 마지막 한글을 확정해주세요.';
  ui['input-hint'].textContent=hint;ui['input-hint'].title=hint;ui['input-hint'].classList.toggle('has-error',state.hasError);
  ui['state-label'].textContent=({ready:'준비',running:'입력 중',paused:'일시정지'})[state.status];
  ui['play-button'].textContent=({ready:'시작하기',running:'일시정지',paused:'계속하기'})[state.status];
  ui['play-button'].disabled=false;ui['restart-button'].disabled=false;
}
function processInput(isComposing) {
  if(!session||session.status==='paused'||session.status==='completed')return null;
  const state=session.updateInput(input.value,clock(),{isComposing});
  if(state.advanced){input.value='';input.scrollLeft=0;announce(state.status==='completed'?'모든 앨범을 완주했어요.':`${state.completedTrack.title} 완료. 다음 곡 ${state.currentTrack.title}`);}
  render(state);return state;
}
input.addEventListener('compositionstart',()=>{composing=true;compositionTail=null;});
input.addEventListener('compositionend',()=>{
  const committed=input.value;composing=false;
  if(session?.status==='paused'){pendingCompositionCommit=committed;return;}
  const state=processInput(false);if(state?.advanced)compositionTail={value:committed,until:clock()+100};
});
input.addEventListener('input',event=>{if(compositionTail&&clock()<compositionTail.until&&input.value===compositionTail.value){input.value='';compositionTail=null;syncScroll();return;}processInput(composing||event.isComposing);});
input.addEventListener('scroll',syncScroll);
input.addEventListener('paste',event=>{event.preventDefault();announce('곡 제목을 직접 입력해주세요.');});
input.addEventListener('drop',event=>event.preventDefault());
input.addEventListener('keydown',event=>{if(event.key!=='Enter'||event.isComposing||composing)return;event.preventDefault();if(session?.status==='ready')render(session.start(clock()));else if(session?.status==='running')processInput(false);});
ui['typing-line'].addEventListener('click',focusInput);
function pause(){if(session?.status==='running')render(session.pause(clock()));}
function resume(){if(session?.status!=='paused')return;render(session.resume(clock()));if(pendingCompositionCommit!==null){input.value=pendingCompositionCommit;pendingCompositionCommit=null;processInput(false);}focusInput();}
ui['play-button'].addEventListener('click',()=>{if(session.status==='running')pause();else if(session.status==='paused')resume();else{render(session.start(clock()));focusInput();}});
document.addEventListener('keydown',event=>{if(event.key!=='Escape'||event.isComposing||composing||ui['catalog-dialog'].open||ui['restart-dialog'].open)return;if(session?.status==='running'){event.preventDefault();pause();}else if(session?.status==='paused'){event.preventDefault();resume();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});

function setOverview(value){overview=Boolean(value);chartView?.setOverview(overview);ui['chart-view-button'].textContent=overview?'따라가기':'전체 차트';ui['chart-view-button'].setAttribute('aria-pressed',String(overview));ui['chart-view-label'].textContent=overview?'전체 앨범 · 단위: 장':'주변 앨범 · 단위: 장';}
ui['chart-view-button'].addEventListener('click',()=>setOverview(!overview));
function reset({focus=true}={}) {
  composing=false;compositionTail=null;pendingCompositionCommit=null;shownAlbum=null;lastFinished=false;lastResult=null;
  input.value='';input.scrollLeft=0;chartModel.reset();setOverview(false);render(session.reset());
  if(focus){focusInput();announce('첫 앨범부터 다시 시작해요.');}
}
ui['restart-button'].addEventListener('click',()=>{if(session.status==='ready'&&session.index===0&&!session.input){reset();return;}restartWasRunning=session.status==='running';pause();ui['restart-dialog'].showModal();});
byId('cancel-restart').addEventListener('click',()=>ui['restart-dialog'].close());
byId('confirm-restart').addEventListener('click',()=>{restartWasRunning=false;ui['restart-dialog'].close();reset();});
ui['restart-dialog'].addEventListener('close',()=>{if(restartWasRunning)resume();restartWasRunning=false;});
byId('replay-button').addEventListener('click',()=>reset());
function renderBest(){ui['best-record'].textContent=best?`나의 최고 기록 ${formatTime(best.elapsedMs,true)}`:'';}
function finish(state) {
  input.readOnly=true;input.blur();ui['game-board'].hidden=false;ui['game-board'].classList.add('is-completed');ui['result-panel'].hidden=false;
  chartView.update(chartModel.update({index:courseTracks.length,status:'completed'}));setOverview(true);
  ui['journey-label'].textContent=`${catalog.albums.length}앨범 · ${courseTracks.length}곡 완주`;ui['progress-percentage'].textContent='100%';ui['progress-fill'].style.width='100%';
  ui['course-progress'].setAttribute('aria-valuenow','100');ui['course-progress'].setAttribute('aria-valuetext','모든 앨범 완주');
  updateViewport();if(lastFinished)return;lastFinished=true;
  const previous=best,record={signature,elapsedMs:state.stats.elapsedMs,cpm:Math.round(state.stats.cpm),accuracy:Number(state.stats.accuracy.toFixed(1)),completedAt:new Date().toISOString()};
  const isBest=!previous||record.elapsedMs<previous.elapsedMs;if(isBest){best=record;writeStorage(storageKey,record);}lastResult=record;
  ui['result-description'].textContent=`${catalog.albums.length}개 실물 앨범의 ${courseTracks.length}곡을 발매순으로 완주했어요.`;
  ui['result-time'].textContent=formatTime(record.elapsedMs,true);ui['result-cpm'].textContent=String(record.cpm);ui['result-accuracy'].textContent=`${record.accuracy}%`;
  ui['best-message'].textContent=isBest?(previous?`이전 최고 기록보다 ${((previous.elapsedMs-record.elapsedMs)/1000).toFixed(1)}초 빨라졌어요.`:'첫 앨범 코스 완주 기록을 남겼어요.'): `나의 최고 기록 ${formatTime(best.elapsedMs,true)}`;
  const fragment=document.createDocumentFragment();catalog.albums.forEach(album=>{const image=document.createElement('img');image.src=album.cover;image.alt=album.title;image.title=album.title;image.width=33;image.height=33;image.onerror=()=>image.hidden=true;fragment.append(image);});
  ui['album-memories'].replaceChildren(fragment);renderBest();byId('replay-button').focus({preventScroll:true});
}
byId('copy-button').addEventListener('click',async()=>{
  if(!lastResult)return;const text=`fromis_9 chart journey\n${catalog.albums.length}앨범 · ${courseTracks.length}곡 완주 · ${formatTime(lastResult.elapsedMs,true)}\n${lastResult.cpm}타 · 정확도 ${lastResult.accuracy}%\n${location.href.split('?')[0]}`;
  try{await navigator.clipboard.writeText(text);byId('copy-button').textContent='복사했어요';announce('완주 기록을 복사했어요.');setTimeout(()=>byId('copy-button').textContent='기록 복사',1800);}catch{announce('기록을 복사하지 못했어요. 화면의 기록을 확인해주세요.');}
});

function addSourceLink(parent,source,label) {
  const url=typeof source==='string'?source:source?.url;if(!url||!url.startsWith('https://'))return;
  const link=document.createElement('a');link.href=url;link.textContent=label||(typeof source==='string'?'출처 확인':source.title);link.className='catalog-source';link.target='_blank';link.rel='noopener noreferrer';parent.append(link);
}
function buildCatalog() {
  const fragment=document.createDocumentFragment();
  catalog.albums.forEach(raw=>{
    const album=albums.get(raw.id),entries=courseTracks.map((track,index)=>({track,index})).filter(entry=>entry.track.albumId===album.id);
    const section=document.createElement('section');section.className='catalog-album';
    const header=document.createElement('div');header.className='catalog-album-header';
    const image=document.createElement('img');image.src=album.cover;image.width=34;image.height=34;image.alt='';image.loading='lazy';image.onerror=()=>image.hidden=true;
    const copy=document.createElement('div'),title=document.createElement('h3'),date=document.createElement('p');title.textContent=album.title;const category=document.createElement('span');category.className='catalog-category';category.textContent=album.categoryLabel;title.append(category);date.textContent=`${album.date} · ${entries.length}곡`;copy.append(title,date);header.append(image,copy);section.append(header);
    const sales=document.createElement('p');sales.className='catalog-sales';sales.textContent=`초동 ${formatSales(album)}`;section.append(sales);
    const record=album.salesRecord;
    if(record?.periodStart&&record?.periodEnd){const period=document.createElement('p');period.className='catalog-note';period.textContent=`집계 기간 ${record.periodStart} ~ ${record.periodEnd}`;section.append(period);}
    for(const note of [album.note,record?.note])if(note){const paragraph=document.createElement('p');paragraph.className='catalog-note';paragraph.textContent=note;section.append(paragraph);}
    const list=document.createElement('ol');list.className='catalog-tracks';entries.forEach(({track,index})=>{const item=document.createElement('li');item.textContent=track.title;if(index<session.index)item.className='track-complete';else if(index===session.index){item.className='track-current';item.setAttribute('aria-current','step');}list.append(item);});section.append(list);
    const links=document.createElement('div');links.className='catalog-source-list';addSourceLink(links,album.physicalEvidence?.url,'실물 발매 정보');(record?.sources||[]).forEach((source,index)=>addSourceLink(links,source,`초동 출처 ${index+1}`));section.append(links);fragment.append(section);
  });
  ui['catalog-list'].replaceChildren(fragment);
}
function openCatalog(){if(!session)return;catalogWasRunning=session.status==='running';pause();buildCatalog();ui['catalog-dialog'].showModal();}
byId('catalog-button').addEventListener('click',openCatalog);byId('sources-button').addEventListener('click',openCatalog);byId('close-catalog').addEventListener('click',()=>ui['catalog-dialog'].close());
ui['catalog-dialog'].addEventListener('close',()=>{if(catalogWasRunning)resume();else focusInput();catalogWasRunning=false;});
function initializeTheme(){const stored=readStorage('fromis-typing-theme');if(stored==='light'||stored==='dark')document.documentElement.dataset.theme=stored;byId('theme-button').addEventListener('click',()=>{const current=document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');const next=current==='dark'?'light':'dark';document.documentElement.dataset.theme=next;writeStorage('fromis-typing-theme',next);byId('theme-button').setAttribute('aria-label',next==='dark'?'밝은 화면으로 변경':'어두운 화면으로 변경');});}
async function initialize() {
  initializeTheme();
  try {
    const responses=await Promise.all([fetch('./data/album-course.json'),fetch('./data/first-week-sales.json')]);if(responses.some(response=>!response.ok))throw new Error('catalog');
    [catalog,salesData]=await Promise.all(responses.map(response=>response.json()));
    const records=new Map(salesData.albums.map(record=>[record.albumId,record]));
    const chartAlbums=catalog.albums.map(album=>{const record=records.get(album.id);return{...album,firstWeekSales:record?.sales??null,approximate:Boolean(record?.approximate),salesRecord:record};});
    albums=new Map(chartAlbums.map(album=>[album.id,album]));courseTracks=catalog.tracks;
    session=new TypingSession(courseTracks);chartModel=new ChartProgress({albums:chartAlbums,tracks:courseTracks});chartView=new SalesChartView({svg:byId('sales-chart'),stage:byId('chart-stage'),albums:chartAlbums});
    signature=courseTracks.map(track=>track.id).join('|');const stored=readStorage(storageKey);best=stored?.signature===signature&&Number.isFinite(stored.elapsedMs)?stored:null;
    ui['course-count'].textContent=`${chartAlbums.length}앨범 · ${courseTracks.length}곡`;
    const known=chartAlbums.filter(album=>album.firstWeekSales!==null).length;ui['course-summary'].textContent=`실물 앨범 ${chartAlbums.length}개 · 초동 확인 ${known}개`;
    ui['catalog-scope'].textContent=catalog.scope;ui['sales-definition'].textContent=salesData.definition;
    ui['excluded-summary'].textContent=`제외 발매: ${(catalog.excluded||[]).map(item=>item.title||item.id).join(', ')}`;
    ui['catalog-updated'].textContent=`목록·자료 확인: ${salesData.updatedAt}`;
    const seen=new Set();[...(catalog.sources||[]),...(salesData.sources||[])].forEach(source=>{const url=typeof source==='string'?source:source.url;if(seen.has(url))return;seen.add(url);const li=document.createElement('li');addSourceLink(li,source);ui['sources-list'].append(li);});
    reset({focus:false});renderBest();startTick();
  }catch(error){console.error('앨범 코스를 불러오지 못했습니다.',error);ui['error-message'].hidden=false;ui['error-message'].textContent='앨범 정보를 불러오지 못했어요. 페이지를 새로고침해주세요.';ui['album-name'].textContent='불러오기를 다시 시도해주세요.';}
}
function startTick(){if(!tick)tick=setInterval(()=>{if(session?.status==='running')renderMetrics(session.snapshot(clock()));},100);}
const viewport=window.visualViewport;let largestViewportHeight=viewport?.height||innerHeight,previousViewportWidth=viewport?.width||innerWidth;
function updateViewport(){const height=viewport?.height||innerHeight,width=viewport?.width||innerWidth;if(Math.abs(width-previousViewportWidth)>80)largestViewportHeight=height;else largestViewportHeight=Math.max(largestViewportHeight,height);previousViewportWidth=width;const keyboardOpen=session?.status!=='completed'&&matchMedia('(pointer:coarse)').matches&&largestViewportHeight-height>120;document.documentElement.style.setProperty('--viewport-height',`${Math.floor(height)}px`);document.documentElement.classList.toggle('keyboard-open',keyboardOpen);}
viewport?.addEventListener('resize',updateViewport);window.addEventListener('resize',updateViewport);input.addEventListener('focus',updateViewport);updateViewport();
window.addEventListener('pagehide',()=>{if(tick)clearInterval(tick);tick=null;});window.addEventListener('pageshow',()=>{if(session)startTick();});
initialize();
