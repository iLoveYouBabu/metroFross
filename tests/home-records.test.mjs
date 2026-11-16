import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeRecords } from '../dist/home-records.mjs';

class Element {
  constructor(){this.children=[];this.text='';this.attributes={};this.dataset={};this.listeners=new Map();this.value='';}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.text='';this.children=children;}
  setAttribute(key,value){this.attributes[key]=String(value);}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}
  emit(type){for(const listener of this.listeners.get(type)||[])listener({target:this});}
}
const rows=[
  {nickname:'ㅍㄹㅂ',device:'pc',signature:'full',isFullCourse:true,albumIds:['a','b'],elapsedMs:120000,cpm:300,accuracy:99,completedAt:'2026-11-15T00:00:00Z'},
  {nickname:'ㅍㄹㅂ',device:'pc',signature:'practice',isFullCourse:false,albumIds:['a'],elapsedMs:20000,cpm:200,accuracy:98,completedAt:'2026-11-14T00:00:00Z'},
  {nickname:'ㅍㄹㅂ',device:'mobile',signature:'full',isFullCourse:true,albumIds:['a','b'],elapsedMs:5000,cpm:100,accuracy:97,completedAt:'2026-11-13T00:00:00Z'},
  {nickname:'ㄷㄹ',device:'pc',signature:'full',isFullCourse:true,albumIds:['a','b'],elapsedMs:1000,cpm:500,accuracy:96,completedAt:'2026-11-12T00:00:00Z'}
];
async function fixture(client,run){
  const nodes=new Map(['records-content','ranking-connection-status','ranking-device','personal-best-time','personal-run-count','records-period-label','refresh-records','records-week','records-all','records-personal'].map(id=>[id,Object.assign(new Element(),{id})]));
  const tabs=['week','all','personal'].map(period=>{const tab=nodes.get('records-'+period);tab.dataset.period=period;return tab;});
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:id=>nodes.get(id),querySelectorAll:()=>tabs,createElement:()=>new Element()}});
  let nickname='ㅍㄹㅂ';
  try{const panel=createHomeRecords({client,records:{list:()=>rows},fullSignature:'full',currentDevice:'pc',getNickname:()=>nickname});await run({nodes,panel,nickname:value=>{nickname=value;}});}
  finally{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;}
}

test('personal history and summaries stay local, filtered by nickname and device, even offline',async()=>{
  let calls=0;
  const client={personal:()=>{calls++;throw new Error('personal API must not be used');},leaderboard:()=>{calls++;throw new Error('offline');}};
  await fixture(client,async({nodes,panel,nickname})=>{
    panel.selectPersonal();
    assert.equal(calls,0);
    assert.equal(nodes.get('records-content').children[0].children.length,2);
    assert.match(nodes.get('records-content').textContent,/전체 앨범 완주/u);
    assert.match(nodes.get('records-content').textContent,/1앨범 연습 완주/u);
    assert.equal(nodes.get('personal-best-time').textContent,'02:00.0');
    assert.equal(nodes.get('personal-run-count').textContent,'2회');
    assert.match(nodes.get('ranking-connection-status').textContent,/이 브라우저에 저장된 기록만/u);
    nodes.get('ranking-device').value='mobile';nodes.get('ranking-device').emit('change');
    assert.equal(nodes.get('personal-best-time').textContent,'00:05.0');assert.equal(nodes.get('personal-run-count').textContent,'1회');
    nodes.get('ranking-device').value='pc';nickname('ㄷㄹ');await panel.refresh();
    assert.equal(nodes.get('personal-best-time').textContent,'00:01.0');assert.equal(nodes.get('personal-run-count').textContent,'1회');
    assert.equal(calls,0);
  });
});

test('a delayed online leaderboard cannot replace the local personal view or its best time',async()=>{
  let resolve,calls=0,personalCalls=0;
  const online=[{rank:1,nickname:'온라인전용',elapsed_ms:1,cpm:999,accuracy:100}];
  const client={personal:()=>{personalCalls++;throw new Error('personal API must not be used');},leaderboard:()=>++calls===1?new Promise(done=>{resolve=done;}):Promise.resolve(online)};
  await fixture(client,async({nodes,panel})=>{
    const pending=panel.refresh();panel.selectPersonal();resolve(online);await pending;
    assert.doesNotMatch(nodes.get('records-content').textContent,/온라인전용/u);
    assert.equal(nodes.get('personal-best-time').textContent,'02:00.0');
    assert.match(nodes.get('ranking-connection-status').textContent,/이 브라우저에 저장된 기록만/u);
    nodes.get('records-all').emit('click');await Promise.resolve();
    assert.match(nodes.get('records-content').textContent,/온라인전용/u);
    assert.equal(nodes.get('personal-best-time').textContent,'02:00.0');
    assert.equal(calls,2);assert.equal(personalCalls,0);
  });
});
