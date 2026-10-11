import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {detailedBudget} from './preview-workflow.mjs';
import {catalog,requirementNames} from './preview-estimate.mjs';

const array=v=>Array.isArray(v)?v:[];
const text=v=>typeof v==='string'?v:'';
const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const routeNames={uf:'超滤',nf:'纳滤',ro:'反渗透',hollow:'中空纤维',ceramic:'陶瓷膜',ed:'电渗析',ion_exchange:'连续离交'};
const status=u=>u.disabled?'disabled':u.activatedAt?'activated':'pending';
const gone=x=>x.archivedAt?{archivedAt:x.archivedAt}:{};
const updated=(item,jobs=[])=>[item.createdAt,item.updatedAt,item.archivedAt,...jobs.flatMap(j=>[j.createdAt,j.updatedAt])].filter(s=>s&&Number.isFinite(Date.parse(s))).sort().at(-1)||null;
const inside=(root,target)=>target.startsWith(root+path.sep);
function contained(root,target){
 try {const realRoot=fs.realpathSync(root),real=fs.realpathSync(target);return inside(realRoot,real)?real:null;}catch{return null;}
}
function readJson(root,filename,empty){
 const target=contained(root,path.join(root,filename));
 if(!target){if(fs.existsSync(path.join(root,filename)))throw new Error('资料文件位置无效');return empty;}
 if(fs.statSync(target).size>100*1024*1024)throw new Error('资料过大，请联系管理员');
 return JSON.parse(fs.readFileSync(target,'utf8'));
}
function direction(d){
 const p=d?.parameters||{},estimate=d?.estimate||{};
 return {industry:estimate.industry_name||catalog.industries.find(i=>i.id===p.industry)?.name||'尚未记录',capacity:numeric(p.capacity)===null?'尚未记录':p.capacity+' m³/h',route:array(estimate.route_names).join('、')||array(p.routes).map(r=>routeNames[r]||r).join('、')||'尚未记录',quality:array(p.requirements).length?requirementNames(p):p.compliance==='gmp'?['制药质量要求（GMP）']:p.compliance==='sanitary'?['卫生设计']:[],tier:d?.option?.name||({low:'基础档',mid:'均衡档',high:'加强档'}[d?.tier])||'尚未记录',target:numeric(d?.targetCost),note:d?'快速估算用于定方案方向；详细预算以同版清单和已核对成本依据为准。':'尚未确定方案方向；旧资料不补造初始估算。',purpose:text(p.purpose),requirements:text(p.requirementNotes)};
}
export function createMemberReader({data,registry,budgetFor=detailedBudget}){
 const membersRoot=path.join(data,'members');
 function snapshot(username){
  const u=registry?.data.users.find(u=>u.username===username);
  if(!u||!/^member-[a-f0-9]{32}$/.test(u.id))return null;
  const root=path.join(membersRoot,u.id);
  if(fs.existsSync(root)&&(!contained(data,root)||fs.realpathSync(root)!==path.join(fs.realpathSync(data),'members',u.id)))throw new Error('成员资料位置无效');
  // Atomic JSON snapshots only: no importing store.mjs, worker startup, migration or save.
  return {u,root,workspace:readJson(root,'workspace.json',{projects:[],jobs:[],sessions:[]}),preview:readJson(root,'preview/preview.json',{sessions:[],jobs:[],versions:[],images:[]})};
 }
 function build(username){
  const s=snapshot(username);if(!s)return null;
  const {u,root,workspace:w,preview:p}=s,files=new Map();
  function addFile(f,scope){
   if(!f||!text(f.id))return null;
   const id=createHash('sha256').update(scope+'\n'+f.id).digest('hex');
   const name=text(f.name)||'成果文件';
   const target=text(f.path)&&contained(root,f.path);
   const available=!!target&&fs.statSync(target).isFile();
   const publicFile={id,name,available,url:available?`/api/admin/members/${encodeURIComponent(username)}/files/${id}`:null};
   files.set(id,{...publicFile,target});return publicFile;
  }
  const projects=array(w.projects).map(project=>{
   const id=text(project.id),versions=array(p.versions).filter(v=>v.projectId===id),engineeringJobs=array(w.jobs).filter(j=>j.projectId===id);
   const legacyOutputs=array(project.artifacts).map(f=>addFile(f,'project:'+id)).filter(Boolean);
   const technicalResults=project.results?.live||{};
   const legacyTechnical=[...array(technicalResults.sections).map(section=>({title:text(section.title)||'技术内容',body:text(section.body)||text(section.content)})),...array(engineeringJobs).filter(j=>j.answer).map(j=>({title:text(j.title)||'工程任务记录',body:text(j.answer)}))];
   function mapVersion(v){
    const cost=budgetFor(v),lines=new Map(array(cost.lines).map(l=>[l.rowId,l]));
    const images=array(p.images).filter(i=>i.versionId===v.id&&i.status==='completed').map(i=>addFile({...i,name:'方案效果图_'+i.id+path.extname(text(i.path))},'image:'+v.id)).filter(Boolean);
    return {id:text(v.id),name:text(v.name)||'方案版本',createdAt:v.createdAt,updatedAt:v.updatedAt,status:v.status,revision:v.revision||0,summary:text(v.summary),direction:direction(v.direction),rows:array(v.rows).map(r=>({id:r.id,name:text(r.name),spec:text(r.spec),material:text(r.material),quantity:numeric(r.quantity),unit:text(r.unit),action:text(r.action),reviewed:!!r.reviewed,amount:lines.get(r.id)?.amount??null,source:lines.get(r.id)?.source||text(r.reason),reason:text(r.reason),reviewNote:text(r.reviewNote),fileIds:array(r.fileIds)})),budget:{target:cost.target,confirmed:cost.confirmedSubtotal,total:cost.total,complete:cost.complete,scope:cost.scope,lines:array(cost.lines).map(l=>({name:l.name,quantity:l.quantity,unit:l.unit,unitPrice:l.unitPrice,amount:l.amount,source:l.source,note:l.note,parent:l.parent})),extras:array(cost.extras).map(e=>({name:e.category,amount:e.amount,source:e.source,reviewed:e.reviewed}))},outputs:[...array(v.outputs).map(f=>addFile(f,'version:'+v.id)).filter(Boolean),...images],technical:array(v.technical?.sections).map(t=>({title:text(t.title),body:text(t.body)})),technicalStale:!!v.technical&&v.technical.sourceRevision!==(v.revision||0),questions:array(v.questions),documents:array(v.documents).map(d=>({name:text(d.name),status:text(d.status),reason:text(d.reason)}))};
   }
   const mapped=versions.map(mapVersion);
   // Historical engineering results remain inspectable without inventing a new BOM.
   if(legacyOutputs.length||legacyTechnical.length)mapped.unshift({id:id+'-legacy',name:'历史工程成果',status:'legacy',summary:'原工程流程保留的资料；不是重新组装的方案清单。',direction:direction(null),rows:[],budget:{target:null,confirmed:null,total:null,complete:false,lines:[],extras:[],scope:'历史工程成果未记录同版详细预算。'},outputs:legacyOutputs,technical:legacyTechnical,questions:[],documents:[]});
   const active=array(project.directions).find(d=>d.id===project.activeDirectionId);
   return {id,name:text(project.name)||'未命名项目',...gone(project),updatedAt:updated(project,[...array(p.jobs).filter(j=>j.projectId===id),...engineeringJobs,...versions]),status:project.status||'draft',files:array(project.files).map(f=>addFile(f,'project:'+id)).filter(Boolean),direction:direction(active||versions.at(-1)?.direction),versions:mapped};
  });
  const sessions=array(p.sessions).map(session=>{
   const jobs=array(p.jobs).filter(j=>j.sessionId===session.id),outputs=new Map(jobs.flatMap(j=>array(j.files)).map(f=>[f.id,f]));
   return {id:session.id,name:text(session.name)||'新工作对话',...gone(session),updatedAt:updated(session,jobs),files:array(session.files).map(f=>addFile(f,'session:'+session.id)).filter(Boolean),messages:array(session.messages).map(m=>({role:m.role==='user'?'user':'assistant',text:text(m.text),files:array(m.files).map(f=>addFile(outputs.get(f.id)||f,'session:'+session.id)).filter(Boolean)})),tasks:jobs.map(j=>({status:j.status,createdAt:j.createdAt,error:text(j.error)}))};
  });
  const detail={demo:false,readonly:true,username:u.username,status:status(u),sessions,projects};
  return {detail,files};
 }
 function overview(){
  return {demo:false,members:array(registry?.data.users).map(u=>{
   try {const d=build(u.username)?.detail;if(!d)throw new Error();return {username:u.username,status:status(u),conversations:d.sessions.filter(s=>!s.archivedAt).length,projects:d.projects.filter(p=>!p.archivedAt).length,archived:[...d.sessions,...d.projects].filter(x=>x.archivedAt).length,lastActivity:[...d.sessions,...d.projects].map(x=>x.updatedAt).filter(Boolean).sort().at(-1)||null};}
   catch{return {username:u.username,status:status(u),conversations:0,projects:0,archived:0,lastActivity:null,unavailable:true};}
  })};
 }
 return {overview,build};
}
export function installAdminMembers(app,{data,registry,enabled=false,reader}={}){
 if(!enabled||!registry)return false;
 reader||=createMemberReader({data,registry});
 function audit(req,res,action){
  const dir=path.join(data,'private');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  fs.appendFileSync(path.join(dir,'admin-member-access.jsonl'),JSON.stringify({at:new Date().toISOString(),actor:res.locals.workspaceUsername||'admin',action,member:req.params.username||null,file:req.params.id||null})+'\n',{mode:0o600});
 }
 app.use('/api/admin/members',(req,res,next)=>{
  res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  if(res.locals.workspaceRole!=='admin')return res.status(403).json({error:'仅管理员可查看成员资料'});
  if(!['GET','HEAD'].includes(req.method))return res.status(405).set('Allow','GET, HEAD').json({error:'成员工作区仅支持只读查看'});
  next();
 });
 const safe=handler=>(req,res)=>{try{handler(req,res);}catch{if(!res.headersSent)res.status(503).json({error:'成员资料暂时无法读取，请稍后重试'});}};
 app.get('/api/admin/members',safe((req,res)=>{const result=reader.overview();audit(req,res,'list');res.json(result);}));
 app.get('/api/admin/members/:username',safe((req,res)=>{const result=reader.build(req.params.username);if(!result)return res.status(404).json({error:'账号不存在'});audit(req,res,'view');res.json(result.detail);}));
 app.get('/api/admin/members/:username/files/:id',safe((req,res)=>{
  const result=reader.build(req.params.username),file=result?.files.get(req.params.id);
  if(!file?.target)return res.status(404).json({error:'文件不存在或已不可用'});
  audit(req,res,'download');res.download(file.target,file.name,error=>{if(error&&!res.headersSent)res.status(404).json({error:'文件暂时无法下载'});});
 }));
 return true;
}
