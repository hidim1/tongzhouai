import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import JSZip from 'jszip';import ExcelJS from 'exceljs';
import {repairDecision,recoveryInfo} from '../server/assistant-recovery.mjs';
import {semanticFind,semanticChunks} from '../server/assistant-semantic.mjs';
import {officeDesign} from '../server/office-design.mjs';
import {makeDocument} from '../server/preview-document.mjs';import {makeWorkbook} from '../server/preview-workbook.mjs';
import {officePackage,readPart,tags} from '../server/office-package.mjs';
import {editTemplate,inspectTemplate} from '../server/office-template.mjs';
import {safeOfficeFormula} from '../server/office-formula.mjs';
import {createAssistantTools} from '../server/assistant-tools.mjs';
import {createAssistant} from '../server/preview-assistant.mjs';
import {runTaskLoop,taskPlan,needsTaskWorkflow} from '../server/assistant-workflow.mjs';
import {publicAssistantSession} from '../server/assistant-context.mjs';
import {pivotTable} from '../server/assistant-pivot.mjs';
import {canvasProblems,presentationFacts} from '../server/preview-canvas.mjs';
import {shouldRetainQuestion} from '../server/assistant-clarify.mjs';
import {assertSafeOfficeResources} from '../server/office-safety.mjs';
const temp=async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'zhouzhi-completeness-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;};
const flush=()=>new Promise(r=>setImmediate(r));
const verdict=(status='passed',reason='已按要求核对')=>({ready:status!=='missing',checks:[{id:'request',status,reason}]});
test('有实质进展可以超过两轮；重复无进展和总返工均有限，不限制任务时长',()=>{
 const cp={};for(let i=0;i<6;i++){cp.repairRounds=i;assert.equal(repairDecision(cp,verdict('missing','缺项'+i),{answer:'草稿'+i}).continue,true);}cp.repairRounds=6;assert.equal(repairDecision(cp,verdict('missing','第七项'),{}).continue,false);
 const same={};for(let i=0;i<2;i++){same.repairRounds=i;assert.equal(repairDecision(same,verdict('missing'),{}).continue,true);}same.repairRounds=2;assert.equal(repairDecision(same,verdict('missing'),{}).reason,'no_progress');
 assert.equal(recoveryInfo({code:'TASK_NEEDS_INPUT',message:'尚有缺项'}).canResume,false);assert.equal(recoveryInfo(Error('资料不属于本次任务')).canResume,false);
});
test('真实草稿进展允许三次修复，不靠增加相同失败重试',async()=>{
 const j={id:'j',message:'先核对，再分析',status:'running',files:[],fileIds:[]};taskPlan(j);let calls=0;
 const result=await runTaskLoop({job:j,tools:{definitions:[]},save(){},cancelled:()=>false,analyze:async()=>({answer:'已补齐'+calls}),askAI:async()=>{calls++;return calls<4?verdict('missing','还缺第'+calls+'项'):verdict();}});
 assert.equal(calls,4);assert.equal(j.checkpoint.repairRounds,3);assert.match(result.answer,/已补齐3/);
});
test('语义排序采用真实候选与位置，缓存复用不把相关性当事实',async()=>{
 const files=[{id:'a',name:'运营事项',text:'运营维护采购价目表和自制标准件制造成本。'}],cp={};let calls=0;const context={checkpoint:cp,id:'x',askAI:async(_id,prompt,_schema,_images,_phase,_effort,options)=>{calls++;assert.match(prompt,/买进零部件/);assert.equal(options.allowWebSearch,false);assert.equal(options.privateResult,true);return{matches:[{index:0,score:95,reason:'采购价格与买进零部件价格相关'}]};}};
 const result=await semanticFind(files,{query:'买进零部件价格'},context);assert.equal(result.results[0].id,'a');assert.equal(result.results[0].offset,0);assert.match(result.results[0].text,/价目表/);assert.equal(result.nextOffset,null);await semanticFind(files,{query:'买进零部件价格'},context);assert.equal(calls,1);
 await assert.rejects(semanticFind(files,{query:'制造成本'},{...context,askAI:async()=>({matches:[{index:99,score:100,reason:'伪造位置'}]})}),/无法核对/);
 assert.equal(semanticChunks([{id:'x',name:'长文',text:'文'.repeat(65000)}]).length,65);
});
test('语义扫描明确分页和覆盖范围，不能凭前60片段说查完全文',async()=>{
 const files=[{id:'a',name:'长文',text:'文'.repeat(65000)}],context={askAI:async()=>({matches:[]})};const first=await semanticFind(files,{query:'查尾部'},context);assert.deepEqual(first.scannedRange,[0,60]);assert.equal(first.nextOffset,60);const last=await semanticFind(files,{query:'查尾部',offset:60},context);assert.deepEqual(last.scannedRange,[60,65]);assert.equal(last.nextOffset,null);
});
test('旧PDF缓存、富文本PDF必须查看页面，单有文字覆盖不能通过',async()=>{
 const file={id:'p',name:'混合图表.pdf',text:'文字层已经有很多内容，仍然可能有重要图表。',pageCount:2},job={id:'pdf',message:'完整审阅',status:'running',fileIds:['p'],files:[]};let reparsed=0;
 const tools=createAssistantTools({job,session:{files:[file],messages:[]},save(){},extractDocument:async()=>{reparsed++;return{...file,visualContent:true,visualMetadataVersion:2};}});
 const result=await tools.execute('zhouzhi_read_file',{id:'p',offset:0,limit:12000},'read');assert.equal(result.success,true);assert.equal(reparsed,1);assert.equal(job.checkpoint.readCoverage.p.textComplete,true);assert.equal(job.checkpoint.readCoverage.p.complete,false);assert.equal(JSON.parse(result.contentItems[0].text).totalPages,2);
 job.checkpoint.pageCoverage={p:{total:2,pages:[1,2],complete:true}};await tools.execute('zhouzhi_read_file',{id:'p',offset:0,limit:12000},'reread');assert.equal(job.checkpoint.readCoverage.p.complete,true);
});
test('有公开资料但没有正文证据不能伪装研究完成；明确限制可有限交付',async()=>{
 const j={id:'web',message:'评价企业优势',files:[],searchReferences:[{url:'https://example.com/'}],checkpoint:{analysisDraft:{answer:'行业第一'},repairRounds:6}};taskPlan(j);
 await assert.rejects(runTaskLoop({job:j,tools:{definitions:[]},save(){},cancelled:()=>false,analyze:async()=>({answer:'行业第一'}),askAI:async()=>verdict()}),/未完成要求/);
 assert.match(j.checkpoint.audit.verdict.checks[0].reason,/真实证据/);
 const limited={id:'limited',message:'评价企业优势',files:[],searchReferences:[{url:'https://example.com/'}]};taskPlan(limited);const answer=await runTaskLoop({job:limited,tools:{definitions:[]},save(){},cancelled:()=>false,analyze:async()=>({answer:'资料不足，不能确认排名。'}),askAI:async()=>verdict('limited')});assert.match(answer.answer,/不能确认/);
});
test('新文档用途自动匹配、指定深色优先，原件修改不使用新主题',async t=>{
 assert.equal(officeDesign('费用分析').purpose,'analytical');assert.equal(officeDesign('资料通知').purpose,'formal');assert.equal(officeDesign('下周计划').purpose,'plan');assert.throws(()=>officeDesign('通知','',{purpose:'formal',accent:'#FFFFFF',density:'compact',rationale:'用户要求'}),/对比不足/);
 const selection={purpose:'plan',accent:'#593777',density:'comfortable',rationale:'用户指定紫色的工作安排'},d=await temp(t),doc=path.join(d,'plan.docx'),xlsx=path.join(d,'plan.xlsx');await makeDocument('工作安排','## 任务\n\n设计提供物料库。',doc,{design:selection});
 const zip=await officePackage(doc),styles=await zip.file('word/styles.xml').async('string');assert.match(styles,/593777/);
 await makeWorkbook('工作安排','',['团队','任务'],[['设计','物料库']],xlsx,{design:selection});const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(xlsx);assert.equal(wb.worksheets[0].getCell('A4').fill.fgColor.argb,'FF593777');
});
test('安全公式支持查找、文本与日期计算，拒绝外部或隐式调用',()=>{
 for(const formula of ['VLOOKUP(A2,数据!A2:B20,2,FALSE)','IFERROR(INDEX(B2:B10,MATCH(A2,A2:A10,0)),0)','XLOOKUP(A2,A3:A9,B3:B9)','TEXTJOIN("、",TRUE,A2:A10)','ROUND(SUMPRODUCT(B2:B9,C2:C9),2)'])assert.equal(safeOfficeFormula(formula),formula);
 for(const formula of ['INDIRECT("A1")','WEBSERVICE("https://example.com")','UNKNOWN(A1)','SUM([其他.xlsx]Sheet1!A1)','RTD("test")','CALL("test")'])assert.throws(()=>safeOfficeFormula(formula));
});
test('PPT可移动原生元素，坐标可读取，越界与分组修改拒绝',async t=>{
 const d=await temp(t),source=path.join(d,'source.pptx'),target=path.join(d,'target.pptx'),zip=new JSZip();zip.file('ppt/presentation.xml','<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="s1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>');zip.file('ppt/_rels/presentation.xml.rels','<Relationships><Relationship Id="s1" Target="slides/slide1.xml"/></Relationships>');zip.file('[Content_Types].xml','<Types/>');zip.file('ppt/slides/slide1.xml','<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/></p:nvSpPr><p:spPr/><p:txBody><a:p><a:r><a:t>原文</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');zip.file('ppt/media/logo.png','保持资源');await fs.writeFile(source,await zip.generateAsync({type:'nodebuffer'}));const info=await inspectTemplate(source),operation={action:'moveSlideElement',slideId:'256',elementId:'2',x:80,y:100,width:500,height:120};await editTemplate(source,target,{fingerprint:info.fingerprint,operations:[operation]});const updated=await inspectTemplate(target);assert.deepEqual(updated.slides[0].elements[0].frame,{x:80,y:100,width:500,height:120});assert.equal(updated.slides[0].elements[0].text,'原文');assert.equal(await(await officePackage(target)).file('ppt/media/logo.png').async('string'),'保持资源');await assert.rejects(editTemplate(source,target,{fingerprint:info.fingerprint,operations:[{...operation,x:1200}]}),/越界/);
});
test('Word只格式化指定段落，不改正文和源样式定义',async t=>{
 const d=await temp(t),source=path.join(d,'source.docx'),target=path.join(d,'target.docx');await makeDocument('通知','待强调事项。\n\n保留事项。',source);const info=await inspectTemplate(source),before=await officePackage(source);await editTemplate(source,target,{fingerprint:info.fingerprint,operations:[{action:'formatParagraph',blockId:'block:1',fontSize:16,alignment:'center',weight:'bold',color:'#17495A'}]});const after=await officePackage(target),$=await readPart(after,'word/document.xml'),paragraph=tags($,'p').eq(1);assert.equal(tags($,'jc',paragraph).attr('w:val'),'center');assert.equal(tags($,'sz',paragraph).attr('w:val'),'32');assert.equal(tags($,'t',paragraph).text(),'待强调事项。');assert.deepEqual(await before.file('word/styles.xml').async('nodebuffer'),await after.file('word/styles.xml').async('nodebuffer'));
});
test('阶段性答复受公开守卫保护、不可在验收发布，也不能用假证据编号',async()=>{
 const j={id:'share',message:'整理这些安排',status:'running',files:[],fileIds:[]},tools=createAssistantTools({job:j,session:{files:[],messages:[]},save(){}});
 assert.equal((await tools.execute('zhouzhi_share_answer',{text:'目前两项工作都需要更新资料。',evidenceIds:[]},'share')).success,true);assert.equal(j.answerUpdates.length,1);
 assert.equal((await tools.execute('zhouzhi_share_answer',{text:'已核对',evidenceIds:['假的证据']},'fake')).success,false);j.analysisMode='audit';assert.equal((await tools.execute('zhouzhi_share_answer',{text:'验收进度',evidenceIds:[]},'audit')).success,false);
});
test('用户补充后续办原任务，复用草稿与成果，不让用户重述',async()=>{
 const s={id:'s',files:[],messages:[]},db={sessions:[s],jobs:[]};let fixed=false;const assistant=createAssistant({db,save(){},fileContext:()=>[],imageInputs:()=>[],artifact(){throw Error('不要文件');},steerAI:async()=>false,cancelAI:async()=>{},askAI:async(_id,prompt,schema)=>schema.properties.ready?verdict(fixed?'passed':'missing','缺少单价'):({answer:fixed?'金额30元。':'请补充单价。'})});
 await assistant.submit('s',{message:'先核对数量，再算金额'});for(let i=0;i<12;i++)await flush();assert.equal(db.jobs[0].status,'failed');assert.equal(db.jobs[0].needsInput,false);assert.equal(db.jobs[0].errorCode,'TASK_NO_PROGRESS');assert.ok(s.pendingRecovery);fixed=true;
 await assistant.submit('s',{message:'补充：单价10元，数量3个'});for(let i=0;i<12;i++)await flush();assert.equal(db.jobs.length,1);assert.equal(db.jobs[0].status,'completed');assert.match(db.jobs[0].answer,/30/);assert.equal(s.pendingRecovery,undefined);assert.equal(publicAssistantSession({...s,pendingRecovery:{jobId:'private'}}).pendingRecovery,undefined);
});
test('有附件的含糊分析同样有验收，简单闲聊不增调用',()=>{assert.equal(needsTaskWorkflow('看看这个',[],1),true);assert.equal(needsTaskWorkflow('你好',[],0),false);});
test('交叉汇总覆盖全量、准确小数、前导零、全缺值组不变成零',()=>{
 const sheet={name:'明细',rows:[{A1:'编号',B1:'类别',C1:'金额'},{A2:'001',B2:'外购',C2:0.1},{A3:'001',B3:'外购',C3:0.2},{A4:'001',B4:'自制',C4:0},{A5:'002',B5:'外购',C5:null},{A6:'003',B6:'外购',C6:'待确认'},{A7:'合计',B7:'',C7:999}]};
 const options={rowColumns:['A'],columnColumn:'B',valueColumn:'C',startRow:2,endRow:6,operation:'sum',limit:2},first=pivotTable(sheet,options),last=pivotTable(sheet,{...options,offset:first.nextOffset});
 assert.equal(first.totalRecords,5);assert.equal(first.items[0].rowKey[0],'001');assert.equal(first.items[0].decimal,'0.3');assert.equal(first.items[1].value,0);assert.equal(last.items[0].value,null);assert.equal(last.items[1].value,null);assert.equal(first.missing,1);assert.equal(first.nonNumeric,1);assert.throws(()=>pivotTable({...sheet,requiresConfirmation:true},options),/疑点/);
});
test('顶部不再展示版本标识，退出登录和AI连接状态仍在',async()=>{
 const ui=await fs.readFile(new URL('../src/Preview.tsx',import.meta.url),'utf8');assert.doesNotMatch(ui,/boot\.version|className="zh-pill"/);assert.match(ui,/退出登录/);assert.match(ui,/AI 已连接/);
});
test('简单任务不携带文件编辑工具，保留数学、历史和授权记忆；执行层也拒绝未暴露工具',async()=>{
 const job={id:'simple',status:'running',message:'你好',fileIds:[],files:[]},tools=createAssistantTools({job,session:{files:[],messages:[]},save(){}});const names=tools.definitions.map(t=>t.name);assert.ok(names.includes('zhouzhi_calculate'));assert.ok(names.includes('zhouzhi_history'));assert.ok(names.includes('zhouzhi_project_memory'));assert.ok(!names.includes('zhouzhi_edit_template'));assert.ok(!names.includes('zhouzhi_semantic_find'));assert.equal((await tools.execute('zhouzhi_edit_template',{id:'x',title:'x',fingerprint:'x',operations:[]},'out')).success,false);
});
test('标题后可插入普通正文或继承其他正文样式，位置与样式不混淆',async t=>{
 const d=await temp(t),source=path.join(d,'source.docx'),target=path.join(d,'target.docx');await makeDocument('资料通知','原正文。',source);const info=await inspectTemplate(source);
 await editTemplate(source,target,{fingerprint:info.fingerprint,operations:[{action:'insertStyledParagraph',part:'word/document.xml',blockId:'block:0',styleBlockId:'normal',text:'新增正文。'}]});
 const after=await inspectTemplate(target);assert.deepEqual(after.parts[0].blocks.map(b=>b.text),['资料通知','新增正文。','原正文。']);const $=await readPart(await officePackage(target),'word/document.xml');assert.equal(tags($,'pStyle',tags($,'p').eq(1)).attr('w:val'),'Normal');
});
test('PPT原生底板和正文可以分层，但前景重叠、越界和错误形状仍拒绝',()=>{
 const shape={kind:'shape',id:'card',x:60,y:50,width:1100,height:160,geometry:'roundRect',fill:'#EAF4F5',lineColor:'#176B78',lineWidth:1,layer:'background'},title={kind:'text',id:'title',x:80,y:70,width:1000,height:80,text:'工作安排',role:'title',fontSize:48,color:'#17384A',bold:true},plan={assets:[],slides:[{title:'工作安排',notes:'',background:'#FFFFFF',elements:[shape,title]}]};assert.deepEqual(canvasProblems(plan),[]);
 const before=presentationFacts(plan);shape.fill='#EAF0F9';assert.equal(presentationFacts(plan),before);shape.geometry='ellipse';assert.notEqual(presentationFacts(plan),before);shape.layer='content';assert.ok(canvasProblems(plan).includes('第1页正文元素重叠'));shape.x=1200;assert.ok(canvasProblems(plan).includes('第1页元素越出画布'));
});
test('明确先确认口径的自然问题保存待补充状态，普通答复的可选追问不强行承接',async()=>{
 assert.equal(shouldRetainQuestion('核对重复金额，先确认口径','请确认：累计还是版本？'),true);assert.equal(shouldRetainQuestion('介绍一下公司','介绍如下。你需要进一步资料吗？'),false);
 const session={id:'s',files:[],messages:[]},db={sessions:[session],jobs:[]};const assistant=createAssistant({db,save(){},fileContext:()=>[],imageInputs:()=>[],artifact(){throw Error('不应制作');},steerAI:async()=>false,cancelAI:async()=>{},askAI:async()=>({answer:'请确认：累计还是版本？'})});
 await assistant.submit('s',{message:'核对重复金额，先确认口径'});for(let i=0;i<6;i++)await flush();assert.equal(db.jobs[0].status,'waiting_user');assert.ok(session.pendingClarification);assert.equal(db.jobs[0].checkpoint.clarification.question,'请确认：累计还是版本？');
});
test('重算前即拒绝外部资源、恶意名称公式和活动控件，不等渲染时才阻断',async()=>{
 const zip=new JSZip();zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="e" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" TargetMode="External" Target="https://example.com/image.png"/></Relationships>');await assert.rejects(assertSafeOfficeResources(zip),/外部加载/);
 zip.remove('xl/_rels/workbook.xml.rels');zip.file('xl/workbook.xml','<workbook><definedNames><definedName name="unsafe">WEBSERVICE("https://example.com")</definedName></definedNames></workbook>');await assert.rejects(assertSafeOfficeResources(zip),/网络/);zip.remove('xl/workbook.xml');zip.file('xl/activeX/activeX1.xml','<active/>');await assert.rejects(assertSafeOfficeResources(zip),/主动控件/);
});
test('等待补充期间撤销文件授权，不沿用旧格式恢复，也不制作旧草稿',async()=>{
 const session={id:'s',files:[],messages:[{role:'user',text:'生成Word通知'}],pendingRecovery:{jobId:'old'}},old={id:'old',sessionId:'s',type:'general',status:'failed',message:'生成Word通知',files:[],fileIds:[],deliveryFormats:['docx'],checkpoint:{stage:'analysis',unfinished:[{id:'request',reason:'缺日期'}],analysisDraft:{answer:'待补充',files:[{title:'通知',format:'docx',body:'旧稿'}]}}},db={sessions:[session],jobs:[old]};let files=0;
 const assistant=createAssistant({db,save(){},fileContext:()=>[],imageInputs:()=>[],artifact(){files++;throw Error('已撤销文件授权');},steerAI:async()=>false,cancelAI:async()=>{},askAI:async(_id,_prompt,schema)=>{assert.equal(schema.properties.files,undefined);return{answer:'在对话内整理，不生成文件。'};}});
 await assistant.submit('s',{message:'继续，不要生成文件'});for(let i=0;i<6;i++)await flush();assert.equal(db.jobs.length,2);assert.equal(old.status,'failed');assert.equal(db.jobs[1].status,'completed');assert.deepEqual(db.jobs[1].deliveryFormats,[]);assert.equal(files,0);
});
