import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createMemberReader,installAdminMembers} from '../server/admin-members.mjs';
import {createAccessGuard,hashPassword} from '../server/access.mjs';
import {MemberRegistry} from '../server/member-registry.mjs';
import {installMemberGateway} from '../server/member-gateway.mjs';

const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-admin-reader-'));
 const registry=new MemberRegistry(path.join(data,'private','members.json'));
 const issued=registry.provision(10,'test-password-1234');
 const user=registry.data.users[0],root=path.join(data,'members',user.id);fs.mkdirSync(path.join(root,'preview','outputs'),{recursive:true});
 const file=path.join(root,'preview','outputs','result.md');fs.writeFileSync(file,'成员测试成果');
 const output={id:'result',name:'成果.md',path:file},d={id:'d',parameters:{industry:'food',capacity:2,routes:['uf'],requirements:['sanitary']},tier:'mid',targetCost:12345,option:{name:'均衡方案'},estimate:{industry_name:'食品',route_names:['超滤']}};
 const project={id:'p',name:'独立项目',updatedAt:'2026-10-10T00:00:00Z',archivedAt:'2026-10-10T01:00:00Z',files:[],artifacts:[],directions:[d],activeDirectionId:'d'};
 const version={id:'v',name:'新方案',projectId:'p',revision:1,status:'reviewed',direction:d,rows:[{id:'r',name:'测试泵',quantity:2,unit:'台',action:'新增',reviewed:true},{id:'removed',name:'已剔除设备',quantity:1,action:'删除',reviewed:true}],budget:{lines:[{rowId:'r',unitPrice:100,source:'测试采购价',reviewed:true}],extras:['制造与装配','设计与验证','运输与安装','其他费用'].map(category=>({category,amount:0,source:'测试中已含',reviewed:true}))},outputs:[output],technical:{sourceRevision:0,sections:[{title:'技术',body:'已记录'}]}};
 const workspaceFile=path.join(root,'workspace.json'),previewFile=path.join(root,'preview','preview.json');
 fs.writeFileSync(workspaceFile,JSON.stringify({projects:[project],jobs:[],sessions:[]}));
 fs.writeFileSync(previewFile,JSON.stringify({sessions:[{id:'s',name:'对话',files:[],messages:[{role:'user',text:'整理资料'},{role:'assistant',text:'已完成',files:[{id:'result',name:'成果.md',url:'/api/preview/outputs/result'}]}]},{id:'deleted',name:'删除对话',archivedAt:'2026-10-10T00:00:00Z',messages:[],files:[]}],jobs:[{id:'j',sessionId:'s',createdAt:'2026-10-10T00:00:00Z',status:'completed',files:[output]}],versions:[version],images:[]}));
 return {data,registry,issued,user,root,file,workspaceFile,previewFile};
}
test('真实成员只读快照：删除记录、空工作区、精确预算、同版输出、零写入',()=>{
 const f=fixture();try{
  const before=[hash(f.workspaceFile),hash(f.previewFile),hash(f.registry.file)],reader=createMemberReader(f);
  const overview=reader.overview();assert.equal(overview.demo,false);assert.equal(overview.members.length,10);assert.equal(overview.members[0].conversations,1);assert.equal(overview.members[0].projects,0);assert.equal(overview.members[0].archived,2);
  const {detail}=reader.build('zhouzhi01');assert.equal(detail.readonly,true);assert.equal(detail.projects[0].direction.target,12345);assert.equal(detail.projects[0].versions[0].budget.total,200);assert.equal(detail.projects[0].versions[0].technicalStale,true);
  assert.ok(detail.sessions[0].messages[1].files[0].url);assert.ok(detail.projects[0].versions[0].outputs[0].url);
  const serialized=JSON.stringify(detail);for(const word of ['passwordHash','installationHash','activationHash',f.data,'threadId'])assert.ok(!serialized.includes(word));
  assert.equal(reader.build('zhouzhi02').detail.projects.length,0);assert.equal(reader.build('missing'),null);
  assert.equal(fs.existsSync(path.join(f.data,'members',f.registry.data.users[1].id)),false);
  assert.deepEqual([hash(f.workspaceFile),hash(f.previewFile),hash(f.registry.file)],before);
 }finally{fs.rmSync(f.data,{recursive:true,force:true});}
});
test('下载按账号引用限定；越界路径/符号链接拒绝，损坏资料不误报空白',()=>{
 const f=fixture();try{
  const reader=createMemberReader(f),one=reader.build('zhouzhi01');assert.ok(one.files.values().next().value.target);
  const id=one.files.keys().next().value;assert.equal(reader.build('zhouzhi02').files.has(id),false);
  fs.unlinkSync(f.file);fs.symlinkSync(f.registry.file,f.file);assert.equal(reader.build('zhouzhi01').files.get(id).target,null);
  fs.writeFileSync(f.previewFile,'broken');assert.throws(()=>reader.build('zhouzhi01'));assert.equal(reader.overview().members[0].unavailable,true);
  const other=f.registry.data.users[1];fs.symlinkSync(f.root,path.join(f.data,'members',other.id));assert.throws(()=>reader.build(other.username));
 }finally{fs.rmSync(f.data,{recursive:true,force:true});}
});
test('管理员会话授权、普通用户阻断、只读方法、下载和审计；未启用接口不注册',async()=>{
 const f=fixture(),app=express(),server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`,secret='a'.repeat(64),password='admin-test-password';
 const pool={get(){throw new Error('管理员查看不应启动成员');},close(){}};
 try{
  installMemberGateway(app,{root:path.resolve(import.meta.dirname,'..'),data:f.data,registry:f.registry,pool,origin:base});
  app.use(createAccessGuard({origin:base,username:'admin',passwordHash:await hashPassword(password),sessionSecret:secret,allowHttpTest:true,httpTestAllowAnyIP:true}));
  assert.equal(installAdminMembers(app,{...f,enabled:true}),true);
  assert.equal((await fetch(base+'/api/admin/members')).status,401);
  const login=await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'admin',password})});assert.equal(login.status,303);const cookie=login.headers.get('set-cookie').split(';')[0];
  const overview=await(await fetch(base+'/api/admin/members',{headers:{Cookie:cookie}})).json();assert.equal(overview.demo,false);
  const response=await fetch(base+'/api/admin/members/zhouzhi01',{headers:{Cookie:cookie}}),d=await response.json();assert.equal(response.status,200);
  const url=d.sessions[0].messages[1].files[0].url;assert.equal(await(await fetch(base+url,{headers:{Cookie:cookie}})).text(),'成员测试成果');
  assert.equal((await fetch(base+url.replace('zhouzhi01','zhouzhi02'),{headers:{Cookie:cookie}})).status,404);
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await fetch(base+'/api/admin/members/zhouzhi01',{method,headers:{Cookie:cookie,Origin:base}})).status,405);
  const installation='b'.repeat(64),token=f.registry.activate('zhouzhi01','test-password-1234',f.issued[0].activationCode,installation);
  assert.equal((await fetch(base+'/api/admin/members',{headers:{Cookie:'zhouzhi_member='+token,'X-Zhouzhi-Installation':installation}})).status,403);
  assert.equal((await fetch(base+'/api/admin/members',{headers:{Cookie:cookie,Origin:'http://evil.test'}})).status,403);
  const log=fs.readFileSync(path.join(f.data,'private','admin-member-access.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(log.map(x=>x.action),['list','view','download']);assert.ok(log.every(x=>x.actor==='admin'));assert.equal(fs.statSync(path.join(f.data,'private','admin-member-access.jsonl')).mode&0o777,0o600);
  const unguarded=express();installAdminMembers(unguarded,{...f,enabled:true});const second=unguarded.listen(0,'127.0.0.1');await once(second,'listening');try{assert.equal((await fetch(`http://127.0.0.1:${second.address().port}/api/admin/members`)).status,403);}finally{second.closeAllConnections();await new Promise(r=>second.close(r));}
  assert.equal(installAdminMembers(express(),f),false);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(f.data,{recursive:true,force:true});}
});
