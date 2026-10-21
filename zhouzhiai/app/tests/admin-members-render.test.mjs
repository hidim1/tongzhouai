import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import {createServer} from 'vite';
import {renderToStaticMarkup} from 'react-dom/server';
import {load} from 'cheerio';

test('管理员只读对话复用新版排版，历史加粗和列表正常显示，用户原文与成果链接保留',async()=>{
 const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-admin-render-'));
 const vite=await createServer({configLoader:'runner',cacheDir,server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
  const {MemberConversation}=await vite.ssrLoadModule('/src/AdminMembers.tsx');
  const messages=[{role:'user',text:'原文 **保留**\n第二行',files:[]},{role:'assistant',text:'可以帮你处理日常工作。\n\n- **写和改文字**：通知、邮件。\n- **整理资料**：提炼重点。\n\n结论：**准备好了。**可以继续。\n\n| 团队 | 资料 |\n| --- | --- |\n| 设计 | 全量物料库 |\n| 运营 | 采购价目表 |\n\n[原文](https://example.com/article)\n\n![追踪图片](https://example.com/tracker.png)\n\n<script>alert(1)</script>',files:[{id:'file-one',name:'工作通知.docx',url:'/api/admin/members/zhouzhi09/files/file-one'}]}];
  const before=JSON.stringify(messages),html=renderToStaticMarkup(React.createElement(MemberConversation,{messages,username:'zhouzhi09'})),page=load(html);
  assert.equal(page('.am-message.user .am-user-text').text(),messages[0].text);
  assert.equal(page('.am-message.assistant .zh-answer-body strong').length,3);
  assert.equal(page('.am-message.assistant li').length,2);
  assert.equal(page('.am-message.assistant table').length,1);
  assert.equal(page('.zh-answer-table col').length,2);
  assert.doesNotMatch(page('.am-message.assistant .zh-answer-body').text(),/\*\*/);
  assert.equal(page('a[href="https://example.com/article"]').attr('rel'),'noopener noreferrer');
  assert.equal(page('a[download="工作通知.docx"]').attr('href'),'/api/admin/members/zhouzhi09/files/file-one');
  assert.equal(page('script,iframe,img,form,textarea,input').length,0);
  assert.equal(page('button').length,1);assert.equal(page('button').attr('aria-label'),'复制回答');
  assert.equal(JSON.stringify(messages),before);
  const source=fs.readFileSync(new URL('../src/AdminMembers.tsx',import.meta.url),'utf8'),css=fs.readFileSync(new URL('../src/admin-members.css',import.meta.url),'utf8');
  assert.match(source,/<MemberConversation messages=\{item.messages\}/);
  assert.match(source,/<AssistantText text=\{s.body\}/);
  assert.doesNotMatch(source,/<p>\{m.text\}<\/p>/);
  assert.doesNotMatch(css,/\.am-message p\s*\{/);
  assert.match(css,/\.am-message\.user\{[^}]*margin-left:auto/);
  assert.match(css,/\.am-workspace\{[^}]*max-width:none/);
 }finally{await vite.close();fs.rmSync(cacheDir,{recursive:true,force:true});}
});
