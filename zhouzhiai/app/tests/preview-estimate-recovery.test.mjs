import test from 'node:test';import assert from 'node:assert/strict';
import {recoverEstimate,estimateFailureKind} from '../server/preview-estimate-recovery.mjs';
import {estimateParameters,costCategories,estimateSchema} from '../server/preview-estimate.mjs';
import {matchesOutputSchema} from '../server/preview-result.mjs';
import {publicAssistantJob} from '../server/preview-search.mjs';
const parameters=estimateParameters({industry:'pharma',routes:['uf'],capacity:1,requirements:['gmp'],explosion_proof:false});
function valid(){return {analysis:'以设备供货边界形成三个独立档次，尚需工程核对。',risks:['介质和通量待确认'],options:['low','mid','high'].map((tier,i)=>({tier,name:'方案'+tier,description:'本档配置'+tier,configuration:['本档配置'+tier],requirementIds:['gmp'],missing:['介质和清洗条件待确认'],lines:costCategories.map(category=>({category,configuration:tier,referenceId:'ai-experience',referenceUnchanged:false,quantityLow:null,quantityHigh:null,quantityBasis:'',amountLow:10000+i*2000,amountHigh:13000+i*2000,basis:'AI经验区间，非供应商报价',assumptions:['仅设备供货的初步配置假设'],supportingReferenceIds:[],fileIds:[]}))}))};}
const disconnected=()=>Object.assign(new Error('stream disconnected before completion: stream closed before response.completed'),{code:'AI_PROVIDER_FAILED'});
const args={id:'estimate-test',parameters,refs:[],context:[],images:[],wait:async()=>{}};
test('输出协议恰好三档，混合21条费用的单对象在接收时就被拒绝',()=>{
 const plan=valid();assert.ok(matchesOutputSchema(plan,estimateSchema));
 const mixed={...plan,options:[{...plan.options[1],configuration:plan.options.flatMap(o=>o.configuration),lines:plan.options.flatMap(o=>o.lines)}]};
 assert.equal(matchesOutputSchema(mixed,estimateSchema),false);assert.equal(matchesOutputSchema({...plan,options:[...plan.options,plan.options[0]]},estimateSchema),false);
});
test('复现06：三档混在一对象时定向纠正，不盲拆或跨档相加',async()=>{
 const plan=valid(),mixed={...plan,options:[{...plan.options[1],lines:plan.options.flatMap(o=>o.lines)}]},calls=[],recovery=[];
 const result=await recoverEstimate({...args,onRecovery:x=>recovery.push(x),askAI:async(...a)=>{calls.push(a);return calls.length===1?mixed:plan;}});
 assert.equal(calls.length,2);assert.equal(result.options.low.cost_low,70000);assert.equal(result.options.high.cost_low,98000);
 assert.match(calls[1][1],/禁止跨档相加/);assert.match(calls[1][1],/上一轮未交付草稿/);assert.equal(recovery[0].reason,'format');assert.equal(calls[0][0],calls[1][0]);
});
test('协议校验失败也保留内存草稿用于修复，不把草稿输出给用户',async()=>{
 let calls=0;const result=await recoverEstimate({...args,askAI:async(...a)=>{calls++;if(calls===1){a[6].onResultText('{"analysis":"待纠正草稿","options":[]}');throw Object.assign(new Error('AI未返回有效结构化结果'),{code:'AI_RESULT_FORMAT'});}assert.match(a[1],/待纠正草稿/);return valid();}});
 assert.equal(calls,2);assert.ok(result.options.mid);
 assert.deepEqual(publicAssistantJob({id:'a',estimateDiagnostics:{attempt:2,private:'draft'}}),{id:'a'});
});
test('复现07：连接中断仅自动重试一次，保留原参数并禁用联网和电脑操作',async()=>{
 const calls=[],recovery=[];let delay=0;
 const result=await recoverEstimate({...args,onRecovery:x=>recovery.push(x),wait:async ms=>{delay=ms;},askAI:async(...a)=>{calls.push(a);if(calls.length===1)throw disconnected();return valid();}});
 assert.equal(calls.length,2);assert.equal(calls[0][1],calls[1][1]);assert.equal(recovery[0].reason,'connection');assert.equal(delay,1000);assert.ok(result.options.high);
 for(const c of calls){assert.equal(c[6].allowWebSearch,false);assert.equal(c[6].cleanupOnFailure,true);assert.equal(c[6].allowCostAssumptions,true);}
});
test('结构纠正与断流恢复合计最多三次，无限重试不可能发生',async()=>{
 for(const first of ['format','connection']){let calls=0;const result=await recoverEstimate({...args,askAI:async()=>{calls++;if((calls===1&&first==='connection')||(calls===2&&first==='format'))throw disconnected();if(calls<3)return{...valid(),options:[]};return valid();}});assert.equal(calls,3);assert.ok(result.options.mid);}
 let calls=0;await assert.rejects(recoverEstimate({...args,askAI:async()=>{calls++;throw disconnected();}}),{code:'AI_ESTIMATE_CONNECTION'});assert.equal(calls,2);
 calls=0;await assert.rejects(recoverEstimate({...args,askAI:async()=>{calls++;return{...valid(),options:[]};}}),{code:'AI_ESTIMATE_VALIDATION'});assert.equal(calls,2);
});
test('取消发生在重试等待或已生成未保存时，不继续请求也不交付',async()=>{
 let cancelled=false,calls=0;
 await assert.rejects(recoverEstimate({...args,cancelled:()=>cancelled,wait:async()=>{cancelled=true;},askAI:async()=>{calls++;throw disconnected();}}),{code:'AI_CANCELLED'});assert.equal(calls,1);
 cancelled=false;await assert.rejects(recoverEstimate({...args,cancelled:()=>cancelled,askAI:async()=>{cancelled=true;return valid();}}),{code:'AI_CANCELLED'});
});
test('认证、配额、安全边界、超时、未知业务失败不能触发重复调用',async()=>{
 for(const error of [Object.assign(disconnected(),{code:'AI_AUTH_REQUIRED'}),new Error('401 stream disconnected'),new Error('429 rate limit'),new Error('insufficient quota'),new Error('stream disconnected: max_output_tokens'),new Error('生成内容包含内部信息'),Object.assign(new Error('任务超过8分钟'),{code:'AI_TASK_TIMEOUT'}),new Error('未知故障')]){
  assert.equal(estimateFailureKind(error),null);let calls=0;await assert.rejects(recoverEstimate({...args,askAI:async()=>{calls++;throw error;}}),e=>e===error);assert.equal(calls,1);
 }
});
test('纠正后的金额、来源、质量要求仍需完整校验，不能因恢复而放行坏预算',async()=>{
 for(const mutate of [p=>p.options[0].requirementIds=[],p=>p.options[0].lines.push({...p.options[0].lines[0]}),p=>p.options[0].lines[0].fileIds=['other-account'],p=>p.options[0].lines[0].referenceId='rule:old-cost',p=>p.options[0].lines[0].amountLow=-1,p=>p.options[0].tier='mid']){
  let calls=0;await assert.rejects(recoverEstimate({...args,askAI:async()=>{calls++;const p=valid();mutate(p);return p;}}),{code:'AI_ESTIMATE_VALIDATION'});assert.equal(calls,2);
 }
});
