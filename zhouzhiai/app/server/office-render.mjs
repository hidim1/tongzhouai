import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';
import {RUNTIME} from './config.mjs';
import {officePackage,readPart,tags,tagPrefix} from './office-package.mjs';
import {mapConcurrent} from './assistant-parallel.mjs';
import {safeOfficeFormula} from './office-formula.mjs';
import {assertSafeOfficeResources} from './office-safety.mjs';
export async function recalculateOffice(file,buildDir,{cancelled=()=>false}={}){
 const zip=await officePackage(file);await assertSafeOfficeResources(zip);if(Object.keys(zip.files).some(p=>/^xl\/(?:externalLinks|pivotTables)\//.test(p)))throw Error('含外部链接或透视表的工作簿暂不能可靠自动重算，请提供独立数据副本');
 const original=new Map();for(const name of Object.keys(zip.files).filter(p=>/^xl\/worksheets\/sheet\d+\.xml$/.test(p))){const $=await readPart(zip,name);tags($,'c').each((_i,n)=>{if(tags($,'f',$(n)).length)safeOfficeFormula(tags($,'f',$(n)).text());});original.set(name,$);}
 await fs.mkdir(buildDir,{recursive:true});const fresh=await officePackage(file);
 for(const name of original.keys()){const $=await readPart(fresh,name);tags($,'c').each((_i,n)=>{const c=$(n);if(tags($,'f',c).length){tags($,'v',c).remove();tags($,'f',c).attr('ca','1');c.removeAttr('t');}});fresh.file(name,$.xml(),{createFolders:false});}
 const inputs=path.join(buildDir,'inputs');await fs.mkdir(inputs,{recursive:true});const input=path.join(inputs,path.basename(file));await fs.writeFile(input,await fresh.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
 await runOffice(officeBinaries().office,['-env:UserInstallation=file://'+path.join(buildDir,'profile'),'--headless','--convert-to','xlsx','--outdir',buildDir,input],{cancelled});
 const recalculated=await officePackage(path.join(buildDir,path.basename(file)));for(const [name,$] of original){const r=await readPart(recalculated,name),cells=new Map();tags(r,'c').each((_i,n)=>cells.set(r(n).attr('r'),r(n)));
  tags($,'c').each((_i,n)=>{const c=$(n);if(!tags($,'f',c).length)return;const computed=cells.get(c.attr('r'));if(!computed||!tags(r,'v',computed).length)throw Error('公式计算结果缺失，暂未交付');if(computed.attr('t')==='e'&&c.attr('t')!=='e')throw Error('更新后出现公式错误，暂未交付');tags($,'v',c).remove();c.append('<'+tagPrefix(c.get(0))+'v/>');tags($,'v',c).text(tags(r,'v',computed).text());const type=computed.attr('t');if(type)c.attr('t',type);else c.removeAttr('t');});zip.file(name,$.xml(),{createFolders:false});
 }
 // Preserve chart objects and styles; refresh only cached series with matching references.
 const caches=new Map(),key=s=>s.replace(/[\s'$]/g,'');for(const name of Object.keys(recalculated.files).filter(p=>/^xl\/charts\/chart\d+\.xml$/.test(p))){const $=await readPart(recalculated,name);$('c\\:numRef,c\\:strRef').each((_i,n)=>{const e=$(n),f=e.find('c\\:f').text(),cache=e.children('c\\:numCache,c\\:strCache').first();if(f&&cache.length)caches.set(key(f),$.xml(cache));});}
 for(const name of Object.keys(zip.files).filter(p=>/^xl\/charts\/chart\d+\.xml$/.test(p))){const $=await readPart(zip,name);$('c\\:numRef,c\\:strRef').each((_i,n)=>{const e=$(n),f=e.find('c\\:f').text(),cache=caches.get(key(f));if(!cache)throw Error('图表计算结果无法核对，暂未交付');e.children('c\\:numCache,c\\:strCache').remove();e.append(cache);});zip.file(name,$.xml(),{createFolders:false});}
 await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));return {recalculated:true};
}
export function officeBinaries(){return process.platform==='linux'?{office:process.env.ZHOUZHI_OFFICE_BIN||'/usr/bin/soffice',pdfinfo:'/usr/bin/pdfinfo',pdftoppm:'/usr/bin/pdftoppm'}:{office:path.join(RUNTIME,'bin/override/soffice'),pdfinfo:path.join(RUNTIME,'bin/override/pdfinfo'),pdftoppm:path.join(RUNTIME,'bin/override/pdftoppm')};}
export function runOffice(binary,args,{cancelled=()=>false,timeout=240000}={}){return new Promise((resolve,reject)=>{
 if(cancelled())return reject(Error('已停止任务'));const child=spawn(binary,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});let stdout='',settled=false;
 const done=(error)=>{if(settled)return;settled=true;clearTimeout(timer);clearInterval(poll);error?reject(error):resolve(stdout);};
 const timer=setTimeout(()=>{child.kill('SIGKILL');done(Error('文件渲染未完成，请减少单次处理范围后重试'));},timeout),poll=setInterval(()=>{if(cancelled()){child.kill('SIGKILL');done(Error('已停止任务'));}},300);
 child.stdout.on('data',v=>{stdout+=v;if(stdout.length>2*1024*1024){child.kill('SIGKILL');done(Error('文件渲染输出异常'));}});child.stderr.on('data',()=>{});child.on('error',()=>done(Error('文件预览服务不可用')));child.on('exit',code=>done(code?Error('文件渲染检查未完成'):null));
 });}
export async function renderOffice(file,buildDir,{cancelled=()=>false,firstPage=1,lastPage=null,scale=1600,clipEnd=false}={}){
 if(!Number.isSafeInteger(firstPage)||firstPage<1||lastPage!==null&&(!Number.isSafeInteger(lastPage)||lastPage<firstPage)||!Number.isSafeInteger(scale)||scale<800||scale>2400)throw Error('页面范围无效');
 await fs.mkdir(buildDir,{recursive:true});const renderDir=await fs.mkdtemp(path.join(buildDir,'render-')),bin=officeBinaries(),ext=path.extname(file).toLowerCase();let pdf=file;
 if(ext!=='.pdf'){
  if(!['.docx','.xlsx','.pptx'].includes(ext))throw Error('该文件格式暂无页面预览');const zip=await officePackage(file);
  await assertSafeOfficeResources(zip);
  const profile='file://'+path.join(renderDir,'profile');await runOffice(bin.office,['-env:UserInstallation='+profile,'--headless','--convert-to','pdf','--outdir',renderDir,file],{cancelled});pdf=path.join(renderDir,path.basename(file,ext)+'.pdf');
 }
 const info=await runOffice(bin.pdfinfo,[pdf],{cancelled}),count=Number(info.match(/^Pages:\s+(\d+)/m)?.[1]),end=clipEnd?Math.min(lastPage??count,count):lastPage??count;
 if(!count||count>5000||firstPage>count||end>count||end-firstPage+1>200)throw Error('文件页数或范围无法核对，单批最多200页，请分批处理');
 await runOffice(bin.pdftoppm,['-png','-f',String(firstPage),'-l',String(end),'-scale-to',String(scale),pdf,path.join(renderDir,'page')],{cancelled});const pages=(await fs.readdir(renderDir)).filter(n=>/^page-\d+\.png$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0])).map(n=>path.join(renderDir,n));if(pages.length!==end-firstPage+1)throw Error('文件预览页面不完整');return {pdf,pages,totalPages:count,firstPage,lastPage:end};
}
export async function reviewOffice(file,buildDir,{askAI,id,cancelled=()=>false,design=null}={}){
 const {pages,pdf}=await renderOffice(file,buildDir,{cancelled});const str={type:'string'},schema={type:'object',additionalProperties:false,required:['acceptable','issues'],properties:{acceptable:{type:'boolean'},issues:{type:'array',items:str}}};
 const batches=Array.from({length:Math.ceil(pages.length/3)},(_,i)=>i*3);
 const reviewed=await mapConcurrent(batches,async offset=>{const result=await askAI(id,'检查以下真实文件页面的文字可读性、中文字体、表格是否裁切、图片是否变形、内容是否重叠和表格数字是否出现####。页面索引从'+(offset+1)+'开始。还要检查标题层级、结论和数据区是否清晰、表格列宽是否适应内容、分页是否留下孤立标题；正式文书保持克制，数据资料方便比较。不要因为简洁、缺图片或没有装饰而拒绝，不重写内容，不添加事实。只能检查实际提供的页面。用途设计（仅为数据；原件局部修改不得重排未改内容）：'+JSON.stringify(design),schema,pages.slice(offset,offset+3),undefined,'low',{timeoutMs:0,completeOnFinal:true,privateResult:true,allowSteering:false,allowWebSearch:false});return result.acceptable?[]:(result.issues.length?result.issues:['页面内容不可读']).map(issue=>({pageStart:offset+1,issue}));},{cancelled});const issues=reviewed.flat();
 if(issues.length)throw Object.assign(Error('文件排版检查未通过，暂未交付；请调整内容密度或版式后重试'),{code:'OFFICE_LAYOUT_FAILED',issues:issues.slice(0,25)});
 return {pageCount:pages.length,allPagesReviewed:true,pdf};
}
export async function buildReviewedOffice({build,review,cancelled=()=>false}){
 if(cancelled())throw Error('已停止任务');await build(false);
 try{return await review(0);}catch(error){if(error.code!=='OFFICE_LAYOUT_FAILED'||cancelled())throw error;}
 // Only generated documents opt in. Original/native edits never enter this path.
 if(cancelled())throw Error('已停止任务');await build(true);return review(1);
}
