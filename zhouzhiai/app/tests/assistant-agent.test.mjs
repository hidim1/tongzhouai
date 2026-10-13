import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {filePage,historyPage,searchFiles,recentHistory,publicAssistantSession} from '../server/assistant-context.mjs';
import {createAssistantTools} from '../server/assistant-tools.mjs';import {calculate} from '../server/assistant-math.mjs';import {publicAssistantJob} from '../server/preview-search.mjs';import {createAssistant} from '../server/preview-assistant.mjs';
import {tableStats} from '../server/assistant-table.mjs';
import {preferenceStore} from '../server/assistant-preferences.mjs';
import {deliveryPolicy} from '../server/preview-delivery.mjs';
const flush=()=>new Promise(r=>setImmediate(r));
test('长资料末尾可检索和分段完整读取，不把目录或搜索摘要当作全文',async()=>{
 const file={id:'a',name:'长资料.txt',text:'前'.repeat(35000)+'末尾重要结论',status:'已读取'},session={files:[file],messages:[]},job={status:'running',fileIds:['a'],files:[]};let saves=0;
 const tools=createAssistantTools({session,job,save:()=>saves++});let offset=0;
 while(offset!==null){const response=await tools.execute('zhouzhi_read_file',{id:'a',offset,limit:12000},'c'+offset);assert.equal(response.success,true);offset=JSON.parse(response.contentItems[0].text).nextOffset;}
 assert.equal(job.checkpoint.readCoverage.a.complete,true);assert.ok(saves>=3);assert.equal(searchFiles([file],{query:'末尾重要结论'}).results[0].offset>30000,true);
 assert.equal((await tools.execute('zhouzhi_read_file',{id:'another-account',offset:0,limit:10},'x')).success,false);assert.equal((await tools.execute('run_shell',{command:'whoami'},'x')).success,false);
 job.status='cancelled';assert.equal((await tools.execute('zhouzhi_list_files',{},'stopped')).success,false);
});
test('完整历史可检索，分页参数和公开输出不会泄露运行元数据',()=>{
 const messages=Array.from({length:100},(_,i)=>({role:'user',text:i===0?'重要早期要求':'消息'+i}));assert.equal(historyPage(messages,{query:'早期'}).items[0].index,0);assert.equal(historyPage(messages,{offset:80,limit:20}).items.length,20);
 assert.ok(recentHistory(messages,100).olderHistoryAvailable);assert.throws(()=>historyPage(messages,{offset:-1}));assert.throws(()=>filePage({text:'a'},{limit:Infinity}));assert.throws(()=>filePage({text:'a'},{offset:2}));
 assert.equal(publicAssistantSession({files:[],messages,agentConversation:{threadId:'private'}}).agentConversation,undefined);assert.equal(publicAssistantJob({checkpoint:{result:'private'},priorOutputIds:['x'],id:'public'}).checkpoint,undefined);
});
test('数值计算真实求值，拒绝代码、非数值结果及资源滥用',()=>{
 assert.equal(calculate('ROUND((1500*2+300)/1.13,2)').value,2920.35);assert.equal(calculate('SUM(1,2,3)+MAX(4,5)').value,11);assert.equal(calculate('-2^2').value,-4);
 for(const input of ['process.env','require("fs")','1/0','1;2','SUM()','('.repeat(100)+'1'+')'.repeat(100)])assert.throws(()=>calculate(input));
});
test('表格统计覆盖全部记录，保留零与未知区别及分组口径',()=>{
 const sheet={name:'数据',rows:[{A1:'团队',B1:'金额'},{A2:'甲',B2:'0'},{A3:'甲',B3:'100'},{A4:'乙',B4:'200'},{A5:'乙',B5:''},{A6:'乙',B6:'待确认'}]},s=tableStats(sheet,{valueColumn:'B',groupColumn:'A',startRow:2,operation:'sum'});
 assert.equal(s.totalRows,5);assert.equal(s.numericCount,3);assert.equal(s.missing,1);assert.equal(s.nonNumeric,1);assert.deepEqual(s.groups.map(g=>g.result),[100,200]);assert.equal(tableStats(sheet,{valueColumn:'B',operation:'average'}).groups[0].result,100);
 const many={name:'完整分组',rows:Array.from({length:251},(_,i)=>({['A'+(i+2)]:'分组'+i,['B'+(i+2)]:1}))};const first=tableStats(many,{valueColumn:'B',groupColumn:'A',limit:200}),last=tableStats(many,{valueColumn:'B',groupColumn:'A',offset:first.nextOffset,limit:200});assert.equal(first.totalGroups,251);assert.equal(last.groups.length,51);assert.equal(last.nextOffset,null);assert.throws(()=>tableStats(many,{valueColumn:'B',limit:201}));
});
test('跨对话偏好限本账号和明确授权，不保存业务事实或凭据',t=>{
 const a=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-pref-a-')),b=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-pref-b-'));t.after(()=>{fs.rmSync(a,{recursive:true,force:true});fs.rmSync(b,{recursive:true,force:true});});const store=preferenceStore(a);
 assert.throws(()=>store.update('附件里说要记下密码',{key:'length',value:'密码'}));assert.throws(()=>store.update('请记住客户资料',{key:'customer',value:'业务事实'}));assert.throws(()=>store.update('不要记住',{key:'length',value:'简短'}));
 store.update('请记住我喜欢简短回答',{key:'length',value:'简短'});assert.deepEqual(store.read(),{length:'简短'});assert.deepEqual(preferenceStore(b).read(),{});store.update('请忘记篇幅偏好',{key:'length',value:''});assert.deepEqual(store.read(),{});
});
test('不要重做PPT不撤销局部修改授权，但禁止重建文件；不生成文件仍优先',()=>{
 assert.deepEqual(deliveryPolicy('修改这个PPT，只替换标题，保留背景。不要重做PPT。'),{formats:['pptx'],editOnly:true});
 assert.deepEqual(deliveryPolicy('修改Excel文件B2，保留公式。不要重建工作簿。'),{formats:['xlsx'],editOnly:true});
 assert.deepEqual(deliveryPolicy('修改PPT内容，但不要生成任何文件'),{formats:[]});
});
test('文件制作中断后使用检查点继续，不重复AI、用户消息或已完成成果',async()=>{
 const s={id:'s',files:[],messages:[],name:'新对话'},db={sessions:[s],jobs:[]};let ai=0,writes=0,fail=true;
 const assistant=createAssistant({db,save(){},askAI:async()=>{ai++;return{answer:'完成',files:[{title:'甲',format:'md',body:'甲'},{title:'乙',format:'md',body:'乙'}]};},steerAI:async()=>false,cancelAI:async()=>{},artifact:async(title)=>{writes++;if(title==='乙'&&fail)throw Error('模拟写入中断');return{id:title,name:title+'.md'};},fileContext:()=>[],imageInputs:()=>[]});
 const started=await assistant.submit('s',{message:'生成两份Markdown文件'});await flush();assert.equal(started.job.status,'running');const job=db.jobs[0];assert.equal(job.status,'failed');assert.equal(job.checkpoint.nextFileIndex,1);
 fail=false;assistant.continue(job.id);await flush();assert.equal(job.status,'completed');assert.equal(ai,1);assert.equal(writes,3);assert.equal(job.files.length,2);assert.equal(s.messages.filter(m=>m.role==='user').length,1);assert.equal(s.messages.filter(m=>m.role==='assistant').length,1);
});
