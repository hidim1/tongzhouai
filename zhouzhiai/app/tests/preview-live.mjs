import assert from 'node:assert/strict';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
const base='http://127.0.0.1:14318/api';
const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Tongzhou-Client':'workspace'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;};
const state=await(await fetch(base+'/preview/state')).json();
const job=state.jobs.find(j=>j.type==='general'&&j.status==='completed');assert.ok(job,'need a completed real general task');
for(const f of job.files){const buffer=Buffer.from(await(await fetch('http://127.0.0.1:14318'+f.url)).arrayBuffer());if(f.name.includes('.xlsx')){const wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer);assert.ok(wb.worksheets[0].rowCount>=3);console.log('真实AI Excel验证：',wb.worksheets[0].getRow(1).values);}else if(f.name.includes('.docx')){const d=await mammoth.extractRawText({buffer});assert.match(d.value,/设计|预算/);console.log('真实AI Word内容验证通过');}}
const project=await post('/projects',{name:'功能验证项目（模拟需求）'});
const form=new FormData();for(const name of ['新项目模拟需求.txt','3D归档验证.step'])form.append('files',new Blob([fs.readFileSync('../测试资料/'+name)]),name);
const upload=await fetch(base+`/preview/projects/${project.id}/files`,{method:'POST',headers:{'X-Tongzhou-Client':'workspace'},body:form});assert.ok(upload.ok);const files=(await upload.json()).files;
assert.match(files.find(f=>f.ext==='.step').parseNote,/仅归档/);assert.equal(files.find(f=>f.ext==='.step').status,'pending');
const assembly=await post(`/preview/projects/${project.id}/assemble`,{mode:'live',templateIds:['CF20260104GA'],message:'只依据模拟需求文件做新项目重组，不要复制旧清单。新增电导率检测，原储罐不再供货；没有计算书时新数量留空。'});console.log('已提交真实重组验证',assembly.id,'项目',project.id);
