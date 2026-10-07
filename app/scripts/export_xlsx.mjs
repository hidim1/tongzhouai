import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RUNTIME } from '../server/config.mjs';
const {p,mode,result,id,dir,target}=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const {Workbook,SpreadsheetFile}=await import(pathToFileURL(path.join(RUNTIME,'node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs')).href).catch(async()=>{const {createRequire}=await import('node:module');const require=createRequire(path.join(RUNTIME,'node/package.json'));return import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);});
  const wb=Workbook.create();const sheet=wb.worksheets.add('材料清单');const headers=['序号','产品名称','规格型号','材质','单位','品牌','数量','单价（元）','工艺位号','确认状态','备注','来源'];
  const literal=v=>typeof v==='string'&&/^[=+@]/.test(v)?"'"+v:v;
  sheet.getRange('A1:L1').merge();sheet.getRange('A1').values=[[`${mode==='demo'?'演示数据  ':''}${p.name} 材料清单草稿`]];
  sheet.getRange('A2:L2').merge();sheet.getRange('A2').values=[['未定数量与价格留空；本表需工程师审核。生成来源：'+result.source]];
  const rows=result.materials.map((x,i)=>[i+1,x.name,x.spec,x.material,x.unit,x.brand,x.quantity,x.price,x.tag,x.status,x.note,x.source].map(literal));
  sheet.getRange('A4:L4').values=[headers];if(rows.length)sheet.getRange(`A5:L${4+rows.length}`).values=rows;
  const n=Math.max(5,4+rows.length);sheet.getRange(`A1:L${n}`).format.font={name:'PingFang SC',size:11};sheet.getRange(`A4:L${n}`).format.wrapText=true;sheet.getRange(`A4:L${n}`).format.verticalAlignment='center';sheet.getRange(`A4:L${n}`).format.borders={preset:'all',color:'#D9D9D9',style:'thin'};
  sheet.getRange('A4:L4').format.fill='#17384A';sheet.getRange('A4:L4').format.font={color:'#FFFFFF',bold:true};sheet.getRange('A4:L4').format.rowHeight=30;sheet.getRange(`A5:L${n}`).format.rowHeight=58;sheet.getRange('A1:L1').format.rowHeight=38;sheet.getRange('A1').format.font={bold:true,size:16};
  const widths=[8,24,28,15,9,18,10,16,18,14,42,64];'ABCDEFGHIJKL'.split('').forEach((c,i)=>{sheet.getRange(`${c}:${c}`).format.columnWidth=widths[i];});
  // Estimate wrapped CJK text height so evidence and engineering notes remain visible.
  rows.forEach((row,i)=>{const lines=Math.max(...row.map((v,c)=>String(v??'').split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil([...line].reduce((n,ch)=>n+(ch.charCodeAt(0)>255?2:1),0)/(widths[c]-2))),0)));sheet.getRange(`A${i+5}:L${i+5}`).format.rowHeight=Math.max(48,lines*14+12);});
  sheet.getRange(`G5:G${n}`).setNumberFormat('General');sheet.getRange(`H5:H${n}`).setNumberFormat('#,##0.00');sheet.freezePanes.freezeRows(4);sheet.showGridLines=false;wb.recalculate();
  const check=await wb.inspect({kind:'table',range:`材料清单!A4:L${Math.min(n,8)}`,tableMaxRows:5,tableMaxCols:12});fs.writeFileSync(path.join(dir,id+'.verification.json'),check.ndjson||JSON.stringify(check));
  const out=await SpreadsheetFile.exportXlsx(wb);await out.save(target);
  try{const preview=await wb.render({sheetName:'材料清单',range:`A1:L${Math.min(n,12)}`,scale:1,format:'png'});fs.writeFileSync(path.join(dir,id+'.png'),new Uint8Array(await preview.arrayBuffer()));}catch(e){fs.writeFileSync(path.join(dir,id+'.preview-error.txt'),e.message);}
console.log(target);
