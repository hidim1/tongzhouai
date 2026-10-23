import {store,getProject,uid,save as saveWorkspace} from './store.mjs';
import {directionInput,detailedBudget,updateBudget,versionChanged,extraCategories,filesSnapshot} from './preview-workflow.mjs';
import {redact} from './provider.mjs';
import {estimateParameters,parameterKey,estimateReferences} from './preview-estimate.mjs';
import {recoverEstimate} from './preview-estimate-recovery.mjs';
const string={type:'string'},strings={type:'array',items:string};
const schema={type:'object',additionalProperties:false,required:['summary','sections','issues'],properties:{summary:string,sections:{type:'array',items:{type:'object',additionalProperties:false,required:['title','body','fileIds'],properties:{title:string,body:string,fileIds:strings}}},issues:strings}};
export function installWorkflow(app,{db,save,askAI,artifact,fileContext,imageInputs}){
 const version=id=>{const v=db.versions.find(v=>v.id===id);if(!v)throw Object.assign(new Error('方案不存在'),{status:404});getProject(v.projectId);return v;};
 const idle=id=>{if([...db.jobs,...store.jobs,...db.images].some(j=>(j.projectId===id||db.versions.some(v=>v.id===j.versionId&&v.projectId===id))&&['running','queued','approval','awaiting_approval'].includes(j.status)))throw Object.assign(new Error('本项目有任务执行，请等待完成或停止后再调整'),{status:409});};
 app.post('/api/preview/projects/:id/estimate',(req,res)=>{
  const p=getProject(req.params.id);idle(p.id);const parameters=estimateParameters(req.body.parameters||{}),files=structuredClone(p.files);
  const j={id:uid('estimate'),projectId:p.id,type:'ai-estimate',parameters,status:'running',createdAt:new Date().toISOString(),phase:'AI 正在分析需求、配置档次与成本依据',files:[]};db.jobs.push(j);save();res.json(j);
  void(async()=>{try{
   const refs=estimateReferences(),context=fileContext(files).slice(0,6).map(f=>({...f,text:typeof f.text==='string'?f.text.slice(0,12000):f.text}));
   const result=await recoverEstimate({id:j.id,parameters,refs,context,fileIds:files.map(f=>f.id),images:imageInputs(files),askAI,cancelled:()=>j.status==='cancelled',onAttempt:detail=>{j.estimateDiagnostics={...detail,startedAt:new Date().toISOString()};save();},onRecovery:detail=>{j.phase=detail.reason==='connection'?'生成连接暂时中断，正在自动重试':'正在核对并纠正三档方案';j.estimateDiagnostics={...detail,updatedAt:new Date().toISOString()};save();console.info(JSON.stringify({event:'estimate-recovery',jobId:j.id,...detail}));}});if(j.status==='cancelled')return;
   const estimate={...result,id:uid('estimate-result'),jobId:j.id,createdAt:new Date().toISOString(),parameterKey:parameterKey(parameters),sourceFiles:filesSnapshot(files),referenceScope:'历史库中的代表性组件，不是完整供货范围；文件最多读取前6份、每份前12000字符和前3张图像，不代表完整图纸审查。'};
   getProject(p.id);p.estimates||=[];p.estimates.push(estimate);saveWorkspace();j.estimateId=estimate.id;j.status='completed';j.completedAt=new Date().toISOString();save();
  }catch(e){if(j.status!=='cancelled'){j.status='failed';j.error=redact(e.message);j.completedAt=new Date().toISOString();console.warn(JSON.stringify({event:'estimate-failed',jobId:j.id,code:e.code||'ESTIMATE_FAILED'}));}save();}})();
 });
 app.post('/api/preview/projects/:id/direction',async(req,res)=>{
  const p=getProject(req.params.id);idle(p.id);const input=directionInput(req.body),estimate=p.estimates?.find(e=>e.id===req.body.estimateId);
  if(!estimate||estimate.kind!=='ai-assisted'||estimate.method!=='ai-only-v1')throw new Error('请先完成新的AI快速方案估算；旧规则结果不能使用');
  if(estimate.parameterKey!==parameterKey(input))throw new Error('项目参数已变化，请重新进行AI估算');
  if(JSON.stringify(estimate.sourceFiles)!==JSON.stringify(filesSnapshot(p.files)))throw new Error('项目资料已变化，请重新进行AI估算');
  const parameters=structuredClone(estimate.parameters);
  const option=estimate.options[req.body.tier];if(!option)throw new Error('估算未返回该档次');
  const targetCost=req.body.targetCost??option.total_cost;
  if(!Number.isFinite(targetCost)||targetCost<=0)throw new Error('成本依据不足，请先填写人工目标成本；不能把待确认金额当作零');
  const d={id:uid('direction'),createdAt:new Date().toISOString(),parameters,estimate:structuredClone(estimate),tier:req.body.tier,option:structuredClone(option),targetCost};
  p.directions||=[];p.directions.push(d);p.activeDirectionId=d.id;saveWorkspace();res.json(d);
 });
 app.put('/api/preview/versions/:id/budget',(req,res)=>{const v=version(req.params.id);idle(v.projectId);v.budget=updateBudget(v,req.body);versionChanged(v);save();res.json(detailedBudget(v));});
 app.get('/api/preview/versions/:id/budget',(req,res)=>res.json(detailedBudget(version(req.params.id))));
 app.post('/api/preview/versions/:id/revise',(req,res)=>{
  const old=version(req.params.id);idle(old.projectId);
  const next=structuredClone(old);next.id=uid('version');next.name=`${old.mode==='demo'?'演示':'真实AI'}方案 v${db.versions.filter(v=>v.projectId===old.projectId).length+1}`;
  next.createdAt=new Date().toISOString();next.status='draft';next.revision=0;next.outputs=[];delete next.technical;
  for(const row of next.rows)row.reviewed=false;
  for(const e of [...(next.budget?.lines||[]),...(next.budget?.extras||[])])e.reviewed=false;
  db.versions.push(next);save();res.json(next);
 });
 app.post('/api/preview/versions/:id/documents',(req,res)=>{
  const v=version(req.params.id);idle(v.projectId);
  if(v.mode==='demo')throw new Error('演示方案不生成真实技术文件');
  if(v.status!=='reviewed')throw new Error('请先核对并保存清单；不能据未核对方案生成技术文件');
  const p=getProject(v.projectId),files=structuredClone(p.files),source=structuredClone(v),budget=detailedBudget(source),revision=v.revision||0;
  const j={id:uid('scheme-doc'),projectId:p.id,versionId:v.id,type:'scheme-documents',status:'running',createdAt:new Date().toISOString(),phase:'AI 正在基于本方案编制技术响应与标书',files:[]};db.jobs.push(j);save();res.json(j);
  void(async()=>{try{
   const result=await askAI(j.id,`基于已核对方案编制技术响应和技术标初稿，并检查新招标要求、清单、预算之间的矛盾与遗漏。不要修改清单，不另起一套材料清单。引用文件的fileIds只能来自下列文件。没有依据的参数或合规承诺标待确认。缺失预算不能声称报价完整。新附件与方案生成时附件不同必须指出需要重新分析。不访问其他目录或网络。\n方案方向：${JSON.stringify(source.direction||null)}\n方案清单：${JSON.stringify(source.rows.filter(r=>r.action!=='删除').map(({name,spec,material,quantity,unit,fileIds,reason})=>({name,spec,material,quantity,unit,fileIds,reason})))}\n预算核对：${JSON.stringify(budget)}\n应编制文件：${JSON.stringify(source.documents)}\n生成清单时的附件：${JSON.stringify(source.sourceFiles||[])}\n当前附件：${JSON.stringify(fileContext(files))}`,schema,imageInputs(files),()=>{},'low');
   if(j.status==='cancelled')return;
   if(!result.sections?.length||result.sections.some(s=>!s.title||!s.body||s.fileIds.some(id=>!files.some(f=>f.id===id))))throw new Error('技术文件引用或内容校验失败');
   if((v.revision||0)!==revision)throw new Error('方案在生成中发生变更，请重新生成技术文件');
   const body=[result.summary,...result.sections.map(s=>`${s.title}\n${s.body}\n依据：${s.fileIds.map(id=>files.find(f=>f.id===id)?.name).join('、')||'待补充依据'}`),'待确认与审查事项',...result.issues].join('\n\n');
   const f=await artifact(p.name+'_'+v.name+'_技术响应与标书初稿','docx',body,[],[],'本方案版本的AI技术初稿，需人工审批');
   if(j.status==='cancelled')return;
   f.sourceRevision=revision;v.outputs||=[];v.outputs.push(f);v.technical={...result,sourceRevision:revision,sourceFiles:filesSnapshot(files),createdAt:new Date().toISOString()};j.files=[f];j.status='completed';save();
  }catch(e){if(j.status!=='cancelled'){j.status='failed';j.error=redact(e.message);}save();}})();
 });
}
