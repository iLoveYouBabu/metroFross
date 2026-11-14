import test from 'node:test';
import assert from 'node:assert/strict';
import { createCountdown } from '../dist/countdown.mjs';

function fixture() {
  const pending = new Map(), ticks = [];
  let id = 0, completions = 0;
  const countdown = createCountdown({onTick:value=>ticks.push(value),onDone:()=>completions++,schedule:callback=>{pending.set(++id,callback);return id;},unschedule:timer=>pending.delete(timer)});
  const next = () => { const [key, callback] = pending.entries().next().value; pending.delete(key); callback(); };
  return {countdown,pending,ticks,next,get completions(){return completions;}};
}

test('countdown starts the clock only after all three beats',()=>{
  const f=fixture(); f.countdown.start(); assert.deepEqual(f.ticks,[3]);
  f.next(); f.next(); assert.deepEqual(f.ticks,[3,2,1]); assert.equal(f.completions,0);
  f.next(); assert.equal(f.completions,1); assert.equal(f.pending.size,0);
});

test('cancelled or superseded countdown callbacks cannot start a game',()=>{
  const f=fixture(); f.countdown.start(); const stale=[...f.pending.values()][0];
  f.countdown.cancel(); stale(); assert.equal(f.completions,0); assert.equal(f.pending.size,0);
  f.countdown.start(); const superseded=[...f.pending.values()][0]; f.countdown.start(); superseded();
  f.next(); f.next(); f.next(); assert.equal(f.completions,1); assert.deepEqual(f.ticks,[3,3,3,2,1]);
});
