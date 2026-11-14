import { TypingSession, normalizeTitle } from './core.mjs';
import { ChartProgress } from './chart-progress.mjs';
import { SalesChartView } from './chart-view.mjs';
import { attachInputController } from './input-controller.mjs';
import { createCountdown } from './countdown.mjs';
import { buildCourse, catalogFingerprint, bestForCourse } from './course-selection.mjs';
import { createPersonalRecords } from './personal-records.mjs';
import { createHomeRecords } from './home-records.mjs';
import { createRankingClient, normalizeNickname } from './ranking-client.mjs';

const byId = id => document.getElementById(id);
const ui = Object.fromEntries(['album-cover','album-name','album-sales','cpm','accuracy','elapsed','typing-input','target-text','typing-line','input-hint','state-label','track-counter','upcoming-tracks','course-progress','progress-fill','progress-percentage','journey-label','play-button','restart-button','game-board','result-panel','result-description','result-time','result-cpm','result-accuracy','best-message','album-memories','best-record','course-summary','course-count','chart-note','chart-view-label','chart-view-button','error-message','announcement','catalog-dialog','catalog-list','catalog-scope','sales-definition','sources-list','excluded-summary','catalog-updated','restart-dialog'].map(id => [id,byId(id)]));
let input = ui['typing-input'];
const clock = () => performance.now();
let safeStorage;try{safeStorage=localStorage;}catch{}
const personalRecords=createPersonalRecords(safeStorage);
let catalog, salesData, albums, courseTracks, session, chartModel, chartView, signature, inputController;
let courseCatalog, fullCourse, activeCourse, previewCourse, selectedIds=new Set(), recordsPanel, rankingConfig={enabled:false}, rankingClient=createRankingClient({enabled:false}), runContext, currentNickname='';
let best = null, lastResult = null, shownAlbum = null, lastFinished = false, overview = false;
let catalogWasRunning = false, restartWasRunning = false, restartAction = 'restart', tick = null, phase = 'home';
for(const id of ['home-screen','game-screen','home-albums','home-course-count','home-best','start-button','countdown-overlay','countdown-number','sales-label','load-error'])ui[id]=byId(id);
for(const id of ['nickname-input','nickname-status','course-mode-badge','course-eligibility','ranking-result-status'])ui[id]=byId(id);

function readStorage(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function writeStorage(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); } catch {} }
function announce(text) { ui.announcement.textContent = text; }
function deviceCategory(){return matchMedia('(pointer:coarse)').matches?'mobile':'pc';}
function uniqueId(){return crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;}
function nicknameError(text){ui['nickname-status'].textContent=text;ui['nickname-status'].classList.toggle('has-error',Boolean(text));ui['nickname-input'].setAttribute('aria-invalid',String(Boolean(text)));}
function nicknameValue(){return normalizeNickname(ui['nickname-input'].value);}
function saveNicknameLocally(value){currentNickname=value;writeStorage('fromis-player-profile-v1',{nickname:value});rankingClient.useNickname?.(value);ui['nickname-input'].value=value;nicknameError('');ui['nickname-status'].textContent='같은 닉네임의 기록은 하나로 묶여요.';}
ui['nickname-input'].addEventListener('input',()=>nicknameError(''));
function rememberEditedNickname(){
  if(phase!=='home')return;
  let nickname;try{nickname=nicknameValue();}catch(error){nicknameError(error.message);return;}
  const changed=nickname!==currentNickname;saveNicknameLocally(nickname);
  if(changed){renderBest();recordsPanel?.refresh();}
}
ui['nickname-input'].addEventListener('change',rememberEditedNickname);
ui['nickname-input'].addEventListener('blur',rememberEditedNickname);
function updatePicker(){
  for(const checkbox of ui['home-albums'].querySelectorAll('input'))checkbox.checked=selectedIds.has(checkbox.value);
  try{previewCourse=buildCourse(courseCatalog,[...selectedIds]);}catch{previewCourse=null;}
  ui['start-button'].disabled=!previewCourse;
  ui['home-course-count'].textContent=previewCourse?`${previewCourse.albums.length}앨범 · ${previewCourse.trackCount}곡`:'앨범을 하나 이상 골라주세요.';
  const full=previewCourse?.isFullCourse;
  ui['course-mode-badge'].textContent=full?'전체 코스 · 랭킹 대상':'선택 코스 · 연습';ui['course-mode-badge'].classList.toggle('practice',!full);
  ui['course-eligibility'].textContent=full?'모든 앨범을 완주하면 주간·전체 랭킹에 기록을 남겨요.':'선택한 앨범은 발매순으로 플레이해요. 연습 기록은 개인 기록에만 남아요.';
  writeStorage('fromis-selected-albums-v1',[...selectedIds]);renderBest();
}
ui['home-albums'].addEventListener('change',event=>{if(phase!=='home'||!event.target.matches('input[type=checkbox]'))return;const id=event.target.value;if(event.target.checked)selectedIds.add(id);else selectedIds.delete(id);updatePicker();});
byId('select-all-albums').addEventListener('click',()=>{if(!catalog)return;selectedIds=new Set(catalog.albums.map(album=>album.id));updatePicker();});
byId('clear-albums').addEventListener('click',()=>{selectedIds.clear();updatePicker();});
function prepareCourse(course){
  activeCourse=course;courseTracks=course.tracks;signature=course.signature;session=new TypingSession(courseTracks);chartModel=new ChartProgress({albums:course.albums,tracks:courseTracks});
  chartView?.destroy();chartView=new SalesChartView({svg:byId('sales-chart'),stage:byId('chart-stage'),albums:course.albums});
  ui['course-count'].textContent=`${course.albums.length}앨범 · ${course.trackCount}곡${course.isFullCourse?'':' · 연습'}`;
  ui['course-summary'].textContent=`${course.isFullCourse?'전체 코스 · 랭킹 대상':'선택 앨범 연습 · 랭킹 제외'} · 비공식 집계 포함`;
}
function createRunContext(nickname){
  const context={id:uniqueId(),course:activeCourse,nickname,device:deviceCategory(),client:rankingClient};
  context.onlineEligible=false;context.ticketReady=false;
  context.rankingStart=(context.course.isFullCourse&&context.client.configured?context.client.startRun({albumIds:context.course.albumIds,fullCourse:true,device:context.device,nickname}).catch(error=>({error})):Promise.resolve({eligible:false,reason:context.course.isFullCourse?'not-configured':'practice'})).then(ticket=>{context.ticket=ticket;context.ticketReady=true;return ticket;});
  return context;
}
function formatTime(milliseconds, precise = false) {
  const tenths = Math.max(0,Math.floor(milliseconds/100));
  return `${String(Math.floor(tenths/600)).padStart(2,'0')}:${String(Math.floor(tenths/10)%60).padStart(2,'0')}${precise ? '.' + tenths%10 : ''}`;
}
function formatSales(album) { return album.firstWeekSales === null ? '자료 미확인' : `${album.approximate ? '약 ' : ''}${album.firstWeekSales.toLocaleString('ko-KR')}장`; }
function focusInput() { if(phase==='game'&&(session?.status==='ready'||session?.status==='running')) input.focus({preventScroll:true}); }
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
  ui['sales-label'].textContent=`${album.salesRecord?.chartSystem==='oricon'?'오리콘 첫 주':'초동 판매량'}${album.salesRecord?.sourceType==='unofficial'?' · 비공식':''}`;
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
  ui['chart-note'].textContent=snapshot.position.hasKnownY?'앨범의 모든 곡을 치면 그 앨범 점에 도착해요.':'초동 미확인 구간 · 숫자를 추정해서 연결하지 않아요.';
}
function render(state) {
  renderMetrics(state);
  if(state.status==='completed'){finish(state);return;}
  ui['game-board'].hidden=false;ui['game-board'].classList.remove('is-completed');ui['result-panel'].hidden=true;
  updateAlbum(state.currentTrack);
  input.disabled=phase==='home';input.readOnly=state.status==='paused';
  inputController?.syncValue(state);
  renderFeedback(state);renderUpcoming(state);renderProgress(state);
  ui['track-counter'].textContent=`${state.index+1} / ${state.progress.total}`;
  let hint='제목을 끝까지 치면 다음 곡으로 넘어가요.';
  if(state.status==='ready')hint='보이는 제목을 입력하면 시작해요.';
  else if(state.status==='paused')hint='계속하기를 누르면 이어서 칠 수 있어요.';
  else if(state.hasError)hint='빨간 글자를 고쳐주세요.';
  if(phase==='countdown')hint='카운트다운 뒤 자동으로 시작해요.';
  ui['input-hint'].textContent=hint;ui['input-hint'].title=hint;ui['input-hint'].classList.toggle('has-error',state.hasError);
  ui['state-label'].textContent=({ready:'준비',running:'입력 중',paused:'일시정지'})[state.status];
  if(state.status==='running'&&runContext&&!runContext.onlineEligible)ui['state-label'].textContent=runContext.course.isFullCourse?'입력 중 · 개인 기록':'입력 중 · 연습';
  ui['play-button'].textContent=({ready:'시작하기',running:'일시정지',paused:'계속하기'})[state.status];
  ui['play-button'].disabled=phase!=='game';ui['restart-button'].disabled=phase!=='game';
}
function bindInput(fresh,previous){
  previous?.removeEventListener('scroll',syncScroll);
  previous?.removeEventListener('focus',updateViewport);
  input=fresh;ui['typing-input']=fresh;
  fresh.addEventListener('scroll',syncScroll);
  fresh.addEventListener('focus',updateViewport);
}
ui['typing-line'].addEventListener('click',focusInput);
function pause(){if(session?.status==='running'){inputController?.cancel();render(session.pause(clock()));}}
function resume(){if(session?.status!=='paused'||phase!=='game')return;render(session.resume(clock()));inputController?.flush();focusInput();}
ui['play-button'].addEventListener('click',()=>{if(session.status==='running')pause();else if(session.status==='paused')resume();else beginRun();});
document.addEventListener('keydown',event=>{if(event.key!=='Escape'||event.isComposing||inputController?.isComposing()||ui['catalog-dialog'].open||ui['restart-dialog'].open)return;if(phase==='countdown'){event.preventDefault();showHome();}else if(phase==='game'&&session?.status==='running'){event.preventDefault();pause();}else if(phase==='game'&&session?.status==='paused'){event.preventDefault();resume();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(phase==='countdown')showHome({focus:false});else pause();}});
function setOverview(value){overview=Boolean(value);chartView?.setOverview(overview);ui['chart-view-button'].textContent=overview?'따라가기':'전체 차트';ui['chart-view-button'].setAttribute('aria-pressed',String(overview));ui['chart-view-label'].textContent=overview?'전체 앨범 · 단위: 장':'세로 확대 · 단위: 장';}
ui['chart-view-button'].addEventListener('click',()=>setOverview(!overview));
function reset({focus=true}={}) {
  shownAlbum=null;lastFinished=false;lastResult=null;
  const state=session.reset();inputController?.reset();input.value='';input.scrollLeft=0;chartModel.reset();setOverview(false);render(state);
  if(focus){focusInput();announce('첫 앨범부터 다시 시작해요.');}
}
function confirmLeave(action){restartAction=action;restartWasRunning=session.status==='running';pause();byId('restart-heading').textContent=action==='home'?'메인으로 돌아갈까요?':'처음부터 다시 시작할까요?';byId('confirm-restart').textContent=action==='home'?'메인으로':'다시 시작';ui['restart-dialog'].showModal();}
ui['restart-button'].addEventListener('click',()=>confirmLeave('restart'));
byId('home-button').addEventListener('click',()=>{if(session.status==='completed'||session.status==='ready')showHome();else confirmLeave('home');});
byId('cancel-restart').addEventListener('click',()=>ui['restart-dialog'].close());
byId('confirm-restart').addEventListener('click',()=>{restartWasRunning=false;ui['restart-dialog'].close();if(restartAction==='home')showHome();else beginRun();});
ui['restart-dialog'].addEventListener('close',()=>{if(restartWasRunning)resume();restartWasRunning=false;});
byId('replay-button').addEventListener('click',()=>beginRun());
function renderBest(){const course=phase==='home'?previewCourse:activeCourse;best=course?bestForCourse(personalRecords.list(),course.signature,deviceCategory(),currentNickname):null;const text=best?`이 코스 개인 최고 ${formatTime(best.elapsedMs,true)}`:'';ui['best-record'].textContent=text;ui['home-best'].textContent=text;recordsPanel?.summary();}

const countdown=createCountdown({onTick:number=>{const digit=document.createElement('span');digit.className='countdown-digit';digit.textContent=String(number);ui['countdown-number'].replaceChildren(digit);},onDone:()=>{if(phase!=='countdown'||document.hidden)return;runContext.onlineEligible=Boolean(runContext.course.isFullCourse&&runContext.ticketReady&&runContext.ticket?.eligible);if(inputController.isComposing()||input.value!=='')inputController.reset();phase='game';ui['countdown-overlay'].hidden=true;render(session.start(clock()));focusInput();announce('시작! 보이는 제목을 따라 입력해주세요.');}});
function beginRun(){if(!previewCourse)return;let nickname;try{nickname=nicknameValue();}catch(error){nicknameError(error.message);ui['nickname-input'].focus();return;}saveNicknameLocally(nickname);countdown.cancel();inputController?.cancel();phase='countdown';document.body.classList.remove('is-home');ui['home-screen'].hidden=true;ui['game-screen'].hidden=false;prepareCourse(previewCourse);runContext=createRunContext(nickname);reset({focus:false});ui['countdown-overlay'].hidden=false;input.disabled=false;input.readOnly=false;input.focus({preventScroll:true});updateViewport();countdown.start();}
function showHome({focus=true}={}){countdown.cancel();inputController?.cancel();phase='home';document.body.classList.add('is-home');ui['countdown-overlay'].hidden=true;if(session)reset({focus:false});ui['game-screen'].hidden=true;ui['home-screen'].hidden=false;input.blur();updateViewport();if(courseCatalog)updatePicker();recordsPanel?.refresh();if(focus)ui['start-button'].focus({preventScroll:true});}
ui['start-button'].addEventListener('click',beginRun);
byId('cancel-countdown').addEventListener('click',()=>showHome());
document.querySelector('.brand').addEventListener('click',event=>{if(!session)return;event.preventDefault();if(phase==='game'&&session.status!=='completed')confirmLeave('home');else showHome();});
function finish(state) {
  input.readOnly=true;input.blur();ui['game-board'].hidden=false;ui['game-board'].classList.add('is-completed');ui['result-panel'].hidden=false;
  chartView.update(chartModel.update({index:courseTracks.length,status:'completed'}));setOverview(true);
  ui['journey-label'].textContent=`${activeCourse.albums.length}앨범 · ${courseTracks.length}곡 완주`;ui['progress-percentage'].textContent='100%';ui['progress-fill'].style.width='100%';
  ui['course-progress'].setAttribute('aria-valuenow','100');ui['course-progress'].setAttribute('aria-valuetext','모든 앨범 완주');
  updateViewport();if(lastFinished)return;lastFinished=true;
  const context=runContext,previous=bestForCourse(personalRecords.list(),signature,context.device,context.nickname),record={id:uniqueId(),signature,courseVersion:rankingConfig.courseVersion||'local',albumIds:[...activeCourse.albumIds],albumTitles:activeCourse.albums.map(album=>album.title),trackCount:courseTracks.length,isFullCourse:activeCourse.isFullCourse,device:context.device,nickname:context.nickname,elapsedMs:state.stats.elapsedMs,cpm:Math.round(state.stats.cpm),accuracy:Number(state.stats.accuracy.toFixed(1)),completedAt:new Date().toISOString()};
  const isBest=!previous||record.elapsedMs<previous.elapsedMs;personalRecords.add(record);lastResult=record;
  ui['result-description'].textContent=`${activeCourse.albums.length}개 앨범의 ${courseTracks.length}곡을 발매순으로 완주했어요.${activeCourse.isFullCourse?'':' 선택 앨범 연습 코스예요.'}`;
  ui['result-time'].textContent=formatTime(record.elapsedMs,true);ui['result-cpm'].textContent=String(record.cpm);ui['result-accuracy'].textContent=`${record.accuracy}%`;
  ui['best-message'].textContent=isBest?(previous?`이 코스의 최고 기록보다 ${((previous.elapsedMs-record.elapsedMs)/1000).toFixed(1)}초 빨라졌어요.`:'이 코스의 첫 개인 기록을 남겼어요.'): `이 코스 개인 최고 ${formatTime(previous.elapsedMs,true)}`;
  const fragment=document.createDocumentFragment();activeCourse.albums.forEach(album=>{const image=document.createElement('img');image.src=album.cover;image.alt=album.title;image.title=album.title;image.width=33;image.height=33;image.onerror=()=>image.hidden=true;fragment.append(image);});
  ui['album-memories'].replaceChildren(fragment);renderBest();byId('replay-button').focus({preventScroll:true});saveCompletionRanking(record,state,context);
}
async function saveCompletionRanking(record,state,context){
  const show=text=>{if(runContext?.id===context.id)ui['ranking-result-status'].textContent=text;};
  if(!context.course.isFullCourse){show('선택 앨범 연습 기록은 개인 기록에 저장했어요. 주간·전체 랭킹에는 포함되지 않아요.');return;}
  if(!context.onlineEligible){show('온라인 랭킹 연결을 완료하지 못했어요. 개인 기록은 이 기기에 저장했어요.');return;}
  show('전체 코스 기록을 랭킹에 저장하고 있어요.');
  try{const result=await context.client.finishRun({runId:context.ticket.run_id,fullCourse:context.course.isFullCourse,completedTrackCount:state.progress.completed,elapsedMs:record.elapsedMs,correctStrokes:state.stats.correctStrokes,attemptedStrokes:state.stats.attemptedStrokes});if(result.eligible){personalRecords.uploaded(record.id,context.ticket.run_id);show('전체 코스 기록을 주간·전체 랭킹에 남겼어요.');if(phase==='home')recordsPanel?.refresh();}else show('이 기록은 개인 기록에만 저장했어요.');}catch{show('온라인 랭킹에 저장하지 못했어요. 개인 기록은 이 기기에 저장했어요.');}
}
byId('copy-button').addEventListener('click',async()=>{
  if(!lastResult)return;const text=`fromis_9 chart journey\n${lastResult.albumIds.length}앨범 · ${lastResult.trackCount}곡 ${lastResult.isFullCourse?'전체 완주':'연습 완주'} · ${formatTime(lastResult.elapsedMs,true)}\n${lastResult.cpm}타 · 정확도 ${lastResult.accuracy}%\n${location.href.split('?')[0]}`;
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
    const sales=document.createElement('p');sales.className='catalog-sales';sales.textContent=`${album.salesRecord?.metricLabel||'초동'} ${formatSales(album)}${album.salesRecord?.sourceType==='unofficial'?' · 비공식 집계':''}`;section.append(sales);
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
    albums=new Map(chartAlbums.map(album=>[album.id,album]));courseCatalog={...catalog,albums:chartAlbums};fullCourse=buildCourse(courseCatalog);
    prepareCourse(fullCourse);
    inputController=attachInputController({input,session:()=>session,now:clock,onState:render,onAnnounce:announce,onInputReplaced:bindInput,canInput:()=>phase==='game'&&!ui['catalog-dialog'].open&&!ui['restart-dialog'].open});
    const storedNickname=readStorage('fromis-player-profile-v1')?.nickname;
    let nickname='';
    try{nickname=normalizeNickname(storedNickname??`ㅍㄹㅂ${Math.floor(Math.random()*900+100)}`);}catch{nicknameError('닉네임 규칙이 바뀌었어요. 초성·숫자·특수기호 1~6글자로 다시 입력해주세요.');}
    currentNickname=nickname;ui['nickname-input'].value=nickname;
    if(nickname)writeStorage('fromis-player-profile-v1',{nickname});
    const storedSelection=readStorage('fromis-selected-albums-v1');selectedIds=new Set(Array.isArray(storedSelection)?storedSelection.filter(id=>albums.has(id)):chartAlbums.map(album=>album.id));
    const choices=document.createDocumentFragment();chartAlbums.forEach(album=>{const label=document.createElement('label');label.className='album-choice';label.title=album.title;const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=album.id;checkbox.setAttribute('aria-label',`${album.title} 선택`);const frame=document.createElement('span');frame.className='choice-cover';const image=document.createElement('img');image.src=album.cover;image.alt='';image.width=62;image.height=62;frame.append(image);const title=document.createElement('span');title.className='choice-title';title.textContent=album.title;label.append(checkbox,frame,title);choices.append(label);});ui['home-albums'].replaceChildren(choices);
    try{const response=await fetch('./data/ranking-config.json');if(response.ok)rankingConfig=await response.json();}catch{}
    if(rankingConfig.catalogHash&&await catalogFingerprint(catalog)===rankingConfig.catalogHash)rankingClient=createRankingClient({...rankingConfig,device:deviceCategory(),nickname});
    const legacy=readStorage('fromis-chart-best-v2');if(!personalRecords.list().length&&legacy?.signature===catalog.tracks.map(track=>`${track.id}:${normalizeTitle(track.title)}`).join('|')){try{personalRecords.add({...legacy,id:`legacy-${legacy.completedAt}`,signature:fullCourse.signature,courseVersion:'legacy',albumIds:[...fullCourse.albumIds],albumTitles:fullCourse.albums.map(album=>album.title),trackCount:fullCourse.trackCount,isFullCourse:true,device:deviceCategory(),nickname});}catch{}}
    recordsPanel=createHomeRecords({client:rankingClient,records:personalRecords,fullSignature:fullCourse.signature,currentDevice:deviceCategory(),getNickname:()=>currentNickname});
    ui['catalog-scope'].textContent=catalog.scope;ui['sales-definition'].textContent=salesData.definition;
    ui['excluded-summary'].textContent=`제외 발매: ${(catalog.excluded||[]).map(item=>item.title||item.id).join(', ')}`;
    ui['catalog-updated'].textContent=`목록·자료 확인: ${salesData.updatedAt}`;
    const seen=new Set();[...(catalog.sources||[]),...(salesData.sources||[])].forEach(source=>{const url=typeof source==='string'?source:source.url;if(seen.has(url))return;seen.add(url);const li=document.createElement('li');addSourceLink(li,source);ui['sources-list'].append(li);});
    ui['start-button'].disabled=false;showHome({focus:false});renderBest();startTick();
  }catch(error){console.error('앨범 코스를 불러오지 못했습니다.',error);ui['load-error'].hidden=false;ui['load-error'].textContent='앨범 정보를 불러오지 못했어요. 페이지를 새로고침해주세요.';ui['album-name'].textContent='불러오기를 다시 시도해주세요.';}
}
function startTick(){if(!tick)tick=setInterval(()=>{if(session?.status==='running')renderMetrics(session.snapshot(clock()));},100);}
const viewport=window.visualViewport;let largestViewportHeight=viewport?.height||innerHeight,previousViewportWidth=viewport?.width||innerWidth;
function updateViewport(){const height=viewport?.height||innerHeight,width=viewport?.width||innerWidth;if(Math.abs(width-previousViewportWidth)>80)largestViewportHeight=height;else largestViewportHeight=Math.max(largestViewportHeight,height);previousViewportWidth=width;const keyboardOpen=phase!=='home'&&session?.status!=='completed'&&matchMedia('(pointer:coarse)').matches&&largestViewportHeight-height>120;document.documentElement.style.setProperty('--viewport-height',`${Math.floor(height)}px`);document.documentElement.classList.toggle('keyboard-open',keyboardOpen);}
viewport?.addEventListener('resize',updateViewport);window.addEventListener('resize',updateViewport);bindInput(input);updateViewport();
window.addEventListener('pagehide',()=>{if(phase==='countdown')showHome({focus:false});inputController?.cancel();if(tick)clearInterval(tick);tick=null;});window.addEventListener('pageshow',()=>{if(session)startTick();});
initialize();
