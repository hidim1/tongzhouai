import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssistant} from '../server/preview-assistant.mjs';
import {recoveryInfo} from '../server/assistant-recovery.mjs';
import {requestClarification} from '../server/assistant-clarify.mjs';
import {taskPlan,runTaskLoop} from '../server/assistant-workflow.mjs';
const flush=()=>new Promise(r=>setImmediate(r));
const settled=async()=>{for(let i=0;i<5;i++)await flush();};
const verdict=status=>({ready:status==='passed',checks:[{id:'request',status,reason:status==='passed'?'要求已覆盖':'缺少业务口径'}]});
function fixture(askAI){
 const s={id:'s',messages:[],files:[]},db={sessions:[s],jobs:[]},interrupts=[];
 const api=createAssistant({db,save(){},askAI:(...args)=>askAI(...args),steerAI:async()=>false,cancelAI:async id=>{interrupts.push(id);},artifact:async()=>{throw Error('本测试不应生成文件');},fileContext:()=>[],imageInputs:()=>[]});
 return {s,db,api,interrupts};
}
test('工具追问立即发布并停止，不依赖模型最终回答；同job回答重入幂等',async()=>{
 let analyses=0,blocked;const f=fixture(async(_id,_prompt,_schema,_images,_progress,_effort,{tools})=>{
  analyses++;
  if(analyses===1){await tools.execute('zhouzhi_calculate',{expression:'1+2'},'calculated');await tools.execute('zhouzhi_clarify',{question:'需要累计值还是本期值？',options:[]},'ask');blocked=await tools.execute('zhouzhi_calculate',{expression:'3+4'},'after-ask');return new Promise(()=>{});}
  return {answer:'按本期值整理完成。'};
 });
 const first=await f.api.submit('s',{message:'整理汇总口径',requestId:'first_0001'});await settled();const j=f.db.jobs[0];
 assert.equal(j.status,'waiting_user');assert.equal(j.completedAt,undefined);assert.equal(j.needsInput,true);assert.equal(blocked.success,false);assert.equal(f.s.messages.at(-1).text,'需要累计值还是本期值？');assert.equal(f.interrupts.length,1);assert.equal(j.checkpoint.toolReceipts.filter(r=>r.tool==='zhouzhi_calculate').length,1);
 const answer={message:'本期值',requestId:'reply_0001'};const results=await Promise.all([f.api.submit('s',answer),f.api.submit('s',answer)]);await settled();
 assert.equal(f.db.jobs.length,1);assert.ok(results.every(r=>r.job.id===first.job.id&&r.receipt==='resumed'));assert.equal(j.status,'completed');assert.equal(analyses,2);assert.equal(j.checkpoint.clarification,undefined);assert.equal(j.checkpoint.clarificationHistory[0].answer,'本期值');assert.equal(f.s.messages.filter(m=>m.role==='user').length,2);assert.equal(j.checkpoint.toolReceipts.filter(r=>r.tool==='zhouzhi_calculate').length,1);
});
test('修复循环中追问立即终止审核，允许保留已完成成果后再问',async()=>{
 let analyses=0,audits=0;const f=fixture(async(_id,_prompt,schema,_images,_progress,_effort,{tools})=>{
  if(schema.properties.ready){audits++;return verdict(analyses<3?'missing':'passed');}
  analyses++;
  if(analyses===1){f.db.jobs[0].files.push({id:'prior-output',name:'已完成部分.md'});return{answer:'完成第一部分，待补充第二部分。'};}
  if(analyses===2){await tools.execute('zhouzhi_clarify',{question:'第二部分按哪个期间？',options:[]},'repair-question');return {answer:'不能交付这个猜测答案'};}
  return {answer:'按本月补齐第二部分。'};
 });
 await f.api.submit('s',{message:'先核对资料，再汇总两部分'});await settled();const j=f.db.jobs[0];
 assert.equal(j.status,'waiting_user');assert.equal(analyses,2);assert.equal(audits,1);assert.equal(j.files[0].id,'prior-output');assert.equal(f.s.messages.at(-1).text,'第二部分按哪个期间？');
 await f.api.submit('s',{message:'本月'});await settled();assert.equal(j.status,'completed');assert.equal(audits,2);assert.equal(analyses,3);assert.equal(j.files.length,1);assert.equal(f.db.jobs.length,1);
});
test('恢复的定向修复若提出问题，不进入下一次审核',async()=>{
 const j={id:'j',message:'先核对，再整理',files:[],fileIds:[],status:'running',checkpoint:{analysisDraft:{answer:'之前草稿'},pendingRepair:{instructions:'继续修复'}}};taskPlan(j);let audits=0;
 await assert.rejects(runTaskLoop({job:j,tools:{definitions:[]},save(){},cancelled:()=>false,analyze:async()=>{requestClarification(j,{question:'需要哪个版本？'});return{answer:'请选择版本'};},askAI:async()=>{audits++;return verdict('passed');}}),e=>e.code==='TASK_NEEDS_INPUT');assert.equal(audits,0);
});
test('等待问题阻止队列越过，原任务优先恢复，取消等待不误跑下一轮',async()=>{
 let release,calls=0;const f=fixture(async(_id,_prompt,_schema,_images,_progress,_effort,{tools})=>{calls++;if(calls===1){await new Promise(r=>release=r);await tools.execute('zhouzhi_clarify',{question:'使用哪种口径？',options:[]},'ask');return{answer:'问题'};}return{answer:'完成'};});
 await f.api.submit('s',{message:'整理口径'});await f.api.submit('s',{message:'介绍公司'});release();await settled();assert.equal(calls,1);assert.throws(()=>f.api.resume('s'),/先回答/);
 const waiting=f.db.jobs[0];await f.api.submit('s',{message:'本期'});await settled();assert.equal(f.db.jobs.length,2);assert.equal(waiting.status,'completed');assert.equal(f.db.jobs[1].status,'completed');assert.equal(calls,3);
 const g=fixture(async(_id,_prompt,_schema,_images,_progress,_effort,{tools})=>{await tools.execute('zhouzhi_clarify',{question:'哪个团队？',options:[]},'ask');return{answer:'问题'};});
 await g.api.submit('s',{message:'整理通知'});await settled();await g.api.stop(g.db.jobs[0].id);assert.equal(g.db.jobs[0].status,'cancelled');assert.equal(g.s.pendingClarification,undefined);assert.equal(g.s.queuePaused,true);
});
test('明确新任务不继承旧问题；长回答不因长度被当成新任务',async()=>{
 let calls=0;const f=fixture(async(_id,prompt,_schema,_images,_progress,_effort,{tools})=>{calls++;if(calls===1){await tools.execute('zhouzhi_clarify',{question:'请补充详细口径？',options:[]},'ask');return{answer:'问题'};}assert.match(prompt,/请补充详细口径/);return{answer:'按详细口径完成'};});
 await f.api.submit('s',{message:'整理口径'});await settled();await f.api.submit('s',{message:'这是明确口径。'.repeat(100)});await settled();assert.equal(f.db.jobs.length,1);assert.equal(f.db.jobs[0].status,'completed');
 let n=0;const g=fixture(async(_id,prompt,_schema,_images,_progress,_effort,{tools})=>{n++;if(n===1){await tools.execute('zhouzhi_clarify',{question:'需要哪个团队？',options:[]},'ask');return{answer:'问题'};}assert.match(prompt,/任务：新任务/);return{answer:'新的普通答复'};});
 await g.api.submit('s',{message:'整理通知'});await settled();await g.api.submit('s',{message:'新任务，介绍一个术语'});await settled();assert.equal(g.db.jobs[0].status,'cancelled');assert.equal(g.db.jobs.length,2);assert.equal(g.db.jobs[1].status,'completed');assert.equal(g.s.pendingClarification,undefined);
});
test('系统空白和修复耗尽是可恢复失败，不是等待用户补充',async()=>{
 for(const code of ['AI_EMPTY_RESPONSE','AI_FINALIZATION_TIMEOUT','AI_RECOVERY_FAILED','TASK_REPAIR_EXHAUSTED','TASK_NO_PROGRESS'])assert.deepEqual(recoveryInfo({code,message:'补充失败或取消字样也不改变类型'}),{kind:'recoverable',canResume:true,code});
 const f=fixture(async()=>{throw Object.assign(Error('响应为空'),{code:'AI_EMPTY_RESPONSE'});});await f.api.submit('s',{message:'你好'});await settled();const j=f.db.jobs[0];assert.equal(j.status,'failed');assert.equal(j.needsInput,false);assert.equal(j.canResume,true);assert.equal(j.errorCode,'AI_EMPTY_RESPONSE');assert.equal(f.s.pendingClarification,undefined);
});
test('原件选择不明确时不调用模型；序号回答保留来源范围并继续原任务',async()=>{
 let calls=0;const f=fixture(async(_id,_prompt,schema)=>{calls++;if(schema.properties.ready)return verdict('passed');f.db.jobs[0].files.push({id:'edited-b',name:'已修改.md',parentId:'b'});return{answer:'已修改第二份文件。',files:[]};});
 f.s.files.push({id:'a',name:'旧通知.md',text:'旧内容'},{id:'b',name:'新通知.md',text:'新内容'});
 await f.api.submit('s',{message:'修改Markdown文件，替换标题，保留其余内容'});await settled();assert.equal(calls,0);const j=f.db.jobs[0];assert.equal(j.status,'waiting_user');assert.match(j.answer,/修改哪一份/);
 await f.api.submit('s',{message:'2'});await settled();assert.equal(j.status,'completed');assert.deepEqual(j.taskContract.sourceFileIds,['b']);assert.equal(j.taskContract.sourceSelectionRequired,false);assert.equal(f.db.jobs.length,1);
});
test('已有执行记录的续跑排队任务不能改写消息和旧交付授权',()=>{
 const f=fixture(async()=>({answer:'不运行'}));const j={id:'resume-j',sessionId:'s',type:'general',status:'queued',message:'原任务',files:[],fileIds:[],resumeRequested:true,checkpoint:{analysisDraft:{answer:'保留草稿'}}};f.db.jobs.push(j);f.s.queuePaused=true;
 assert.throws(()=>f.api.edit('s',j.id,'替换为另一任务'),/续跑任务/);assert.equal(j.message,'原任务');assert.equal(j.checkpoint.analysisDraft.answer,'保留草稿');
});
test('迟到资料读取不能写入新attempt的覆盖或证据记录',async()=>{
 const {createAssistantTools}=await import('../server/assistant-tools.mjs');let active=true,resolve;
 const j={id:'late',status:'running',message:'读取文件',files:[],fileIds:['a'],checkpoint:{}},session={files:[{id:'a',name:'资料.txt',path:'/test/source.txt'}],messages:[]};
 const tools=createAssistantTools({job:j,session,save(){},isActive:()=>active,extractDocument:()=>new Promise(r=>resolve=r)});
 const pending=tools.execute('zhouzhi_read_file',{id:'a',offset:0,limit:100},'old-read');await flush();active=false;resolve({text:'迟到的旧attempt资料'});const result=await pending;
 assert.equal(result.success,false);assert.equal(j.checkpoint.readCoverage,undefined);assert.equal(j.checkpoint.toolReceipts.length,0);
});
test('追问清理旧turn尚未结束时切换新任务，清理后队列会继续',async()=>{
 const s={id:'s',files:[],messages:[]},db={sessions:[s],jobs:[]};let releasePause,calls=0;
 const api=createAssistant({db,save(){},askAI:async(_id,_prompt,_schema,_images,_progress,_effort,{tools})=>{calls++;if(calls===1){await tools.execute('zhouzhi_clarify',{question:'哪个口径？',options:[]},'ask');return new Promise(()=>{});}return{answer:'新任务完成'};},pauseAI:()=>new Promise(r=>releasePause=r),cancelAI:async()=>{},steerAI:async()=>false,artifact(){throw Error('不制作');},fileContext:()=>[],imageInputs:()=>[]});
 await api.submit('s',{message:'整理口径'});await settled();assert.equal(db.jobs[0].status,'waiting_user');await api.submit('s',{message:'新任务，介绍术语'});assert.equal(db.jobs[1].status,'queued');releasePause();await settled();assert.equal(db.jobs[1].status,'completed');assert.equal(calls,2);
});
