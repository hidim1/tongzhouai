// Run under the service environment. Prints counts/status only, never credentials or member content.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {once} from 'node:events';
import express from 'express';
import http from 'node:http';
import {MemberRegistry} from '../server/member-registry.mjs';
import {installMemberGateway} from '../server/member-gateway.mjs';
import {createAccessGuard} from '../server/access.mjs';
import {installAdminMembers} from '../server/admin-members.mjs';

const data=process.env.TONGZHOU_DATA_DIR,origin=process.env.TONGZHOU_PUBLIC_ORIGIN;
assert.ok(data&&origin);
const registry=new MemberRegistry(process.env.ZHOUZHI_MEMBER_REGISTRY||path.join(data,'private/members.json'));
function businessSnapshot(){
 const result={};
 for(const scope of ['',...registry.data.users.map(u=>'members/'+u.id)])for(const name of ['workspace.json','preview/preview.json']){
  const f=path.join(data,scope,name);if(fs.existsSync(f))result[scope+'/'+name]=createHash('sha256').update(JSON.stringify(JSON.parse(fs.readFileSync(f,'utf8')))).digest('hex');
 }
 result.registry=createHash('sha256').update(fs.readFileSync(registry.file)).digest('hex');return result;
}
const before=businessSnapshot();
const live=process.argv.includes('--live');
let server;
if(!live){
 const app=express(),pool={close(){},get(){throw new Error('只读管理不得启动成员工作器');}};
 installMemberGateway(app,{root:path.resolve(import.meta.dirname,'..'),data,registry,pool,origin});
 app.use(createAccessGuard());installAdminMembers(app,{data,registry,enabled:true});
 server=app.listen(0,'127.0.0.1');await once(server,'listening');
}
const base='http://127.0.0.1:'+(live?(process.env.PORT||4318):server.address().port),expiry=String(Math.floor(Date.now()/1000)+3600);
const username=process.env.TONGZHOU_WORKSPACE_USERNAME||'';
const signature=createHmac('sha256',process.env.TONGZHOU_AUTH_SECRET).update(`${origin}\n${username}\n${expiry}`).digest('hex');
const cookieName=origin.startsWith('http:')?'tongzhou_internal_'+new URL(origin).port:'__Host-tongzhou';
const adminHeaders={Host:new URL(origin).host,Cookie:`${cookieName}=${expiry}.${signature}`};
const request=(url,options={})=>new Promise((resolve,reject)=>{
 const req=http.request(base+url,{method:options.method||'GET',headers:{...adminHeaders,...options.headers}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});req.on('error',reject);req.end();
});
try{
 if(live){const bootstrap=await(await request('/api/bootstrap')).json();assert.equal(bootstrap.role,'admin');assert.equal(bootstrap.adminMembersEnabled,true);assert.equal(bootstrap.version,'V1.0');const html=await(await request('/')).text();assert.equal(html,fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'));for(const asset of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)){const downloaded=Buffer.from(await(await request(asset[1])).arrayBuffer());assert.deepEqual(downloaded,fs.readFileSync(new URL('../dist'+asset[1],import.meta.url)));}}
 assert.equal((await request('/api/admin/members',{headers:{Cookie:''}})).status,401);
 const response=await request('/api/admin/members');assert.equal(response.status,200);const overview=await response.json();assert.equal(overview.demo,false);assert.equal(overview.members.length,registry.data.users.length);
 let sessions=0,projects=0,downloads=0,archived=0;
 for(const member of overview.members){
  assert.equal(member.unavailable,undefined);
  const r=await request('/api/admin/members/'+member.username);assert.equal(r.status,200);const d=await r.json();assert.equal(d.demo,false);assert.equal(d.readonly,true);assert.equal(d.username,member.username);
  sessions+=d.sessions.length;projects+=d.projects.length;archived+=d.sessions.filter(s=>s.archivedAt).length+d.projects.filter(p=>p.archivedAt).length;
  const files=[...d.sessions.flatMap(s=>[...s.files,...s.messages.flatMap(m=>m.files||[])]),...d.projects.flatMap(p=>[...p.files,...p.versions.flatMap(v=>v.outputs)])];
  for(const f of files.filter(f=>f.url)){const file=await request(f.url);assert.equal(file.status,200);assert.match(file.headers.get('content-disposition'),/attachment/);await file.arrayBuffer();downloads++;const other=overview.members.find(m=>m.username!==member.username);assert.equal((await request(f.url.replace('/'+member.username+'/', '/'+other.username+'/'))).status,404);}
 }
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await request('/api/admin/members/'+overview.members[0].username,{method,headers:{Origin:origin,'X-Tongzhou-Client':'workspace'}})).status,405);
 assert.equal((await request('/api/admin/members',{headers:{Origin:'http://invalid.example'}})).status,403);
 assert.equal((await request('/api/admin/members',{headers:{Cookie:'zhouzhi_member='+randomBytes(32).toString('hex'),'X-Zhouzhi-Installation':randomBytes(32).toString('hex')}})).status,401);
 assert.deepEqual(businessSnapshot(),before);
 console.log(JSON.stringify({ok:true,live,members:overview.members.length,sessions,projects,archived,downloads,businessDataUnchanged:true}));
}finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}
