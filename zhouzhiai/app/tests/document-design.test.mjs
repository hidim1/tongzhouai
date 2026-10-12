import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import mammoth from 'mammoth';import ExcelJS from 'exceljs';
import {parseMarkdown,formatMarkdown,nodeText} from '../shared/markdown.mjs';
import {makeDocument,makeMarkdown} from '../server/preview-document.mjs';
import {makeWorkbook,workbookSheets} from '../server/preview-workbook.mjs';
import {canvasProblems,presentationFacts} from '../server/preview-canvas.mjs';
import {presentationAssets} from '../server/preview-presentation-assets.mjs';
import {validatePresentation,presentationInstructions} from '../server/preview-presentation.mjs';
import {reviewPresentation,repairPresentationLayout} from '../server/preview-presentation-review.mjs';
import {generalFileSchema} from '../server/preview-ai.mjs';
import {assistantResult} from '../server/preview-search.mjs';
import {presentationReviewSchema} from '../server/preview-design-schema.mjs';
function dir(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-document-design-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
const plan=()=>({design:{background:'#FFFFFF',textColor:'#172F42',accentColor:'#006875',fontFamily:'Arial Unicode MS',rationale:'工作汇报'},assets:[],slides:[{layout:'canvas',title:'工作进展',background:'#FFFFFF',notes:'',elements:[{kind:'text',id:'title',role:'title',x:64,y:56,width:1152,height:100,text:'工作进展',fontSize:48,bold:true,color:'#172F42'},{kind:'text',id:'body',role:'body',x:64,y:210,width:900,height:260,text:'设计团队提供全量物料库。',fontSize:32,bold:false,color:'#172F42'}]}]});
test('中文句号紧接汉字、空格闭合的加粗兼容；代码、转义、三连星、链接、HTML不改写',()=>{
 for(const s of ['**结论。**你说得对。','**结论。 **你说得对。','结论：**候选名单。**这些资料待核实。']){const tree=parseMarkdown(s);assert.ok(tree.children[0].children.some(n=>n.type==='strong'));assert.ok(!formatMarkdown(s).includes('&#x'));}
 for(const s of ['`**结论。**你`','\\*\\*保留星号\\*\\*','***结论***','[**结论。**你](https://example.com)'])assert.ok(parseMarkdown(s));
 const escaped=parseMarkdown('\\*\\*保留星号\\*\\*');assert.deepEqual(escaped.children[0].children.map(n=>n.type),['text']);assert.equal(nodeText(escaped),'**保留星号**');
 assert.equal(parseMarkdown('`**结论。**你`').children[0].children[0].type,'inlineCode');
 assert.equal(nodeText(parseMarkdown('**结论。**你质疑得对。')),'结论。你质疑得对。');
 assert.match(formatMarkdown('```js\nconst s="**结论。**你";\n```'),/const s="\*\*结论。\*\*你"/);
});
test('Word原生标题、加粗、编号和表格；Markdown不重复标题或附加系统说明',async t=>{
 const d=dir(t),doc=path.join(d,'report.docx'),md=path.join(d,'report.md');
 const body='# 工作进展\n\n**已完成。**下一步收集物料资料。\n\n## 待办\n\n1. 整理资料\n2. 核对价格\n\n| 团队 | 交付 |\n| --- | --- |\n| 设计 | 全量物料库 |\n| 运营 | 采购价与制造成本 |\n\n<script>不可执行</script>';
 await makeDocument('工作进展.docx',body,doc);await makeMarkdown('工作进展.md',body,md);
 const html=(await mammoth.convertToHtml({path:doc})).value;assert.match(html,/<h1>待办<\/h1>|<h2>待办<\/h2>/);assert.match(html,/<strong>已完成。<\/strong>/);assert.match(html,/<ol>/);assert.match(html,/<table>/);assert.doesNotMatch(html,/\*\*|<script>|不可执行|\.docx/);assert.equal((html.match(/工作进展/g)||[]).length,1);
 const text=fs.readFileSync(md,'utf8');assert.equal(text.match(/^# 工作进展$/gm).length,1);assert.doesNotMatch(text,/通用输出|编制说明|&#x/);assert.match(text,/\|.*全量物料库/);
});
test('Excel保留类型、零与空、编号前导零、行数、列宽、冻结和打印；原有预算金额不变',async t=>{
 const d=dir(t),target=path.join(d,'data.xlsx'),data={sheets:[{name:'采购清单',columns:[{label:'编号',kind:'text'},{label:'物料名称和规格',kind:'text'},{label:'数量',kind:'number'},{label:'金额',kind:'currency'},{label:'日期',kind:'date'}],rows:[['0007','卫生级过滤组件及其配套密封件',2,1500,'2026-10-12'],['0008','待定物料',null,0,null]]}]};
 await makeWorkbook('采购清单','数量待确认时保持空白。',[],[],target,{plan:data});const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(target);const s=wb.worksheets[0];
 assert.equal(wb.worksheets.length,1);assert.equal(s.getCell('A5').value,'0007');assert.equal(s.getCell('C5').value,2);assert.equal(s.getCell('D6').value,0);assert.equal(s.getCell('C6').value,null);assert.ok(s.getCell('E5').value instanceof Date);assert.equal(s.getCell('E5').numFmt,'yyyy-mm-dd');assert.ok(s.getColumn(2).width>s.getColumn(3).width);assert.equal(s.views[0].ySplit,4);assert.ok(s.autoFilter);assert.match(s.pageSetup.printTitlesRow,/4/);
 const old=path.join(d,'budget.xlsx');await makeWorkbook('预算','', ['项目','金额'],[['设备',200]],old,{engineering:true});const ow=new ExcelJS.Workbook();await ow.xlsx.readFile(old);assert.equal(ow.worksheets[0].getCell('B2').value,200);
 assert.throws(()=>workbookSheets([],[],[],{sheets:[{...data.sheets[0],rows:[['bad']]}]}),/列数/);
 assert.throws(()=>workbookSheets([],[],[],{sheets:[{name:'日期',columns:[{label:'日期',kind:'date'}],rows:[['2026-02-30']]}]}),/日期无效/);
 assert.throws(()=>workbookSheets([],[],[],{sheets:[{name:'重复',columns:[{label:'值',kind:'number'}],rows:[[Infinity]]}]}),/无效数字/);
 const literal=workbookSheets(['内容'],[['=HYPERLINK("http://example.com")']]);assert.equal(literal[0].rows[0][0],'=HYPERLINK("http://example.com")');
});
test('PPT逐页自由构图、配图与可编辑数据结构；越界、重叠、缺图片和无效表格拒绝',()=>{
 const p=plan();assert.deepEqual(canvasProblems(p),[]);assert.equal(validatePresentation(p),p);assert.match(presentationInstructions,/逐页设计|逐页/);assert.doesNotMatch(presentationInstructions,/最多.*张|两张/);
 const schema=generalFileSchema(['pptx']).properties.files.items.properties.presentation.anyOf[0];assert.equal(schema.properties.slides.items.properties.layout.enum[0],'canvas');assert.equal(schema.properties.assets.maxItems,undefined);
 for(const mutate of [p=>p.slides[0].elements[1].x=1200,p=>p.slides[0].elements[1].y=60,p=>p.slides[0].elements[1].text='**文本**']){const q=plan();mutate(q);assert.ok(canvasProblems(q).length);assert.throws(()=>validatePresentation(q));}
});
test('PPT图片只来自本轮资料、品牌或授权生图；没有张数上限、取消后不继续发起',async t=>{
 const d=dir(t),root=path.resolve(import.meta.dirname,'..'),png=fs.readFileSync(path.join(root,'public/brand/crossflow-logo.png'));let calls=0;
 const p={assets:Array.from({length:4},(_,i)=>({id:'g'+i,kind:'generated',prompt:'示意图'+i,alt:'示意图'}))};
 const images=await presentationAssets(p,{root,buildDir:d,allowGenerated:true,generateImage:async payload=>{calls++;fs.writeFileSync(payload.target,png);}});assert.equal(calls,4);assert.equal(images.size,4);
 await presentationAssets(p,{root,buildDir:d,allowGenerated:true,generateImage:async()=>{throw Error('不得重复计费');}});assert.equal(calls,4);
 await assert.rejects(presentationAssets({assets:[{id:'x',kind:'uploaded',fileId:'other-account'}]},{root,buildDir:d,sourceFiles:[]}),/不属于本轮/);
 await assert.rejects(presentationAssets(p,{root,buildDir:d,allowGenerated:true,generateImage:async()=>{},cancelled:()=>true}),/停止/);
 await assert.rejects(presentationAssets(p,{root,buildDir:d,allowGenerated:false}),/尚未允许/);
});
test('PPT视觉检查必须查看所有页面；排版修正不能改事实或移除数据',async()=>{
 assert.equal(assistantResult(JSON.stringify({acceptable:true,problems:[],repairs:[],sources:[]}),presentationReviewSchema,v=>v).output.acceptable,true);
 const p=plan();p.slides=Array.from({length:5},()=>structuredClone(p.slides[0]));let calls=0;
 await reviewPresentation(p,['a','b','c','d','e'],{id:'test',askAI:async(_id,_text,_schema,images)=>{calls++;assert.ok(images.length<=4);return{acceptable:true,problems:[],repairs:[]};}});assert.equal(calls,2);
 const changed=plan();changed.slides[0].elements[1].text='伪造新事实';assert.notEqual(presentationFacts(changed),presentationFacts(plan()));
 await assert.rejects(repairPresentationLayout(plan(),'字号不足',{askAI:async()=>changed}),/改变了原始内容/);
 await assert.rejects(reviewPresentation(plan(),['a'],{askAI:async()=>({acceptable:false,problems:['文字太小'],repairs:[]})}),/未通过/);
});
