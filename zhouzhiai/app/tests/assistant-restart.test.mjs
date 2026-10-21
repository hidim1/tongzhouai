import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverInterruptedTasks} from '../server/assistant-startup.mjs';
import {createAssistant} from '../server/preview-assistant.mjs';
const flush=()=>new Promise(r=>setImmediate(r));
test('重启保留待发送原文并暂停队列，不丢弃排队消息或自动触发AI',()=>{
 const db={sessions:[{id:'s',messages:[{role:'user',text:'历史正文'}],files:[]}],jobs:[{id:'active',sessionId:'s',type:'general',status:'running',message:'正在处理的消息',files:[],checkpoint:{analysisDraft:{answer:'已有草稿'}}},{id:'pending',sessionId:'s',type:'general',status:'queued',message:'尚未发送的原文',fileIds:[],files:[]}],images:[]};
 recoverInterruptedTasks(db);assert.equal(db.jobs[0].status,'failed');assert.equal(db.jobs[0].canResume,true);assert.equal(db.jobs[1].status,'queued');assert.equal(db.jobs[1].message,'尚未发送的原文');assert.equal(db.sessions[0].queuePaused,true);assert.deepEqual(db.sessions[0].messages,[{role:'user',text:'历史正文'}]);
});
test('重启恢复已提问任务，回答后复用同job及证据，不重复问题',async()=>{
 const s={id:'s',messages:[{role:'user',text:'整理口径',jobId:'j'}],files:[]},j={id:'j',sessionId:'s',type:'general',status:'running',message:'整理口径',files:[],fileIds:[],deliveryFormats:[],checkpoint:{stage:'analysis',clarification:{question:'本期还是累计？'},toolReceipts:[{tool:'zhouzhi_calculate',summary:'3',evidenceId:'proof'}]}},db={sessions:[s],jobs:[j],images:[]};
 recoverInterruptedTasks(db);recoverInterruptedTasks(db);assert.equal(j.status,'waiting_user');assert.equal(s.messages.filter(m=>m.role==='assistant').length,1);assert.equal(s.pendingClarification.jobId,'j');let calls=0;
 const api=createAssistant({db,save(){},askAI:async()=>{calls++;return{answer:'按本期处理。'};},steerAI:async()=>false,cancelAI:async()=>{},artifact(){throw Error('不制作文件');},fileContext:()=>[],imageInputs:()=>[]});
 await api.submit('s',{message:'本期'});for(let i=0;i<5;i++)await flush();assert.equal(db.jobs.length,1);assert.equal(j.status,'completed');assert.equal(calls,1);assert.equal(j.checkpoint.toolReceipts[0].evidenceId,'proof');assert.equal(j.checkpoint.clarification,undefined);recoverInterruptedTasks(db);assert.equal(j.status,'completed');
});
