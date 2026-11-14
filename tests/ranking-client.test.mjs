import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRankingClient, normalizeNickname } from '../dist/ranking-client.mjs';

const base = { enabled:true, url:'https://test-project.supabase.co', publishableKey:'sb_publishable_test', courseVersion:'test-course', canonicalAlbumIds:['a','b'], trackCount:3, device:'pc', nickname:'ㅍㄹㅂ' };
const reply = (data,status=200) => ({ok:status>=200&&status<300,status,json:async()=>data});
function fixture(responses=[],extra={}) {
  const calls=[],storageCalls=[];
  const client=createRankingClient({...base,...extra,storage:{getItem(){storageCalls.push('get');return null;},setItem(){storageCalls.push('set');},removeItem(){storageCalls.push('remove');}},fetch:async(url,options)=>{
    calls.push({url,options,body:JSON.parse(options.body)});
    const next=responses.shift(); if(next instanceof Error)throw next; if(!next)throw new Error('Unexpected request'); return next;
  }});
  return {client,calls,storageCalls};
}

test('practice and a partial selection never access the server',async()=>{
  const f=fixture();
  assert.deepEqual(await f.client.startRun({albumIds:['a'],fullCourse:false}),{eligible:false,reason:'practice'});
  assert.deepEqual(await f.client.startRun({albumIds:['a'],fullCourse:true}),{eligible:false,reason:'practice'});
  assert.deepEqual(await f.client.startRun({albumIds:['b','a'],fullCourse:true}),{eligible:false,reason:'practice'});
  assert.deepEqual(await f.client.finishRun({fullCourse:false}),{eligible:false,reason:'practice'});
  assert.equal(f.calls.length,0);
});

test('missing nickname SQL is an explicit setup error, not an empty leaderboard',async()=>{
  const f=fixture([reply({code:'PGRST202',message:'function was not found'},404)]);
  await assert.rejects(f.client.leaderboard(),{code:'backend-not-ready'});
  assert.equal(f.calls.length,1);assert.match(f.calls[0].url,/\/rpc\/fromis_nickname_leaderboard$/u);
  assert.equal(f.calls[0].options.headers.Authorization,undefined);
  assert.equal(f.calls[0].options.headers.apikey,base.publishableKey);
});

test('leaderboard passes the current nickname only for highlighting actual records',async()=>{
  const rows=[{rank:1,nickname:'ㅍㄹㅂ',elapsed_ms:123456,cpm:350,accuracy:99,is_me:true}];
  const f=fixture([reply(rows)]);
  assert.deepEqual(await f.client.leaderboard({period:'all',device:'mobile'}),rows);
  assert.equal(f.calls[0].body.p_period,'all');assert.equal(f.calls[0].body.p_device,'mobile');assert.equal(f.calls[0].body.p_nickname,'ㅍㄹㅂ');
});

test('nickname save uses one public RPC and never requests Auth or writes session storage',async()=>{
  const f=fixture([reply({nickname:'ㅍㄹㅂ1!'})]);
  assert.deepEqual(await f.client.setNickname(' ㅍㄹㅂ1! '),{nickname:'ㅍㄹㅂ1!'});
  assert.equal(f.calls.length,1);assert.match(f.calls[0].url,/\/rpc\/fromis_nickname_set$/u);
  assert.deepEqual(f.calls[0].body,{p_nickname:'ㅍㄹㅂ1!'});
  assert.equal(f.client.getNickname(),'ㅍㄹㅂ1!');assert.deepEqual(f.storageCalls,[]);
});

test('local nickname selection changes the personal lookup without any profile write',async()=>{
  const result={nickname:'ㄷㄹㅂ',best:null,weekBest:null,completedRuns:0,recent:[]};
  const f=fixture([reply(result)]);
  assert.equal(f.client.useNickname('ㄷㄹㅂ'),'ㄷㄹㅂ');assert.equal(f.calls.length,0);
  assert.deepEqual(await f.client.personal(),result);
  assert.match(f.calls[0].url,/\/rpc\/fromis_nickname_personal$/u);assert.equal(f.calls[0].body.p_nickname,'ㄷㄹㅂ');
});

test('personal records can be looked up by an explicitly supplied nickname with no login',async()=>{
  const result={nickname:'ㄱㅇㄴ',best:{elapsed_ms:123456},weekBest:null,completedRuns:1,recent:[]};
  const f=fixture([reply(result)]);
  assert.deepEqual(await f.client.personal({nickname:'ㄱㅇㄴ'}),result);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.headers.Authorization,undefined);assert.deepEqual(f.storageCalls,[]);
  const empty=fixture([],{nickname:''});
  await assert.rejects(empty.client.personal(),{code:'nickname-required'});assert.equal(empty.calls.length,0);
});

test('full-course tickets carry the private finish token into only the finish request',async()=>{
  const runId='00000000-0000-4000-8000-000000000001',runToken='00000000-0000-4000-8000-000000000002';
  const f=fixture([reply({eligible:true,run_id:runId,run_token:runToken}),reply({eligible:true,duplicate:false,record:{run_id:runId,nickname:'ㅍㄹㅂ',elapsed_ms:54321}})]);
  const run=await f.client.startRun({albumIds:['a','b'],fullCourse:true});assert.equal(run.run_token,runToken);
  assert.equal(f.calls[0].body.p_nickname,'ㅍㄹㅂ');
  const result=await f.client.finishRun({runId,runToken,fullCourse:true,completedTrackCount:3,elapsedMs:54321.2,correctStrokes:654,attemptedStrokes:660});
  assert.equal(f.calls[1].body.p_elapsed_ms,54321);assert.equal(f.calls[1].body.p_run_id,runId);assert.equal(f.calls[1].body.p_run_token,runToken);
  assert.equal(result.record.run_token,undefined);assert.equal(result.record.finish_token,undefined);
});

test('finish requires the issued token, complete count and consistent counters',async()=>{
  const f=fixture();
  const common={runId:'id',runToken:'token',fullCourse:true,completedTrackCount:3,elapsedMs:100,correctStrokes:50,attemptedStrokes:60};
  await assert.rejects(f.client.finishRun({...common,runToken:null}),{code:'invalid-run'});
  await assert.rejects(f.client.finishRun({...common,completedTrackCount:2}),{code:'invalid-run'});
  await assert.rejects(f.client.finishRun({...common,attemptedStrokes:40}),{code:'invalid-run'});
  assert.equal(f.calls.length,0);
});

test('unconfigured or privileged keys cannot make network calls',async()=>{
  const fakeService=['header',Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url'),'signature'].join('.');
  for(const key of ['', 'sb_secret_test',fakeService]){
    const f=fixture([],{publishableKey:key});assert.equal(f.client.configured,false);
    await assert.rejects(f.client.leaderboard(),{code:'not-configured'});assert.equal(f.calls.length,0);
  }
});

test('network and invalid server tickets remain explicit errors',async()=>{
  await assert.rejects(fixture([new TypeError('offline')]).client.leaderboard(),{code:'network'});
  const f=fixture([reply({code:'P0001',message:'INVALID_RUN'},400)]);
  await assert.rejects(f.client.finishRun({runId:'id',runToken:'token',fullCourse:true,completedTrackCount:3,elapsedMs:20000,correctStrokes:654,attemptedStrokes:654}),{code:'invalid-run'});
});

test('nicknames accept only kkobak initials, ASCII digits and symbols, from one to six characters',()=>{
  for(const value of ['ㄱ','ㄲㄸㅃㅆㅉ','ᄀᄂᄒ','0','123456','ㅍㄹㅂ123','<>','!@#$%^','[]{}~`'])assert.equal(normalizeNickname(value),value);
  assert.equal(normalizeNickname('  ㅍㄹㅂ1!  '),'ㅍㄹㅂ1!');
  for(const value of ['',null,'가','플로버','ABC','abc','ㅏ','ㄳ','ㄱ 1','ㄱ\n1','🎵','１','١','1234567','ㄱ'.repeat(7)])assert.throws(()=>normalizeNickname(value),{code:'invalid-nickname'},String(value));
  // Cover every ASCII punctuation/digit individually, including quotes and angle brackets.
  for(let code=33;code<=126;code++){
    const char=String.fromCharCode(code);
    if(/[A-Za-z]/u.test(char))assert.throws(()=>normalizeNickname(char),{code:'invalid-nickname'});
    else assert.equal(normalizeNickname(char),char);
  }
});

test('invalid nicknames never reach nickname or ranking RPCs',async()=>{
  for(const nickname of ['완성형','English','ㄱ 1','ㄱ'.repeat(7),'ㅏ']){
    const f=fixture();
    await assert.rejects(f.client.setNickname(nickname),{code:'invalid-nickname'});
    await assert.rejects(f.client.startRun({albumIds:['a','b'],fullCourse:true,nickname}),{code:'invalid-nickname'});
    await assert.rejects(f.client.personal({nickname}),{code:'invalid-nickname'});
    await assert.rejects(f.client.leaderboard({nickname}),{code:'invalid-nickname'});
    assert.equal(f.calls.length,0);
  }
  const f=fixture([reply({nickname:'ㄱ'})]);assert.deepEqual(await f.client.setNickname('ㄱ'),{nickname:'ㄱ'});
});

test('nickname ranking version isolates the old Auth version and matches the complete catalog',async()=>{
  const root=new URL('../',import.meta.url);
  const [course,config]=await Promise.all(['dist/data/album-course.json','dist/data/ranking-config.json'].map(async path=>JSON.parse(await readFile(new URL(path,root),'utf8'))));
  const canonical=JSON.stringify({albums:course.albums.map(album=>album.id),tracks:course.tracks.map(track=>({id:track.id,title:track.title,albumId:track.albumId,trackNumber:track.trackNumber,aliases:track.aliases||[]}))});
  const hash=createHash('sha256').update(canonical).digest('hex');
  assert.equal(config.catalogHash,hash);assert.equal(config.courseVersion,'fromis-full-nickname-v1-'+hash.slice(0,16));
  assert.deepEqual(config.canonicalAlbumIds,course.albums.map(album=>album.id));assert.equal(config.trackCount,course.tracks.length);
});
