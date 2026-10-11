import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-assistant-api-test-'));
process.env.TONGZHOU_DATA_DIR=dir;
const {installPreview}=await import('../server/preview-routes.mjs');
const {previewAI}=await import('../server/preview-ai.mjs');
test('智能助理完整正式结果不依赖turn-end，仍生成真实可下载文件并保存会话',async t=>{
 const app=express();app.use(express.json());installPreview(app);app.use((e,req,res,next)=>res.status(400).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const originals={connect:previewAI.connect,request:previewAI.request,interrupt:previewAI.interrupt};let sequence=0;
 const phases=[],requests=[],threads=[];
 previewAI.connect=async()=>{previewAI.status.authenticated=true;};
 previewAI.interrupt=async()=>{};
 previewAI.request=async(method,p)=>{
  if(method==='thread/start'){assert.equal(p.config.web_search,'live');threads.push(p);return{thread:{id:'assistant-api-'+(++sequence)}};}
  if(method==='turn/start'){
   assert.match(p.input[0].text,/final_answer/);
   requests.push(p);
   const files=p.outputSchema.properties.files;
   const response=files?{answer:'已整理完成。',files:[{title:'资料整理',format:'md',body:'公开资料整理测试。',columns:[],rows:[],presentation:null}]}:{answer:'同舟纵横的公司介绍正文直接在这里阅读。\n这是对话答案，不是附件。'};
   setTimeout(()=>{
    previewAI.emit('event',{method:'item/started',params:{threadId:p.threadId,item:{type:'webSearch'}}});
    const db=JSON.parse(fs.readFileSync(path.join(dir,'preview/preview.json'),'utf8'));phases.push(db.jobs.at(-1).phase);
    previewAI.emit('event',{method:'item/completed',params:{threadId:p.threadId,item:{type:'agentMessage',phase:'final_answer',text:JSON.stringify(response)}}});
   },10);return{turn:{id:'turn-'+sequence}};
  }throw Error(method);
 };
 t.after(async()=>{previewAI.emit('disconnected',new Error('验收结束'));Object.assign(previewAI,originals);server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const post=async(url,body)=>{const r=await fetch(base+'/api'+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 const s=await post('/preview/sessions',{}),j=await post(`/preview/sessions/${s.id}/tasks`,{message:'整理公开资料并输出Markdown文件'});
 let state,job;for(let i=0;i<100;i++){state=await(await fetch(base+'/api/preview/state')).json();job=state.jobs.find(x=>x.id===j.id);if(job.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(job.status,'completed',job.error);assert.equal(job.phase,'已完成');assert.ok(job.completedAt);assert.equal(job.files.length,1);assert.equal(phases[0],'正在检索公开资料');
 const messages=state.sessions.find(x=>x.id===s.id).messages;assert.equal(messages.length,2);assert.equal(messages[1].text,'已整理完成。');
 const file=await fetch(base+job.files[0].url);assert.equal(file.status,200);assert.match(await file.text(),/公开资料整理测试/);
 // The next ordinary question must not inherit the preceding file instruction.
 const chat=await post(`/preview/sessions/${s.id}/tasks`,{message:'给我一个同舟纵横公司的整体介绍'});
 for(let i=0;i<100;i++){state=await(await fetch(base+'/api/preview/state')).json();job=state.jobs.find(x=>x.id===chat.id);if(job.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(job.status,'completed',job.error);assert.equal(job.files.length,0);assert.match(job.answer,/公司介绍正文/);
 assert.deepEqual(Object.keys(requests.at(-1).outputSchema.properties),['answer']);
 assert.match(requests.at(-1).input[0].text,/本轮为日常对话/);
 assert.doesNotMatch(requests.at(-1).input[0].text,/design\.rationale/);
 assert.equal(fs.readdirSync(path.join(dir,'preview/outputs')).length,1);
 // Follow-up conversion uses the same conversation's substantive answer.
 const exported=await post(`/preview/sessions/${s.id}/tasks`,{message:'把刚才的介绍输出Markdown文件'});
 for(let i=0;i<100;i++){state=await(await fetch(base+'/api/preview/state')).json();job=state.jobs.find(x=>x.id===exported.id);if(job.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(job.status,'completed',job.error);assert.equal(job.files.length,1);
 assert.deepEqual(requests.at(-1).outputSchema.properties.files.items.properties.format.enum,['md']);
 assert.match(requests.at(-1).input[0].text,/公司介绍正文直接在这里阅读/);
 for(const thread of threads){
  assert.match(thread.developerInstructions,/像一位可靠、懂业务、好沟通的同事/);
  assert.match(thread.developerInstructions,/承接当前会话/);
  assert.match(thread.developerInstructions,/正式成果保持专业/);
  assert.match(thread.developerInstructions,/不得把附件正文/);
  assert.match(thread.developerInstructions,/无证据的工程参数/);
 }
});
