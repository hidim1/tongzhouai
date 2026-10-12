import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {load} from 'cheerio';
test('同一操作位置切换发送、补充和停止；请求忙碌时停止仍独立可用',async()=>{
 const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-controls-test-'));
 const vite=await createServer({configLoader:'runner',cacheDir,server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
  const {AssistantControls}=await vite.ssrLoadModule('/src/AssistantControls.tsx');
  const render=props=>load(renderToStaticMarkup(React.createElement(AssistantControls,{busy:false,stopping:false,onSend(){},onStop(){},...props})));
  let p=render({running:false,hasText:true});assert.equal(p('button').length,1);assert.equal(p('button').attr('aria-label'),'发送消息');
  p=render({running:true,hasText:true});assert.equal(p('.zh-send').attr('aria-label'),'补充本轮');assert.equal(p('button').length,2);assert.equal(p('.zh-send-options').attr('aria-haspopup'),'menu');
  p=render({running:true,hasText:false,busy:true});assert.equal(p('.zh-send').attr('aria-label'),'停止回答');assert.equal(p('.zh-send').attr('disabled'),undefined);
  p=render({running:true,hasText:false,stopping:true});assert.equal(p('.zh-send').attr('aria-label'),'正在停止');assert.notEqual(p('.zh-send').attr('disabled'),undefined);
  p=render({running:false,hasText:false});assert.notEqual(p('.zh-send').attr('disabled'),undefined);
 }finally{await vite.close();fs.rmSync(cacheDir,{recursive:true,force:true});}
});
