import test from 'node:test';
import assert from 'node:assert/strict';
import {templates,candidates,demoPlan,validatePlan,procurementSubtotal,templateCatalog,selectedModules,hydratePlan,expandAssembly} from '../server/preview-core.mjs';
test('重组有六种动作，删除不进入成本、历史数据不被改写',()=>{
 const selected=candidates([templates[0].template_id]),before=JSON.stringify(selected);const p=demoPlan(selected);
 assert.deepEqual(new Set(p.rows.map(r=>r.action)),new Set(['沿用','调整','替换','删除','待确认','新增']));assert.equal(JSON.stringify(selected),before);assert.equal(procurementSubtotal(p.rows).subtotal,0);
 assert.equal(procurementSubtotal(p.rows).details.length,p.rows.length-1);
});
test('不存在的历史行和伪造附件来源被拒绝',()=>{
 const selected=candidates([templates[0].template_id]),p=demoPlan(selected);
 p.rows[0].rowIndex=999999;assert.throws(()=>validatePlan(p,selected,[]),/行号/);
 const second=demoPlan(selected);second.rows[0].fileIds=['not-this-project'];assert.throws(()=>validatePlan(second,selected,[]),/非本项目/);
});
test('替换组件不继承旧采购价格；缺量不视为零成本',()=>{
 const p=demoPlan(candidates([templates[0].template_id]));assert.equal(p.rows[2].priceCode,'');assert.equal(p.rows[1].quantity,null);
});
test('采购小计只使用当前有效、已审核、同币种单位价格',()=>{
 const row={id:'r',action:'沿用',reviewed:true,property:'外购',quantity:2,priceCode:'A',unit:'台'};
 const base={material_code:'A',supplier:'test',unit:'台',tax_included_unit_price:100,document_status:'已审核',currency:'人民币',effective_date:'2026/1/1',expiry_date:'2026/12/31'};
 assert.equal(procurementSubtotal([row],[base],'2026-10-09').subtotal,200);
 for(const patch of [{expiry_date:'2026/9/1'},{document_status:'重新审核'},{currency:'美元'},{unit:'套'},{effective_date:'2027/1/1'}])assert.equal(procurementSubtotal([row],[{...base,...patch}],'2026-10-09').subtotal,0);
 assert.equal(procurementSubtotal([{...row,reviewed:false}],[base],'2026-10-09').details[0].price,null);
 assert.equal(procurementSubtotal([{...row,action:'删除'}],[base],'2026-10-09').subtotal,0);
});
test('组件父级与子件避免重复计价',()=>{
 const rows=[{id:'parent',action:'沿用',reviewed:true,property:'外购',quantity:1,priceCode:'A',unit:'台',templateId:'T',level:'1',original:{}},{id:'child',action:'沿用',reviewed:true,property:'外购',quantity:2,priceCode:'B',unit:'台',templateId:'T',level:'1.1',original:{}}];
 const book=['A','B'].map(material_code=>({material_code,unit:'台',tax_included_unit_price:100,document_status:'已审核',currency:'人民币',effective_date:'2026/1/1',expiry_date:'2026/12/31'}));assert.equal(procurementSubtotal(rows,book,'2026-10-09').subtotal,200);
});
test('后台模块检索保留原始行号，并拒绝越界或跨样机模块',()=>{
 const t=templateCatalog().find(t=>t.id==='CF20260326GA'),m=t.modules.find(m=>m.name.includes('超滤'));
 const selected=selectedModules({templateIds:[t.id],moduleIds:[m.id]});assert.equal(selected[0].rows.length,m.count);assert.equal(selected[0].rows[0].index,m.start);assert.ok(selected[0].rows.every(r=>r.index>=m.start&&r.index<=m.end));assert.ok(selected[0].rows.length<590);
 assert.throws(()=>selectedModules({templateIds:[t.id],moduleIds:['not-valid']}),/不存在/);
 assert.throws(()=>selectedModules({templateIds:[templates[0].template_id],moduleIds:[m.id]}),/不存在/);
});
test('压缩AI输出仅回填源规格，不回填历史数量或替换规格',()=>{
 const selected=candidates([templates[0].template_id]),source=selected[0].rows[2];
 const row={templateId:selected[0].id,rowIndex:2,name:'',spec:'',material:'',unit:'',quantity:null,action:'待确认'};
 const p=hydratePlan({rows:[row]},selected);assert.equal(p.rows[0].name,source.name);assert.equal(p.rows[0].spec,source.specification);assert.equal(p.rows[0].quantity,null);
 const replacement=hydratePlan({rows:[{...row,spec:'',material:'',action:'替换'}]},selected);assert.equal(replacement.rows[0].spec,'');assert.equal(replacement.rows[0].material,'');
});
test('组决策逐项展开，保持AI变更与来源，不自动补历史数量或遗漏项',()=>{
 const selected=candidates([templates[0].template_id]),group={templateId:selected[0].id,rowIndices:[2,3],action:'替换',name:'',spec:'选型待确认',material:'316L',unit:'',quantity:null,fileIds:['new-file'],reason:'新招标要求润湿部件316L',note:''};
 const p=expandAssembly({summary:'初稿',groups:[group],additions:[],documents:[],questions:[]},selected);
 assert.equal(p.rows.length,2);assert.deepEqual(p.rows.map(r=>r.rowIndex),[2,3]);assert.ok(p.rows.every(r=>r.material==='316L'&&r.quantity===null));assert.match(p.questions[0],/未纳入决策范围/);assert.equal(p.rows[0].name,selected[0].rows[2].name);
 assert.throws(()=>expandAssembly({groups:[{...group,rowIndices:[99999]}],additions:[],questions:[]},selected),/超出/);
 assert.throws(()=>expandAssembly({groups:[{...group,name:'统一名称'}],additions:[],questions:[]},selected),/同一名称/);
});
