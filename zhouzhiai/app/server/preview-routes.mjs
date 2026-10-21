import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { DATA, ROOT, PYTHON, SERVER } from './config.mjs';
import { store, getProject, projectDir, uid, save as saveWorkspace } from './store.mjs';
import { ingest } from './intake.mjs';
import { extractDocument } from './documents.mjs';
import { templates, candidates, templateCatalog, selectedModules, expandAssembly, validatePlan, demoPlan, procurementSubtotal, actions } from './preview-core.mjs';
import { askAI, groupedAssemblySchema, selectionSchema, cancelAI,pauseAI,steerAI } from './preview-ai.mjs';
import {createAssistant} from './preview-assistant.mjs';
import {publicAssistantJob} from './preview-search.mjs';
import { makePresentation, presentationInstructions } from './preview-presentation.mjs';
import { providerStatus, redact } from './provider.mjs';
import { archiveItem, restoreItem } from './preview-archive.mjs';
import { installWorkflow } from './preview-workflow-routes.mjs';
import { directionContext, filesSnapshot, detailedBudget, invalidateBudget, versionChanged } from './preview-workflow.mjs';
import {assertPublicOutput} from './member-policy.mjs';
import {makeDocument,makeMarkdown} from './preview-document.mjs';
import {makeWorkbook} from './preview-workbook.mjs';
import {reviewPresentation,repairPresentationLayout} from './preview-presentation-review.mjs';
import {publicAssistantSession} from './assistant-context.mjs';
import {reviewOffice,buildReviewedOffice} from './office-render.mjs';
import {verifyOfficeContent} from './office-content.mjs';
import {recoverInterruptedTasks} from './assistant-startup.mjs';

const dir = path.join(DATA,'preview');
fs.mkdirSync(dir,{recursive:true});
const dbPath = path.join(dir,'preview.json');
const db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath)) : {sessions:[],jobs:[],versions:[],images:[]};
export const hasPreviewWork = () => [...db.jobs,...db.images].some(j=>['running','queued','waiting_user','approval','awaiting_approval'].includes(j.status));
recoverInterruptedTasks(db);
for(const j of db.jobs)for(const f of j.files||[])f.name=f.name.replace(/\.(xlsx|docx|md)\.\1$/i,'.$1');
for(const s of db.sessions)for(const m of s.messages)for(const f of m.files||[])f.name=f.name.replace(/\.(xlsx|docx|md)\.\1$/i,'.$1');
function save() {fs.writeFileSync(dbPath+'.tmp',JSON.stringify(db));fs.renameSync(dbPath+'.tmp',dbPath);}
save();
const cleanFile = ({path:_,text, ...f})=>({...f,textPreview:(text||'').slice(0,2000)});
const upload = multer({dest:path.join(dir,'uploads'),limits:{fileSize:30*1024*1024,files:12},fileFilter:(req,file,cb)=>cb(null,/\.(docx?|pptx|xlsx|pdf|txt|md|csv|png|jpe?g|dwg|dxf|step|stp|iges|igs|sldprt|sldasm)$/i.test(file.originalname))});
const known3D = name => /\.(step|stp|iges|igs|sldprt|sldasm)$/i.test(name);
const safe = str => String(str||'输出').replace(/[\/\\:*?"<>|\x00-\x1f]/g,'_').slice(0,80);
async function artifact(title,format,body,columns=[],rows=[],scope='通用输出',presentation=null,extraSheets=[],options={}) {
  assertPublicOutput({title,body,columns,rows,scope,presentation,extraSheets,workbook:options.workbook});
  const id=options.artifactId||uid('output');if(!/^[a-zA-Z0-9_-]{1,160}$/.test(id))throw Error('成果标识无效');const out=path.join(dir,'outputs');fs.mkdirSync(out,{recursive:true});
  const filename=safe(title).replace(/\.(xlsx|docx|md|pptx)$/i,'')+'.'+format, target=path.join(out,id+'.'+format);
  if(scope==='通用输出'&&options.jobId&&['docx','xlsx'].includes(format)){
   let contentCheck;
   await buildReviewedOffice({cancelled:options.cancelled,build:async readableLayout=>{if(format==='docx')await makeDocument(title,body,target,{readableLayout,design:options.design});else await makeWorkbook(title,body,columns,rows,target,{extraSheets,plan:options.workbook,readableLayout,design:options.design});contentCheck=await verifyOfficeContent(target,{format,title,body,columns,rows,extraSheets,workbook:options.workbook});},review:attempt=>reviewOffice(target,path.join(dir,'document-build',id,'attempt-'+attempt),{askAI,id:options.jobId,cancelled:options.cancelled,design:options.design})});
   options.onContentVerified?.(contentCheck);
   return {id,name:filename,path:target,url:'/api/preview/outputs/'+id,createdAt:new Date().toISOString(),version:1};
  }
  if(format==='pptx') {
    const buildDir=path.join(dir,'presentation-build',id),settings={...options,root:ROOT,allowGenerated:process.env.ZHOUZHI_PRESENTATION_IMAGES!=='0',generateImage:payload=>runBridge(payload,720000),...(options.jobId?{review:({plan,previews})=>reviewPresentation(plan,previews,{askAI,id:options.jobId,cancelled:options.cancelled})}:{})};
    try{
      try{await makePresentation(presentation,target,buildDir,settings);}catch(e){
       if(!options.jobId||presentation?.slides?.[0]?.layout!=='canvas'||!e.revisedPresentation&&!/PPT构图需要调整|PPT文字区域不足|PPT文字对比不足|PPT表格行距不足|PPT表格文字与页面背景/.test(e.message))throw e;
       const fixed=e.revisedPresentation||await repairPresentationLayout(presentation,e.message,{askAI,id:options.jobId,cancelled:options.cancelled});assertPublicOutput(fixed);
       await makePresentation(fixed,target,buildDir,settings);
      }
    }catch(e){console.error('PPT:',e.message);throw new Error(e.code==='PRESENTATION_VALIDATION_FAILED'?'PPT排版校验未通过，文件未交付。请要求合理分页或调整构图后重试。':e.message);}
  } else if(format==='xlsx') {
    await makeWorkbook(title,body,columns,rows,target,{extraSheets,plan:options.workbook,engineering:scope!=='通用输出'});
  } else if(format==='docx') {
    await makeDocument(title,(scope==='通用输出'?'':scope+'\n\n')+body,target);
  } else if(format==='md') await makeMarkdown(title,(scope==='通用输出'?'':scope+'\n\n')+body,target);
  else throw new Error('不支持该输出格式');
  return {id,name:filename,path:target,url:'/api/preview/outputs/'+id,createdAt:new Date().toISOString(),version:1};
}
function runBridge(payload,timeout=20000) {
  return new Promise((resolve,reject)=>{
    const python=process.env.ZHOUZHI_PYTHON || PYTHON;
    const child=spawn(python,[path.join(ROOT,'../membrane/preview_bridge.py')],{env:process.env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('预算/图片服务超时，请重试'));},timeout);
    child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('exit',code=>{clearTimeout(timer); if(code)reject(new Error('本地预算/图片服务失败：'+redact(stderr).slice(-300)));else{try{resolve(JSON.parse(stdout));}catch{reject(new Error('预算服务返回格式错误'));}}});
    child.stdin.end(JSON.stringify(payload));
  });
}
const imagePath=f=>f.preview&&/\.(png|jpe?g)$/i.test(f.preview)?f.preview:/\.(png|jpe?g)$/i.test(f.name)?f.path:null;
const imageInputs=files=>files.map(imagePath).filter(Boolean).slice(0,3);
const fileContext = files => files.map(f=>({id:f.id,name:f.name,status:f.status,imageAttached:!!imagePath(f)&&imageInputs(files).includes(imagePath(f)),note:(f.parseNote||f.error||f.cadNote||'')+((f.text||'').length>30000?' 本文件文本超过本轮30000字符范围，未读取全部；不得宣称完整分析。':''),text:(f.text||'').slice(0,30000)}));
export function installPreview(app) {
  installWorkflow(app,{db,save,runBridge,askAI,artifact,fileContext,imageInputs});
  const assistant=createAssistant({db,save,askAI,steerAI,cancelAI,pauseAI,artifact,fileContext,imageInputs,extractDocument});
  const publicArtifact=({path:_,...f})=>f;
  app.get('/api/preview/state',(req,res)=>{
    const hidden=new Set([...db.sessions,...store.projects].filter(x=>x.archivedAt).map(x=>x.id));
    const versions=db.versions.filter(v=>!hidden.has(v.projectId));
    res.json({sessions:db.sessions.filter(s=>!s.archivedAt).map(s=>publicAssistantSession(s,cleanFile)),jobs:db.jobs.filter(j=>!hidden.has(j.sessionId)&&!hidden.has(j.projectId)).map(j=>({...publicAssistantJob(j),files:(j.files||[]).map(publicArtifact)})),versions:versions.map(v=>({...v,outputs:(v.outputs||[]).map(publicArtifact)})),images:db.images.filter(j=>versions.some(v=>v.id===j.versionId)).map(publicArtifact),archived:[...db.sessions.filter(s=>s.archivedAt).map(({id,name,archivedAt})=>({id,name,archivedAt,type:'sessions'})),...store.projects.filter(p=>p.archivedAt).map(({id,name,archivedAt})=>({id,name,archivedAt,type:'projects'}))],provider:providerStatus(),templates:templates.map(t=>({id:t.template_id,name:t.project_name,routes:t.route_tags,count:t.bom.rows.length})),localOnly:!SERVER});
  });
  app.post('/api/preview/image/check',async(req,res)=>res.json(await runBridge({action:'image-check'},50000)));
  app.delete('/api/preview/sessions/:id',(req,res)=>{const result=archiveItem(db.sessions.find(s=>s.id===req.params.id),db.jobs);save();res.json(result);});
  app.delete('/api/preview/projects/:id',(req,res)=>{const result=archiveItem(store.projects.find(p=>p.id===req.params.id),[...db.jobs,...store.jobs],db.images,db.versions);saveWorkspace();res.json(result);});
  app.post('/api/preview/archive/:type/:id/restore',(req,res)=>{
    if(!['sessions','projects'].includes(req.params.type))return res.status(400).json({error:'无效记录类型'});
    const result=restoreItem((req.params.type==='sessions'?db.sessions:store.projects).find(x=>x.id===req.params.id));
    req.params.type==='sessions'?save():saveWorkspace();res.json(result);
  });
  app.post('/api/preview/sessions',(req,res)=>{const s={id:uid('general'),name:String(req.body.name||'新工作对话').slice(0,50),messages:[],files:[]};db.sessions.push(s);save();res.json(s);});
  app.post('/api/preview/jobs/:id/cancel',async(req,res)=>{const j=db.jobs.find(j=>j.id===req.params.id);if(!j)throw new Error('任务不存在');if(j.type==='general')return res.json(await assistant.stop(j.id));if(j.status!=='running')throw new Error('任务已经结束');j.status='cancelled';j.error='已手动停止';save();await Promise.all([cancelAI(j.id),cancelAI(j.id+'-selection')]);res.json(publicAssistantJob(j));});
  app.post('/api/preview/sessions/:id/files',upload.array('files',12),async(req,res)=>{
    const s=db.sessions.find(s=>s.id===req.params.id&&!s.archivedAt);if(!s)throw new Error('会话不存在');
    for(const f of req.files||[]) {
      const name=Buffer.from(f.originalname,'latin1').toString('utf8'),id=uid('file');const target=path.join(dir,'uploads',id+path.extname(name));fs.renameSync(f.path,target);
      let parsed;try{parsed=await extractDocument(target);}catch(e){parsed={text:'',error:e.message};}
      s.files.push({id,name,path:target,size:f.size,status:known3D(name)?'仅归档・3D待解析':parsed.error?'解析失败':parsed.unsupported?'待解析':/\.(png|jpe?g)$/i.test(name)?'图片参考':parsed.text?'已提取文本':'无可读文本',...parsed});
    }save();res.json(s.files.map(cleanFile));
  });
  app.post('/api/preview/sessions/:id/tasks',async(req,res)=>{
    const result=await assistant.submit(req.params.id,req.body);
    res.json({...result.job,receipt:result.receipt,notice:result.notice});
  });
  app.patch('/api/preview/sessions/:id/queue/:jobId',(req,res)=>res.json(assistant.edit(req.params.id,req.params.jobId,req.body.message)));
  app.delete('/api/preview/sessions/:id/queue/:jobId',(req,res)=>res.json(assistant.remove(req.params.id,req.params.jobId)));
  app.post('/api/preview/sessions/:id/queue/resume',(req,res)=>res.json(assistant.resume(req.params.id)));
  app.post('/api/preview/jobs/:id/continue',(req,res)=>res.json(assistant.continue(req.params.id)));
  app.post('/api/preview/projects/:id/files',upload.array('files',12),async(req,res)=>{
    const p=getProject(req.params.id);for(const f of req.files||[]) {try{const name=Buffer.from(f.originalname,'latin1').toString('utf8');const item=await ingest(p,f.path,name);if(known3D(name)){item.status='pending';item.parseNote='原生3D仅归档。请另传装配清单CSV/Excel、尺寸表及导出视图；当前不自动解析几何或算量。';item.text='';}}finally{fs.unlinkSync(f.path);}}
    const {save:saveMain}=await import('./store.mjs');saveMain();res.json({files:p.files.map(cleanFile)});
  });
  app.post('/api/preview/projects/:id/assemble',async(req,res)=>{
    const p=structuredClone(getProject(req.params.id));
    if([...db.jobs,...store.jobs,...db.images].some(j=>(j.projectId===p.id||db.versions.some(v=>v.id===j.versionId&&v.projectId===p.id))&&['running','queued','approval','awaiting_approval'].includes(j.status)))throw new Error('本项目已有任务运行，请等待或停止');
    const direction=p.directions?.find(d=>d.id===p.activeDirectionId);
    if(!direction)throw new Error('请先完成快速估算并确定方案方向与档次');
    const demo=req.body.mode==='demo',message=String(req.body.message||'').slice(0,12000)+'\n初步方案方向与约束：'+directionContext(direction);
    if(!demo&&!p.files.some(f=>f.text||imagePath(f)))throw new Error('请先上传可读的招标文件/设计输入或图纸视图');
    const j={id:uid('assembly'),projectId:p.id,type:'assembly',status:'running',mode:demo?'demo':'live',message,createdAt:new Date().toISOString()};db.jobs.push(j);save();res.json(j);
    void(async()=>{try{
      j.phase=demo?'准备演示样例':'AI 正在读取需求并匹配历史组件';save();
      const catalog=templateCatalog();
      // Historical candidates are selected on the server, never by a frontend checklist.
      const selection=demo?{templateIds:[templates[0].template_id],moduleIds:[catalog[0].modules[0].id],reason:'仅演示交互，不作为本项目选型',missingInformation:[]}:await askAI(j.id+'-selection',`你是舟知的膜设备选型助手。在后台根据本项目的招标要求、供货边界、技术路线和文件证据，选择1至3套最相关的历史样机作为组件检索范围。不是直接复用旧方案，也不能把样机配置当作新项目参数。templateIds必须来自目录，moduleIds必须为已选择样机的1至12个模块id。按新路线只选相关设备模块和必要共用模块，不能把多套工艺的整份旧项目全部纳入。对新范围明确剔除的配套模块可纳入检索范围以记录删除。如资料不足以判断路线则返回空数组并在missingInformation中说明，不允许随机选择或以第一套替代。仅依据下面提供的数据，不访问任何其他文件。\n项目：${p.name}\n用户要求：${message}\n新项目资料：${JSON.stringify(fileContext(p.files))}\n历史目录：${JSON.stringify(catalog)}`,selectionSchema,imageInputs(p.files));
      if(j.status==='cancelled')return;
      const ids=selection.templateIds;
      if(!ids?.length)throw new Error('AI 暂无法确定合适的组件范围：'+(selection.missingInformation?.join('；')||'请补充工艺路线、处理量和供货范围'));
      const selected=demo?candidates(ids):selectedModules(selection);
      j.phase='AI 正在重新组装新项目清单与投标文件';j.selection=selection;save();
      const plan=demo?demoPlan(selected,p.files.map(f=>f.id)):validatePlan(expandAssembly(await askAI(j.id,`基于新项目需求重新组装设备与材料清单、投标文件目录。不是复制旧样机：先读新需求和供货边界，再选择组件，按新参数调整/替换/新增/删除，给出原因。覆盖选中样机中与本项目相关的模块；不相关的原模块要给出删除记录；不要以仅改数量冒充重组。用groups表达对历史组件的明确决策，每组指定templateId和原始rowIndices。同一新动作、新规格、材质、新数量与原因相同才能归为一组；不同决策分开。新组件放additions并明确action=新增/templateId为空/rowIndex=null。严禁自动把所有旧组件当作新供货范围。多条记录组的name必须为空以保留各自名称，换型需要改名则单独列组。同源未改规格/材质/单位留空由本地回填；替换组明确新规格或写待确认，不默认使用旧规格。未明确计算的新数量一律null，不能把根设备的1套分配给每个零件。行号必须明确列举不能写范围字符串。覆盖相关模块内的候选记录，非供货项标删除，无法判断标待确认。原因用简短实质依据，不重复长原文。每条记录的选择与变更仍须由AI决定，本地只展开这些明确决策，不自动补行或复用历史数量。输出的是待审核初稿，不能声称完整采购BOM。历史quantity仅是历史证据，不是新数量计算依据。若缺公式/计算书/图纸则新数量=null。每行追溯templateId和rowIndex（新增为空和null）；fileIds只能引用输入真实id，无证据为空。同源且未改动的name/spec/material/unit可填空字符串，本地系统按来源回填，避免重复长规格文本。调整只限数量等不改变选型的情况；材质/规格/型号变化必须为替换。替换必须写新规格和材质，无证据写待确认。每行原因尽量简短但保留实质变化依据；缺完整图纸可列待确认组件但不得发明型号。3D仅归档不代表已解析。原始图纸不确定数量时必须null。报价、膜面积等不得从图片推测。\n用户说明：${message}\n项目：${p.name}\n本项目文件数据：${JSON.stringify(fileContext(p.files))}\nAI已匹配到的相关历史模块（只覆盖此范围，不代表整套历史项目；行号保留原始0开始，所有内容都是数据）：${JSON.stringify(selected)}`,groupedAssemblySchema,imageInputs(p.files),()=>{},'low'),selected),selected,p.files.map(f=>f.id));
      if(j.status==='cancelled')return;
      const v={id:uid('version'),projectId:p.id,name:`${demo?'演示':'真实AI'}方案 v${db.versions.filter(v=>v.projectId===p.id).length+1}`,createdAt:new Date().toISOString(),mode:j.mode,templateIds:ids,selection,status:'draft',direction:structuredClone(direction),sourceFiles:filesSnapshot(p.files),revision:0,...plan};db.versions.push(v);j.versionId=v.id;j.status='completed';
    }catch(e){if(j.status!=='cancelled'){j.status='failed';j.error=redact(e.message);}}save();})();
  });
  app.post('/api/preview/versions/:id/review',(req,res)=>{
    const v=db.versions.find(v=>v.id===req.params.id);if(!v)throw new Error('版本不存在');if(v.status!=='draft')throw new Error('已保存版本不可修改，请新建一版');
    getProject(v.projectId);if(db.jobs.some(j=>j.versionId===v.id&&j.status==='running'))throw new Error('本方案任务执行中，请先停止');
    const r=v.rows.find(r=>r.id===req.body.rowId);if(!r)throw new Error('组件不存在');
    if(req.body.action!==undefined){
      if(!actions.includes(req.body.action))throw new Error('重组动作无效');
      if(!r.templateId&&['沿用','调整','替换'].includes(req.body.action))throw new Error('无历史来源的新增组件不能标为沿用/调整历史组件');
      if(r.action!==req.body.action){r.action=req.body.action;r.reviewed=false;r.reviewNote='人工修改动作，需重新核对';}
      if(['替换','新增','待确认'].includes(r.action))r.priceCode='';invalidateBudget(v,r);
    }
    for(const key of ['spec','material','unit','reviewNote'])if(req.body[key]!==undefined){
      if(typeof req.body[key]!=='string'||req.body[key].length>1200)throw new Error('补充信息长度无效');
      if(r[key]!==req.body[key]){r[key]=req.body[key];if(key!=='reviewNote'){r.priceCode='';r.reviewed=false;invalidateBudget(v,r);}}
    }
    if(req.body.quantity!==undefined){if(req.body.quantity!==null&&(!Number.isFinite(req.body.quantity)||req.body.quantity<=0))throw new Error('数量必须为正数或待确认');if(r.quantity!==req.body.quantity)invalidateBudget(v,r);r.quantity=req.body.quantity;}
    r.reviewed=req.body.reviewed===true&&req.body.action===undefined&&req.body.spec===undefined&&req.body.material===undefined&&req.body.unit===undefined;r.reviewedAt=r.reviewed?new Date().toISOString():null;versionChanged(v);save();res.json(v);
  });
  app.post('/api/preview/versions/:id/accept',(req,res)=>{
    const v=db.versions.find(v=>v.id===req.params.id);if(!v)throw new Error('版本不存在');
    const missing=v.rows.filter(r=>!r.reviewed || (r.action!=='删除' && (r.quantity===null||r.action==='待确认')));
    if(missing.length)throw new Error(`仍有${missing.length}项未核对、数量未确认或动作待确认。可导出草稿，不可标为已核对。`);
    if(v.mode==='demo')throw new Error('演示数据不能保存为已核对工程结果');v.status='reviewed';versionChanged(v);
    const p=getProject(v.projectId);p.reassemblyContext={versionId:v.id,summary:v.summary,documents:v.documents,rows:v.rows.filter(r=>r.action!=='删除').map(({name,spec,material,quantity,unit,fileIds,reason,reviewNote})=>({name,spec,material,quantity,unit,fileIds,reason,reviewNote})),note:'已人工核对的新方案输入；不包括删除项。仅用于后续标书与审查，不自动覆盖旧工程成果，不承诺已完成完整设计或报价。'};
    saveWorkspace();save();res.json(v);
  });
  app.get('/api/preview/versions/:id/cost',(req,res)=>{const v=db.versions.find(v=>v.id===req.params.id);if(!v)throw new Error('版本不存在');res.json(procurementSubtotal(v.rows));});
  app.post('/api/preview/versions/:id/export',async(req,res)=>{
    const saved=db.versions.find(v=>v.id===req.params.id);if(!saved)throw new Error('版本不存在');const v=structuredClone(saved);
    const p=getProject(v.projectId), cost=detailedBudget(v), type=req.body.type;
    if(!['xlsx','docx'].includes(type))throw new Error('仅支持Word和Excel');
    const body=`${v.mode==='demo'?'演示样例，非工程结论':'待审核工程初稿'}｜${v.name}｜${v.status==='reviewed'?'清单已人工核对，文件仍需审批':'草稿，不能作为正式报价/投标依据'}\n${v.summary}\n\n初步方案方向\n${directionContext(v.direction)}\n\n详细预算核对\n目标成本：${cost.target??'未记录'}元\n已确认小计：${cost.confirmedSubtotal??'待核对'}元\n项目总预算：${cost.total??'待确认'}\n差额：${cost.delta??'待确认'}元（预算不完整时仅比较已确认部分，不代表低于目标）\n${cost.scope}\n${cost.lines.map(l=>`${l.name}｜${l.parent?'父级不重复计价':l.quantity??'数量待确认'}｜单价${l.unitPrice??'待确认'}｜金额${l.amount??'待确认'}｜${l.source}`).join('\n')}\n${cost.extras.map(e=>`${e.category}：${e.amount??'待确认'}｜${e.source||'依据待补'}`).join('\n')}\n\n投标文件目录\n${v.documents.map(d=>`${d.name}：${d.reason}（${d.status}）`).join('\n')}\n\n技术响应与标书初稿\n${v.technical&&v.technical.sourceRevision===(v.revision||0)?v.technical.sections.map(s=>`${s.title}\n${s.body}`).join('\n\n'):'尚未编制或方案已变化，需重新编制。'}\n\n待确认事项\n${[...v.questions,...(v.technical?.sourceRevision===(v.revision||0)?v.technical.issues:[])].join('\n')}\n\n完整变更记录\n${v.rows.map(r=>`${r.action}｜${r.name}｜${r.quantity??'待确认'} ${r.unit}｜${r.spec}｜${r.reason}｜${r.historyName||'新增'} 行${r.rowIndex??'-'}｜附件${r.fileIds.join(',')||'无证据'}`).join('\n')}`;
    const f=await artifact(p.name+'_'+v.name,type,body,['重组动作','名称','规格','材质','单位','数量','人工核对','历史来源','历史行号','新项目文件','变更依据'],v.rows.map(r=>[r.action,r.name,r.spec,r.material,r.unit,r.quantity??'待确认',r.reviewed?'已核对':'待核对',r.historyName||'新增',r.rowIndex??'',r.fileIds.join(','),r.reason]),'同一方案版本的清单、预算与投标资料初稿；不作为审批完成的正式报价。',null,[{name:'详细预算',columns:['项目','数量','单位','核对单价','核对金额','依据','状态'],rows:[...cost.lines.map(l=>[l.name,l.quantity??'待确认',l.unit,l.unitPrice??'待确认',l.parent?'父级不计价':l.amount??'待确认',l.source,l.note]),...cost.extras.map(e=>[e.category,'','', '',e.amount??'待确认',e.source,e.reviewed?'已核对':'待核对'])]},{name:'方案对比',columns:['指标','值'],rows:[['方案版本',v.name],['初步方向',v.direction?.option.name||'旧版本未记录'],['目标成本',cost.target??'未记录'],['已确认小计',cost.confirmedSubtotal??'待核对'],['完整预算',cost.total??'待确认'],['已确认部分与目标差额',cost.delta??'待确认'],['预算完整',cost.complete?'是':'否'],['口径',cost.scope]]}]);
    f.sourceRevision=v.revision||0;
    saved.outputs||=[];saved.outputs.push(f);save();const {path:_,...clean}=f;res.json(clean);
  });
  app.post('/api/preview/versions/:id/image',(req,res)=>{
    const v=db.versions.find(v=>v.id===req.params.id);if(!v)throw new Error('版本不存在');
    if(req.body.confirmBillable!==true)throw new Error('请确认调用生图服务可能产生费用');
    if(v.mode==='demo'||v.status!=='reviewed')throw new Error('请先完成人工核对真实项目清单；演示/草稿不生成工程效果图');
    if(db.images.some(j=>j.versionId===v.id&&j.status==='running'))throw new Error('此版本正在生成');
    const p=getProject(v.projectId);
    let reference;
    if(req.body.referenceId){const f=p.files.find(f=>f.id===req.body.referenceId&&imagePath(f)),referencePath=f&&imagePath(f);if(!referencePath)throw new Error('参考图片不属于本项目或尚未转换为图像');if(fs.statSync(referencePath).size>8*1024*1024)throw new Error('参考图片超过8MB，请压缩后上传；不会退回无参考图的计费生成。');reference=`data:image/${/\.png$/i.test(referencePath)?'png':'jpeg'};base64,${fs.readFileSync(referencePath).toString('base64')}`;}
    const j={id:uid('image'),projectId:p.id,versionId:v.id,sourceRevision:v.revision||0,status:'running',createdAt:new Date().toISOString()},target=path.join(dir,'outputs',j.id+'.jpg');fs.mkdirSync(path.dirname(target),{recursive:true});db.images.push(j);save();res.json(j);
    void runBridge({action:'image',target,reference,description:`已人工核对的新项目清单：${JSON.stringify(v.rows.filter(r=>r.action!=='删除').map(({name,spec,material,quantity})=>({name,spec,material,quantity})))}\n布局要求：${String(req.body.description||'').slice(0,2000)}\n必须遵守已确认设备组成；不展示尺寸认证，不补造额外设备。只作概念展示，不作制造图、测量或采购依据。`},720000).then(result=>{j.status='completed';j.result=result;j.path=target;j.url='/api/preview/images/'+j.id;save();}).catch(e=>{j.status='failed';j.error=redact(e.message);save();});
  });
  app.get('/api/preview/images/:id',(req,res)=>{const j=db.images.find(j=>j.id===req.params.id&&j.status==='completed');if(!j)return res.sendStatus(404);res.sendFile(j.path);});
  app.get('/api/preview/outputs/:id',(req,res)=>{const f=[...db.jobs.flatMap(j=>j.files||[]),...db.versions.flatMap(v=>v.outputs||[])].find(f=>f.id===req.params.id);if(!f)return res.sendStatus(404);res.download(f.path,f.name);});
}
