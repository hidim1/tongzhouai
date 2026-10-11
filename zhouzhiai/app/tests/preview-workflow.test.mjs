import test from 'node:test';
import assert from 'node:assert/strict';
import {directionInput,directionContext,detailedBudget,updateBudget,invalidateBudget,versionChanged,filesSnapshot,extraCategories} from '../server/preview-workflow.mjs';
const params={industry:'pharma',routes:['uf'],capacity:1,compliance:'gmp',explosion_proof:false};
const row={id:'r',action:'新增',name:'新设备',unit:'台',quantity:2,reviewed:true};
const version=()=>({id:'v',status:'reviewed',rows:[{...row}],direction:{targetCost:300}});
const extras=()=>extraCategories.map(category=>({category,amount:0,source:'费用已包含，不额外计入',reviewed:true}));
test('方向参数和目标成本严格验证，不接受无效档次和伪造参数',()=>{
 assert.deepEqual(directionInput({parameters:params,tier:'mid'}),{...params,explosion_class:''});
 for(const patch of [{tier:'no'},{targetCost:-1},{parameters:{...params,capacity:0}},{parameters:{...params,routes:['bad']}},{parameters:{...params,routes:['uf','uf']}}])assert.throws(()=>directionInput({parameters:params,tier:'mid',...patch}));
 const c=directionContext({id:'d',parameters:params,estimate:{industry_name:'制药',route_names:['超滤']},tier:'mid',option:{name:'推荐中档',total_cost:250},targetCost:300});assert.match(c,/上传资料中的明确要求优先/);assert.match(c,/不.*新清单数量/);
});
test('缺数量或价格保留待确认，粗估不加进详细预算',()=>{
 const v=version();const b=detailedBudget(v,[]);assert.equal(b.confirmedSubtotal,null);assert.equal(b.total,null);assert.equal(b.pendingLines,1);assert.equal(b.target,300);assert.equal(b.delta,null);
 v.rows[0].quantity=null;v.budget=updateBudget(v,{lines:[{rowId:'r',unitPrice:100,source:'询价单A',reviewed:true}],extras:extras()});assert.equal(detailedBudget(v,[]).total,null);
});
test('人工依据有效才能完整核算，初步目标只用于差额比较',()=>{
 const v=version();v.budget=updateBudget(v,{lines:[{rowId:'r',unitPrice:100,source:'含税询价单A',reviewed:true}],extras:extras()});
 const b=detailedBudget(v,[]);assert.equal(b.total,200);assert.equal(b.delta,-100);assert.equal(b.complete,true);assert.equal(b.overTarget,false);
 v.direction.targetCost=150;assert.equal(detailedBudget(v,[]).overTarget,true);
 v.rows[0].reviewed=false;assert.equal(detailedBudget(v,[]).complete,false);
});
test('修改规格数量使人工价格失效、导出版本过期',()=>{
 const v=version();v.budget=updateBudget(v,{lines:[{rowId:'r',unitPrice:100,source:'询价A',reviewed:true}],extras:extras()});
 invalidateBudget(v,v.rows[0]);versionChanged(v);assert.equal(v.budget.lines[0].unitPrice,null);assert.equal(v.budget.lines[0].reviewed,false);assert.equal(v.revision,1);assert.equal(detailedBudget(v,[]).total,null);
});
test('无依据零价、非本方案行和重复费用被拒绝',()=>{
 const v=version();assert.throws(()=>updateBudget(v,{lines:[{rowId:'r',unitPrice:0,source:'',reviewed:true}],extras:[]}));
 assert.throws(()=>updateBudget(v,{lines:[{rowId:'other',unitPrice:100,source:'A',reviewed:true}],extras:[]}));
 assert.throws(()=>updateBudget(v,{lines:[],extras:[extras()[0],extras()[0]]}));
});
test('父级不与子件重复计价，删除行不计入预算',()=>{
 const v=version();v.rows=[{...row,id:'parent',hasChildren:true},{...row,id:'child'},{...row,id:'deleted',action:'删除'}];
 v.budget=updateBudget(v,{lines:[{rowId:'parent',unitPrice:500,source:'父级报价',reviewed:true},{rowId:'child',unitPrice:50,source:'子件报价',reviewed:true}],extras:extras()});
 const b=detailedBudget(v,[]);assert.equal(b.total,100);assert.equal(b.lines.find(l=>l.rowId==='parent').amount,null);assert.equal(b.lines.length,2);
});
test('附件快照不包含正文路径，文本变化留下不同指纹',()=>{
 const f={id:'f',name:'招标.txt',text:'需求A',size:20,status:'parsed',path:'/private'};
 const a=filesSnapshot([f])[0],b=filesSnapshot([{...f,text:'需求B'}])[0];assert.notEqual(a.hash,b.hash);assert.equal(a.path,undefined);assert.equal(a.text,undefined);
});
