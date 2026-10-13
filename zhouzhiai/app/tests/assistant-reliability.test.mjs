import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {calculate} from '../server/assistant-math.mjs';
import {tableStats} from '../server/assistant-table.mjs';
import {compareTables} from '../server/assistant-table-compare.mjs';
import {makeDocument} from '../server/preview-document.mjs';
import {makeWorkbook,workbookSheets} from '../server/preview-workbook.mjs';
import {verifyOfficeContent} from '../server/office-content.mjs';
import {extractDocument} from '../server/documents.mjs';
import {officePackage,readPart,tags} from '../server/office-package.mjs';
import {measureStage} from '../server/assistant-timing.mjs';
import {publicAssistantJob} from '../server/preview-search.mjs';
import {createAssistantTools} from '../server/assistant-tools.mjs';
import {createAssistant} from '../server/preview-assistant.mjs';
const temp=async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'zhouzhi-reliability-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;};
test('十进制求值、负数对称舍入和循环小数标识',()=>{
 for(const [expr,value] of [['0.1+0.2',0.3],['0.3-0.1',0.2],['ROUND(1.005,2)',1.01],['ROUND(-1.005,2)',-1.01],['ROUND(-1.5,0)',-2],['ROUND(-150,-2)',-200],['SUM(0.1,0.2,0.3)',0.6],['(1/3)*3',1],['2^-2',0.25],['-2^2',-4],['MIN(-0.1,-0.2)',-0.2]])assert.equal(calculate(expr).value,value,expr);
 assert.equal(calculate('9007199254740993+1').decimal,'9007199254740994');const third=calculate('1/3');assert.equal(third.exact,false);assert.equal(third.ratio,'1/3');assert.equal(calculate('1/8').exact,true);
 for(const expr of ['1/0','0^-1','2^0.5','2^99999999','1e99999','ROUND(1,1.1)','ABS(1,2)','1e-1000'])assert.throws(()=>calculate(expr));
});
test('全量统计和跨表差额没有浮点累加误差，不改变未知和重复口径',()=>{
 const left={name:'旧价',rows:[{A2:'001',B2:'0.1'},{A3:'002',B3:'0.2'}]},right={name:'新价',rows:[{A2:'001',B2:'0.2'},{A3:'002',B3:'0.3'}]};
 assert.equal(tableStats(left,{valueColumn:'B'}).groups[0].result,0.3);
 const result=compareTables(left,right,{leftKeyColumn:'A',rightKeyColumn:'A',leftValueColumn:'B',rightValueColumn:'B'});
 assert.equal(result.comparableTotals.difference,0.2);assert.deepEqual(result.items.map(i=>i.difference),[0.1,0.1]);assert.equal(result.comparableDecimals.left,'0.3');
});
test('生成Word全正文逐项核对，正文、表格、重复段落和尾部被改即拒绝',async t=>{
 const dir=await temp(t),file=path.join(dir,'notice.docx'),body='# 通知\n\n**设计团队**准备资料，金额1.01元。\n\n- 采购价目表\n- 标准件成本\n\n| 编号 | 金额 |\n| --- | --- |\n| 001 | 0.30 |\n\n重复段落。\n\n重复段落。\n\n尾部校验926。',plan={format:'docx',title:'通知.docx',body};
 for(const readableLayout of [false,true]){await makeDocument(plan.title,body,file,{readableLayout});assert.equal((await verifyOfficeContent(file,plan)).contentVerified,true);}
 const zip=await officePackage(file),$=await readPart(zip,'word/document.xml');const last=tags($,'t').last();last.text(last.text().replace('926','927'));zip.file('word/document.xml',$.xml());await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));
 await assert.rejects(verifyOfficeContent(file,plan),e=>e.code==='OFFICE_CONTENT_FAILED');
});
test('Excel核对每张表全部字段和类型，零空值、日期、百分比、长编号、尾行保留',async t=>{
 const dir=await temp(t),file=path.join(dir,'cost.xlsx'),workbook={sheets:[{name:'成本',columns:[{label:'编号',kind:'text'},{label:'金额',kind:'currency'},{label:'日期',kind:'date'},{label:'比例',kind:'percentage'}],rows:[['00000000000000000001','0.30','2026-10-13','0.07%'],['002',0,null,null],['003',null,null,null]]},{name:'空数据',columns:[{label:'项目',kind:'text'}],rows:[]}]},plan={format:'xlsx',title:'成本',body:'保留未知值。',columns:[],rows:[],workbook};
 for(const readableLayout of [false,true]){await makeWorkbook(plan.title,plan.body,[],[],file,{plan:workbook,readableLayout});assert.equal((await verifyOfficeContent(file,plan)).dataRows,3);}
 const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(file);wb.worksheets[0].getCell('B5').value=0.31;await wb.xlsx.writeFile(file);
 await assert.rejects(verifyOfficeContent(file,plan),e=>e.code==='OFFICE_CONTENT_FAILED');
 await makeWorkbook(plan.title,plan.body,[],[],file,{plan:workbook});await wb.xlsx.readFile(file);wb.worksheets[0].getCell('E5').value='未规划内容';await wb.xlsx.writeFile(file);await assert.rejects(verifyOfficeContent(file,plan),e=>e.code==='OFFICE_CONTENT_FAILED');
 assert.throws(()=>workbookSheets([],[],[],{sheets:[{name:'表',columns:[{label:'值',kind:'number'}],rows:[['9007199254740993']]}]}),/精度/);
});
test('上传Excel保留日期、格式、真假值、错误和公式缓存，不把未重算当新结果',async t=>{
 const dir=await temp(t),file=path.join(dir,'input.xlsx'),wb=new ExcelJS.Workbook(),s=wb.addWorksheet('资料');s.getCell('A1').value='00001';s.getCell('B1').value=new Date('2026-10-13T00:00:00Z');s.getCell('B1').numFmt='yyyy-mm-dd';s.getCell('C1').value={formula:'1+2',result:3};s.getCell('D1').value={formula:'SUM(C1:C2)'};s.getCell('E1').value=false;s.getCell('F1').value={error:'#DIV/0!'};await wb.xlsx.writeFile(file);
 const parsed=await extractDocument(file),cells=parsed.sheets[0].cells;assert.equal(parsed.sheets[0].rows[0].B1,'2026-10-13');assert.equal(cells.find(c=>c.address==='B1').type,'date');assert.equal(cells.find(c=>c.address==='C1').formula,'1+2');assert.equal(cells.find(c=>c.address==='D1').cacheMissing,true);assert.equal(cells.find(c=>c.address==='E1').value,false);assert.equal(cells.find(c=>c.address==='F1').type,'error');
 const job={id:'test',status:'running',files:[],fileIds:['x']},tools=createAssistantTools({session:{files:[{id:'x',name:'input.xlsx',...parsed}],messages:[]},job,save(){},extractDocument});
 const response=await tools.execute('zhouzhi_structure',{id:'x',part:'sheet:资料',offset:0,limit:1},'structure');assert.equal(response.success,true);const structure=JSON.parse(response.contentItems[0].text);assert.equal(structure.cells.find(c=>c.address==='B1').type,'date');assert.equal(structure.cells.find(c=>c.address==='D1').cacheMissing,true);assert.equal(structure.items[0].D1,'[公式缓存缺失]');
});
test('耗时证据仅后台保留，失败和断点阶段可定位、不进入公开DTO',async()=>{
 const job={id:'task'};assert.equal(await measureStage(job,'analysis',async()=>42),42);await assert.rejects(measureStage(job,'delivery',async()=>{throw Error('测试失败');}),/测试失败/);
 assert.deepEqual(job.checkpoint.timings.map(t=>t.status),['completed','failed']);assert.ok(job.checkpoint.timings.every(t=>t.durationMs>=0));assert.equal(publicAssistantJob(job).checkpoint,undefined);
});
test('真实文件内容核对失败不发布附件或已完成消息；成功证据仅后台保存',async t=>{
 const dir=await temp(t),file=path.join(dir,'notice.docx'),s={id:'s',files:[],messages:[]},db={sessions:[s],jobs:[]};let corrupt=true;
 const assistant=createAssistant({db,save(){},askAI:async(_id,_prompt,schema)=>schema.properties.ready?{ready:true,checks:[{id:'request',status:'passed',reason:'完整正文规划'}]}:{answer:'已整理通知。',files:[{title:'通知',format:'docx',body:'采购价目表更新。尾部926。'}]},steerAI:async()=>false,cancelAI:async()=>{},fileContext:()=>[],imageInputs:()=>[],artifact:async(title,format,body,_columns,_rows,_scope,_presentation,_extra,options)=>{
  await makeDocument(title,corrupt?body.replace('926','927'):body,file);const check=await verifyOfficeContent(file,{title,format,body});options.onContentVerified(check);return{id:'verified',name:'通知.docx'};
 }});
 async function settled(){for(let i=0;i<100;i++){if(db.jobs.at(-1)?.status==='failed'||db.jobs.at(-1)?.status==='completed')return;await new Promise(r=>setTimeout(r,5));}throw Error('测试任务未结束');}
 await assistant.submit('s',{message:'生成Word通知'});await settled();assert.equal(db.jobs[0].status,'failed');assert.equal(db.jobs[0].files.length,0);assert.equal(s.messages.filter(m=>m.role==='assistant').length,0);
 corrupt=false;assistant.resume('s');await assistant.submit('s',{message:'生成Word通知'});await settled();const job=db.jobs[1];assert.equal(job.status,'completed');assert.equal(job.checkpoint.contentChecks[0].contentVerified,true);assert.equal(publicAssistantJob(job).checkpoint,undefined);assert.equal(s.messages.filter(m=>m.role==='assistant').length,1);
});
