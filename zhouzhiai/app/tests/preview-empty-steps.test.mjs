import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {load} from 'cheerio';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('没有方案版本也显示预算与成果步骤，操作禁用；有版本恢复正常内容',async()=>{
 const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-empty-steps-vite-'));
 const vite=await createServer({configLoader:'runner',cacheDir,server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
  const {MembraneWorkspace}=await vite.ssrLoadModule('/src/MembraneWorkspace.tsx');
  const base={project:{id:'empty-project',name:'空项目',files:[]},boot:{engine:{connected:false,authenticated:false},jobs:[]},state:{versions:[],jobs:[],images:[]},busy:false,perform:()=>{},onUpload:()=>{},onCreate:()=>{}};
  const html=renderToStaticMarkup(React.createElement(MembraneWorkspace,base));
  assert.match(html,/详细预算核对<\/h2>/);assert.match(html,/输出本方案成果<\/h2>/);
  assert.equal((html.match(/待生成方案清单/g)||[]).length,2);
  const $=load(html);
  for(const label of ['保存预算核对','导出清单与预算 Excel','导出方案资料 Word','AI 编制技术响应与标书','生成效果图']){
   const button=$('button').filter((_,el)=>$(el).text()===label);
   assert.equal(button.length,1,label);assert.ok(button.is('[disabled]'),label);
  }
  assert.ok(!html.includes('预算核对数据读取中'));
  assert.equal($('button').filter((_,el)=>$(el).text()==='上传招标 / 设计资料 / 图纸').length,1);
  assert.equal($('.mw-estimate button').filter((_,el)=>/招标|上传|资料/.test($(el).text())).length,0);
  assert.ok(!html.includes('可能计费'));
  const version={id:'version-test',projectId:'empty-project',name:'模拟版本',mode:'live',status:'draft',rows:[],documents:[],questions:[],summary:'模拟内容',outputs:[]};
  const generated=renderToStaticMarkup(React.createElement(MembraneWorkspace,{...base,state:{...base.state,versions:[version]}}));
  assert.ok(!generated.includes('mw-pending-budget-title'));assert.ok(!generated.includes('待生成方案清单'));
  assert.match(generated,/预算核对数据读取中/);
  assert.match(generated,/<button class="zh-primary">[\s\S]*?导出清单与预算 Excel<\/button>/);
  const generatedPage=load(generated);
  assert.equal(generatedPage('button').filter((_,el)=>generatedPage(el).text()==='生成效果图').length,1);
  assert.ok(!generated.includes('可能计费'));
 }finally{await vite.close();fs.rmSync(cacheDir,{recursive:true,force:true});}
});
