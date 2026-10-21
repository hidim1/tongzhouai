import test from 'node:test';
import assert from 'node:assert/strict';
import {recentHistory,historyPage} from '../server/assistant-context.mjs';
import {versionCatalog} from '../server/assistant-versions.mjs';
import {recoverInterruptedTasks} from '../server/assistant-startup.mjs';
import {createAssistant} from '../server/preview-assistant.mjs';
import {taskContract} from '../server/assistant-task-contract.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<8;i++)await flush();}
function harness(jobs=[],overrides={}){
  const s={id:'s',files:[],messages:[]},db={sessions:[s],jobs};
  const assistant=createAssistant({db,save(){},askAI:async()=>({answer:'已按新范围回答。'}),steerAI:async()=>true,cancelAI:async()=>{},artifact(){throw Error('测试不应创建文件');},fileContext:()=>[],imageInputs:()=>[],...overrides});
  return {s,db,assistant};
}

test('超大历史消息的摘录保留首尾和准确索引，完整原文仍可按历史读取',()=>{
  const messages=[{role:'user',text:'本项目不对外发布'},{role:'assistant',text:'首段：'+('长资料\n"'.repeat(30000))+'末段。'}];
  const snapshot=recentHistory(messages,1200),item=snapshot.items.at(-1);
  assert.equal(item.historyIndex,1);assert.equal(item.truncated,true);assert.equal(snapshot.olderHistoryAvailable,true);
  assert.match(item.text,/首段/);assert.match(item.text,/末段/);assert.ok(JSON.stringify(snapshot.items).length<=1200);
  assert.equal(historyPage(messages,{offset:item.historyIndex,limit:1}).items[0].text,messages[1].text);
  assert.deepEqual(recentHistory(messages,0).items,[]);
});

test('版本目录不泄露未授权父节点，不把分支/同名文件猜成唯一最新',()=>{
  const files=[{id:'a',name:'报告.docx',parentId:'secret-parent',createdAt:'2026-10-01'},
    {id:'b',name:'报告.docx',parentId:'a'},{id:'c',name:'报告.docx',parentId:'a'},
    {id:'other',name:'报告.docx',createdAt:'2026-10-21'},
    {id:'cycle-a',name:'循环A.docx',parentId:'cycle-b'},{id:'cycle-b',name:'循环B.docx',parentId:'cycle-a'}];
  const rows=versionCatalog(files);
  assert.equal(JSON.stringify(rows).includes('secret-parent'),false);
  assert.equal(rows.find(r=>r.id==='a').parentId,null);
  assert.deepEqual(rows.find(r=>r.id==='a').supersededBy,['b','c']);
  for(const row of rows)assert.equal(row.needsSelection,true,row.id);
  assert.equal(rows.find(r=>r.id==='cycle-a').isLatestCandidate,false);
});

test('恢复旧版待确认任务幂等，不能误恢复已经完成的同文任务',()=>{
  const old={id:'old',sessionId:'s',type:'general',status:'completed',message:'整理资料',checkpoint:{stage:'clarification',clarification:{question:'本期还是累计？'}}};
  const done={...old,id:'done',checkpoint:{stage:'completed'}};
  const s={id:'s',messages:[],pendingClarification:{request:old.message,question:'本期还是累计？'}};
  const db={sessions:[s],jobs:[old,done],images:[]};recoverInterruptedTasks(db);recoverInterruptedTasks(db);
  assert.equal(old.status,'waiting_user');assert.equal(done.status,'completed');
  assert.equal(s.messages.length,1);assert.equal(s.pendingClarification.jobId,'old');assert.equal(s.queuePaused,true);
});

test('旧版无jobId的同文待确认记录只恢复最近一轮，不误选历史已回答的问题',()=>{
  const make=id=>({id,sessionId:'s',type:'general',status:'completed',message:'整理Word通知',checkpoint:{stage:'clarification',clarification:{question:'通知给谁？'}}});
  const old=make('old'),latest=make('latest');
  const s={id:'s',messages:[],pendingClarification:{request:latest.message,question:'通知给谁？'}};
  recoverInterruptedTasks({sessions:[s],jobs:[old,latest],images:[]});
  assert.equal(old.status,'completed');assert.equal(latest.status,'waiting_user');assert.equal(s.pendingClarification.jobId,'latest');
});

test('待确认原任务收到撤销文件授权后，新执行不再暴露文件交付权限',async()=>{
  const contract=taskContract('生成Word通知'),j={id:'j',sessionId:'s',type:'general',status:'waiting_user',message:'生成Word通知',files:[],fileIds:[],deliveryFormats:['docx'],taskContract:contract,checkpoint:{stage:'clarification',clarification:{question:'通知给谁？'}}};
  const seen=[],{db,s,assistant}=harness([j],{askAI:async(_id,_prompt,_schema,_images,_unused,_effort,options)=>{seen.push(options);return{answer:'只说明通知要点，不生成文件。'};}});
  s.queuePaused=true;s.pendingClarification={jobId:j.id,request:j.message,question:'通知给谁？'};
  await assistant.submit(s.id,{message:'不要生成文件，只分析通知应该包含什么。'});await settle();
  assert.equal(j.status,'cancelled');assert.equal(db.jobs.length,2);assert.deepEqual(db.jobs[1].deliveryFormats,[]);
  assert.equal(db.jobs[1].status,'completed');assert.match(seen[0].deliveryInstructions,/本轮为日常对话/);
});

test('运行中撤销文件权限不是普通steer，旧任务与写工具必须停止',async()=>{
  let release,steered=0,cancelled=0,first=true;
  const blocked=new Promise(resolve=>{release=resolve;});
  const {db,s,assistant}=harness([],{askAI:async()=>{if(first){first=false;return blocked;}return{answer:'仅分析，不制作文件。'};},steerAI:async()=>{steered++;return true;},cancelAI:async()=>{cancelled++;release({answer:'旧任务已停止。',files:[]});}});
  try{
    await assistant.submit(s.id,{message:'生成Word通知'});await flush();
    const original=db.jobs[0];assert.equal(original.status,'running');
    await assistant.submit(s.id,{message:'不要生成任何文件，只在对话里分析。',mode:'steer'});await settle();
    assert.equal(steered,0,'撤销不应只给模型一条建议');assert.ok(cancelled>0);
    assert.equal(original.status,'cancelled');assert.deepEqual(db.jobs.at(-1).deliveryFormats,[]);
  }finally{release({answer:'停止。',files:[]});await settle();}
});
