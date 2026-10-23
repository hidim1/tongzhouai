import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import ExcelJS from 'exceljs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-workflow-test-'));
process.env.TONGZHOU_DATA_DIR=dir;
process.env.ZHOUZHI_PYTHON='/Users/lhy19950000/vibe/设备自动化设计/膜设备成本预算demo/.venv/bin/python';
const {store,newProject}=await import('../server/store.mjs');
const {installPreview}=await import('../server/preview-routes.mjs');
const {previewAI}=await import('../server/preview-ai.mjs');
const {templateCatalog}=await import('../server/preview-core.mjs');
const {extraCategories}=await import('../server/preview-workflow.mjs');
const {costCategories}=await import('../server/preview-estimate.mjs');
test('方案流程API：方向约束→AI清单→详细核算→技术文件→版本导出',{timeout:30000},async t=>{
 const app=express();app.use(express.json());installPreview(app);app.use((e,req,res,next)=>res.status(e.status||400).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 const oldConnect=previewAI.connect,oldRequest=previewAI.request;const calls=[];let counter=0,failEstimate=false,holdEstimate=false,badEstimateOnce=false,disconnectOnce=false;
 previewAI.connect=async()=>{previewAI.status.authenticated=true;};
 previewAI.request=async(method,p)=>{
  if(method==='thread/start')return{thread:{id:'test-'+(++counter)}};
  if(method==='turn/start'){
   calls.push(p.input[0].text);const id='turn-'+counter,keys=p.outputSchema.properties,t=templateCatalog()[0],m=t.modules[0];
   if(keys.options&&failEstimate)throw Error('模拟AI连接失败');
   if(keys.options&&disconnectOnce){disconnectOnce=false;throw Object.assign(new Error('stream disconnected before completion: stream closed before response.completed'),{code:'AI_PROVIDER_FAILED'});}
   if(keys.options&&holdEstimate)return{turn:{id}};
   const result=keys.options?{analysis:'基于新需求分析三档配置',risks:['测试返回，不作为真实工程结论'],options:['low','mid','high'].map((tier,i)=>({tier,name:'方案'+tier,description:'配置'+tier,configuration:['配置'+tier],requirementIds:['gmp'],missing:['项目介质待确认'],lines:costCategories.map((category,k)=>({category,configuration:'配置'+tier,referenceId:'ai-experience',referenceUnchanged:false,quantityLow:null,quantityHigh:null,quantityBasis:'',amountLow:8000+i*1500+k*100,amountHigh:10000+i*2000+k*100,basis:'测试AI经验区间',assumptions:['初步配置与供货范围假设'],supportingReferenceIds:[],fileIds:['test-file']}))}))}:keys.templateIds?{templateIds:[t.id],moduleIds:[m.id],reason:'依据新需求选择范围',missingInformation:[]}:keys.groups?{summary:'新项目模拟AI方案',groups:[],additions:[{name:'新选型泵',spec:'测试规格',material:'316L',unit:'台',quantity:2,action:'新增',templateId:'',rowIndex:null,fileIds:['test-file'],reason:'新招标要求',note:''}],documents:[{name:'技术响应',reason:'按新要求',status:'待编制'}],questions:[]}: {summary:'本方案技术初稿',sections:[{title:'供货范围',body:'两台新选型泵；仍需工程审核。',fileIds:['test-file']}],issues:['预算与供货范围需最终审核']};
   if(keys.options&&badEstimateOnce){badEstimateOnce=false;result.options=[{...result.options[1],lines:result.options.flatMap(o=>o.lines)}];}
   setTimeout(()=>{previewAI.emit('event',{method:'item/completed',params:{threadId:p.threadId,item:{type:'agentMessage',text:JSON.stringify(result)}}});previewAI.emit('event',{method:'turn/completed',params:{threadId:p.threadId,turn:{id,status:'completed'}}});},10);
   return{turn:{id}};
  }
  if(method==='turn/interrupt')return{};throw Error(method);
 };
 t.after(async()=>{previewAI.connect=oldConnect;previewAI.request=oldRequest;server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const request=async(url,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json','X-Tongzhou-Client':'workspace'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
 const state=async()=> (await request('/preview/state')).data;
 const wait=async id=>{for(let i=0;i<100;i++){const j=(await state()).jobs.find(j=>j.id===id);if(j.status!=='running'){assert.equal(j.status,'completed',j.error);return j;}await new Promise(r=>setTimeout(r,20));}throw Error('test job timeout');};
 const p=newProject('隔离流程测试');p.files=[{id:'test-file',name:'需求.txt',text:'需要两台316L泵',status:'parsed',size:20}];
 let r=await request(`/preview/projects/${p.id}/assemble`,{mode:'live'});assert.equal(r.status,400);assert.match(r.data.error,/先完成快速估算/);
 const parameters={industry:'pharma',routes:['uf'],capacity:1,compliance:'gmp',explosion_proof:false};
 assert.equal((await request(`/preview/projects/${p.id}/direction`,{parameters,tier:'mid',targetCost:200})).status,400);
 r=await request(`/preview/projects/${p.id}/estimate`,{parameters});const estimateJob=await wait(r.data.id);
 assert.equal(p.estimates[0].method,'ai-only-v1');assert.ok(!calls[0].includes('rule:'));assert.ok(calls[0].includes('采购价')&&calls[0].includes('质量要求'));
 assert.equal((await request(`/preview/projects/${p.id}/direction`,{parameters:{...parameters,capacity:2},estimateId:estimateJob.estimateId,tier:'mid',targetCost:200})).status,400);
 r=await request(`/preview/projects/${p.id}/direction`,{parameters,estimateId:estimateJob.estimateId,tier:'mid',targetCost:200});assert.equal(r.status,200);const direction=r.data;
 r=await request(`/preview/projects/${p.id}/assemble`,{mode:'live',message:'测试'});const job=await wait(r.data.id);let v=(await state()).versions.find(v=>v.id===job.versionId);
 assert.equal(v.direction.id,direction.id);assert.equal(v.direction.targetCost,200);assert.ok(calls.slice(1,3).every(x=>x.includes(direction.id)&&x.includes('明确要求优先')&&x.includes(direction.option.description)));
 assert.equal((await request(`/preview/versions/${v.id}/documents`,{})).status,400);
 await request(`/preview/versions/${v.id}/review`,{rowId:v.rows[0].id,reviewed:true});await request(`/preview/versions/${v.id}/accept`,{});
 r=await request(`/preview/versions/${v.id}/budget`,{lines:[{rowId:v.rows[0].id,unitPrice:100,source:'测试含税询价单',reviewed:true}],extras:extraCategories.map(category=>({category,amount:0,source:'已含在清单费用内',reviewed:true}))},'PUT');assert.equal(r.status,200);assert.equal(r.data.total,200);assert.equal(r.data.delta,0);
 r=await request(`/preview/versions/${v.id}/documents`,{});await wait(r.data.id);v=(await state()).versions.find(x=>x.id===v.id);assert.equal(v.technical.sections.length,1);assert.equal(v.technical.sourceRevision,v.revision);assert.ok(calls.at(-1).includes('不另起一套材料清单'));
 r=await request(`/preview/versions/${v.id}/export`,{type:'xlsx'});assert.equal(r.status,200);const download=await fetch(`http://127.0.0.1:${server.address().port}${r.data.url}`);assert.equal(download.status,200);
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(await download.arrayBuffer()));assert.ok(wb.getWorksheet('详细预算'));assert.ok(wb.getWorksheet('方案对比'));assert.equal(wb.getWorksheet('详细预算').getRow(2).getCell(5).value,200);
 r=await request(`/preview/projects/${p.id}/estimate`,{parameters:{...parameters,capacity:2}});const newEstimate=await wait(r.data.id);
 await request(`/preview/projects/${p.id}/direction`,{parameters:{...parameters,capacity:2},estimateId:newEstimate.estimateId,tier:'high',targetCost:300});v=(await state()).versions.find(x=>x.id===v.id);assert.equal(v.direction.targetCost,200);assert.equal(v.direction.parameters.capacity,1);
 r=await request(`/preview/versions/${v.id}/revise`,{});assert.equal(r.data.status,'draft');assert.equal(r.data.rows[0].reviewed,false);assert.equal(r.data.outputs.length,0);assert.equal(r.data.direction.id,direction.id);
 const originalRevision=v.revision;await request(`/preview/versions/${v.id}/budget`,{lines:[],extras:[]},'PUT');v=(await state()).versions.find(x=>x.id===v.id);assert.equal(v.revision,originalRevision+1);assert.notEqual(v.technical.sourceRevision,v.revision);
 assert.equal((await fetch(base+'/preview/calculate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(parameters)})).status,404);
 // Both diagnosed failures recover under the original job id and commit once.
 for(const scenario of ['mixed-tiers','disconnected']){
  const before=p.estimates.length,priorCalls=calls.length;if(scenario==='mixed-tiers')badEstimateOnce=true;else disconnectOnce=true;
  r=await request(`/preview/projects/${p.id}/estimate`,{parameters});const recovered=await wait(r.data.id);
  assert.equal(p.estimates.length,before+1);assert.equal(p.estimates.at(-1).jobId,recovered.id);assert.equal(calls.length,priorCalls+2);
  assert.equal(recovered.estimateDiagnostics,undefined);assert.ok(recovered.completedAt);assert.equal(recovered.error,undefined);
 }
 // Cancelling the job during backoff never starts another call or saves a plan.
 {const before=p.estimates.length,priorCalls=calls.length;disconnectOnce=true;
  r=await request(`/preview/projects/${p.id}/estimate`,{parameters});
  assert.equal((await request(`/preview/projects/${p.id}/estimate`,{parameters})).status,409);
  assert.equal((await request(`/preview/jobs/${r.data.id}/cancel`,{})).data.status,'cancelled');
  await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(p.estimates.length,before);assert.equal(calls.length,priorCalls+1);
 }
 const before=p.estimates.length,oldDirection=p.activeDirectionId;failEstimate=true;
 r=await request(`/preview/projects/${p.id}/estimate`,{parameters});
 for(let i=0;i<100;i++){const j=(await state()).jobs.find(j=>j.id===r.data.id);if(j.status==='failed'){assert.match(j.error,/模拟AI连接失败/);break;}assert.ok(i<99);await new Promise(r=>setTimeout(r,20));}
 assert.equal(p.estimates.length,before);assert.equal(p.activeDirectionId,oldDirection);failEstimate=false;holdEstimate=true;
 r=await request(`/preview/projects/${p.id}/estimate`,{parameters});await new Promise(r=>setTimeout(r,30));
 assert.equal((await request(`/preview/jobs/${r.data.id}/cancel`,{})).data.status,'cancelled');assert.equal(p.estimates.length,before);assert.equal(p.activeDirectionId,oldDirection);
});
