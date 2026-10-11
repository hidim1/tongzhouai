import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,costCategories,estimateParameters,parameterKey,validPriceIndex,estimateReferences,evaluateEstimate,estimatePrompt} from '../server/preview-estimate.mjs';
const parameters=estimateParameters({industry:'dairy',routes:['uf'],capacity:2,requirements:['food_contact','cip'],explosion_proof:false});
function plan(){return{analysis:'根据乳品用途形成不同配置；缺介质数据仍待核对。',risks:['温度和清洗条件待确认'],options:['low','mid','high'].map((tier,i)=>({tier,name:['基础方案','均衡方案','加强方案'][i],description:'档次配置'+tier,configuration:['档次配置'+tier],requirementIds:parameters.requirements,missing:['需确认膜通量与处理目标'],lines:costCategories.map((category,k)=>({category,configuration:'本类别配置'+tier,referenceId:'ai-experience',referenceUnchanged:false,quantityLow:null,quantityHigh:null,quantityBasis:'',amountLow:8000+i*2000+k*100,amountHigh:10000+i*3000+k*100,basis:'AI根据本档配置提出的工程经验区间，非询价',assumptions:['未取得报价，仅以设备边界和初步配置做经验估计'],supportingReferenceIds:[],fileIds:[]}))}))};}
test('行业覆盖实际膜应用且质量要求可组合；其他与出口需说明',()=>{
 assert.equal(catalog.industries.length,24);assert.equal(catalog.requirements.length,17);assert.ok(catalog.industries.every(i=>!('legacy' in i)));
 assert.deepEqual(parameters.requirements,['cip','food_contact']);assert.equal(parameters.compliance,'sanitary');
 assert.equal(parameterKey(parameters),parameterKey({...parameters,requirements:['food_contact','cip']}));
 for(const p of [{industry:'fake'},{industry:'other'},{requirements:['export']},{requirements:['cip','cip']},{capacity:0.01},{requirements:['unknown']}])assert.throws(()=>estimateParameters({...parameters,...p}));
 assert.equal(estimateParameters({...parameters,industry:'other',industryDetail:'特殊资源提取',requirements:['other'],requirementNotes:'按客户URS核对'}).industry,'other');
});
test('采购来源仅采用有效、含税、已审核、同币种单位价格',()=>{
 const good={material_code:'p',unit:'台',supplier:'A',currency:'人民币',document_status:'已审核',tax_included:'是',effective_date:'2026/1/1',expiry_date:'2026/12/31',tax_included_unit_price:100};
 const index=validPriceIndex([good,...[{active:false},{document_status:'未审核'},{currency:'USD'},{tax_included:'否'},{effective_date:'2027/1/1'},{expiry_date:'2025/1/1'}].map((p,i)=>({...good,material_code:'bad'+i,...p}))],'2026-10-09');
 assert.equal(index.size,1);assert.equal(index.get('p|台').tax_included_unit_price,100);
});
test('快速估算只汇总AI经验区间，不依赖原规则或信任模型总价',()=>{
 const p=plan();p.total_cost=1;const result=evaluateEstimate(p,[],parameters);
 assert.equal(result.method,'ai-only-v1');assert.equal(result.options.low.cost_low,58000);assert.equal(result.options.low.cost_high,73000);assert.equal(result.options.low.costKind,'含 AI 经验假设');
 assert.notEqual(result.options.high.total_cost/result.options.mid.total_cost,1.34);assert.match(result.options.low.lines[0].source,/非采购报价/);
});
test('待确认项使全方案成本待确认，已有依据仅作部分区间',()=>{
 const p=plan();p.options[0].lines[0]={...p.options[0].lines[0],referenceId:'pending',amountLow:null,amountHigh:null};
 const o=evaluateEstimate(p,[],parameters).options.low;assert.equal(o.cost_low,null);assert.equal(o.total_cost,null);assert.ok(o.known_low>0);assert.equal(o.pendingCount,1);
});
test('型号变化不借用旧物料价，引用真实采购价以AI数量假设核算',()=>{
 const item={id:'item:t:1',kind:'procurement',category:costCategories[0],name:'参考膜',unit:'支',code:'m',unitPrice:1234,priceSource:'采购单A'};
 const p=plan(),l=p.options[0].lines[0];Object.assign(l,{referenceId:item.id,referenceUnchanged:true,quantityLow:2,quantityHigh:3,quantityBasis:'初步设计假设，需试验确认',amountLow:null,amountHigh:null});
 let o=evaluateEstimate(p,[item],parameters).options.low;assert.equal(o.lines[0].low,2468);assert.equal(o.lines[0].high,3702);
 l.referenceUnchanged=false;o=evaluateEstimate(p,[item],parameters).options.low;assert.equal(o.lines[0].low,null);assert.match(o.lines[0].source,/不能沿用/);
});
test('规则金额、虚构来源、重复费用、无依据数字、降低质量要求均拒绝',()=>{
 const mutations=[p=>p.options[0].lines[0].referenceId='rule:膜组件',p=>p.options[0].lines[0].referenceId='unknown',p=>p.options[0].lines.push({...p.options[0].lines[0]}),p=>p.options[0].requirementIds=[],p=>p.options[0].lines[0].amountHigh=1e11,p=>p.options[0].lines[0].fileIds=['other-project'],p=>p.options[0].lines[0].quantityLow=1,p=>p.options[0].lines[0].assumptions=[],p=>p.options[0].lines[0].supportingReferenceIds=['fake'],p=>p.options[0].lines.pop()];
 for(const mutate of mutations){const p=plan();mutate(p);assert.throws(()=>evaluateEstimate(p,[],parameters));}
 const p=plan();p.options[0].lines[0].referenceId='rule:膜组件';assert.throws(()=>evaluateEstimate(p,[{id:'rule:膜组件',kind:'rule',category:'膜组件',baseCost:10000}],parameters));
 const same=plan();same.options=same.options.map(o=>({...same.options[0],tier:o.tier}));assert.throws(()=>evaluateEstimate(same,[],parameters),/没有实质/);
});
test('参考只有历史组件采购价，不包含旧规则金额或历史数量；父子不重复',()=>{
 const t={template_id:'t',project_name:'样机',route_tags:['超滤'],bom:{rows:[{name:'膜组',code:'p',unit:'套',quantity:1,level:'.1',property:'外购'},{name:'膜芯',code:'m',unit:'支',quantity:999,level:'..2',property:'外购'}]}};
 const refs=estimateReferences([t],[]);assert.equal(refs.length,1);assert.equal(refs[0].name,'膜芯');assert.equal(refs[0].quantity,undefined);assert.equal(refs[0].unitPrice,null);assert.ok(refs.every(r=>r.kind==='procurement'&&!('baseCost' in r)));
 assert.match(estimatePrompt(parameters,refs,[]),/仅限最初/);assert.ok(!estimatePrompt(parameters,refs,[]).includes('rule:'));
});
