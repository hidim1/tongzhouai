import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assistantConversationInstructions} from '../server/preview-conversation.mjs';

test('自然语气明确承接上下文、适度长度、关键追问及非迎合表达',()=>{
 for(const pattern of [/可靠、懂业务、好沟通的同事/,/不扮演真人/,/不.*一味附和/,/直接给答案或判断/,/简单问题通常两到四句话/,/复杂问题可以充分展开/,/承接当前会话/,/不重复背景/,/一到两个关键问题/,/不擅自假定/])assert.match(assistantConversationInstructions,pattern);
});
test('聊天与正式文件分开，准确性、来源、内部信息与显式文件规则不被语气覆盖',()=>{
 for(const pattern of [/只约束聊天答复 answer/,/内部技术信息保护/,/风险、缺项和待确认不能掩盖/,/保留公开来源/,/明确允许文件时才生成附件/,/正式成果保持专业/,/示例不是固定回复模板/])assert.match(assistantConversationInstructions,pattern);
});
test('自然语气仅注入通用会话，不修改膜预算或选型提示',()=>{
 const routes=fs.readFileSync(new URL('../server/preview-routes.mjs',import.meta.url),'utf8');
 const start=routes.indexOf("app.post('/api/preview/sessions/:id/tasks'"),end=routes.indexOf("app.post('/api/preview/projects/:id/files'",start);
 const assistant=fs.readFileSync(new URL('../server/preview-assistant.mjs',import.meta.url),'utf8');
 assert.match(routes.slice(start,end),/assistant.submit/);assert.match(assistant,/assistantConversationInstructions/);
 assert.doesNotMatch(routes.slice(end),/assistantConversationInstructions/);
 const engine=fs.readFileSync(new URL('../server/preview-ai.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(engine,/assistantConversationInstructions/);
 assert.match(assistant,/timeoutMs:0/);
});
