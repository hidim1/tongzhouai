import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-completion-test-'));
process.env.TONGZHOU_DATA_DIR=dir;
const {askAI,previewAI,generalSchema,cancelAI,steerAI}=await import('../server/preview-ai.mjs');
const {matchesOutputSchema}=await import('../server/preview-result.mjs');
after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const valid={answer:'已完成资料整理。',files:[]};
const reviewSchema={type:'object',properties:{acceptable:{type:'boolean'},problems:{type:'array',items:{type:'string'}},repairs:{type:'array',items:{type:'string'}}},required:['acceptable','problems','repairs'],additionalProperties:false};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
let seq=0;
function fixture(t,options={}){
 const originals={connect:previewAI.connect,request:previewAI.request,interrupt:previewAI.interrupt};
 const threadId='completion-'+(++seq),turnId='turn-'+seq,calls=[],phases=[];
 previewAI.connect=async()=>{previewAI.status.authenticated=true;};
 previewAI.request=async(method,params)=>{calls.push({method,params});if(method==='thread/start')return{thread:{id:threadId}};if(method==='turn/start'){if(options.startReply)await options.startReply;if(options.results){const index=calls.filter(c=>c.method==='turn/start').length-1;setImmediate(()=>{previewAI.emit('event',{method:'item/completed',params:{threadId,turnId,item:{type:'agentMessage',phase:'final_answer',text:JSON.stringify(options.results[index])}}});});}return{turn:{id:turnId}};}if(method==='turn/steer')return{turnId};throw Error(method);};
 previewAI.interrupt=async(...params)=>{calls.push({method:'interrupt',params});};
 t.after(()=>Object.assign(previewAI,originals));
 const start=(overrides={})=>askAI('test-'+seq,'整理资料',generalSchema,[],undefined,'medium',{timeoutMs:0,completeOnFinal:true,onPhase:phase=>phases.push(phase),...overrides});
 const emit=(method,params={})=>previewAI.emit('event',{method,params:{threadId,turnId,...params}});
 const item=(value=valid,phase='final_answer')=>emit('item/completed',{item:{type:'agentMessage',phase,text:typeof value==='string'?value:JSON.stringify(value)}});
 const complete=status=>emit('turn/completed',{turn:{status}});
 return{start,emit,item,complete,calls,phases,threadId,turnId};
}
test('通用任务超过八分钟仍继续等待，正式结果无需等缺失的结束事件',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);let settled=false;
 const result=f.start().then(v=>{settled=true;return v;});await flush();
 t.mock.timers.tick(480001);await flush();assert.equal(settled,false);assert.equal(f.calls.filter(c=>c.method==='interrupt').length,0);
 f.item();assert.deepEqual(await result,valid);f.complete('completed');t.mock.timers.tick(5001);
 assert.equal(f.calls.filter(c=>c.method==='interrupt').length,0);
});
test('内部视觉检查没有answer字段也可正式交付，不触发聊天格式纠正',async t=>{
 const f=fixture(t),result=askAI('test-'+seq,'核对排版',reviewSchema,[],undefined,'low',{timeoutMs:0,completeOnFinal:true});await flush();
 const value={acceptable:true,problems:[],repairs:[]};f.item({...value,sources:[]});assert.deepEqual(await result,value);f.complete('completed');
 assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);assert.equal(f.calls.filter(c=>c.method==='turn/steer').length,0);
});
test('中间进度和未完整JSON不提前交付，完整commentary触发一次正式提交修复',async t=>{
 const f=fixture(t);let settled=false;const result=f.start().then(v=>{settled=true;return v;});await flush();
 f.item('正在搜索公开资料','commentary');f.item('{"answer":"未结束"','commentary');await flush();assert.equal(settled,false);assert.equal(f.calls.filter(c=>c.method==='turn/steer').length,0);
 f.item(valid,'commentary');f.item(valid,'commentary');await flush();assert.equal(settled,false);
 const steering=f.calls.filter(c=>c.method==='turn/steer');assert.equal(steering.length,1);assert.equal(steering[0].params.expectedTurnId,f.turnId);assert.match(steering[0].params.input[0].text,/final_answer/);
 f.item();assert.deepEqual(await result,valid);f.complete('completed');
});
test('正式结果结束事件丢失时只清理已交付的线程，不继续空等',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);const result=f.start();await flush();f.item();await result;t.mock.timers.tick(5001);await flush();
 assert.deepEqual(f.calls.filter(c=>c.method==='interrupt').map(c=>c.params),[[f.threadId,f.turnId]]);
});
test('完整进度早于turn/start返回时，修复等待正确的turn id',async t=>{
 let unblock;const f=fixture(t,{startReply:new Promise(resolve=>unblock=resolve)});const result=f.start();await flush();f.item(valid,'commentary');assert.equal(f.calls.filter(c=>c.method==='turn/steer').length,0);
 unblock();await flush();assert.equal(f.calls.find(c=>c.method==='turn/steer').params.expectedTurnId,f.turnId);f.item();await result;f.complete('completed');
});
test('旧版无phase结果支持完成事件，空消息不会覆盖有效结果',async t=>{
 const f=fixture(t);const result=f.start();await flush();f.item(valid,null);f.item(' ',null);f.complete('completed');assert.deepEqual(await result,valid);
});
test('无phase空回复只纠正一次，不交付也不终止尚未完成的检索',async t=>{
 const f=fixture(t);let settled=false;const result=f.start().then(v=>{settled=true;return v;});await flush();f.item(' ',null);f.item('',null);await flush();
 const steering=f.calls.filter(c=>c.method==='turn/steer');assert.equal(steering.length,1);assert.match(steering[0].params.input[0].text,/尚未返回的检索结果应等待/);assert.equal(settled,false);
 f.item(valid,'commentary');assert.equal(f.calls.filter(c=>c.method==='turn/steer').length,2);f.item();await result;f.complete('completed');
});
test('正式结果结构无效不得交付',async t=>{
 const f=fixture(t,{results:[{answer:42,files:[]},{answer:42,files:[]}]});
 await assert.rejects(f.start(),/答复格式/);assert.equal(f.calls.filter(c=>c.method==='turn/start').length,2);assert.equal(f.calls.filter(c=>c.method==='interrupt').length,2);
});
test('有效正文附带来源不失败，来源通过内部回调接收而非对话输出',async t=>{
 const f=fixture(t);let sources;
 const result=f.start({onReferences:value=>sources=value});await flush();
 f.item({...valid,sources:[{title:'公开参考',url:'https://example.com/reference',date:'2026-10-11'}]});
 assert.deepEqual(await result,valid);assert.equal(sources[0].publishedAt,'2026-10-11');assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);f.complete('completed');
});
test('无效格式只纠正一次，保留原任务，不重复联网和生成附件',async t=>{
 const f=fixture(t,{results:[{answer:42},valid]});
 assert.deepEqual(await f.start({allowWebSearch:true}),valid);
 const threads=f.calls.filter(c=>c.method==='thread/start'),turns=f.calls.filter(c=>c.method==='turn/start');
 assert.equal(threads.length,2);assert.equal(threads[0].params.config.web_search,'live');assert.equal(threads[1].params.config.web_search,'disabled');
 assert.match(turns[1].params.input[0].text,/不要重复联网/);assert.match(turns[1].params.input[0].text,/上一轮结果/);f.complete('completed');
});
test('未完成任务仍可手动停止，并忽略迟到结果',async t=>{
 const f=fixture(t);const result=f.start();const rejected=assert.rejects(result,/已停止任务/);await flush();await cancelAI('test-'+seq);await rejected;f.item();f.complete('completed');
 assert.equal(f.calls.filter(c=>c.method==='interrupt').length,1);
});
test('turn/start回执延迟时手动停止不使用空turn id，收到回执后清理对应任务',async t=>{
 let unblock;const f=fixture(t,{startReply:new Promise(resolve=>unblock=resolve)});const result=f.start();const rejected=assert.rejects(result,/已停止任务/);await flush();await cancelAI('test-'+seq);
 assert.equal(f.calls.filter(c=>c.method==='interrupt').length,0);unblock();await rejected;assert.deepEqual(f.calls.find(c=>c.method==='interrupt').params,[f.threadId,f.turnId]);
});
test('连接断开正常失败，不无限等待',async t=>{
 const f=fixture(t);const result=f.start();const rejected=assert.rejects(result,/连接断开/);await flush();previewAI.emit('disconnected',new Error('连接断开'));await rejected;
});
test('可重试错误不会结束任务，最终错误仍及时结束',async t=>{
 const f=fixture(t);const result=f.start();const rejected=assert.rejects(result,/连接异常/);await flush();f.emit('error',{willRetry:true,error:{message:'短暂异常'}});f.emit('error',{willRetry:false,error:{message:'连接异常'}});await rejected;
});
test('工程任务保留原八分钟限制，不启用通用任务收尾逻辑',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);const result=f.start({timeoutMs:480000,completeOnFinal:false});const rejected=assert.rejects(result,/超过8分钟/);await flush();f.item();t.mock.timers.tick(480001);await rejected;
});
test('普通用户内部信息检查仍在正式交付之前生效',async t=>{
 const f=fixture(t);const previous=process.env.ZHOUZHI_MEMBER_MODE;process.env.ZHOUZHI_MEMBER_MODE='1';t.after(()=>previous===undefined?delete process.env.ZHOUZHI_MEMBER_MODE:process.env.ZHOUZHI_MEMBER_MODE=previous);
 const result=f.start();const rejected=assert.rejects(result,/内部信息/);await flush();f.item({answer:'codex',files:[]});await rejected;
});
test('进度仅使用固定业务提示，不把检索参数或回复原文传给前端',async t=>{
 const f=fixture(t);const result=f.start();await flush();f.emit('item/started',{item:{type:'webSearch',query:'不应显示'}});f.emit('item/completed',{item:{type:'webSearch',query:'不应显示'}});f.item('包含技术细节的处理中原文','commentary');f.item();await result;f.complete('completed');
 assert.deepEqual(f.phases,['正在检索公开资料','正在核对检索资料并整理答复']);
});
test('结构校验拒绝多余字段、类型错误和继承属性',()=>{
 assert.equal(matchesOutputSchema(valid,generalSchema),true);
 assert.equal(matchesOutputSchema({...valid,answer:1},generalSchema),false);
 assert.equal(matchesOutputSchema({...valid,extra:true},generalSchema),false);
 assert.equal(matchesOutputSchema(JSON.parse('{"answer":"a","files":[],"toString":"x"}'),generalSchema),false);
});
test('只有智能工作助理取消固定时限，页面进度与手动停止保留',()=>{
 const routes=fs.readFileSync(new URL('../server/preview-assistant.mjs',import.meta.url),'utf8');
 assert.equal((routes.match(/timeoutMs:0/g)||[]).length,1);
 assert.match(routes,/allowWebSearch:true,timeoutMs:0,completeOnFinal:true,onPhase:/);
 const view=fs.readFileSync(new URL('../src/Preview.tsx',import.meta.url),'utf8');
 assert.match(view,/generalProgress/);assert.match(view,/思考中…/);assert.match(view,/onStop=\{\(\)=>void stopGeneral\(\)\}/);
 const controls=fs.readFileSync(new URL('../src/AssistantControls.tsx',import.meta.url),'utf8');
 assert.match(controls,/停止回答/);assert.match(controls,/stop\?onStop\(\)/);
});
test('用户引导使用实际活跃回合，未交付草稿修订后才完成，结束后不假接收',async t=>{
 const f=fixture(t);const result=f.start();await flush();
 assert.equal(await steerAI('test-'+seq,'更简短一点'),true);
 const call=f.calls.find(c=>c.method==='turn/steer');assert.equal(call.params.expectedTurnId,f.turnId);assert.match(call.params.input[0].text,/更简短一点/);
 assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);f.item();await flush();await flush();
 assert.equal(f.calls.filter(c=>c.method==='turn/start').length,2);assert.match(f.calls.filter(c=>c.method==='turn/start')[1].params.input[0].text,/更简短一点/);
 f.item();await result;f.complete('completed');
 assert.equal(await steerAI('test-'+seq,'来晚的补充'),false);
});
test('回合开始回执尚未到达时，不向未知回合发送引导',async t=>{
 let unblock;const f=fixture(t,{startReply:new Promise(r=>unblock=r)});const result=f.start();await flush();
 assert.equal(await steerAI('test-'+seq,'更简短'),false);assert.equal(f.calls.filter(c=>c.method==='turn/steer').length,0);
 unblock();await flush();f.item();await result;f.complete('completed');
});
test('引导确认晚于正式答复时返回未接收，不能假显示本轮已补充',async t=>{
 const f=fixture(t),old=previewAI.request;let acknowledge;
 previewAI.request=async(method,p)=>method==='turn/steer'?new Promise(r=>acknowledge=r):old(method,p);
 const result=f.start();await flush();const guidance=steerAI('test-'+seq,'来晚的指导');await flush();
 f.item();await result;acknowledge({turnId:f.turnId});assert.equal(await guidance,false);f.complete('completed');
});
test('一次格式纠正会保留已接受的用户引导，不重复联网',async t=>{
 const f=fixture(t),result=f.start();await flush();await steerAI('test-'+seq,'正文只写两句话');
 f.item({answer:42});await flush();await flush();
 const requests=f.calls.filter(c=>c.method==='turn/start');assert.equal(requests.length,2);assert.match(requests[1].params.input[0].text,/正文只写两句话/);
 f.item();await result;f.complete('completed');
});
