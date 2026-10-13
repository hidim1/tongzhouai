import ExcelJS from 'exceljs';
import {nodeText,parseMarkdown} from '../shared/markdown.mjs';
const kinds=['text','number','currency','percentage','date'];
const plain=value=>nodeText(parseMarkdown(String(value??''))).trim();
const length=s=>[...String(s)].reduce((n,c)=>n+(/[\u3400-\u9fff]/.test(c)?2:1),0);
function valueFor(value,kind){
 if(value===null||value===undefined||value==='')return null;
 if(kind==='text')return String(value);
 if(kind==='date'){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('日期须为完整年月日，不得猜测年份');
  const date=new Date(value+'T00:00:00Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==value)throw Error('Excel日期无效');return date;
 }
 if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Excel含无效数字');return value;}
 if(['number','currency','percentage'].includes(kind)&&typeof value==='string'){
  const s=value.trim();if(/^(?:待确认|待核对|未记录|未提供|不适用|—)$/.test(s))return s;
  if(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s))return Number(s);
  if(kind==='percentage'&&/^-?\d+(?:\.\d+)?%$/.test(s))return Number(s.slice(0,-1))/100;
  throw Error('数值列含无法核对的文本，请保留未知值为空或明确待确认');
 }
 if(typeof value==='boolean')return value;
 return plain(value);
}
export function workbookSheets(columns,rows,extraSheets=[],plan=null){
 const sheets=plan?.sheets||[{name:'工作清单',columns:columns.length?columns.map(label=>({label,kind:'auto'})):[{label:'内容',kind:'auto'}],rows},...extraSheets.map(s=>({...s,columns:s.columns.map(label=>({label,kind:'auto'}))}))];
 if(!sheets.length||sheets.length>8)throw Error('Excel需要1至8张有效工作表');const names=new Set();
 return sheets.map(s=>{
  if(typeof s.name!=='string'||!s.name.trim()||s.name.length>31||/[\\/:?*\[\]]/.test(s.name)||names.has(s.name.toLowerCase()))throw Error('Excel工作表名称无效或重复');names.add(s.name.toLowerCase());
  if(!Array.isArray(s.columns)||!s.columns.length||s.columns.length>20||!Array.isArray(s.rows)||s.rows.length>5000)throw Error('Excel表格范围过大或缺少表头');
  const labels=new Set();for(const c of s.columns){if(typeof c.label!=='string'||!c.label.trim()||labels.has(c.label)||!['auto',...kinds].includes(c.kind))throw Error('Excel表头重复或数据类型无效');labels.add(c.label);}
  return{...s,rows:s.rows.map(r=>{if(!Array.isArray(r)||r.length!==s.columns.length)throw Error('Excel数据与表头列数不一致，不能省略字段');return r.map((v,i)=>valueFor(v,s.columns[i].kind));})};
 });
}
export async function makeWorkbook(title,body,columns,rows,target,{extraSheets=[],plan=null,engineering=false,readableLayout=false}={}){
 title=String(title||'').trim().replace(/\.(docx|xlsx|pptx|md)$/i,'');
 const sheets=workbookSheets(columns,rows,extraSheets,plan),wb=new ExcelJS.Workbook();wb.creator='舟知';wb.title=title;
 for(const [si,s] of sheets.entries()){
  const sheet=wb.addWorksheet(s.name),header=engineering?1:4;sheet.properties.defaultRowHeight=24;
  if(!engineering){sheet.getCell('A2').value=si===0?title:s.name;sheet.getCell('A2').font={name:'Microsoft YaHei',size:16,bold:true,color:{argb:'FF172F42'}};sheet.getRow(2).height=32;}
  sheet.getRow(header).values=s.columns.map(c=>plain(c.label));sheet.getRow(header).height=30;
  for(const r of s.rows)sheet.addRow(r);
  sheet.views=[{state:'frozen',ySplit:header,xSplit:s.columns.length>6?1:0,showGridLines:false}];sheet.autoFilter={from:{row:header,column:1},to:{row:header+s.rows.length,column:s.columns.length}};
  const formats={number:'#,##0.00',currency:'"¥"#,##0.00',percentage:'0.0%',date:'yyyy-mm-dd',text:'@'};
  for(const [i,c] of s.columns.entries()){
   const width=Math.min(readableLayout?18:54,Math.max(12,length(c.label)+4,...s.rows.map(r=>Math.min(50,length(r[i] instanceof Date?'2026-10-12':r[i])+2))));sheet.getColumn(i+1).width=width;
   if(formats[c.kind])sheet.getColumn(i+1).numFmt=c.kind==='number'&&s.rows.every(r=>r[i]===null||typeof r[i]==='string'||Number.isInteger(r[i]))?'#,##0':formats[c.kind];
  }
  for(let row=header;row<=header+s.rows.length;row++){
   let lines=1;sheet.getRow(row).eachCell({includeEmpty:true},(cell,col)=>{
    cell.font={name:'Microsoft YaHei',size:readableLayout?12:11,color:{argb:row===header?'FFFFFFFF':'FF233A48'},bold:row===header};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:row===header?'FF24495D':row%2?'FFFFFFFF':'FFF3F6F8'}};
    cell.alignment={vertical:'middle',horizontal:row===header||cell.value instanceof Date?'center':typeof cell.value==='number'?'right':'left',wrapText:true};
    cell.border=row===header?{bottom:{style:'thin',color:{argb:'FFDCE5EB'}}}:{};
    lines=Math.max(lines,...String(cell.value instanceof Date?'2026-10-12':cell.value??'').split('\n').map(t=>Math.ceil(length(t)/(sheet.getColumn(col).width-2))));
   });const height=Math.max(row===header?30:24,lines*(readableLayout?21:17)+(readableLayout?12:8));if(readableLayout&&height>409)throw Error('单元格长文超过可读行高，请拆分内容或使用Word交付');sheet.getRow(row).height=height;
  }
  sheet.pageSetup={orientation:s.columns.length>5?'landscape':'portrait',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:`${header}:${header}`,printArea:`A${engineering?1:2}:${sheet.getColumn(s.columns.length).letter}${header+s.rows.length}`};
  if(readableLayout){const totalWidth=s.columns.reduce((n,_,i)=>n+sheet.getColumn(i+1).width,0);sheet.pageSetup={...sheet.pageSetup,orientation:totalWidth>80?'landscape':'portrait',paperSize:totalWidth>140?8:9,fitToPage:true,fitToWidth:1,fitToHeight:0};}
 }
 // Only substantive notes, not an automatic extra "编制说明" worksheet.
 if(body?.trim()){
  const sheet=wb.worksheets[0],r=sheet.rowCount+3,cols=sheets[0].columns.length,total=sheets[0].columns.reduce((n,_,i)=>n+sheet.getColumn(i+1).width,0);sheet.getCell(r,1).value='说明';sheet.getCell(r,1).font={name:'Microsoft YaHei',size:11,bold:true};
  for(const [i,line] of parseMarkdown(body).children.map(nodeText).filter(Boolean).entries()){sheet.mergeCells(r+i+1,1,r+i+1,cols);sheet.getCell(r+i+1,1).value=line;sheet.getCell(r+i+1,1).font={name:'Microsoft YaHei',size:11};sheet.getCell(r+i+1,1).alignment={wrapText:true};sheet.getRow(r+i+1).height=Math.max(24,Math.ceil(length(line)/(total-2))*17+8);}
  sheet.pageSetup.printArea=`A${engineering?1:2}:${sheet.getColumn(cols).letter}${sheet.rowCount}`;
 }
 await wb.xlsx.writeFile(target);
}
