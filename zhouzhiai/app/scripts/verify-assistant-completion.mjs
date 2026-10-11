// Public, isolated acceptance run. Never point this at a production workspace.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DATA} from '../server/config.mjs';
import {askAI,previewAI,generalSchema} from '../server/preview-ai.mjs';
assert.ok(DATA.includes('zhouzhi-assistant-canary-'),'验收必须使用独立临时数据目录');
const events=[];
previewAI.on('event',msg=>{
 if(msg.method==='item/completed')events.push({at:new Date().toISOString(),type:msg.params?.item?.type,phase:msg.params?.item?.phase});
 if(msg.method==='turn/completed')events.push({at:new Date().toISOString(),type:'turn',status:msg.params?.turn?.status});
});
const started=Date.now();
const offline=process.argv.includes('--offline');
const brief=process.argv.includes('--brief');
// Test-harness guard only, not the application task's lifetime.
const guard=setTimeout(()=>previewAI.close(),15*60*1000);
try{
 const prompt=offline?'这是一个任务结束验收。不要联网，不要访问文件，不生成文件。answer仅填写“舟知已完成测试”，files为空数组。请以正式答复提交完整JSON并结束本轮。':'请联网查找同舟纵横（厦门）流体技术有限公司的官网公开资料，给出整体介绍，覆盖主营业务、技术产品和应用行业，总字数不超过600字，附官网原文完整URL。只依据成功检索的资料；查不到就如实说明。不生成文件，不访问本机文件。最终只在正式答复阶段提交完整结构结果并结束。';
 const task=brief?'请实时联网搜索“同舟纵横 官网 膜设备”，只给出该公司的主营业务一句话和核实到的官网完整URL，不超过120字，不生成文件。只做本轮验收需要的一次检索，不进一步打开页面。如不能核实请如实说明。最终在正式答复阶段提交完整JSON并结束。':prompt;
 const answer=await askAI(offline?'offline-delivery':'public-company-intro',task,generalSchema,[],undefined,'medium',{allowWebSearch:true,timeoutMs:0,completeOnFinal:true,onPhase:phase=>console.log(JSON.stringify({phase,elapsedSeconds:Math.round((Date.now()-started)/1000)}))});
 assert.ok(answer.answer.trim());assert.equal(answer.files.length,0);
 if(offline)assert.equal(answer.answer,'舟知已完成测试');
 else{assert.ok(events.some(e=>e.type==='webSearch'),'必须实际检索');assert.match(answer.answer,/https?:\/\//,'需提供公开来源或如实说明');}
 const evidence={at:new Date().toISOString(),elapsedSeconds:Math.round((Date.now()-started)/1000),events,answer};
 fs.writeFileSync(DATA+(offline?'/offline-acceptance.json':'/acceptance.json'),JSON.stringify(evidence,null,2),{mode:0o600});
 console.log(JSON.stringify({ok:true,elapsedSeconds:evidence.elapsedSeconds,publicSearch:!offline,answerDelivered:true,files:answer.files.length,finalPhaseSeen:events.some(e=>e.phase==='final_answer')}));
}finally{clearTimeout(guard);previewAI.close();}
