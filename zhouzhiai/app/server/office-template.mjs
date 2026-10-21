import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {officePackage,readPart,tags,presentationParts,tagPrefix} from './office-package.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const textOf=($,node)=>tags($,'t',$(node)).toArray().map(t=>$(t).text()).join('');
const wordParts=zip=>Object.keys(zip.files).filter(p=>/^word\/(?:document|header\d+|footer\d+)\.xml$/.test(p));
function blocks($){const body=tags($,'body').first();return body.children().toArray().filter(n=>['p','tbl'].includes(n.name?.split(':').at(-1)));}
const paragraphs=($,n)=>tags($,'p',$(n)).toArray();
function paragraphXML($,base,text,styleSizes=new Map()){
 const prefix=tagPrefix(base),originalPr=base?$(base).children().filter((_i,n)=>n.name?.split(':').at(-1)==='pPr').first():null,pPr=originalPr?.length?originalPr.clone():$('<'+prefix+'pPr/>'),rPr=base?tags($,'rPr',$(base)).first():null;
 const style=tags($,'pStyle',$(base)).first().attr(prefix+'val'),sizes=tags($,'sz',$(base)).toArray().map(n=>Number($(n).attr(prefix+'val'))),size=Math.max(styleSizes.get(style)||styleSizes.get('default')||24,...sizes.filter(Number.isFinite));
 // A larger inherited heading font must not reuse the body font's fixed line
 // box when the new text wraps. Only the changed/new paragraph is adjusted;
 // source styles, original paragraphs and all unmodified objects are retained.
 let spacing=pPr.children().filter((_i,n)=>n.name?.split(':').at(-1)==='spacing').first();if(!spacing.length){pPr.append('<'+prefix+'spacing/>');spacing=pPr.children().last();}
 const old=Number(spacing.attr(prefix+'line'))||0,rule=spacing.attr(prefix+'lineRule'),minimum=Math.ceil(size*10*1.35);
 spacing.attr(prefix+'lineRule','atLeast').attr(prefix+'line',String(Math.max(minimum,rule==='exact'||rule==='atLeast'?old:0)));
 return '<'+prefix+'p>'+(pPr?.length?$.xml(pPr):'')+'<'+prefix+'r>'+(rPr?.length?$.xml(rPr):'')+String(text).split('\n').map((t,i)=>(i?'<'+prefix+'br/>':'')+'<'+prefix+'t xml:space="preserve">'+escape(t)+'</'+prefix+'t>').join('')+'</'+prefix+'r></'+prefix+'p>';
}
async function wordStyleSizes(zip){const sizes=new Map();if(!zip.file('word/styles.xml'))return sizes;const $=await readPart(zip,'word/styles.xml'),defaultSize=Number(tags($,'sz',tags($,'docDefaults').first()).first().attr('w:val'))||24,styles=new Map(tags($,'style').toArray().map(n=>[$(n).attr('w:styleId'),n]));sizes.set('default',defaultSize);
 for(const [id,node] of styles){let current=node,size=null;const seen=new Set();while(current&&!seen.has(current)){seen.add(current);const direct=Number(tags($,'sz',$(current)).first().attr('w:val'));if(direct){size=direct;break;}current=styles.get(tags($,'basedOn',$(current)).first().attr('w:val'));}sizes.set(id,size||defaultSize);}return sizes;
}
export async function inspectTemplate(file){
 const zip=await officePackage(file),format=path.extname(file).slice(1).toLowerCase(),fingerprint=digest(await fs.readFile(file));
 if(format==='docx'){
  const parts=[];for(const name of wordParts(zip)){const $=await readPart(zip,name),nodes=name==='word/document.xml'?blocks($):tags($,'p').toArray();
   parts.push({part:name,blocks:nodes.map((n,i)=>({id:'block:'+i,kind:n.name.split(':').at(-1)==='tbl'?'table':'paragraph',text:textOf($,n),...(n.name.split(':').at(-1)==='tbl'?{rows:tags($,'tr',$(n)).toArray().map(r=>$(r).children().filter((_i,c)=>c.name?.split(':').at(-1)==='tc').toArray().map(c=>textOf($,c)))}:{})}))});
  }return{format,fingerprint,parts,note:'段落与表格ID只对应此指纹版本；页眉页脚可单独定位。继承原文件样式、页眉页脚和相关资源，不重建母版。'};
 }
 if(format==='pptx'){
  const p=await readPart(zip,'ppt/presentation.xml'),names=await presentationParts(zip),ids=tags(p,'sldId').toArray().map(n=>p(n).attr('id'));
  const size=tags(p,'sldSz').first(),scale=(Number(size.attr('cx'))||12192000)/1280,height=(Number(size.attr('cy'))||6858000)/scale;
  const slides=[];for(const [i,name] of names.entries()){const $=await readPart(zip,name),nodes=['sp','pic','graphicFrame'].flatMap(t=>tags($,t).toArray());slides.push({id:ids[i],index:i,part:name,elements:nodes.map(n=>{const xfrm=tags($,'xfrm',$(n)).first(),off=tags($,'off',xfrm).first(),ext=tags($,'ext',xfrm).first();return{id:tags($,'cNvPr',$(n)).first().attr('id'),kind:n.name.split(':').at(-1),text:textOf($,n),frame:off.length&&ext.length?{x:Number(off.attr('x'))/scale,y:Number(off.attr('y'))/scale,width:Number(ext.attr('cx'))/scale,height:Number(ext.attr('cy'))/scale}:null};})});}
  return{format,fingerprint,canvasWidth:1280,canvasHeight:height,slides,note:'页面与元素ID对应此指纹版本；可复制、删除、重排、修改文字或移动原生文字/图片/图表框，保留母版、背景与资源。坐标使用返回画布尺寸；分组内元素不自动移动。删除仅影响新版本，原件不变。'};
 }
 if(format==='xlsx'){
  const wb=await readPart(zip,'xl/workbook.xml');return{format,fingerprint,sheets:tags(wb,'sheet').toArray().map(n=>({name:wb(n).attr('name')})),note:'可在明确位置写入新范围、公式或新增表；保留原生样式和对象。新增数据不自动猜测或扩展其他公式范围，须明确给出汇总公式并重算。'};
 }
 throw Error('此格式不支持原版式结构编辑');
}
function wholeText($,node,text){const ns=tags($,'t',$(node)).toArray();if(!ns.length)throw Error('此元素没有可修改的原生文字');$(ns[0]).text(text).attr('xml:space','preserve');for(const n of ns.slice(1))$(n).text('');}
function nextPart(zip,folder,stem){let n=1;while(zip.file(folder+'/'+stem+n+'.xml'))n++;return folder+'/'+stem+n+'.xml';}
function addType($,name,contentType){if(!$('Override').toArray().some(n=>$(n).attr('PartName')==='/'+name))$('Types').append('<Override PartName="/'+escape(name)+'" ContentType="'+contentType+'"/>');}
export async function editTemplate(source,target,{fingerprint,operations=[]}={}){
 const before=await fs.readFile(source);if(digest(before)!==fingerprint)throw Error('文件版本已经变化，请重新读取版本后修改');
 if(!operations.length||operations.length>100)throw Error('结构修改条目须为1至100项');const zip=await officePackage(source),format=path.extname(source).slice(1).toLowerCase(),changed=[];
 if(format==='docx'){
  const loaded=new Map(),styleSizes=await wordStyleSizes(zip);for(const part of wordParts(zip)){const $=await readPart(zip,part),nodes=part==='word/document.xml'?blocks($):tags($,'p').toArray();loaded.set(part,{$,nodes});}
  for(const op of operations){const context=loaded.get(op.part||'word/document.xml');if(!context)throw Error('段落修改范围无效');const {$,nodes}=context,index=Number(op.blockId?.replace(/^block:/,'')),base=/^block:\d+$/.test(op.blockId||'')?nodes[index]:null;
   if(!base||!base.parent)throw Error('原文块不存在或本轮已删除');
   if(op.action==='replaceParagraph'){if(base.name.split(':').at(-1)!=='p'||typeof op.text!=='string'||op.text.length>12000)throw Error('段落修改内容无效');if(['drawing','pict','fldChar','hyperlink'].some(t=>tags($,t,$(base)).length))throw Error('此段落含图片、字段或链接，请用唯一原文局部替换，不自动移除对象');$(base).replaceWith(paragraphXML($,base,op.text,styleSizes));nodes[index]=null;}
   else if(op.action==='insertParagraph'){if(base.name.split(':').at(-1)!=='p'||typeof op.text!=='string'||op.text.length>12000)throw Error('新增段落须指定原样式段落');$(base).after(paragraphXML($,base,op.text,styleSizes));}
   else if(op.action==='insertStyledParagraph'){
    if(typeof op.text!=='string'||op.text.length>12000)throw Error('新增正文内容无效');
    let styleBase;if(op.styleBlockId==='normal'){styleBase=paragraphs($,base)[0]||nodes.find(n=>n?.name?.split(':').at(-1)==='p');if(!styleBase)throw Error('原文没有可继承的段落命名空间');styleBase=$(styleBase).clone()[0];$(styleBase).empty();const prefix=tagPrefix(styleBase);$(styleBase).append('<'+prefix+'pPr><'+prefix+'pStyle '+prefix+'val="Normal"/></'+prefix+'pPr>');}
    else{const index=/^block:\d+$/.test(op.styleBlockId||'')?Number(op.styleBlockId.slice(6)):-1;styleBase=nodes[index];if(styleBase?.name?.split(':').at(-1)!=='p')throw Error('指定段落样式来源不存在');}
    $(base).after(paragraphXML($,styleBase,op.text,styleSizes));
   }
   else if(op.action==='formatParagraph'){
    if(base.name.split(':').at(-1)!=='p'||!Number.isFinite(op.fontSize)||op.fontSize<0||op.fontSize>48||op.fontSize>0&&op.fontSize<8||!['keep','left','center','right','both'].includes(op.alignment)||!['keep','bold','normal'].includes(op.weight)||op.color&&!/^#[0-9a-f]{6}$/i.test(op.color))throw Error('段落格式无效');
    const prefix=tagPrefix(base);let pr=$(base).children().filter((_i,n)=>n.name?.split(':').at(-1)==='pPr').first();if(!pr.length){$(base).prepend('<'+prefix+'pPr/>');pr=$(base).children().first();}
    if(op.alignment!=='keep'){tags($,'jc',pr).remove();pr.append('<'+prefix+'jc '+prefix+'val="'+op.alignment+'"/>');}
    for(const run of tags($,'r',$(base)).toArray()){let rp=$(run).children().filter((_i,n)=>n.name?.split(':').at(-1)==='rPr').first();if(!rp.length){$(run).prepend('<'+prefix+'rPr/>');rp=$(run).children().first();}if(op.fontSize){for(const tag of ['sz','szCs']){tags($,tag,rp).remove();rp.append('<'+prefix+tag+' '+prefix+'val="'+Math.round(op.fontSize*2)+'"/>');}}if(op.color){tags($,'color',rp).remove();rp.append('<'+prefix+'color '+prefix+'val="'+op.color.slice(1)+'"/>');}if(op.weight!=='keep'){tags($,'b',rp).remove();rp.append('<'+prefix+'b '+prefix+'val="'+(op.weight==='bold'?'1':'0')+'"/>');}}
    if(op.fontSize){let spacing=tags($,'spacing',pr).first();if(!spacing.length){pr.append('<'+prefix+'spacing/>');spacing=tags($,'spacing',pr).first();}spacing.attr(prefix+'lineRule','atLeast').attr(prefix+'line',String(Math.ceil(op.fontSize*20*1.35)));}
   }
   else if(op.action==='deleteBlock'){if(op.part&&op.part!=='word/document.xml')throw Error('不删除页眉页脚结构');$(base).remove();nodes[index]=null;}
   else if(op.action==='replaceTable'||op.action==='appendTableRows'){
    if(base.name.split(':').at(-1)!=='tbl'||!Array.isArray(op.rows)||!op.rows.length||op.rows.length>1000)throw Error('表格数据无效');
    if(tags($,'drawing',$(base)).length||tags($,'fldChar',$(base)).length)throw Error('此表格含图片或字段，请明确拆分修改，不自动移除对象');
    const nativeRows=$(base).children().filter((_i,n)=>n.name?.split(':').at(-1)==='tr').toArray(),columns=tags($,'tc',$(nativeRows[0])).length;
    if(!columns||op.rows.some(r=>!Array.isArray(r)||r.length!==columns||r.some(v=>typeof v!=='string'||v.length>4000)))throw Error('新表格字段与原表列数不一致');
    const createRow=(values,rowBase)=>{const row=$(rowBase).clone(),cells=row.children().filter((_i,n)=>n.name?.split(':').at(-1)==='tc').toArray();for(const [i,c] of cells.entries()){const p=paragraphs($,c)[0];$(c).children().filter((_i,n)=>n.name?.split(':').at(-1)!=='tcPr').remove();$(c).append(paragraphXML($,p,values[i],styleSizes));}return $.xml(row);};
    if(op.action==='replaceTable'){for(const r of nativeRows)$(r).remove();op.rows.forEach((r,i)=>$(base).append(createRow(r,nativeRows[Math.min(i,nativeRows.length-1)])));}
    else for(const r of op.rows){const row=createRow(r,nativeRows.at(-1));$(base).append(row);tags($,'tblHeader',$(base).children().last()).remove();}
   }else throw Error('此Word结构操作不支持');changed.push({action:op.action,part:op.part||'word/document.xml',blockId:op.blockId});
  }
  for(const [part,{$}] of loaded)if(changed.some(c=>c.part===part))zip.file(part,$.xml(),{createFolders:false});
 }else if(format==='pptx'){
  const p=await readPart(zip,'ppt/presentation.xml'),rels=await readPart(zip,'ppt/_rels/presentation.xml.rels'),types=await readPart(zip,'[Content_Types].xml'),parts=await presentationParts(zip),entries=tags(p,'sldId').toArray(),byId=new Map(entries.map((n,i)=>[p(n).attr('id'),{node:n,part:parts[i]}]));
  const locate=id=>{const e=byId.get(String(id));if(!e||!e.node.parent)throw Error('指定页面不存在或已删除');return e;};
  for(const op of operations){
   if(op.action==='replaceSlideText'){const e=locate(op.slideId),$=await readPart(zip,e.part),shape=tags($,'sp').filter((_i,n)=>tags($,'cNvPr',$(n)).first().attr('id')===op.elementId);if(shape.length!==1||typeof op.text!=='string'||op.text.length>12000)throw Error('页面文字元素无效');wholeText($,shape[0],op.text);zip.file(e.part,$.xml());}
   else if(op.action==='moveSlideElement'){
    const e=locate(op.slideId),$=await readPart(zip,e.part),nodes=['sp','pic','graphicFrame'].flatMap(t=>tags($,t).toArray()),shape=nodes.find(n=>tags($,'cNvPr',$(n)).first().attr('id')===op.elementId);
    const size=tags(p,'sldSz').first(),scale=(Number(size.attr('cx'))||12192000)/1280,height=(Number(size.attr('cy'))||6858000)/scale;
    if(!shape||$(shape).parents().toArray().some(n=>n.name?.split(':').at(-1)==='grpSp')||![op.x,op.y,op.width,op.height].every(Number.isFinite)||op.x<0||op.y<0||op.width<=0||op.height<=0||op.x+op.width>1280||op.y+op.height>height)throw Error('原生元素位置无效、越界或属于分组');
    const kind=shape.name.split(':').at(-1),pp=tagPrefix(shape),root=$.root().children().first();let ns='zhd';while(root.attr('xmlns:'+ns)&&root.attr('xmlns:'+ns)!=='http://schemas.openxmlformats.org/drawingml/2006/main')ns+='x';root.attr('xmlns:'+ns,'http://schemas.openxmlformats.org/drawingml/2006/main');const ap=ns+':';
    let xfrm=tags($,'xfrm',$(shape)).first();if(!xfrm.length){if(kind==='graphicFrame'){$(shape).children().first().after('<'+pp+'xfrm/>');xfrm=tags($,'xfrm',$(shape)).first();}else{let pr=tags($,'spPr',$(shape)).first();if(!pr.length){$(shape).children().first().after('<'+pp+'spPr/>');pr=tags($,'spPr',$(shape)).first();}pr.prepend('<'+ap+'xfrm/>');xfrm=tags($,'xfrm',pr).first();}}
    for(const tag of ['off','ext'])tags($,tag,xfrm).remove();xfrm.prepend('<'+ap+'off x="'+Math.round(op.x*scale)+'" y="'+Math.round(op.y*scale)+'"/><'+ap+'ext cx="'+Math.round(op.width*scale)+'" cy="'+Math.round(op.height*scale)+'"/>');zip.file(e.part,$.xml());
   }
   else if(op.action==='duplicateSlide'){
    const e=locate(op.slideId),newPart=nextPart(zip,'ppt/slides','slide'),newId=String(Math.max(255,...[...byId.keys()].map(Number))+1),relId='zhouzhiSlide'+newId;
    zip.file(newPart,await zip.file(e.part).async('nodebuffer'));const oldRel=path.posix.dirname(e.part)+'/_rels/'+path.posix.basename(e.part)+'.rels',newRel=path.posix.dirname(newPart)+'/_rels/'+path.posix.basename(newPart)+'.rels';
    if(zip.file(oldRel)){
     const r=await readPart(zip,oldRel);
     for(const n of r('Relationship').toArray()){const link=r(n);if(!/\/notesSlide$/.test(link.attr('Type')||''))continue;if(link.attr('TargetMode')==='External')throw Error('不复制外部注释');
      const noteTarget=link.attr('Target'),oldNotes=noteTarget.startsWith('/')?noteTarget.slice(1):path.posix.normalize(path.posix.join(path.posix.dirname(e.part),noteTarget));if(!/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(oldNotes)||!zip.file(oldNotes))throw Error('注释结构无法安全继承');const newNotes=nextPart(zip,'ppt/notesSlides','notesSlide');zip.file(newNotes,await zip.file(oldNotes).async('nodebuffer'));link.attr('Target',path.posix.relative(path.posix.dirname(newPart),newNotes));
      const notesRel=path.posix.dirname(oldNotes)+'/_rels/'+path.posix.basename(oldNotes)+'.rels';if(zip.file(notesRel)){const nr=await readPart(zip,notesRel);nr('Relationship').each((_i,a)=>{if(/\/slide$/.test(nr(a).attr('Type')||''))nr(a).attr('Target',path.posix.relative(path.posix.dirname(newNotes),newPart));});zip.file(path.posix.dirname(newNotes)+'/_rels/'+path.posix.basename(newNotes)+'.rels',nr.xml());}addType(types,newNotes,'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml');
     }zip.file(newRel,r.xml());
    }
    addType(types,newPart,'application/vnd.openxmlformats-officedocument.presentationml.slide+xml');rels('Relationships').append('<Relationship Id="'+relId+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="'+path.posix.relative('ppt',newPart)+'"/>');
    const clone=p(e.node).clone().attr('id',newId).attr('r:id',relId);p(locate(op.afterSlideId||op.slideId).node).after(clone);byId.set(newId,{node:clone[0],part:newPart});changed.push({action:op.action,newSlideId:newId,sourceSlideId:op.slideId});continue;
   }else if(op.action==='deleteSlide'){if([...byId.values()].filter(e=>e.node.parent).length<=1)throw Error('不能删除全部页面');p(locate(op.slideId).node).remove();}
   else if(op.action==='reorderSlides'){
    const live=[...byId.keys()].filter(id=>byId.get(id).node.parent);if(!Array.isArray(op.order)||op.order.length!==live.length||new Set(op.order).size!==live.length||op.order.some(id=>!live.includes(id)))throw Error('重排须包含所有当前页面且不重复');const list=tags(p,'sldIdLst').first();for(const id of op.order){const n=locate(id).node;p(n).remove();list.append(n);}
   }else throw Error('此PPT结构操作不支持');changed.push({action:op.action,slideId:op.slideId});
  }
  for(const {node,part} of byId.values())if(!node.parent){zip.remove(part);zip.remove(path.posix.dirname(part)+'/_rels/'+path.posix.basename(part)+'.rels');types('Override').filter((_i,n)=>types(n).attr('PartName')==='/'+part).remove();rels('Relationship').filter((_i,n)=>{const t=rels(n).attr('Target')||'';return(t.startsWith('/')?t.slice(1):path.posix.normalize(path.posix.join('ppt',t)))===part;}).remove();}
  zip.file('ppt/presentation.xml',p.xml());zip.file('ppt/_rels/presentation.xml.rels',rels.xml());zip.file('[Content_Types].xml',types.xml());
 }else throw Error('此文件格式暂无此结构操作');
 await fs.writeFile(target,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
 return{changed,preservedTemplate:true,fingerprint:digest(await fs.readFile(target))};
}
