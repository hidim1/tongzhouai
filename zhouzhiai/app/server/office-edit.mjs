// Focused OOXML edits keep unrelated media, themes, comments and native objects.
import fs from 'node:fs';import path from 'node:path';
import {officePackage,readPart,presentationParts,tags,tagPrefix} from './office-package.mjs';
function replaceInRuns($,nodes,find,replacement){
 const values=nodes.map(n=>$(n).text()),whole=values.join(''),at=whole.indexOf(find);if(at<0)return false;
 let offset=0,inserted=false;for(let i=0;i<nodes.length;i++){const value=values[i],start=offset,end=offset+value.length;offset=end;
  if(end<=at||start>=at+find.length)continue;
  const prefix=start<at?value.slice(0,at-start):'',suffix=end>at+find.length?value.slice(at+find.length-start):'';
  $(nodes[i]).text(prefix+(inserted?'':replacement)+suffix).attr('xml:space','preserve');inserted=true;
 }return true;
}
export async function editOffice(source,target,{replacements=[],cells=[]}={}){
 const ext=path.extname(source).toLowerCase();if(!['.docx','.pptx','.xlsx','.md','.txt'].includes(ext))throw Error('该格式暂不支持保留原版式的局部修改');
 if(!Array.isArray(replacements)||!Array.isArray(cells)||replacements.length+cells.length<1||replacements.length+cells.length>200)throw Error('修改条目无效或过多');
 const changed=[];
 if(['.md','.txt'].includes(ext)){
  if(cells.length)throw Error('文字文件不能修改单元格');let body=fs.readFileSync(source,'utf8');
  for(const r of replacements){if(typeof r.find!=='string'||!r.find||typeof r.replace!=='string')throw Error('替换内容无效');const count=body.split(r.find).length-1;if(count!==1)throw Error('替换原文不存在或不唯一，请明确修改范围');body=body.replace(r.find,r.replace);changed.push(r.find);}
  fs.writeFileSync(target,body);return {changed,recalculationNeeded:false};
 }
 const zip=await officePackage(source);
 if(ext==='.xlsx'){
  if(replacements.length)throw Error('Excel请明确指定工作表和单元格');
  if(Object.keys(zip.files).some(p=>p.startsWith('xl/externalLinks/')))throw Error('含外部工作簿链接的文件不能自动修改，请先提供独立副本');
  const wb=await readPart(zip,'xl/workbook.xml'),rels=await readPart(zip,'xl/_rels/workbook.xml.rels'),targets=new Map();rels('Relationship').each((_i,n)=>{const e=rels(n);targets.set(e.attr('Id'),e.attr('Target'));});
  const parts=new Map();tags(wb,'sheet').each((_i,n)=>{const e=wb(n),t=targets.get(e.attr('r:id'));if(t&&!t.includes('..'))parts.set(e.attr('name'),t.startsWith('/xl/')?t.slice(1):'xl/'+t);});
  const loaded=new Map();for(const c of cells){const part=parts.get(c.sheet);if(!part||!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(c.address)||c.value!==null&&!['string','number','boolean'].includes(typeof c.value)||typeof c.value==='number'&&!Number.isFinite(c.value))throw Error('工作表、单元格或值无效');
   if(!loaded.has(part))loaded.set(part,await readPart(zip,part));const $=loaded.get(part),cell=tags($,'c').filter((_i,n)=>$(n).attr('r')===c.address);if(cell.length!==1)throw Error('仅支持修改已有单元格，不能擅自插入结构');const prefix=tagPrefix(cell.get(0));
   for(const name of ['f','v','is'])tags($,name,cell).remove();cell.removeAttr('t');if(typeof c.value==='string'){cell.attr('t','inlineStr');cell.append('<'+prefix+'is><'+prefix+'t xml:space="preserve"/></'+prefix+'is>');tags($,'t',cell).text(c.value);}else if(c.value!==null){if(typeof c.value==='boolean')cell.attr('t','b');cell.append('<'+prefix+'v/>');tags($,'v',cell).text(String(typeof c.value==='boolean'?Number(c.value):c.value));}changed.push(c.sheet+'!'+c.address);
  }
  for(const [part,$] of loaded)zip.file(part,$.xml(),{createFolders:false});let calc=tags(wb,'calcPr');if(!calc.length){const root=tags(wb,'workbook');root.append('<'+tagPrefix(root.get(0))+'calcPr/>');calc=tags(wb,'calcPr');}calc.attr('fullCalcOnLoad','1').attr('forceFullCalc','1');zip.file('xl/workbook.xml',wb.xml(),{createFolders:false});
  const buffer=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});fs.writeFileSync(target,buffer);return {changed,recalculationNeeded:true};
 }
 if(cells.length)throw Error('此文件请用原文定位修改');
 const names=ext==='.docx'?['word/document.xml']:await presentationParts(zip);
 const docs=new Map(),touched=new Set();for(const name of names)docs.set(name,await readPart(zip,name));const paragraph=ext==='.docx'?'w\\:p':'a\\:p',run=ext==='.docx'?'w\\:t':'a\\:t';
 for(const r of replacements){if(typeof r.find!=='string'||!r.find||typeof r.replace!=='string'||/[\r\n]/.test(r.replace))throw Error('局部替换须为同一段文字，不自动改变段落结构');let matches=[];
  for(const [index,name] of names.entries()){if(r.part&&r.part!==(ext==='.pptx'?'slide:'+index:'document'))continue;const $=docs.get(name);$(paragraph).each((_i,node)=>{const nodes=$(node).find(run).toArray(),text=nodes.map(n=>$(n).text()).join('');if(text.includes(r.find))matches.push({$,nodes,name,count:text.split(r.find).length-1});});}
  if(matches.reduce((sum,m)=>sum+m.count,0)!==1)throw Error('替换原文不存在或不唯一，请指定页面及唯一原文');replaceInRuns(matches[0].$,matches[0].nodes,r.find,r.replace);touched.add(matches[0].name);changed.push(r.find);
 }
 for(const [name,$] of docs)if(touched.has(name))zip.file(name,$.xml(),{createFolders:false});fs.writeFileSync(target,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));return {changed,recalculationNeeded:false};
}
