import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantOutputSchema,assistantResult,normalizeSources,publicAssistantJob,conversationReferences,webSearchInstructions} from '../server/preview-search.mjs';
const schema={type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false};
const guard=value=>value;
const source={title:'测试公开资料',url:'https://example.com/article',date:'2026-10-11'};
test('真实故障形式：answer + sources 接收为正文，来源分开留后台，兼容旧日期字段',()=>{
 const response=assistantResult(JSON.stringify({answer:'整合后的判断。',sources:[source]}),schema,guard);
 assert.deepEqual(response.output,{answer:'整合后的判断。'});
 assert.deepEqual(response.sources,[{title:source.title,url:source.url,publishedAt:source.date,summary:''}]);
 assert.deepEqual(assistantResult('{"answer":"没有联网的日常回答"}',schema,guard).sources,[]);
 const request=assistantOutputSchema(schema);assert.deepEqual(Object.keys(schema.properties),['answer']);assert.deepEqual(request.required,['answer','sources']);
});
test('安全格式纠正允许完整JSON代码围栏和旧空附件，不提取自然语言中的任意JSON',()=>{
 assert.equal(assistantResult('```json\n{"answer":"正文","files":[],"references":[]}\n```',schema,guard).output.answer,'正文');
 for(const input of ['说明：{"answer":"正文"}','{"answer":42}','{"answer":"  "}','{"answer":"正文","files":[{"format":"md"}]}','{"answer":"正文","other":"未知"}','{"answer":"正文","toString":"x"}'])assert.throws(()=>assistantResult(input,schema,guard),e=>e.code==='AI_RESULT_FORMAT');
});
test('来源缺字段、无效协议、内网地址、密码网址和重复记录不进入后台引用',()=>{
 const invalid=['javascript:alert(1)','file:///tmp/a','https://localhost/a','http://127.0.0.1/a','http://[::1]/a','https://user:password@example.com/a','https://x.internal/a','https://example.com/a?api_key=secret'];
 const result=normalizeSources([source,{...source,url:source.url+'#part'},...invalid.map(url=>({...source,url})),{title:'无网址'},{url:'https://example.com/no-title'},null]);
 assert.equal(result.length,1);assert.equal(result[0].publishedAt,'2026-10-11');
 assert.deepEqual(normalizeSources('not-an-array'),[]);
});
test('技术信息防护先检查完整返回，不能通过隐藏来源或删除字段绕过',()=>{
 const block=value=>{if(JSON.stringify(value).includes('private-configuration'))throw Error('包含内部信息');return value;};
 assert.throws(()=>assistantResult(JSON.stringify({answer:'正文',sources:[{...source,title:'private-configuration'}]}),schema,block),/内部信息/);
});
test('公开任务不携带后台来源，引用上下文只来自同一对话已完成任务',()=>{
 const own={id:'a',sessionId:'mine',status:'completed',message:'本轮问题',answer:'正文',searchReferences:[source]};
 const other={...own,id:'b',sessionId:'other'};
 assert.deepEqual(publicAssistantJob(own),{id:'a',sessionId:'mine',status:'completed',message:'本轮问题',answer:'正文'});
 assert.equal(conversationReferences([own,other,{...own,status:'failed'}],'mine').length,1);
 assert.match(webSearchInstructions,/后台 sources/);assert.match(webSearchInstructions,/不附来源列表/);assert.match(webSearchInstructions,/不照搬搜索摘要/);assert.match(webSearchInstructions,/证据不足/);assert.match(webSearchInstructions,/不自动附加来源页/);
});
