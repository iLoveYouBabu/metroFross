import test from 'node:test';
import assert from 'node:assert/strict';
import { TypingSession } from '../dist/core.mjs';
import { attachInputController } from '../dist/input-controller.mjs';

// Event ownership and DOM-write checks cannot emulate an operating-system IME.
class Input extends EventTarget {
  constructor() { super(); this._value=''; this.writesDuringComposition=[]; this.scrollLeft=0; this.disabled=false; this.readOnly=false; this.isConnected=true; this.focused=true; this.nativeComposing=false; }
  get value() { return this._value; }
  set value(value) { if(this.nativeComposing)this.writesDuringComposition.push(value); this._value=value; }
  nativeValue(value) { this._value=value; }
  emit(type,fields={}) {
    if(type==='compositionstart'||(type==='input'&&fields.isComposing))this.nativeComposing=true;
    if(type==='compositionend')this.nativeComposing=false;
    const event=new Event(type,{cancelable:true});
    for(const [key,value] of Object.entries(fields))Object.defineProperty(event,key,{value});
    this.dispatchEvent(event); return event;
  }
  cloneNode() { const fresh=new Input(); fresh._value=this.value; fresh.disabled=this.disabled; fresh.readOnly=this.readOnly; fresh.focused=false; fresh.isConnected=false; return fresh; }
  replaceWith(fresh) { this.isConnected=false; this.focused=false; fresh.isConnected=true; this.emit('compositionend',{data:this.value}); }
  focus() { this.focused=true; }
  blur() { this.focused=false; this.emit('compositionend'); }
}
function fixture(titles=['투 하트','Feel Good','두근두근']) {
  const engine=new TypingSession(titles.map((title,id)=>({id,title})));
  let input=new Input(),locked=false,time=0;
  const states=[],announcements=[],replacements=[];
  const controller=attachInputController({input,session:()=>engine,now:()=>++time,canInput:()=>!locked,
    onInputReplaced:(fresh,previous)=>{assert.equal(previous.isConnected,false);input=fresh;replacements.push({fresh,previous});},
    onState:state=>{states.push(state);controller.syncValue(state);},onAnnounce:text=>announcements.push(text)});
  const type=(value,isComposing=false,fields={})=>{input.nativeValue(value);input.emit('input',{isComposing,...fields});};
  return{engine,get input(){return input;},controller,states,announcements,replacements,type,lock(value){locked=value;},wait(milliseconds){time+=milliseconds;}};
}

test('English to Korean preserves the first jamo when input precedes compositionstart',()=>{
  const f=fixture(['Feel Good','두근두근']),old=f.input;
  f.type('Feel Good');assert.equal(f.engine.index,1);assert.notEqual(f.input,old);
  f.type('ㄷ',true,{inputType:'insertCompositionText'});assert.equal(f.engine.input,'ㄷ');assert.equal(f.input.value,'ㄷ');
  f.input.emit('compositionstart');f.type('두',true);f.type('두ㄱ',true);f.type('두근',true);
  assert.equal(f.engine.input,'두근');assert.equal(f.engine.index,1);assert.deepEqual(f.input.writesDuringComposition,[]);
  f.type('두근두근',true);assert.equal(f.engine.status,'completed');assert.equal(f.engine.snapshot(200).stats.accuracy,100);
});
test('Korean to English isolates delayed old-node commits and retains the first English key',()=>{
  const f=fixture(['투 하트','Feel Good']),old=f.input;
  f.input.emit('compositionstart');f.type('투 하트',true);
  assert.equal(f.engine.index,1);assert.equal(f.input.focused,true);assert.equal(old.value,'투 하트');assert.deepEqual(old.writesDuringComposition,[]);
  f.type('F');f.wait(1500);
  for(const residue of ['트','하트','투 하트','F트']){old.nativeValue(residue);old.emit('compositionend',{data:residue});old.emit('input',{data:residue,inputType:'insertFromComposition'});assert.equal(f.engine.input,'F');assert.equal(f.input.value,'F');}
  f.type('Feel Good');assert.equal(f.engine.status,'completed');assert.equal(f.announcements.length,2);assert.equal(f.engine.snapshot(2000).stats.accuracy,100);
});
test('a repeated Korean initial is never removed as a fragment of the previous song',()=>{
  const f=fixture(['가','가나']);f.input.emit('compositionstart');f.type('가',true);
  f.type('ㄱ',true);assert.equal(f.input.value,'ㄱ');assert.equal(f.engine.input,'ㄱ');
  f.type('가',true);assert.equal(f.input.value,'가');assert.equal(f.engine.index,1);
  f.type('가나',true);assert.equal(f.engine.status,'completed');
});
test('repeated language changes advance each title once without Enter or delayed focus',()=>{
  const f=fixture(['Up And','업앤','Stay Alive','위고','DM']);
  const values=[['Up And',false],['업앤',true],['Stay Alive',false],['위고',true],['DM',false]];
  for(const [value,isComposing] of values){const old=f.input,index=f.engine.index;if(isComposing)old.emit('compositionstart');f.type(value,isComposing);assert.equal(f.engine.index,index+1);assert.notEqual(f.input,old);assert.equal(f.input.value,'');old.emit('compositionend',{data:value});old.emit('input');assert.equal(f.engine.index,index+1);assert.equal(f.input.focused,f.engine.status!=='completed');}
  assert.equal(f.announcements.length,values.length);assert.equal(f.engine.snapshot(200).stats.accuracy,100);
});
test('partial syllables remain editable and exact aliases also advance automatically',()=>{
  const f=fixture(['클로버','위고']);f.input.emit('compositionstart');f.type('클로ㅂ',true);assert.equal(f.engine.index,0);assert.deepEqual(f.input.writesDuringComposition,[]);f.type('클로버',true);assert.equal(f.engine.index,1);
  const engine=new TypingSession([{id:1,title:'위고',aliases:['WE GO']}]);let input=new Input();attachInputController({input,session:()=>engine,now:()=>10,onInputReplaced:fresh=>{input=fresh;}});input.emit('compositionstart');input.nativeValue('WE GO');input.emit('input',{isComposing:true});assert.equal(engine.status,'completed');
});
test('compositionend commits a partial composition once and later input is idempotent',()=>{
  const f=fixture(['두근두근']);f.input.emit('compositionstart');f.type('두',true);f.input.emit('compositionend');const attempted=f.engine.snapshot(100).stats.attemptedStrokes;f.type('두');assert.equal(f.engine.snapshot(100).stats.attemptedStrokes,attempted);f.input.emit('compositionstart');f.type('두근두근',true);assert.equal(f.engine.status,'completed');
});
test('pause freezes the accepted preedit and ignores later old-node events on resume',()=>{
  const f=fixture(['두근두근']);f.input.emit('compositionstart');f.type('두',true);const old=f.input;f.controller.cancel();f.engine.pause(100);assert.equal(f.input.value,'두');assert.equal(f.input.focused,false);old.nativeValue('두근두근');old.emit('compositionend');old.emit('input');assert.equal(f.engine.index,0);assert.equal(f.engine.input,'두');f.engine.resume(200);f.controller.flush();const attempted=f.engine.snapshot(300).stats.attemptedStrokes;f.controller.flush();assert.equal(f.engine.snapshot(300).stats.attemptedStrokes,attempted);f.input.emit('compositionstart');f.type('두근두근',true);assert.equal(f.engine.status,'completed');
});
test('countdown reset at GO discards blocked preedit and its late native events',()=>{
  const f=fixture(['두근두근']);f.lock(true);assert.equal(f.input.emit('beforeinput',{inputType:'insertText'}).defaultPrevented,true);f.input.emit('compositionstart');f.type('두',true);const old=f.input;assert.equal(f.engine.status,'ready');assert.deepEqual(old.writesDuringComposition,[]);f.controller.reset();f.lock(false);old.nativeValue('두근두근');old.emit('compositionend');old.emit('input');assert.equal(f.input.value,'');assert.equal(f.engine.index,0);f.type('ㄷ',true);assert.equal(f.engine.input,'ㄷ');f.type('두근두근',true);assert.equal(f.engine.status,'completed');
});
test('a composition started while locked stays excluded if it ends after unlocking',()=>{
  const f=fixture(['두근두근']);f.lock(true);f.input.emit('compositionstart');f.type('두',true);const old=f.input;f.lock(false);f.type('두근두근',true);old.emit('compositionend');assert.equal(f.engine.index,0);assert.equal(f.input.value,'');f.type('두근두근',true);assert.equal(f.engine.status,'completed');
});
test('paste and drop are blocked while ordinary input is allowed',()=>{
  const f=fixture();for(const inputType of ['insertFromPaste','insertFromDrop'])assert.equal(f.input.emit('beforeinput',{inputType}).defaultPrevented,true);assert.equal(f.input.emit('beforeinput',{inputType:'insertText',data:'F'}).defaultPrevented,false);assert.equal(f.input.emit('paste').defaultPrevented,true);assert.equal(f.input.emit('drop').defaultPrevented,true);
});
test('restart and destroy invalidate retired listeners without stealing focus',()=>{
  const f=fixture(['가','가나']);f.input.emit('compositionstart');f.type('ㄱ',true);const old=f.input;f.engine.reset();f.controller.reset();assert.equal(f.input.value,'');assert.equal(f.input.focused,false);old.nativeValue('가');old.emit('input',{isComposing:true});assert.equal(f.engine.index,0);f.type('가',true);assert.equal(f.engine.index,1);const live=f.input;f.controller.destroy();live.nativeValue('가나');live.emit('input');assert.equal(f.engine.index,1);
});
