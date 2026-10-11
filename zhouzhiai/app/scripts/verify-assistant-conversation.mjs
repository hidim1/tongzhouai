// Real conversational acceptance using synthetic facts in an isolated workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import mammoth from 'mammoth';
import {DATA} from '../server/config.mjs';
assert.ok(DATA.startsWith('/tmp/zhouzhi-conversation-canary-'),'仅允许独立临时验收目录');
const {installPreview}=await import('../server/preview-routes.mjs');
const {previewAI}=await import('../server/preview-ai.mjs');
const app=express();app.use(express.json());installPreview(app);
app.use((e,req,res,next)=>res.status(400).json({error:e.message}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`,started=Date.now(),checks=[];
const post=async(url,body)=>{
 const r=await fetch(base+'/api/preview'+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal(r.status,200);return r.json();
};
try {
 const session=await post('/sessions',{});
 async function run(message) {
  const job=await post(`/sessions/${session.id}/tasks`,{message});
  const deadline=Date.now()+15*60*1000;let lastPhase='';
  while(Date.now()<deadline){
   const state=await(await fetch(base+'/api/preview/state')).json(),j=state.jobs.find(x=>x.id===job.id);
   if(lastPhase!==j.phase){lastPhase=j.phase;console.log(JSON.stringify({phase:j.phase,elapsedSeconds:Math.round((Date.now()-started)/1000)}));}
   if(j.status!=='running'){assert.equal(j.status,'completed',j.error);return j;}
   await new Promise(r=>setTimeout(r,1000));
  }
  await post(`/jobs/${job.id}/cancel`,{});throw Error('独立验收等待结束，已停止该验收任务');
 }
 const plain=j=>{
  assert.equal(j.files.length,0);
  assert.doesNotMatch(j.answer,/针对您的需求|以下从几个方面|综上所述|感谢您的提问|^\s*#{1,3}\s|\n\s*\d+[、.)]/m);
 };
 const intro=await run('已知事实：舟知是全量工作助手。智能工作助理做日常资料和文档工作，膜预算平台做膜设备项目方案、清单和预算；两条线并行，共享AI能力。舟知主要帮我们做什么？只用这些事实，不联网。');
 plain(intro);assert.match(intro.answer,/日常|资料|文档/);assert.match(intro.answer,/膜预算|膜设备/);assert.ok(intro.answer.length<=220);
 checks.push({case:'short-natural-reply',answer:intro.answer,files:0});
 const follow=await run('所以一定要先用前一个，再用后一个，是吗？不联网。');
 plain(follow);assert.match(follow.answer,/不用|不必|不需要|不是|不一定|没有|并行|可以分别/);assert.ok(follow.answer.length<=200);
 checks.push({case:'context-and-correction',answer:follow.answer,files:0});
 const missing=await run('我们现在想核对一套膜设备的详细预算，但是没有清单和采购单价，能直接告诉我准确金额吗？不联网。');
 plain(missing);assert.match(missing.answer,/清单|单价/);assert.doesNotMatch(missing.answer,/\d[\d,.]*\s*(?:万元|元|万)/);assert.ok(missing.answer.length<=300);
 checks.push({case:'uncertainty-without-fabricated-price',answer:missing.answer,files:0});
 const file=await run('帮我生成一份正式Word通知：周一由设计团队整理图纸，周三由运营管理团队更新采购价目表。只用这些事实，日期保留周一、周三，不虚构完成情况，不联网。');
 assert.equal(file.files.length,1);assert.match(file.files[0].name,/\.docx$/);
 const download=await fetch(base+file.files[0].url);assert.equal(download.status,200);
 const bytes=Buffer.from(await download.arrayBuffer()),document=(await mammoth.extractRawText({buffer:bytes})).value;
 for(const pattern of [/周一/,/设计团队/,/图纸/,/周三/,/运营管理团队/,/采购价目表/])assert.match(document,pattern);
 assert.doesNotMatch(document,/搞定啦|嗨|哈哈|已经全部完成|均已完成/);
 checks.push({case:'formal-word-with-factual-content',answer:file.answer,files:1,document});
 const again=await run('那周三谁负责？不联网。');
 plain(again);assert.match(again.answer,/运营管理团队/);assert.ok(again.answer.length<=120);
 checks.push({case:'chat-after-document',answer:again.answer,files:0});
 const evidence={ok:true,at:new Date().toISOString(),elapsedSeconds:Math.round((Date.now()-started)/1000),checks};
 fs.writeFileSync(DATA+'/conversation-acceptance.json',JSON.stringify(evidence,null,2),{mode:0o600});
 console.log(JSON.stringify({ok:true,elapsedSeconds:evidence.elapsedSeconds,cases:checks.map(c=>({case:c.case,files:c.files}))}));
} finally {
 previewAI.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
