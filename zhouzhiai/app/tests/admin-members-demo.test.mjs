import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {once} from 'node:events';
import {installAdminMembersDemo} from '../server/admin-members-demo.mjs';
test('本地成员页面：演示标记、只读限制、空账号不创建数据及账号范围内下载',async()=>{
 const app=express();installAdminMembersDemo(app,{enabled:true});const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const overview=await(await fetch(base+'/api/admin/members')).json();assert.equal(overview.demo,true);assert.equal(overview.members.length,11);assert.equal(overview.members.find(m=>m.username==='zhouzhi01').conversations,2);
  const detail=await(await fetch(base+'/api/admin/members/zhouzhi01')).json();assert.equal(detail.readonly,true);assert.equal(detail.demo,true);assert.ok(detail.sessions.some(s=>s.archivedAt));assert.equal(detail.projects[0].versions.length,2);
  assert.ok(detail.sessions[0].messages[1].files[0].url.startsWith('/api/admin/members/zhouzhi01/files/'));
  const empty=await(await fetch(base+'/api/admin/members/zhouzhi02')).json();assert.equal(empty.sessions.length,0);assert.equal(empty.projects.length,0);
  const snapshot=JSON.stringify(detail);
  for(const method of ['POST','PUT','DELETE','PATCH'])assert.equal((await fetch(base+'/api/admin/members/zhouzhi01',{method})).status,405);
  assert.equal(JSON.stringify(await(await fetch(base+'/api/admin/members/zhouzhi01')).json()),snapshot);
  const download=await fetch(base+'/api/admin/members/zhouzhi01/files/notice');assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);assert.match(await download.text(),/演示/);
  assert.equal((await fetch(base+'/api/admin/members/zhouzhi02/files/notice')).status,404);
  assert.equal((await fetch(base+'/api/admin/members/zhouzhics/files/notice')).status,404);
  assert.equal((await fetch(base+'/api/admin/members/missing')).status,404);
  assert.ok(!JSON.stringify(overview).includes('password'));assert.ok(!snapshot.includes('activationHash'));assert.ok(!snapshot.includes('/var/lib'));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('演示接口默认关闭，普通客户端不导入管理员页面，云端标志不开放本地演示',async()=>{
 const app=express();installAdminMembersDemo(app);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 try{assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/admin/members`)).status,404);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 const source=fs.readFileSync(path.resolve(import.meta.dirname,'../server/index.mjs'),'utf8');assert.match(source,/ZHOUZHI_ADMIN_MEMBERS_PREVIEW==='1'&&!SERVER&&!isMember\(\)/);
 assert.ok(!fs.readFileSync(path.resolve(import.meta.dirname,'../src/member-main.tsx'),'utf8').includes('AdminMembers'));
});
