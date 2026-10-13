import fs from 'node:fs';
import path from 'node:path';import {createHash} from 'node:crypto';
import {DATA} from './config.mjs';
import {renderOffice,reviewOffice,recalculateOffice} from './office-render.mjs';
import {editOffice} from './office-edit.mjs';
import {assertPublicOutput} from './member-policy.mjs';
import {filePage,historyPage,searchFiles,markRead} from './assistant-context.mjs';
import {calculate} from './assistant-math.mjs';
import {tableStats} from './assistant-table.mjs';
import {preferenceStore} from './assistant-preferences.mjs';
import {matchesOutputSchema} from './preview-result.mjs';
import {publicError} from './member-policy.mjs';

const str={type:'string'},integer={type:'integer'},obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const tool=(name,description,inputSchema)=>({type:'function',name,description,inputSchema});
const replacementsSchema={type:'array',items:obj({part:str,find:str,replace:str})};
const cellsSchema={type:'array',items:obj({sheet:str,address:str,value:{type:['string','number','boolean','null']}})};
export const assistantTools=[
 tool('zhouzhi_list_files','列出当前任务获准使用的资料及当前对话历史成果，返回可读取的ID，不访问其他对话。',obj({})),
 tool('zhouzhi_read_file','按字符范围读取资料正文。长文件可以一直读取到nextOffset为空。',obj({id:str,offset:integer,limit:integer})),
 tool('zhouzhi_search_files','在获准使用的全部资料正文中检索原文位置，再用read_file读取上下文。',obj({query:str,limit:integer})),
 tool('zhouzhi_history','读取或检索本对话完整历史。query为空时按消息序号分页。',obj({query:str,offset:integer,limit:integer})),
 tool('zhouzhi_structure','读取文件的原生表格、Excel工作表或PPT页面结构。part为空列出索引，否则按索引分页读取。',obj({id:str,part:str,offset:integer,limit:integer})),
 tool('zhouzhi_view_image','查看获准的图片资料，不限于输入首三张。每次只读取指定图片ID。',obj({id:str})),
 tool('zhouzhi_calculate','可靠数值计算，支持四则运算、幂、SUM/MIN/MAX/AVG/ABS/ROUND；不运行代码，不推测缺失输入。',obj({expression:str})),
 tool('zhouzhi_preference','仅用户本轮明确要求记住或忘记时，保存或清除账号范围内的表达偏好，不保存业务事实、凭据或敏感资料。key为voice/length/documentStyle，清除时value为空。',obj({key:{type:'string',enum:['voice','length','documentStyle']},value:str})),
 tool('zhouzhi_table_stats','对指定Excel工作表全部已解析记录做统计，不抽样。列用A/B等字母，startRow指定首个数据行。groupColumn为空表示不分组，返回数值、缺失和非数值记录数，不把未知当零。',obj({id:str,sheet:str,valueColumn:str,groupColumn:str,startRow:integer,offset:integer,limit:integer,operation:{type:'string',enum:['sum','average','min','max','count']}})),
 tool('zhouzhi_view_page','查看获准PDF、Word、Excel或PPT的真实页面。page从1开始，返回该页图像及总页数，不读取任意路径。',obj({id:str,page:integer})),
 tool('zhouzhi_edit_file','仅在用户本轮要求修改对应格式文件时使用。保留原件、版式和未修改内容，另存新版本并检查。Word/PPT/Markdown用唯一原文替换，PPT part为slide:0等0开始页面；Excel按sheet和address修改已有单元格。不改结构、不执行代码；不支持的复杂对象明确失败。成功后成果已经生成，最终files不要重复生成同一文件。',obj({id:str,title:str,replacements:replacementsSchema,cells:cellsSchema})),
];

export function createAssistantTools({session,job,save,extractDocument,priorOutputs=[],askAI}){
 const checkpoint=job.checkpoint??={version:1,stage:'analysis'},receipts=checkpoint.toolReceipts??=[];
 const outputs=()=>priorOutputs;
 const permitted=()=>[...session.files.filter(f=>(job.fileIds||[]).includes(f.id)),...outputs().filter(f=>job.priorOutputIds?.includes(f.id)),...(job.files||[])];
 const cached=new Map(),previews=new Map();const cancelled=()=>job.status!=='running';
 async function get(id){const file=permitted().find(f=>f.id===id);if(!file)throw Error('资料不属于本次任务，不能读取');
  if(file.text!==undefined&&!file.error&&!file.unsupported||!extractDocument)return file;
  if(!cached.has(id))cached.set(id,Promise.resolve(extractDocument(file.path)).then(parsed=>({...file,...parsed,error:parsed.error,status:parsed.error?'解析失败':parsed.unsupported?'待解析':parsed.text?'已提取文本':file.status})));return cached.get(id);
 }
 async function all(){return Promise.all(permitted().map(f=>get(f.id)));}
 const text=value=>[{type:'inputText',text:JSON.stringify(value)}];
 async function execute(name,args,callId){
  if(job.status!=='running')return {success:false,contentItems:text({error:'任务已停止，不能继续读取'})};
  const spec=assistantTools.find(t=>t.name===name);if(!spec||!matchesOutputSchema(args,spec.inputSchema))return {success:false,contentItems:text({error:'工具或参数无效'})};
  // Read-only tools may run concurrently; receipt IDs are scoped to this job.
  try{let value,contentItems;
   if(name==='zhouzhi_list_files')value=(await all()).map(f=>({id:f.id,name:f.name,status:f.status,textCharacters:(f.text||'').length,sheets:f.sheets?.map(s=>s.name),slides:f.slides?.length,tables:f.tables?.length,image:/\.(png|jpe?g)$/i.test(f.name)}));
   else if(name==='zhouzhi_read_file'){const file=await get(args.id);value=filePage(file,args);markRead(checkpoint,file.id,value.offset,value.end,value.totalCharacters);}
   else if(name==='zhouzhi_search_files')value=searchFiles(await all(),args);
   else if(name==='zhouzhi_history')value=historyPage(session.messages,args);
   else if(name==='zhouzhi_calculate')value=calculate(args.expression);
   else if(name==='zhouzhi_preference')value=preferenceStore(DATA).update(job.message,args);
   else if(name==='zhouzhi_table_stats'){const file=await get(args.id),sheet=file.sheets?.find(s=>s.name===args.sheet);if(!sheet)throw Error('工作表不存在或未能解析');value=tableStats(sheet,args);}
   else if(name==='zhouzhi_view_page'){
    const file=await get(args.id);if(!Number.isSafeInteger(args.page)||args.page<1)throw Error('页码无效');if(!previews.has(file.id))previews.set(file.id,renderOffice(file.path,path.join(DATA,'preview','page-read',job.id,file.id),{cancelled}));const rendered=await previews.get(file.id);if(args.page>rendered.pages.length)throw Error('指定页码不存在');
    contentItems=[...text({id:file.id,page:args.page,totalPages:rendered.pages.length}),{type:'inputImage',imageUrl:'data:image/png;base64,'+fs.readFileSync(rendered.pages[args.page-1]).toString('base64')}];
   }
   else if(name==='zhouzhi_edit_file'){
    const source=await get(args.id),format=path.extname(source.path).slice(1).toLowerCase();if(!(job.deliveryFormats||[]).includes(format))throw Error('本轮未授权交付或修改此格式文件，请先向用户确认');if(!askAI)throw Error('文件检查服务不可用');assertPublicOutput(args);
    const digest=createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0,20),id=job.id+'-edit-'+digest,prior=job.files.find(f=>f.id===id);
    if(prior)value={id:prior.id,name:prior.name,alreadyCreated:true};else{
     const out=path.join(DATA,'preview','outputs');fs.mkdirSync(out,{recursive:true});const target=path.join(out,id+'.'+format),build=path.join(DATA,'preview','native-edits',id);const evidence=await editOffice(source.path,target,args);
     if(format==='xlsx')await recalculateOffice(target,path.join(build,'recalculation'),{cancelled});if(format!=='md')await reviewOffice(target,path.join(build,'review'),{askAI,id:job.id,cancelled});
     if(cancelled())throw Error('已停止任务');const name=String(args.title||source.name).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/\.(docx|xlsx|pptx|md)$/i,'').slice(0,80)+'.'+format,file={id,name,path:target,url:'/api/preview/outputs/'+id};assertPublicOutput({name,text:(await extractDocument(target)).text});job.files.push(file);value={id,name,changed:evidence.changed,validated:true};
    }
   }
   else if(name==='zhouzhi_view_image'){
    const file=await get(args.id);if(!/\.(png|jpe?g)$/i.test(file.name))throw Error('该资料不是图片');const bytes=fs.readFileSync(file.path);if(bytes.length>12*1024*1024)throw Error('图片过大，请上传压缩后的图片');
    contentItems=[{type:'inputImage',imageUrl:'data:image/'+(/\.png$/i.test(file.name)?'png':'jpeg')+';base64,'+bytes.toString('base64')}];
   }else if(name==='zhouzhi_structure'){
    const f=await get(args.id);if(!Number.isSafeInteger(args.offset)||args.offset<0||!Number.isSafeInteger(args.limit)||args.limit<1||args.limit>100)throw Error('读取范围无效');
    const parts=[...(f.sheets||[]).map(s=>({id:'sheet:'+s.name,name:s.name,items:s.rows})),...(f.tables||[]).map((r,i)=>({id:'table:'+i,items:r})),...(f.slides||[]).map((s,i)=>({id:'slide:'+i,items:s.elements||[],...s}))];
    if(!args.part)value=parts.map(p=>({id:p.id,name:p.name||p.title||p.id,total:p.items.length}));
    else{const p=parts.find(p=>p.id===args.part);if(!p)throw Error('指定页面或表格不存在');value={id:p.id,total:p.items.length,items:p.items.slice(args.offset,args.offset+args.limit),nextOffset:args.offset+args.limit<p.items.length?args.offset+args.limit:null};}
   }
   if(job.status!=='running')throw Error('任务已停止');
   receipts.push({callId,tool:name,completedAt:new Date().toISOString(),...(args.id?{fileId:args.id}:{})});save();return {success:true,contentItems:contentItems||text(value)};
  }catch(error){receipts.push({callId,tool:name,failed:true,completedAt:new Date().toISOString(),error:publicError(error.message)});save();return {success:false,contentItems:text({error:publicError(error.message)})};}
 }
 return {definitions:assistantTools,execute};
}
