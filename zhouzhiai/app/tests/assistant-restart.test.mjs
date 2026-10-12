import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-chat-restart-'));
process.env.TONGZHOU_DATA_DIR=dir;fs.mkdirSync(path.join(dir,'preview'));
const initial={sessions:[{id:'restart-session',name:'历史会话',messages:[{role:'user',text:'历史正文'}],files:[]}],jobs:[{id:'active',sessionId:'restart-session',type:'general',status:'running',message:'正在处理的消息',files:[]},{id:'pending',sessionId:'restart-session',type:'general',status:'queued',message:'尚未发送的原文',fileIds:[],files:[]}],versions:[],images:[]};
fs.writeFileSync(path.join(dir,'preview/preview.json'),JSON.stringify(initial));
test('重启保留待发送原文并暂停队列，不将排队消息丢弃或自动触发AI',async()=>{
 try{await import('../server/preview-routes.mjs');const stored=JSON.parse(fs.readFileSync(path.join(dir,'preview/preview.json')));
  assert.equal(stored.jobs[0].status,'failed');assert.equal(stored.jobs[1].status,'queued');assert.equal(stored.jobs[1].message,'尚未发送的原文');assert.equal(stored.sessions[0].queuePaused,true);assert.deepEqual(stored.sessions[0].messages,initial.sessions[0].messages);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
