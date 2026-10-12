import test from 'node:test';
import assert from 'node:assert/strict';
import {composerAction,elapsedLabel} from '../src/assistant-input.ts';
test('回车发送或排队，只有显式组合键引导；换行、输入法及重复按键保护',()=>{
 for(const running of [false,true]){
  assert.equal(composerAction({key:'Enter'},running),'queue');
  assert.equal(composerAction({key:'Enter',shiftKey:true},running),null);
  for(const modifier of ['ctrlKey','metaKey']){
   assert.equal(composerAction({key:'Enter',[modifier]:true},running),running?'steer':'queue');
   assert.equal(composerAction({key:'Enter',shiftKey:true,[modifier]:true},running),null);
  }
  for(const input of [{key:'Enter',isComposing:true},{key:'Enter',keyCode:229},{key:'Enter',repeat:true},{key:'Enter',altKey:true},{key:'Tab'}])assert.equal(composerAction(input,running),null);
  assert.equal(composerAction({key:'Enter',ctrlKey:true},running,true),null);
 }
});
test('计时只描述实际用时，不显示阶段、倒计时或虚假完成进度',()=>{
 assert.equal(elapsedLabel('2026-10-12T00:00:00Z',Date.parse('2026-10-12T00:00:18Z')),'用时 18 秒');
 assert.equal(elapsedLabel('2026-10-12T00:00:00Z',Date.parse('2026-10-12T00:09:03Z')),'用时 9 分 3 秒');
 assert.equal(elapsedLabel('invalid'),'用时 0 秒');
});
