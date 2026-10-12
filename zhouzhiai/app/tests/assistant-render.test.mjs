import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {load} from 'cheerio';
test('自然段落、列表、加粗和表格安全渲染，不执行HTML或加载外部图片',async()=>{
 const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-chat-render-'));
 const vite=await createServer({configLoader:'runner',cacheDir,server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
  const {AssistantText,safeChatUrl}=await vite.ssrLoadModule('/src/AssistantText.tsx');
  const text='先把需求说清楚。\n\n**设计团队**准备图纸。\n\n- 整理资料\n- 核对价格\n\n| 团队 | 资料 |\n| --- | --- |\n| 设计 | 图纸 |\n\n[原文](https://example.com/article)\n\n[坏链接](javascript:alert(1))\n\n![图片](https://example.com/tracker.png)\n\n<script>alert(1)</script><iframe src="https://example.com/track"></iframe>';
  const html=renderToStaticMarkup(React.createElement(AssistantText,{text})),page=load(html);
  assert.equal(page('strong').text(),'设计团队');assert.equal(page('li').length,2);assert.equal(page('table').length,1);assert.ok(page('p').length>=2);
  assert.equal(page('colgroup col').length,2);assert.equal(page('.zh-answer-table').attr('tabindex'),'0');assert.match(page('table').attr('style'),/min-width:/);
  assert.equal(page('a[href="https://example.com/article"]').attr('rel'),'noopener noreferrer');
  assert.equal(page('script,iframe,img').length,0);assert.ok(!html.includes('javascript:'));assert.ok(!html.includes('tracker.png'));
  assert.equal(safeChatUrl('data:text/html,test'),'');assert.equal(safeChatUrl('https://name:secret@example.com/'),'');assert.equal(safeChatUrl('/api/private'),'');
  const view=fs.readFileSync(new URL('../src/Preview.tsx',import.meta.url),'utf8');
  assert.match(view,/思考中…/);assert.match(view,/composerAction/);assert.match(view,/onCompositionStart/);assert.match(view,/sending.current/);
  assert.match(view,/nav==='membrane'&&assemblyRunning/);assert.doesNotMatch(view,/复杂任务会继续处理|已等待/);
  assert.doesNotMatch(view,/disabled=\{busy\|\|generalRunning/);
  assert.doesNotMatch(view,/\+ Shift \+ 回车补充|className="zh-guide"|className="zh-stop"/);
 }finally{await vite.close();fs.rmSync(cacheDir,{recursive:true,force:true});}
});
