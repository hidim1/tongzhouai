// Deterministic saved-package checks, separate from AI factual/visual review.
import ExcelJS from 'exceljs';
import {officePackage,readPart,tags,presentationParts} from './office-package.mjs';
import path from 'node:path';
import {Decimal} from './assistant-decimal.mjs';
import {parseMarkdown,nodeText} from '../shared/markdown.mjs';
import {documentTitle} from './preview-document.mjs';
import {workbookSheets} from './preview-workbook.mjs';
const normalized=s=>String(s??'').replace(/\s+/gu,'');
const fail=()=>{throw Object.assign(Error('文件内容核对未通过，暂未交付；正文或表格与已验收草稿不一致'),{code:'OFFICE_CONTENT_FAILED'});};
function visible(n,title){
 if(n.type==='heading'&&n.depth===1&&nodeText(n).trim()===title)return '';
 if(n.type==='html'||n.type==='definition')return '';
 if(n.type==='image')return n.alt||'';
 if(n.type==='footnoteReference')return '['+(n.label||n.identifier)+']';
 if(n.type==='footnoteDefinition')return '['+(n.label||n.identifier)+'] '+nodeText(n);
 return typeof n.value==='string'?n.value:(n.children||[]).map(c=>visible(c,title)).join('');
}
export async function verifyOfficeContent(file,{format,title,body='',columns=[],rows=[],extraSheets=[],workbook=null}={}){
 if(format==='docx'){
  const zip=await officePackage(file),$=await readPart(zip,'word/document.xml'),cleanTitle=documentTitle(title);
  const actual=tags($,'t').toArray().map(n=>$(n).text()).join('');
  const blocks=parseMarkdown(body).children.filter(n=>!(n.type==='heading'&&n.depth===1&&nodeText(n).trim()===cleanTitle.trim()));
  if(normalized(actual)!==normalized(cleanTitle+blocks.map(n=>visible(n,cleanTitle)).join('')))fail();
  return {format,contentVerified:true,textCharacters:normalized(actual).length};
 }
 if(format==='xlsx'){
  const expected=workbookSheets(columns,rows,extraSheets,workbook),wb=new ExcelJS.Workbook();await wb.xlsx.readFile(file);
  if(wb.worksheets.length!==expected.length)fail();let checkedCells=0,dataRows=0;
  for(const [i,s] of expected.entries()){
   const sheet=wb.worksheets[i];if(sheet.name!==s.name)fail();const cells=new Map(),put=(r,c,v)=>{if(v!==null&&v!==undefined&&v!=='')cells.set(sheet.getCell(r,c).address,v);};
   const plain=v=>nodeText(parseMarkdown(String(v??''))).trim();
   put(2,1,i===0?documentTitle(title):s.name);s.columns.forEach((c,j)=>put(4,j+1,plain(c.label)));s.rows.forEach((r,k)=>r.forEach((v,j)=>put(5+k,j+1,v)));dataRows+=s.rows.length;
   if(i===0&&body.trim()){
    const r=4+s.rows.length+3;put(r,1,'说明');parseMarkdown(body).children.map(nodeText).filter(Boolean).forEach((line,k)=>put(r+k+1,1,line));
   }
   sheet.eachRow(row=>row.eachCell(cell=>{
    if(cell.isMerged&&cell.master.address!==cell.address)return;
    if(cell.value===null||cell.value==='')return;
    const value=cells.get(cell.address),actual=cell.value;
    if(value===undefined)fail();
    if(value instanceof Date?!(actual instanceof Date&&+actual===+value):typeof actual!==typeof value||actual!==value)fail();
    cells.delete(cell.address);checkedCells++;
   }));if(cells.size)fail();
  }
  return {format,contentVerified:true,sheets:expected.length,dataRows,checkedCells};
 }
 throw Error('该格式暂不支持此内容核对');
}
export async function verifyPresentationContent(file,plan){
 const zip=await officePackage(file),parts=await presentationParts(zip);if(parts.length!==plan.slides.length)fail();let checkedCharts=0;
 for(const [i,part] of parts.entries()){
  const slide=plan.slides[i],$=await readPart(zip,part),actual=tags($,'t').toArray().map(n=>$(n).text()).join('');
  if(slide.layout==='canvas'){
   const expected=slide.elements.map(e=>e.kind==='text'?e.text:e.kind==='table'?[e.headers,...e.rows].flat().join(''):e.kind==='chart'?e.unit:'').join('');if(normalized(actual)!==normalized(expected))fail();
   const nativeTables=tags($,'tbl').toArray(),tables=slide.elements.filter(e=>e.kind==='table');if(nativeTables.length!==tables.length)fail();
   nativeTables.forEach((n,j)=>{const rows=tags($,'tr',$(n)).toArray().map(r=>$(r).children().filter((_i,c)=>c.name?.split(':').at(-1)==='tc').toArray().map(c=>tags($,'t',$(c)).text()));if(JSON.stringify(rows.map(r=>r.map(normalized)))!==JSON.stringify([tables[j].headers,...tables[j].rows].map(r=>r.map(normalized))))fail();});
  }else{
   const expected=[slide.title,slide.subtitle,...(slide.paragraphs||[]).map(p=>slide.layout==='text'?p.replace(/^\s*\d+\s*[.、|｜]\s*/,''):p),...(slide.columns||[]).flatMap(c=>[c.heading,c.body]),...(slide.tableHeaders||[]),...(slide.tableRows||[]).flat(),slide.chart?.unit].filter(Boolean);if(expected.some(text=>!normalized(actual).includes(normalized(text))))fail();
  }
  const charts=slide.layout==='canvas'?slide.elements.filter(e=>e.kind==='chart').map(e=>({categories:e.categories,series:e.series})):slide.layout==='chart'?[slide.chart]:[];
  const refs=tags($,'chart').toArray();if(refs.length!==charts.length)fail();if(!refs.length)continue;
  const rels=await readPart(zip,path.posix.dirname(part)+'/_rels/'+path.posix.basename(part)+'.rels');
  for(const [j,n] of refs.entries()){
   const r=rels('Relationship').toArray().find(r=>rels(r).attr('Id')===$(n).attr('r:id'));if(!r||rels(r).attr('TargetMode')==='External')fail();const target=rels(r).attr('Target'),name=target.startsWith('/')?target.slice(1):path.posix.normalize(path.posix.join(path.posix.dirname(part),target));if(!/^ppt\/(?:slides\/)?charts\/[^/]+\.xml$/.test(name))fail();
   const chart=await readPart(zip,name),series=tags(chart,'ser').toArray();if(series.length!==charts[j].series.length)fail();
   const points=(root)=>tags(chart,'pt',root).toArray().sort((a,b)=>Number(chart(a).attr('idx'))-Number(chart(b).attr('idx'))).map(p=>tags(chart,'v',chart(p)).text());
   series.forEach((s,k)=>{const cat=tags(chart,'cat',chart(s)).first(),val=tags(chart,'val',chart(s)).first(),categories=points(cat),values=points(val);if(JSON.stringify(categories)!==JSON.stringify(charts[j].categories.map(String))||values.length!==charts[j].series[k].values.length||values.some((v,index)=>Decimal.from(v).compare(charts[j].series[k].values[index])!==0))fail();});checkedCharts++;
  }
 }
 return{format:'pptx',contentVerified:true,slides:parts.length,checkedCharts};
}
