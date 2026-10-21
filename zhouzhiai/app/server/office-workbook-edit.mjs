import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
import {officePackage,readPart,tags,tagPrefix} from './office-package.mjs';
import {safeOfficeFormula as safeFormula} from './office-formula.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function address(value){const m=String(value).match(/^([A-Z]{1,3})([1-9]\d{0,6})$/);if(!m)throw Error('单元格地址无效');const col=[...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),row=Number(m[2]);if(col>16384||row>1048576)throw Error('单元格越界');return{col,row};}
function letter(n){let result='';while(n){n--;result=String.fromCharCode(65+n%26)+result;n=Math.floor(n/26);}return result;}
export async function editWorkbookStructure(source,target,{fingerprint,operations=[]}){
 const bytes=await fs.readFile(source);if(hash(bytes)!==fingerprint)throw Error('工作簿版本已经变化，请重新读取版本');
 if(!operations.length||operations.length>30)throw Error('工作簿结构修改范围无效');const zip=await officePackage(source);if(Object.keys(zip.files).some(p=>/^xl\/(?:externalLinks|pivotTables)\//.test(p)))throw Error('此工作簿含外部链接或透视表，暂不自动改结构');
 const wb=await readPart(zip,'xl/workbook.xml'),rels=await readPart(zip,'xl/_rels/workbook.xml.rels'),types=await readPart(zip,'[Content_Types].xml'),map=new Map(),loaded=new Map(),changed=[];
 const targets=new Map();rels('Relationship').each((_i,n)=>targets.set(rels(n).attr('Id'),rels(n).attr('Target')));tags(wb,'sheet').each((_i,n)=>{const e=wb(n),t=targets.get(e.attr('r:id'));if(!t||t.includes('..'))throw Error('工作表引用无效');map.set(e.attr('name'),t.startsWith('/xl/')?t.slice(1):'xl/'+t);});
 let cellCount=0;
 for(const op of operations){
  if(typeof op.sheet!=='string'||!op.sheet.trim()||op.sheet.length>31||/[\\/:?*\[\]]/.test(op.sheet))throw Error('工作表名称无效');
  if(op.action==='addSheet'){
   if([...map.keys()].some(n=>n.toLowerCase()===op.sheet.toLowerCase()))throw Error('工作表名称已存在');let n=1;while(zip.file('xl/worksheets/sheet'+n+'.xml'))n++;const part='xl/worksheets/sheet'+n+'.xml',id='zhouzhiSheet'+n;
   zip.file(part,'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>');map.set(op.sheet,part);
   const sheetId=Math.max(0,...tags(wb,'sheet').toArray().map(n=>Number(wb(n).attr('sheetId'))))+1;tags(wb,'sheets').append('<'+tagPrefix(tags(wb,'sheets')[0])+'sheet name="'+esc(op.sheet)+'" sheetId="'+sheetId+'" r:id="'+id+'"/>');
   rels('Relationships').append('<Relationship Id="'+id+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+n+'.xml"/>');types('Types').append('<Override PartName="/'+part+'" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
  }else if(op.action!=='writeRange')throw Error('此工作簿结构操作不支持');
  const part=map.get(op.sheet);if(!part)throw Error('工作表不存在');if(!loaded.has(part))loaded.set(part,await readPart(zip,part));const $=loaded.get(part),root=tags($,'worksheet').first(),data=tags($,'sheetData').first(),prefix=tagPrefix(root[0]);
  const start=address(op.startCell),rows=op.rows||[],formulas=op.formulas||[];if(rows.length>5000||formulas.length>500||rows.some(r=>!Array.isArray(r)||r.length>100))throw Error('数据范围过大或无效');
  const existingRows=new Map(tags($,'row').toArray().map(n=>[Number($(n).attr('r')),n])),existingCells=new Map(tags($,'c').toArray().map(n=>[$(n).attr('r'),n]));
  function writable(a){const position=address(a);let row=existingRows.get(position.row);if(!row){data.append('<'+prefix+'row r="'+position.row+'"/>');row=data.children().last()[0];existingRows.set(position.row,row);}let cell=existingCells.get(a);
   if(!cell){$(row).append('<'+prefix+'c r="'+a+'"/>');cell=$(row).children().last()[0];if(op.templateRow>0){const style=$(existingCells.get(letter(position.col)+op.templateRow)).attr('s');if(style)$(cell).attr('s',style);}existingCells.set(a,cell);}
   for(const t of ['f','v','is'])tags($,t,$(cell)).remove();$(cell).removeAttr('t');return $(cell);
  }
  for(const [i,row] of rows.entries())for(const [j,v] of row.entries()){
   if(++cellCount>20000)throw Error('单次结构编辑最多20000个单元格，请分批');if(v!==null&&!['string','number','boolean'].includes(typeof v)||typeof v==='number'&&(!Number.isFinite(v)||Number.isInteger(v)&&!Number.isSafeInteger(v))||typeof v==='string'&&v.length>32000)throw Error('单元格值无效或超出可靠精度');
   const a=letter(start.col+j)+(start.row+i),c=writable(a);if(typeof v==='string'){c.attr('t','inlineStr').append('<'+prefix+'is><'+prefix+'t xml:space="preserve">'+esc(v)+'</'+prefix+'t></'+prefix+'is>');}else if(v!==null){if(typeof v==='boolean')c.attr('t','b');c.append('<'+prefix+'v>'+String(typeof v==='boolean'?Number(v):v)+'</'+prefix+'v>');}changed.push({sheet:op.sheet,address:a,value:v});
  }
  const touched=new Set(changed.filter(c=>c.sheet===op.sheet).map(c=>c.address));for(const f of formulas){address(f.address);if(touched.has(f.address))throw Error('公式地址与本轮值写入冲突');const formula=safeFormula(f.formula),c=writable(f.address);c.append('<'+prefix+'f ca="1">'+esc(formula)+'</'+prefix+'f>');changed.push({sheet:op.sheet,address:f.address,formula});touched.add(f.address);}
  // Ordered rows and cells are required by spreadsheet readers. No row shifting.
  for(const r of [...existingRows.values()].sort((a,b)=>Number($(a).attr('r'))-Number($(b).attr('r')))){for(const c of $(r).children().toArray().sort((a,b)=>address($(a).attr('r')).col-address($(b).attr('r')).col)){$(c).remove();$(r).append(c);}$(r).remove();data.append(r);}
  const positions=[...existingCells.keys()].map(address),lastRow=positions.reduce((n,p)=>Math.max(n,p.row),1),lastCol=positions.reduce((n,p)=>Math.max(n,p.col),1);let dim=tags($,'dimension').first();if(!dim.length){root.prepend('<'+prefix+'dimension/>');dim=tags($,'dimension').first();}dim.attr('ref','A1:'+letter(lastCol)+lastRow);
 }
 for(const [part,$] of loaded)zip.file(part,$.xml());let calc=tags(wb,'calcPr');if(!calc.length){tags(wb,'workbook').append('<'+tagPrefix(tags(wb,'workbook')[0])+'calcPr/>');calc=tags(wb,'calcPr');}calc.attr('fullCalcOnLoad','1').attr('forceFullCalc','1');
 zip.file('xl/workbook.xml',wb.xml());zip.file('xl/_rels/workbook.xml.rels',rels.xml());zip.file('[Content_Types].xml',types.xml());await fs.writeFile(target,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));return{changed,preservedTemplate:true,recalculationNeeded:true};
}
