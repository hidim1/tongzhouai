import fs from 'node:fs';
import JSZip from 'jszip';
import {load} from 'cheerio';
export function xml(source){if(/<!DOCTYPE|<!ENTITY/i.test(source))throw Error('文件含不受支持的外部定义');return load(source,{xmlMode:true});}
export const tags=($,name,root=null)=>(root?root.find('*'):$('*')).filter((_i,n)=>n.name?.split(':').at(-1)===name);
export const tagPrefix=node=>node?.name?.includes(':')?node.name.split(':')[0]+':':'';
export async function officePackage(file){
 const bytes=fs.readFileSync(file);if(bytes.length>30*1024*1024)throw Error('文件过大');
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('Office文件结构无效');const count=bytes.readUInt16LE(end+10),start=bytes.readUInt32LE(end+16);if(count>10000||count===65535||start>=bytes.length)throw Error('Office文件结构过大或不受支持');
 let at=start,total=0;for(let i=0;i<count;i++){if(at+46>bytes.length||bytes.readUInt32LE(at)!==0x02014b50)throw Error('Office目录无效');const size=bytes.readUInt32LE(at+24);total+=size;if(size>40*1024*1024||total>200*1024*1024)throw Error('文件解压内容过大');at+=46+bytes.readUInt16LE(at+28)+bytes.readUInt16LE(at+30)+bytes.readUInt16LE(at+32);}
 const zip=await JSZip.loadAsync(bytes);if(Object.keys(zip.files).some(n=>/(?:^|\/)vbaProject\.bin$/i.test(n)))throw Error('不处理带宏文件');return zip;
}
export async function readPart(zip,name){const f=zip.file(name);if(!f)throw Error('Office文件缺少必要内容');return xml(await f.async('string'));}
export async function presentationParts(zip){
 const p=await readPart(zip,'ppt/presentation.xml'),rels=await readPart(zip,'ppt/_rels/presentation.xml.rels'),map=new Map();
 rels('Relationship').each((_i,node)=>{const e=rels(node);if(e.attr('TargetMode')!=='External')map.set(e.attr('Id'),e.attr('Target'));});
 return p('p\\:sldId').toArray().map(node=>{const target=map.get(p(node).attr('r:id'));if(!target||target.includes('..')||target.startsWith('/')&&!target.startsWith('/ppt/'))throw Error('幻灯片引用无效');return target.startsWith('/ppt/')?target.slice(1):'ppt/'+target;});
}
export async function readPresentation(file){
 const zip=await officePackage(file),p=await readPart(zip,'ppt/presentation.xml'),paths=await presentationParts(zip);
 const slides=[];for(const [index,part] of paths.entries()){
  const $=await readPart(zip,part),elements=[];$('p\\:sp,p\\:graphicFrame').each((_i,node)=>{const e=$(node),texts=e.find('a\\:p').toArray().map(n=>$(n).find('a\\:t').toArray().map(t=>$(t).text()).join('')).filter(Boolean),off=e.find('a\\:xfrm a\\:off,p\\:xfrm a\\:off').first(),ext=e.find('a\\:xfrm a\\:ext,p\\:xfrm a\\:ext').first();
   elements.push({id:e.find('p\\:cNvPr').first().attr('id')||String(elements.length),kind:e.find('a\\:tbl').length?'table':'text',text:texts.join('\n'),x:Number(off.attr('x'))||0,y:Number(off.attr('y'))||0,width:Number(ext.attr('cx'))||0,height:Number(ext.attr('cy'))||0,fontSizes:e.find('a\\:rPr').toArray().map(n=>Number($(n).attr('sz'))/100).filter(Boolean)});
  });slides.push({index,title:elements.find(e=>e.text)?.text.split('\n')[0]||'',elements,imageCount:$('p\\:pic').length,chartCount:$('c\\:chart').length});
 }
 return {slides,text:slides.map(s=>'第'+(s.index+1)+'页\n'+s.elements.map(e=>e.text).join('\n')).join('\n\n'),presentationSize:{width:Number(p('p\\:sldSz').attr('cx')),height:Number(p('p\\:sldSz').attr('cy'))},parseNote:'已读取PPT页面文本、表格及对象信息；背景、图片与版式须通过页面预览核对，不把原始图片内容当作已识别。'};
}
export async function readWorkbook(file){
 const zip=await officePackage(file),wb=await readPart(zip,'xl/workbook.xml'),rels=await readPart(zip,'xl/_rels/workbook.xml.rels'),map=new Map();rels('Relationship').each((_i,n)=>{const e=rels(n);if(e.attr('TargetMode')!=='External')map.set(e.attr('Id'),e.attr('Target'));});
 const strings=[];if(zip.file('xl/sharedStrings.xml')){const $=await readPart(zip,'xl/sharedStrings.xml');tags($,'si').each((_i,n)=>strings.push(tags($,'t',$(n)).toArray().map(t=>$(t).text()).join('')));}
 const sheets=[];for(const node of tags(wb,'sheet').toArray()){
  const s=wb(node),target=map.get(s.attr('r:id'));if(!target||target.includes('..')||target.startsWith('/')&&!target.startsWith('/xl/'))throw Error('工作表引用无效');const $=await readPart(zip,target.startsWith('/xl/')?target.slice(1):'xl/'+target),rows=[],cells=[];
  for(const n of tags($,'row').toArray()){const row={};for(const cell of tags($,'c',$(n)).toArray()){const e=$(cell),address=e.attr('r');if(!/^[A-Z]{1,3}[1-9]\d*$/.test(address||''))throw Error('单元格地址无效');const raw=tags($,'v',e).text(),type=e.attr('t');let value=type==='s'?strings[Number(raw)]:type==='inlineStr'?tags($,'t',e).text():type==='b'?raw==='1':type==='str'||type==='e'?raw:raw===''?null:Number(raw);if(value===undefined)throw Error('共享字符串缺失');if(value!==null){row[address]=String(value);cells.push({address,value,type:type||'number',...(tags($,'f',e).length?{formula:tags($,'f',e).text()}:{})});}}
   if(Object.keys(row).length)rows.push(row);
  }sheets.push({name:s.attr('name'),rows,cells});
 }
 return {sheets,text:sheets.map(s=>s.name+'\n'+s.rows.map(r=>Object.entries(r).map(([a,v])=>a+'='+v).join(' | ')).join('\n')).join('\n'),parseNote:'已按原生工作表读取单元格值和公式缓存；日期显示格式须通过页面预览核对，不把缓存当作新一次重算。'};
}
