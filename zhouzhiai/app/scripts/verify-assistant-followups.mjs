// Actual steering/queue acceptance, only in a synthetic isolated workspace.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import express from 'express';
import {DATA} from '../server/config.mjs';
assert.ok(DATA.startsWith('/tmp/zhouzhi-chat-interaction-canary-'),'仅允许独立验收目录');
const {installPreview}=await import('../server/preview-routes.mjs');
const {previewAI}=await import('../server/preview-ai.mjs');
const app=express();app.use(express.json());installPreview(app);app.use((error,req,res,next)=>res.status(400).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/preview`,start=Date.now();
const original=previewAI.request;let starts=0;
previewAI.request=async function(method,...args){const result=await original.call(this,method,...args);if(method==='turn/start')starts++;return result;};
async function send(path,body,method='POST'){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,200,data.error);return data;}
async function state(){return(await fetch(base+'/state')).json();}
async function wait(check,label){const deadline=Date.now()+15*60*1000;let phase='';while(Date.now()<deadline){const s=await state(),running=s.jobs.find(j=>j.status==='running');if(running?.phase&&running.phase!==phase){phase=running.phase;console.log(JSON.stringify({check:label,phase,seconds:Math.round((Date.now()-start)/1000)}));}if(await check(s))return s;await new Promise(r=>setTimeout(r,150));}throw Error('独立验收未在观察窗口完成');}
try{
 const s=await send('/sessions',{});
 const first=await send(`/sessions/${s.id}/tasks`,{message:'不联网，不生成文件。请写一份较完整的内部资料准备说明，介绍设计图纸、全量物料库、计算依据、招投标模板和采购价目表分别如何准备及配合。不要虚构公司已有数据。',requestId:'live_initial_001'});
 await wait(()=>starts>0,'native-turn-start');
 const guidance=await send(`/sessions/${s.id}/tasks`,{mode:'steer',message:'补充本轮：缩短答复，只保留两个自然段，不要标题、列表或文件。第一段必须写“设计团队提供物料库”，第二段必须写“运营管理团队更新采购价格”。这两句是本轮要求，不要虚构完成状态。',requestId:'live_guide_001'});
 assert.equal(guidance.receipt,'steered',guidance.notice);
 const next=await send(`/sessions/${s.id}/tasks`,{message:'不联网，不生成文件。把刚才的两个团队分工概括成一句话。',requestId:'live_queue_001'});assert.equal(next.receipt,'queued',next.notice);
 const final=await wait(s=>s.jobs.filter(j=>[first.id,next.id].includes(j.id)).every(j=>j.status!=='running'&&j.status!=='queued'),'steer-and-queue');
 const a=final.jobs.find(j=>j.id===first.id),b=final.jobs.find(j=>j.id===next.id);
 assert.equal(a.status,'completed',a.error);assert.equal(b.status,'completed',b.error);
 assert.match(a.answer,/设计团队提供物料库/);assert.match(a.answer,/运营管理团队更新采购价格/);
 assert.equal(a.files.length,0);assert.equal(b.files.length,0);assert.match(b.answer,/设计/);assert.match(b.answer,/运营/);
 assert.ok(starts>=2&&starts<=3,'只允许本轮定向修订和排队下一轮');
 const beforeReplay=starts;const replay=await send(`/sessions/${s.id}/tasks`,{message:'不联网，不生成文件。把刚才的两个团队分工概括成一句话。',requestId:'live_queue_001'});assert.equal(replay.id,next.id);assert.equal(starts,beforeReplay);
 fs.writeFileSync(DATA+'/followup-acceptance.json',JSON.stringify({ok:true,seconds:Math.round((Date.now()-start)/1000),guidance:guidance.receipt,answers:[a.answer,b.answer],nativeTurns:starts},null,2),{mode:0o600});
 console.log(JSON.stringify({ok:true,seconds:Math.round((Date.now()-start)/1000),nativeTurns:starts,cases:['real-steer','queue-after-final','natural-paragraphs','same-conversation','no-auto-files','idempotency']}));
}finally{previewAI.request=original;previewAI.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
