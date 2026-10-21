import test from 'node:test';
import assert from 'node:assert/strict';
import {recentHistory,historyPage} from '../server/assistant-context.mjs';
import {versionCatalog} from '../server/assistant-versions.mjs';
import {measureStage} from '../server/assistant-timing.mjs';
import {publicAssistantJob} from '../server/preview-search.mjs';
import {recoverInterruptedTasks} from '../server/assistant-startup.mjs';
import {archiveItem} from '../server/preview-archive.mjs';

test('超长历史保留可定位首尾摘要，显式标记截取且原文仍可检索',()=>{
 const messages=[{role:'user',text:'受众是采购团队，保留原件'},{role:'assistant',text:'开头'+('内容\\"\n'.repeat(15000))+'尾部要求'}];
 const result=recentHistory(messages,500);
 assert.equal(result.items.length,1);assert.equal(result.items[0].historyIndex,1);
 assert.equal(result.items[0].truncated,true);assert.ok(result.items[0].text.startsWith('开头'));assert.ok(result.items[0].text.endsWith('尾部要求'));
 assert.ok(JSON.stringify(result.items).length<=500);assert.equal(result.olderHistoryAvailable,true);
 assert.equal(historyPage(messages,{query:'采购团队'}).items[0].text,messages[0].text);
 assert.equal(historyPage(messages,{offset:1,limit:1}).items[0].text,messages[1].text);
 assert.deepEqual(recentHistory([{role:'user',text:'短问题'}]).items,[{role:'user',text:'短问题'}]);
 assert.throws(()=>recentHistory(messages,NaN));
});
test('版本索引按父子关系标识替代与分支，不按文件名或时间猜最新',()=>{
 const files=[{id:'a',name:'预算.xlsx'},{id:'b',name:'预算.xlsx',parentId:'a',createdAt:'2026-10-21'},{id:'c',name:'预算分支.xlsx',parentId:'a'}];
 const result=versionCatalog(files);
 assert.deepEqual(result[0].supersededBy,['b','c']);assert.equal(result[0].isLatestCandidate,false);
 assert.equal(result[1].isLatestCandidate,true);assert.equal(result[1].needsSelection,true);
 assert.equal(versionCatalog(files.slice(0,2))[1].needsSelection,false);
 const unrelated=versionCatalog([{id:'a',name:'同名.docx'},{id:'b',name:'同名.docx',createdAt:'2026-10-21'}]);
 assert.ok(unrelated.every(f=>f.needsSelection));
 const orphan=versionCatalog([{id:'b',name:'新版本.docx',parentId:'outside-account'}])[0];
 assert.equal(orphan.parentId,null);assert.equal(orphan.historyIncomplete,true);assert.doesNotMatch(JSON.stringify(orphan),/outside-account/);
 assert.ok(versionCatalog([{id:'a',name:'a',parentId:'b'},{id:'b',name:'b',parentId:'a'}]).every(f=>f.cyclic&&f.needsSelection&&!f.isLatestCandidate));
});
test('等待补充重启保留问题、成果和队列，重复初始化不重复消息',()=>{
 const job={id:'j',type:'general',sessionId:'s',status:'waiting_user',message:'修改报告',files:[{id:'done'}],checkpoint:{clarification:{question:'保留哪个版本？'},toolReceipts:[{evidenceId:'r'}]}};
 const db={sessions:[{id:'s',messages:[],files:[]}],jobs:[job,{id:'q',type:'general',sessionId:'s',status:'queued',message:'后续任务'}],images:[]};
 recoverInterruptedTasks(db);recoverInterruptedTasks(db);
 assert.equal(job.status,'waiting_user');assert.equal(db.sessions[0].pendingClarification.jobId,'j');assert.equal(db.sessions[0].messages.length,1);
 assert.equal(db.sessions[0].queuePaused,true);assert.equal(db.jobs[1].status,'queued');assert.equal(job.files[0].id,'done');assert.equal(job.checkpoint.toolReceipts.length,1);
 assert.throws(()=>archiveItem(db.sessions[0],db.jobs),/先停止/);
});
test('重启中断执行步骤但不重复已落盘成果，也不把故障变成缺用户输入',()=>{
 const job={id:'j',type:'general',sessionId:'s',status:'running',needsInput:true,files:[{id:'done'}],checkpoint:{nextFileIndex:1,timings:[{stage:'analysis',status:'completed'},{stage:'delivery',status:'running'}]}};
 const db={sessions:[{id:'s',messages:[]}],jobs:[job],images:[]};recoverInterruptedTasks(db);
 assert.equal(job.status,'failed');assert.equal(job.needsInput,false);assert.equal(job.canResume,true);
 assert.equal(job.checkpoint.nextFileIndex,1);assert.equal(job.files.length,1);assert.equal(job.checkpoint.timings[1].status,'interrupted');
});
test('步骤诊断保留错误分类和尝试次数，不记录凭据正文或公开内部计划',async()=>{
 const job={taskContract:{secret:'internal'}};
 await assert.rejects(measureStage(job,'analysis',async()=>{throw Object.assign(Error('secret credential'),{code:'AI_EMPTY_RESPONSE'});}));
 await measureStage(job,'analysis',async()=>42);
 assert.equal(job.checkpoint.timings[0].errorCode,'AI_EMPTY_RESPONSE');assert.equal(job.checkpoint.timings[1].attempt,2);
 assert.doesNotMatch(JSON.stringify(job.checkpoint.timings),/secret credential/);
 assert.equal(publicAssistantJob(job).taskContract,undefined);assert.equal(publicAssistantJob(job).checkpoint,undefined);
});
