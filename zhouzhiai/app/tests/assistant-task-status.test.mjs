import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {load} from 'cheerio';
test('等待用户和系统失败分开呈现，等待时可取消而非继续转圈',async()=>{
 const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-task-status-'));
 const vite=await createServer({configLoader:'runner',cacheDir,server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
  const {AssistantTaskStatus}=await vite.ssrLoadModule('/src/AssistantTaskStatus.tsx');
  const render=job=>load(renderToStaticMarkup(React.createElement(AssistantTaskStatus,{job,busy:false,onCancel(){},onContinue(){}})));
  const waiting=render({id:'j',status:'waiting_user'});assert.match(waiting('[role=status]').text(),/等待你补充后继续/);assert.equal(waiting('button').text(),'取消此任务');assert.equal(waiting('[role=alert]').length,0);
  const failed=render({id:'j',status:'failed',error:'未收到有效答复',canResume:true});assert.match(failed('[role=alert]').text(),/未收到有效答复/);assert.equal(failed('button').text(),'继续处理');assert.doesNotMatch(failed.text(),/等待你补充/);
  assert.equal(render({id:'j',status:'completed'})('button').length,0);
 }finally{await vite.close();fs.rmSync(cacheDir,{recursive:true,force:true});}
});
