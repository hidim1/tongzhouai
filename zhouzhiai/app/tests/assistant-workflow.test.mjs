import test from 'node:test';import assert from 'node:assert/strict';
import {needsTaskWorkflow,taskPlan,updateTaskPlan,runTaskLoop,validateTaskAudit,allowTaskSearch} from '../server/assistant-workflow.mjs';
import {compareTables} from '../server/assistant-table-compare.mjs';
import {createAssistantTools} from '../server/assistant-tools.mjs';
import {createAssistant} from '../server/preview-assistant.mjs';
import {publicAssistantJob} from '../server/preview-search.mjs';
import {buildReviewedOffice} from '../server/office-render.mjs';
import {publicError,containsInternal} from '../server/member-policy.mjs';
const step=(extra={})=>({id:'read',title:'核对资料',criterion:'读完当前资料',status:'pending',evidence:[],fileIds:['a'],readMode:'complete',...extra});
const verdict=(status='passed')=>({ready:status!=='missing',checks:[{id:'request',status,reason:status==='missing'?'遗漏乙项':'已覆盖本轮要求'}]});
const job=()=>({id:'j',message:'先核对数据，再给出结论',status:'running',fileIds:['a'],files:[],checkpoint:{version:1,stage:'analysis'}});
test('简单聊天不增加任务验收；Office交付、多步骤及比较启用',()=>{assert.equal(needsTaskWorkflow('你好'),false);assert.equal(needsTaskWorkflow('写一句通知',['md']),false);assert.equal(needsTaskWorkflow('生成Word',['docx']),true);assert.equal(needsTaskWorkflow('先核对，再分析差距'),true);});
test('响应长度与断流信息只展示业务提示，内部工具名称不得交付',()=>{assert.equal(containsInternal('zhouzhi_read_draft'),true);assert.equal(publicError('stream disconnected before completion: Incomplete response returned, reason: max_output_tokens'),'服务暂时无法完成任务，请稍后重试或联系管理员。');});
test('用户明确不联网时执行层关闭搜索，不只依赖提示词',()=>{for(const m of ['不联网，分析资料','不要联网搜索','不要搜索','仅使用附件'])assert.equal(allowTaskSearch(m),false);assert.equal(allowTaskSearch('联网了解最新情况'),true);});
test('计划不能更改原目标、跨账号、伪造证据或用目录代替全文',async()=>{
 const j=job(),s={files:[{id:'a',name:'资料.txt',text:'甲'.repeat(25000)}],messages:[]},tools=createAssistantTools({session:s,job:j,save(){}});taskPlan(j);
 assert.throws(()=>updateTaskPlan(j,[step({fileIds:['foreign']})],['a']));assert.throws(()=>updateTaskPlan(j,[step({id:'request'})],['a']));assert.throws(()=>updateTaskPlan(j,[step({status:'completed',evidence:['invented']})],['a']));
 const r=await tools.execute('zhouzhi_read_file',{id:'a',offset:0,limit:20000},'one'),id=JSON.parse(r.contentItems[0].text).evidenceId;
 assert.throws(()=>updateTaskPlan(j,[step({status:'completed',evidence:[id]})],['a']),/完整/);await tools.execute('zhouzhi_read_file',{id:'a',offset:20000,limit:10000},'two');updateTaskPlan(j,[step({status:'completed',evidence:[id]})],['a']);assert.equal(j.checkpoint.workPlan.objective,j.message);assert.equal(j.checkpoint.workPlan.steps[1].status,'completed');assert.equal(publicAssistantJob(j).checkpoint,undefined);
});
test('验收不得漏项、重复、无理由或与完成状态矛盾',()=>{const p=taskPlan(job());assert.equal(validateTaskAudit(verdict(),p).ready,true);for(const v of [{ready:true,checks:[]},{ready:true,checks:[{id:'request',status:'missing',reason:'未完成'}]},{ready:true,checks:[{id:'request',status:'passed',reason:''}]}])assert.throws(()=>validateTaskAudit(v,p));});
test('发现遗漏只返工缺项，验收只读，不重新制作既有文件',async()=>{
 const j=job();taskPlan(j);let calls=0,analyses=0;const tools={definitions:[{name:'zhouzhi_edit_file'},{name:'zhouzhi_read_file'}],execute:async()=>({success:true,contentItems:[]})};
 const result=await runTaskLoop({job:j,tools,save(){},cancelled:()=>false,analyze:async instructions=>{analyses++;if(analyses===2)assert.match(instructions,/遗漏乙项/);return {answer:analyses===1?'只有甲':'甲乙齐全'};},askAI:async(_id,_text,_schema,_images,_progress,_effort,options)=>{calls++;assert.equal(options.allowSteering,false);assert.equal(options.tools.definitions.length,1);assert.equal((await options.tools.execute('zhouzhi_edit_file',{})).success,false);return verdict(calls===1?'missing':'passed');}});
 assert.equal(result.answer,'甲乙齐全');assert.equal(analyses,2);assert.equal(j.checkpoint.repairRounds,1);assert.equal(j.checkpoint.workPlan.steps[0].status,'completed');
});
test('验收连接中断后复用草稿，停止时不继续，持续缺项最多两次返工',async()=>{
 const j=job();taskPlan(j);let analyzed=0,fail=true;const options={job:j,tools:{definitions:[],execute(){}},save(){},cancelled:()=>false,analyze:async()=>{analyzed++;return{answer:'草稿'};},askAI:async()=>{if(fail)throw Error('连接断开');return verdict();}};
 await assert.rejects(runTaskLoop(options),/连接断开/);fail=false;await runTaskLoop(options);assert.equal(analyzed,1);
 const stopped=job();taskPlan(stopped);stopped.checkpoint.analysisDraft={answer:'草稿'};await assert.rejects(runTaskLoop({...options,job:stopped,cancelled:()=>true}),/停止/);
 const bounded=job();taskPlan(bounded);let corrections=0;await assert.rejects(runTaskLoop({...options,job:bounded,askAI:async()=>verdict('missing'),analyze:async()=>{corrections++;return{answer:'仍遗漏'};}}),/未完成要求/);assert.equal(corrections,3);assert.equal(bounded.checkpoint.repairRounds,2);
});
test('未知信息解释清楚可有限交付，不编造以通过验收',async()=>{const j=job();taskPlan(j);const result=await runTaskLoop({job:j,tools:{definitions:[]},save(){},cancelled:()=>false,analyze:async()=>({answer:'缺少采购价，请补充价目表。'}),askAI:async()=>verdict('limited')});assert.match(result.answer,/缺少/);assert.equal(j.checkpoint.workPlan.steps[0].status,'blocked');});
test('定向修复连接中断后延续同一修复轮次，不消耗新返工额度',async()=>{const j=job();taskPlan(j);let calls=0,fail=true;const options={job:j,tools:{definitions:[]},save(){},cancelled:()=>false,analyze:async instructions=>{calls++;if(instructions&&fail)throw Error('连接断开');return{answer:instructions?'甲乙齐全':'缺乙'};},askAI:async()=>verdict(fail?'missing':'passed')};await assert.rejects(runTaskLoop(options),/连接断开/);assert.equal(j.checkpoint.repairRounds,1);assert.ok(j.checkpoint.pendingRepair);fail=false;await runTaskLoop(options);assert.equal(j.checkpoint.repairRounds,1);assert.equal(j.checkpoint.pendingRepair,undefined);assert.equal(calls,3);});
test('全文阅读的主要求有硬性覆盖检查，验收自称通过不能绕过',async()=>{const j=job();j.message='完整读取附件并给出结论';taskPlan(j);await assert.rejects(runTaskLoop({job:j,tools:{definitions:[]},save(){},cancelled:()=>false,analyze:async()=>({answer:'已读完'}),askAI:async()=>verdict()}),/未完成要求/);assert.equal(j.checkpoint.audit.verdict.ready,false);});
test('草稿验收能分页读取中间与末尾记录，而不是只有样本；不能访问其他任务草稿',async()=>{const j=job();j.checkpoint.analysisDraft={files:[{title:'明细',rows:Array.from({length:3000},(_,i)=>['记录'+i,i])}]};const tools=createAssistantTools({session:{files:[],messages:[]},job:j,save(){}});let offset=0,text='';while(offset!==null){const r=await tools.execute('zhouzhi_read_draft',{index:0,offset,limit:20000},'draft-'+offset);assert.equal(r.success,true);const v=JSON.parse(r.contentItems[0].text);text+=v.text;offset=v.nextOffset;}assert.match(text,/记录1500/);assert.match(text,/记录2999/);assert.equal((await tools.execute('zhouzhi_read_draft',{index:1,offset:0,limit:20},'wrong')).success,false);});
test('新文件排版失败只重试一次，其他错误及取消不重试',async()=>{const builds=[],reviews=[];await buildReviewedOffice({build:async mode=>builds.push(mode),review:async n=>{reviews.push(n);if(n===0)throw Object.assign(Error('裁切'),{code:'OFFICE_LAYOUT_FAILED'});return{};}});assert.deepEqual(builds,[false,true]);assert.deepEqual(reviews,[0,1]);let n=0;await assert.rejects(buildReviewedOffice({build:async()=>n++,review:async()=>{throw Error('连接失败');}}),/连接失败/);assert.equal(n,1);await assert.rejects(buildReviewedOffice({build:async()=>n++,review(){},cancelled:()=>true}),/停止/);assert.equal(n,1);});
test('多表对比保留前导零、零和缺值；重复键不得隐式取第一条',()=>{
 const a={name:'旧',rows:[{A1:'编号',B1:'金额'},{A2:'001',B2:0},{A3:'002',B3:100},{A4:'002',B4:200},{A5:'003',B5:null},{A6:'004',B6:50},{A7:'',B7:300}]},b={name:'新',rows:[{A2:'001',B2:10},{A3:'002',B3:300},{A4:'003',B4:0},{A5:'005',B5:50}]},options={leftKeyColumn:'A',rightKeyColumn:'A',leftValueColumn:'B',rightValueColumn:'B',leftStartRow:2,rightStartRow:2,limit:2};
 const first=compareTables(a,b,options),last=compareTables(a,b,{...options,offset:first.nextOffset,limit:200});assert.equal(first.leftRecords,6);assert.equal(first.leftMissingKeys,1);assert.deepEqual(first.counts,{matched:1,leftOnly:1,rightOnly:1,duplicate:1,nonNumeric:1});assert.equal(first.comparableTotals.difference,10);assert.equal(first.items[0].key,'001');assert.equal(first.items[1].difference,null);assert.equal(last.nextOffset,null);
});
test('任务层集成草稿验收，失败恢复不重复消息，日常问答仍单次调用',async()=>{
 const s={id:'s',files:[],messages:[]},db={sessions:[s],jobs:[]};let analysis=0,audits=0,fail=true;
 const assistant=createAssistant({db,save(){},askAI:async(_id,_text,schema)=>{if(schema.properties.ready){audits++;if(fail)throw Error('验收连接断开');return verdict();}analysis++;return{answer:'自然答复'};},steerAI:async()=>false,cancelAI:async()=>{},artifact(){throw Error('不应创建文件');},fileContext:()=>[],imageInputs:()=>[]});
 await assistant.submit('s',{message:'先核对数据，再给出结论'});await new Promise(r=>setImmediate(r));const j=db.jobs[0];assert.equal(j.status,'failed');fail=false;assistant.continue(j.id);await new Promise(r=>setImmediate(r));assert.equal(j.status,'completed');assert.equal(analysis,1);assert.equal(audits,2);assert.equal(s.messages.length,2);assert.equal(j.checkpoint.analysisDraft,undefined);
 await assistant.submit('s',{message:'你好'});await new Promise(r=>setImmediate(r));assert.equal(analysis,2);assert.equal(audits,2);
});
