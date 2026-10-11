// Real upstream acceptance through the same API as the UI, with synthetic data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import {DATA} from '../server/config.mjs';
assert.ok(DATA.startsWith('/tmp/zhouzhi-delivery-canary-'),'仅允许独立临时验收目录');
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
    while(Date.now()<deadline) {
      const state=await(await fetch(base+'/api/preview/state')).json(),j=state.jobs.find(x=>x.id===job.id);
      if(lastPhase!==j.phase){lastPhase=j.phase;console.log(JSON.stringify({phase:j.phase,elapsedSeconds:Math.round((Date.now()-started)/1000)}));}
      if(j.status!=='running'){assert.equal(j.status,'completed',j.error);return j;}
      await new Promise(r=>setTimeout(r,1000));
    }
    await post(`/jobs/${job.id}/cancel`,{});throw Error('独立验收等待结束，已停止该验收任务');
  }
  const chat=await run('已知事实：舟知定位为全量工作助手，智能工作助理和膜预算平台是两条并行工作线，二者共享AI能力。请给我一个简短的舟知整体介绍，不超过100字，只依据这些事实，不联网。');
  assert.equal(chat.files.length,0);assert.match(chat.answer,/舟知/);assert.match(chat.answer,/智能工作助理/);assert.match(chat.answer,/膜预算/);
  checks.push({case:'ordinary-chat',answer:chat.answer,files:chat.files.length});
  const file=await run('把刚才的介绍做成Excel文件，表头为模块、用途，两行数据。不联网，不增加其他事实。');
  assert.equal(file.files.length,1);assert.match(file.files[0].name,/\.xlsx$/);
  const downloaded=await fetch(base+file.files[0].url);assert.equal(downloaded.status,200);
  const bytes=Buffer.from(await downloaded.arrayBuffer());assert.equal(bytes.subarray(0,2).toString(),'PK');
  checks.push({case:'explicit-file',files:1,bytes:bytes.length});
  const again=await run('这两条工作线是前后顺序吗？用一句话回答，不联网。');
  assert.equal(again.files.length,0);assert.match(again.answer,/并行|不是|不属于|非前后/);
  checks.push({case:'chat-after-file',answer:again.answer,files:again.files.length});
  const evidence={ok:true,elapsedSeconds:Math.round((Date.now()-started)/1000),checks};
  fs.writeFileSync(DATA+'/delivery-acceptance.json',JSON.stringify(evidence,null,2),{mode:0o600});
  console.log(JSON.stringify({ok:true,elapsedSeconds:evidence.elapsedSeconds,cases:checks.map(c=>({case:c.case,files:c.files}))}));
} finally {
  previewAI.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
