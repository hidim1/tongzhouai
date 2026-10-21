// Exercise the real assistant lifecycle and AI bridge together. Only the native
// transport is stubbed: no model, network, credentials or production data used.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-ai-integration-'));
process.env.TONGZHOU_DATA_DIR=dir;
const {askAI,previewAI,pauseAI,cancelAI,steerAI}=await import('../server/preview-ai.mjs');
const {createAssistant}=await import('../server/preview-assistant.mjs');
after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<50;i++){if(predicate())return;await flush();}assert.ok(predicate(),'expected lifecycle state did not arrive');}
let sequence=0;
function harness(t,{holdInterrupt=false,steerFails=false}={}){
 const original={connect:previewAI.connect,request:previewAI.request,interrupt:previewAI.interrupt,respond:previewAI.respond};
 const prefix='integration-'+(++sequence),threadId=prefix+'-thread',turns=[],calls=[],responses=[];let releaseInterrupt;
 const session={id:prefix,files:[],messages:[]},db={sessions:[session],jobs:[]};
 previewAI.connect=async()=>{previewAI.status.authenticated=true;};
 previewAI.respond=(id,value)=>responses.push({id,value});
 previewAI.request=async(method,params)=>{
  calls.push({method,params});
  if(method==='thread/start'||method==='thread/resume')return{thread:{id:threadId}};
  if(method==='turn/start'){const id=prefix+'-turn-'+(turns.length+1);turns.push({id,params});return{turn:{id}};}
  if(method==='turn/steer'){if(steerFails)throw Error('transport rejected steer');return{turnId:params.expectedTurnId};}
  throw Error('unexpected transport method '+method);
 };
 previewAI.interrupt=async(thread,turn)=>{calls.push({method:'interrupt',thread,turn});if(holdInterrupt)await new Promise(resolve=>releaseInterrupt=resolve);};
 t.after(()=>Object.assign(previewAI,original));
 const assistant=createAssistant({db,save(){},askAI,pauseAI,cancelAI,steerAI,fileContext:()=>[],imageInputs:()=>[],artifact(){throw Error('this test must not create files');}});
 const emit=(method,params,turnId=turns.at(-1)?.id)=>previewAI.emit('event',{method,params:{threadId,turnId,...params}});
 const final=(answer,turnId=turns.at(-1)?.id)=>{
  emit('item/completed',{item:{type:'agentMessage',phase:'final_answer',text:JSON.stringify({answer,sources:[]})}},turnId);
  emit('turn/completed',{turn:{id:turnId,status:'completed'}},turnId);
 };
 const clarify=()=>previewAI.emit('approval',{id:prefix+'-question',method:'item/tool/call',params:{threadId,turnId:turns.at(-1).id,tool:'zhouzhi_clarify',callId:prefix+'-call',arguments:{question:'这段介绍是给哪类读者看的？',options:['采购负责人','技术团队']}}});
 return{assistant,session,db,turns,calls,responses,emit,final,clarify,release:()=>releaseInterrupt?.()};
}

test('真实AI桥接：工具追问立即暂停，无模型收尾也能回答后同job续作',async t=>{
 const h=harness(t);await h.assistant.submit(h.session.id,{message:'写两句话介绍我们的业务'});await until(()=>h.turns.length===1);
 const job=h.db.jobs[0],oldTurn=h.turns[0].id;h.clarify();await until(()=>job.status==='waiting_user');
 assert.equal(job.needsInput,true);assert.equal(h.session.messages.filter(m=>m.role==='assistant').length,1);
 await until(()=>h.calls.some(c=>c.method==='interrupt'));await flush();
 await h.assistant.submit(h.session.id,{message:'给采购负责人'});await until(()=>h.turns.length===2);
 assert.equal(h.db.jobs.length,1);assert.equal(h.db.jobs[0].id,job.id);
 h.final('旧回合不能交付',oldTurn);assert.notEqual(job.status,'completed');
 h.final('为采购负责人整理的两句话。');await until(()=>job.status==='completed');
 assert.equal(job.answer,'为采购负责人整理的两句话。');assert.equal(job.errorCode,undefined);
 assert.equal(h.calls.filter(c=>c.method==='thread/resume').length,1);assert.equal(h.calls.filter(c=>c.method==='interrupt').length,1);
});

test('真实AI桥接：用户在暂停清理期间立即回答，旧attempt结束后仅启动一次续作',async t=>{
 const h=harness(t,{holdInterrupt:true});await h.assistant.submit(h.session.id,{message:'写两句话介绍我们的业务'});await until(()=>h.turns.length===1);
 const job=h.db.jobs[0];h.clarify();await until(()=>job.status==='waiting_user');await until(()=>h.calls.some(c=>c.method==='interrupt'));
 await h.assistant.submit(h.session.id,{message:'给采购负责人'});assert.equal(job.status,'queued');assert.equal(h.turns.length,1);
 h.release();await until(()=>h.turns.length===2);h.final('继续后的介绍。');await until(()=>job.status==='completed');
 assert.equal(h.db.jobs.length,1);assert.equal(h.turns.length,2);assert.equal(job.answer,'继续后的介绍。');
});

test('真实AI桥接：空白恢复失败进入可重试系统故障，不进入待补充',async t=>{
 const h=harness(t,{steerFails:true});await h.assistant.submit(h.session.id,{message:'介绍我们的业务'});await until(()=>h.turns.length===1);
 h.emit('item/completed',{item:{type:'agentMessage',text:''}});const job=h.db.jobs[0];await until(()=>job.status==='failed');
 assert.equal(job.errorCode,'AI_RECOVERY_FAILED');assert.equal(job.canResume,true);assert.equal(job.needsInput,false);assert.equal(h.session.pendingClarification,undefined);
 await flush();h.assistant.continue(job.id);await until(()=>h.turns.length===2);h.final('恢复后的有效介绍。');await until(()=>job.status==='completed');
 assert.equal(h.db.jobs.length,1);assert.equal(job.answer,'恢复后的有效介绍。');
});
