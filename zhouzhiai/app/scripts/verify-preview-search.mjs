// Isolated public-information canary; never run using a production workspace as DATA.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DATA} from '../server/config.mjs';
import {askAI,previewAI,generalSchema} from '../server/preview-ai.mjs';
assert.ok(DATA.includes('zhouzhi-search-canary-'),'验收必须使用独立临时数据目录');
const events=[];
previewAI.on('event',msg=>{if(msg.method==='item/completed'&&msg.params?.item?.type==='webSearch')events.push(msg.params.item);});
try{
 const answer=await askAI('public-search','请现在使用联网搜索，从国家统计局官网（stats.gov.cn）查找最近一条公开新闻或统计发布。只返回一条标题、发布日期、简短摘要和完整的原文URL。必须联网核实，不能凭记忆编造；不生成任何文件。',generalSchema,[],undefined,'medium',{allowWebSearch:true});
 fs.writeFileSync(DATA+'/search-evidence.json',JSON.stringify({events,answer},null,2),{mode:0o600});
 assert.ok(events.length>0,'没有观察到真实联网检索');
 assert.match(answer.answer,/https?:\/\/[^\s]*stats\.gov\.cn/,'回答必须提供公开原文网址');
 assert.equal(answer.files.length,0);
 console.log(JSON.stringify({liveWebSearch:true,searchToolCalls:events.length,officialSourceReturned:true,workspaceIsolated:true}));
}finally{previewAI.close();}
