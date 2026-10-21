// Representative natural-language end-to-end tasks, not tool-parameter demos.
// Run only in a synthetic, isolated workspace. This invokes the configured AI.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url)),cases=JSON.parse(await fs.readFile(path.join(root,'../tests/fixtures/assistant-benchmark.json'),'utf8'));
if(process.argv.includes('--list')){console.log(cases.map(c=>({id:c.id,message:c.message})));process.exit(0);}
const data=process.env.TONGZHOU_DATA_DIR;assert.ok(data&&/^\/(?:private\/)?(?:var\/)?tmp\/zhouzhi-benchmark-[a-zA-Z0-9_-]+$/.test(data),'必须使用独立临时目录 /tmp/zhouzhi-benchmark-*；禁止生产工作区');
process.env.ZHOUZHI_MEMBRANE_DATA||=path.resolve(root,'../tests/fixtures/assistant-isolation/membrane');
const requested=process.argv.find(a=>a.startsWith('--cases='))?.slice(8).split(',')||['chat','decimal','word'];
const selected=process.argv.includes('--all')?cases:cases.filter(c=>requested.includes(c.id));assert.ok(selected.length,'没有选中验收任务');
const sourceHash=createHash('sha256');for(const folder of ['server','src','shared']){const dir=path.resolve(root,'..',folder);for(const name of (await fs.readdir(dir,{recursive:true})).sort()){const file=path.join(dir,name);if((await fs.stat(file)).isFile()){sourceHash.update(folder+'/'+name);sourceHash.update(await fs.readFile(file));}}}const sourceFingerprint=sourceHash.digest('hex');
const {default:express}=await import('express'),{default:ExcelJS}=await import('exceljs');
const {initializeProvider,redact}=await import('../server/provider.mjs');await initializeProvider();
const {makeDocument}=await import('../server/preview-document.mjs'),{extractDocument}=await import('../server/documents.mjs');
const {inspectTemplate}=await import('../server/office-template.mjs'),{officePackage,readPart,tags}=await import('../server/office-package.mjs');
const {installPreview}=await import('../server/preview-routes.mjs'),{previewAI}=await import('../server/preview-ai.mjs');
const app=express();app.use(express.json());installPreview(app);app.use((error,_req,res,_next)=>res.status(400).json({error:redact(error.message)}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
const post=async(url,body)=>{const response=await fetch(origin+'/api/preview'+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error);return value;};
async function task(session,message){
 const submitted=await post('/sessions/'+session.id+'/tasks',{message}),id=submitted.job?.id||submitted.id,start=Date.now();
 // This is a test watchdog, not a product task timeout. Failed cases never pass.
 while(Date.now()-start<20*60*1000){const db=JSON.parse(await fs.readFile(path.join(data,'preview/preview.json'),'utf8')),job=db.jobs.find(j=>j.id===id);if(['failed','completed','cancelled'].includes(job.status))return job;await new Promise(r=>setTimeout(r,1000));}
 await post('/jobs/'+id+'/cancel',{});throw Error('验收等待结束，已停止此独立测试任务');
}
const results=[];try{
 for(const scenario of selected){const start=Date.now(),result={id:scenario.id,status:'failed',checks:[],manualChecks:(scenario.manualChecks||[]).map(name=>({name,status:'not_reviewed'}))};
  try{const session=await post('/sessions',{});for(const attachment of scenario.attachments||[]){let bytes;
   if(attachment.name.endsWith('.xlsx')){const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('数据');for(const row of attachment.rows)sheet.addRow(row);bytes=await wb.xlsx.writeBuffer();}
   else if(attachment.name.endsWith('.docx')){const file=path.join(data,'fixture-'+scenario.id+'.docx');await makeDocument(attachment.title,attachment.body,file);bytes=await fs.readFile(file);}
   else bytes=Buffer.from(attachment.text);const body=new FormData();body.append('files',new Blob([bytes]),attachment.name);const upload=await fetch(origin+'/api/preview/sessions/'+session.id+'/files',{method:'POST',body});assert.ok(upload.ok,'合成附件上传失败');
  }
  const job=await task(session,scenario.message);assert.equal(job.status,'completed',job.error);result.jobId=job.id;
  const check=(name,passed)=>{result.checks.push({name,passed});assert.ok(passed,name);};
  for(const pattern of scenario.answerPatterns||[])check('答复包含 '+pattern,new RegExp(pattern).test(job.answer));
  for(const pattern of scenario.forbiddenPatterns||[])check('不泄露 '+pattern,!new RegExp(pattern,'i').test(job.answer));
  check('附件格式与数量',job.files.length===scenario.formats.length&&scenario.formats.every(f=>job.files.some(x=>x.name.endsWith('.'+f))));
  for(const tool of scenario.requiredTools||[])check('实际处理回执 '+tool,!!job.checkpoint?.toolReceipts?.some(r=>r.tool===tool&&!r.failed));
  if(scenario.requireBodyEvidence)check('真实正文证据',!!job.checkpoint?.researchClaims?.some(c=>c.evidence.some(e=>e.quoteMatched&&e.quoteField==='body')));
  for(const file of job.files){const parsed=await extractDocument(file.path);for(const pattern of scenario.filePatterns||[])check('文件完整内容 '+pattern,new RegExp(pattern).test(parsed.text));if(scenario.slideCount)check('真实页数',parsed.slides?.length===scenario.slideCount);if(scenario.bodyAfterTitle){const info=await inspectTemplate(file.path),blocks=info.parts.find(p=>p.part==='word/document.xml').blocks;check('正文在标题后且文字准确',blocks[1].text===scenario.bodyAfterTitle);const $=await readPart(await officePackage(file.path),'word/document.xml'),style=tags($,'pStyle',tags($,'p').eq(1)).attr('w:val');check('正文不是标题样式',!style||style==='Normal');}}
  if(scenario.followup){const target=scenario.newSessionForFollowup?await post('/sessions',{}):session,next=await task(target,scenario.followup);check('跨轮实际完成',next.status==='completed');for(const pattern of scenario.followupPatterns||[])check('后续答复 '+pattern,new RegExp(pattern).test(next.answer));}
  result.stageDurations=(job.checkpoint?.timings||[]).map(({stage,durationMs,status})=>({stage,durationMs,status}));result.toolCalls=job.checkpoint?.toolReceipts?.length||0;result.repairRounds=job.checkpoint?.repairRounds||0;result.status='passed';
  }catch(error){result.error=redact(error.message);}finally{result.durationMs=Date.now()-start;results.push(result);await fs.writeFile(path.join(data,'benchmark-progress.json'),JSON.stringify(results,null,2),{mode:0o600});console.log(JSON.stringify({id:result.id,status:result.status,durationMs:result.durationMs}));}
 }
 const durations=results.map(r=>r.durationMs).sort((a,b)=>a-b),percentile=p=>durations[Math.max(0,Math.ceil(p*durations.length)-1)]||null;
 const report={createdAt:new Date().toISOString(),sourceFingerprint,syntheticDataOnly:true,scenarioCount:results.length,passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status!=='passed').length,p50Ms:percentile(.5),p95Ms:percentile(.95),usageCost:'not_measured',manualQuality:'not_scored',note:'自动检查不证明视觉设计合格或达到其他产品能力；需人工检查，并多轮重复测量。',results};
 await fs.writeFile(path.join(data,'benchmark-report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({report:path.join(data,'benchmark-report.json'),passed:report.passed,failed:report.failed,p50Ms:report.p50Ms,p95Ms:report.p95Ms}));if(report.failed)process.exitCode=1;
}finally{previewAI.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
