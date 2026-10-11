// Real search + hidden-evidence acceptance in a synthetic, isolated workspace.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import express from 'express';
import {DATA} from '../server/config.mjs';
assert.ok(DATA.startsWith('/tmp/zhouzhi-search-evidence-canary-'),'仅允许独立临时验收目录');
const {installPreview}=await import('../server/preview-routes.mjs');
const {previewAI}=await import('../server/preview-ai.mjs');
const app=express();app.use(express.json());installPreview(app);
app.use((error,req,res,next)=>res.status(400).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`,start=Date.now(),checks=[];
async function post(url,body){const r=await fetch(base+'/api/preview'+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();}
try{
 const session=await post('/sessions',{});
 async function run(message){
  const job=await post(`/sessions/${session.id}/tasks`,{message});let phase='';const deadline=Date.now()+15*60*1000;
  while(Date.now()<deadline){
   const state=await(await fetch(base+'/api/preview/state')).json(),j=state.jobs.find(j=>j.id===job.id);
   if(j.phase!==phase){phase=j.phase;console.log(JSON.stringify({phase,seconds:Math.round((Date.now()-start)/1000)}));}
   assert.equal(j.searchReferences,undefined);assert.equal(j.sources,undefined);
   if(j.status!=='running'){assert.equal(j.status,'completed',j.error);assert.equal(j.files.length,0);return j;}
   await new Promise(r=>setTimeout(r,1000));
  }
  await post(`/jobs/${job.id}/cancel`,{});throw Error('独立验收等待结束，已停止该验收任务');
 }
 const first=await run('请联网从国家统计局官网查找最近一条公开发布的信息，用两到三句话告诉我主要内容和时间；整合表达，不需要列来源或链接，不生成文件。');
 assert.doesNotMatch(first.answer,/https?:\/\/|来源[：:]|参考资料[：:]/i);
 const stored=JSON.parse(fs.readFileSync(DATA+'/preview/preview.json','utf8')),references=stored.jobs.find(j=>j.id===first.id).searchReferences;
 assert.ok(references?.some(r=>new URL(r.url).hostname==='stats.gov.cn'||new URL(r.url).hostname.endsWith('.stats.gov.cn')),'后台未记录国家统计局原文');
 checks.push({case:'integrated-answer-hidden-evidence',answer:first.answer,references});
 const follow=await run('把刚才参考的国家统计局官网原文链接告诉我，不需要重新搜索，也不要生成文件。');
 assert.match(follow.answer,/https?:\/\/[^\s]*stats\.gov\.cn/);
 assert.ok(references.some(r=>follow.answer.includes(r.url)),'追问未沿用同一对话来源');
 checks.push({case:'sources-only-on-explicit-follow-up',answer:follow.answer});
 const plain=await run('不联网，只把这句话改得自然一点：设计团队需在周一整理图纸。不要文件。');
 assert.match(plain.answer,/周一/);assert.match(plain.answer,/设计/);assert.doesNotMatch(plain.answer,/https?:\/\//);
 checks.push({case:'ordinary-no-search-no-file',answer:plain.answer});
 fs.writeFileSync(DATA+'/search-evidence-acceptance.json',JSON.stringify({ok:true,at:new Date().toISOString(),checks},null,2),{mode:0o600});
 console.log(JSON.stringify({ok:true,seconds:Math.round((Date.now()-start)/1000),cases:checks.map(x=>x.case)}));
}finally{previewAI.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
