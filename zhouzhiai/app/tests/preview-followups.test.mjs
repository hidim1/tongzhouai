import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssistant} from '../server/preview-assistant.mjs';
const flush=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const db={sessions:[{id:'s1',messages:[],files:[],name:'新对话'},{id:'s2',messages:[],files:[],name:'新对话'}],jobs:[]},calls=[],steers=[];
 const api=createAssistant({db,save(){},askAI(id,text,schema,images,progress,effort,options){return new Promise((resolve,reject)=>calls.push({id,text,schema,options,resolve,reject}));},async steerAI(id,text){steers.push({id,text});return true;},async cancelAI(id){calls.find(c=>c.id===id)?.reject(Error('停止'));},async artifact(){return{id:'f',name:'output.md',url:'/file'};},fileContext:files=>files,imageInputs:()=>[]});
 return {db,calls,steers,api,finish:async(index,answer='正文')=>{calls[index].resolve({answer});await flush();}};
}
test('生成中回车排队，编辑删除仅限本会话；队列不进入当前任务上下文',async()=>{
 const f=fixture(),first=await f.api.submit('s1',{message:'介绍舟知'});
 const second=await f.api.submit('s1',{message:'然后回答第二个问题'});
 const third=await f.api.submit('s1',{message:'要删除的下一轮'});
 assert.equal(first.receipt,'started');assert.equal(second.receipt,'queued');assert.equal(f.calls.length,1);
 assert.doesNotMatch(f.calls[0].text,/第二个问题|要删除的/);assert.equal(f.db.sessions[0].messages.length,1);
 assert.throws(()=>f.api.edit('s2',second.job.id,'越界'),/不能编辑/);
 assert.throws(()=>f.api.remove('s2',third.job.id),/不能移出/);
 f.api.edit('s1',second.job.id,'改过的第二个问题');f.api.remove('s1',third.job.id);
 await f.finish(0,'第一轮正文');assert.equal(f.calls.length,2);assert.match(f.calls[1].text,/第一轮正文/);assert.match(f.calls[1].text,/改过的第二个问题/);
 assert.doesNotMatch(f.calls[1].text,/要删除的/);await f.finish(1);assert.equal(f.calls.length,2);
});
test('显式引导确认后记录补充，不启动第二轮；重复请求只接收一次',async()=>{
 const f=fixture(),first=await f.api.submit('s1',{message:'介绍舟知',requestId:'request_001'});
 const replay=await f.api.submit('s1',{message:'介绍舟知',requestId:'request_001'});assert.equal(replay.job.id,first.job.id);
 const guidance={message:'只说两句话',mode:'steer',requestId:'guidance_001'};
 const [a,b]=await Promise.all([f.api.submit('s1',guidance),f.api.submit('s1',guidance)]);
 assert.equal(a.receipt,'steered');assert.equal(b.receipt,'steered');assert.equal(f.steers.length,1);assert.equal(f.calls.length,1);
 assert.equal(f.db.sessions[0].messages.at(-1).delivery,'steer');assert.equal(f.db.jobs.find(j=>j.id===first.job.id).guidance.length,1);
 await f.finish(0);assert.equal(f.calls.length,1);
});
test('文件格式变化、新附件及交付阶段的补充转下一轮，不扩大当前结构',async()=>{
 for(const kind of ['format','attachment','delivery']){
  const f=fixture(),first=await f.api.submit('s1',{message:'介绍舟知'});
  if(kind==='attachment')f.db.sessions[0].files.push({id:'new-file',name:'新资料'});
  if(kind==='delivery')f.db.jobs.find(j=>j.id===first.job.id).deliveryStarted=true;
  const next=await f.api.submit('s1',{message:kind==='format'?'把它输出Markdown文件':'再简短一点',mode:'steer'});
  assert.equal(next.receipt,'queued');assert.equal(f.steers.length,0);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].schema.properties.files,undefined);await f.finish(0);
  if(kind==='format'){assert.deepEqual(f.calls[1].schema.properties.files.items.properties.format.enum,['md']);f.calls[1].resolve({answer:'做好了',files:[]});await flush();}else await f.finish(1);
 }
});
test('引导回执与回答完成竞态不丢消息；拒绝接收不会假显示成功',async()=>{
 const f=fixture();await f.api.submit('s1',{message:'介绍舟知'});
 // The native acknowledgement arrives after final delivery, so process next turn.
 const second=await f.api.submit('s1',{message:'简短一点',mode:'steer'});assert.equal(second.receipt,'steered');await f.finish(0);
 const next=await f.api.submit('s1',{message:'后续问题',mode:'steer'});assert.equal(next.receipt,'started');await f.finish(1);
 const db={sessions:[{id:'s',messages:[],files:[]}],jobs:[]};let resolve;
 const api=createAssistant({db,save(){},askAI:()=>new Promise(r=>resolve=r),steerAI:async()=>{throw Error('断线');},cancelAI:async()=>{},artifact:async()=>{},fileContext:x=>x,imageInputs:()=>[]});
 await api.submit('s',{message:'第一问'});await assert.rejects(api.submit('s',{message:'补充',mode:'steer'}),/未确认接收/);
 assert.equal(db.sessions[0].messages.length,1);assert.equal(db.jobs.length,1);resolve({answer:'正文'});await flush();
});
test('停止或失败会暂停队列，用户明确继续后才运行，不自动消耗后续任务',async()=>{
 for(const type of ['stop','fail']){
  const f=fixture(),first=await f.api.submit('s1',{message:'第一问'});await f.api.submit('s1',{message:'第二问'});
  if(type==='stop')await f.api.stop(first.job.id);else f.calls[0].reject(Error('验收失败'));
  await flush();assert.equal(f.calls.length,1);assert.equal(f.db.sessions[0].queuePaused,true);
  f.api.resume('s1');assert.equal(f.calls.length,2);await f.finish(1);
 }
});
test('并发请求最多一个活跃任务，队列有界、非法参数和不存在会话被拒绝',async()=>{
 const f=fixture();await Promise.all(Array.from({length:11},(_,i)=>f.api.submit('s1',{message:'问题'+i,requestId:'request_'+String(i).padStart(3,'0')})));
 assert.equal(f.calls.length,1);assert.equal(f.db.jobs.filter(j=>j.status==='queued').length,10);
 await assert.rejects(f.api.submit('s1',{message:'超限'}),/最多10条/);
 await assert.rejects(f.api.submit('missing',{message:'越界'}),/不存在/);
 await assert.rejects(f.api.submit('s2',{message:' ',mode:'queue'}),/请输入/);
 await assert.rejects(f.api.submit('s2',{message:'普通',mode:'interrupt'}),/无效/);
 for(let i=0;i<11;i++)await f.finish(i);
});
