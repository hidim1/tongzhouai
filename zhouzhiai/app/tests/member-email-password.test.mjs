import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import express from 'express';
import {MemberRegistry} from '../server/member-registry.mjs';
import {memberPage,installMemberGateway} from '../server/member-gateway.mjs';
import {createMemberReader} from '../server/admin-members.mjs';
const oldPassword='fixture-original-password',newPassword='fixture-updated-password',device='a'.repeat(64),otherDevice='b'.repeat(64);
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-alias-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const registry=new MemberRegistry(path.join(dir,'private/members.json')),issued=registry.provision(10,oldPassword);
 const extra=registry.addMember('zhouzhics',oldPassword);
 const mappings=issued.map((a,i)=>({username:a.username,email:`person${i+1}@company.example`}));
 return{dir,registry,issued,extra,mappings};
}
test('邮箱迁移只增加十个别名：ID、密码、激活、会话和测试账号完整保留；管理员只读展示',t=>{
 const f=fixture(t);f.registry.activate(f.issued[0].username,f.issued[0].activationCode,device);const token=f.registry.login(f.issued[0].username,oldPassword,device);
 const before=structuredClone(f.registry.data);assert.deepEqual(f.registry.applyEmailAliases(f.mappings),{updated:10});
 const stripped=structuredClone(f.registry.data);for(const u of stripped.users)delete u.email;assert.deepEqual(stripped,before);
 assert.equal(f.registry.authenticate(token,device).username,'zhouzhi01');
 assert.deepEqual(new MemberRegistry(f.registry.file).data,f.registry.data);
 const reader=createMemberReader({data:f.dir,registry:f.registry});assert.equal(reader.overview().members[0].email,f.mappings[0].email);assert.equal(reader.build('zhouzhi01').detail.email,f.mappings[0].email);assert.equal(reader.overview().members.at(-1).email,undefined);
});
test('激活无需密码且不发登录会话；邮箱和原用户名共用单次激活码和客户端绑定',t=>{
 const f=fixture(t);f.registry.applyEmailAliases(f.mappings);const hashes=f.registry.data.users.map(u=>u.passwordHash);
 assert.throws(()=>f.registry.activate(f.mappings[0].email,f.issued[1].activationCode,device),/不正确/);
 assert.deepEqual(f.registry.activate(' PERSON1@COMPANY.EXAMPLE ',f.issued[0].activationCode,device),{ok:true});
 assert.equal(f.registry.data.sessions.length,0);assert.deepEqual(f.registry.data.users.map(u=>u.passwordHash),hashes);
 assert.throws(()=>f.registry.activate('zhouzhi01',f.issued[0].activationCode,device),/已激活/);
 assert.throws(()=>f.registry.login(f.mappings[0].email,'incorrect',device),/不正确/);
 const a=f.registry.login(f.mappings[0].email,oldPassword,device),b=f.registry.login('ZHOUZHI01',oldPassword,device);
 assert.deepEqual(f.registry.authenticate(a,device),f.registry.authenticate(b,device));assert.equal(f.registry.authenticate(a,device).username,'zhouzhi01');
 assert.throws(()=>f.registry.login(f.mappings[0].email,oldPassword,otherDevice),/不匹配/);
 f.registry.activate('zhouzhi02',f.issued[1].activationCode,otherDevice);assert.equal(f.registry.authenticate(f.registry.login(f.mappings[1].email,oldPassword,otherDevice),otherDevice).username,'zhouzhi02');
});
test('不正确的邮箱迁移整体回退；禁用账号、未知标识、别名轮换与原账号共用限流',t=>{
 const f=fixture(t),before=fs.readFileSync(f.registry.file,'utf8');
 for(const changes of [f.mappings.slice(1),f.mappings.map((m,i)=>i===1?{...m,email:f.mappings[0].email}:m),f.mappings.map((m,i)=>i===0?{...m,username:'zhouzhics'}:m),f.mappings.map((m,i)=>i===0?{...m,email:'bad'}:m)]){assert.throws(()=>f.registry.applyEmailAliases(changes));assert.equal(fs.readFileSync(f.registry.file,'utf8'),before);}
 f.registry.applyEmailAliases(f.mappings);const migrated=structuredClone(f.registry.data),save=f.registry.save;f.registry.save=()=>{throw Error('fixture disk unavailable');};assert.throws(()=>f.registry.applyEmailAliases(f.mappings.map(m=>({...m,email:'new-'+m.email}))));assert.deepEqual(f.registry.data,migrated);f.registry.save=save;
 for(let i=0;i<6;i++)assert.throws(()=>f.registry.login(i%2?f.mappings[0].email:'zhouzhi01','bad',device),/不正确/);
 assert.throws(()=>f.registry.activate(f.mappings[0].email,f.issued[0].activationCode,device),/次数过多/);
 f.registry.data.users[1].disabled=true;assert.throws(()=>f.registry.activate(f.mappings[1].email,f.issued[1].activationCode,device),/不正确/);
 assert.throws(()=>f.registry.activate('unknown@company.example',f.issued[1].activationCode,device),/不正确/);
});
test('修改密码保留激活与工作区，只撤销本账号会话，拒绝原密码错误/异客户端/未激活/测试账号',t=>{
 const f=fixture(t);f.registry.applyEmailAliases(f.mappings);
 f.registry.activate('zhouzhi01',f.issued[0].activationCode,device);f.registry.activate('zhouzhi02',f.issued[1].activationCode,otherDevice);f.registry.activate(f.extra.username,f.extra.activationCode,otherDevice);
 const a=f.registry.login('zhouzhi01',oldPassword,device),a2=f.registry.login(f.mappings[0].email,oldPassword,device),b=f.registry.login('zhouzhi02',oldPassword,otherDevice),before=structuredClone(f.registry.data.users[0]);
 assert.throws(()=>f.registry.changePassword('zhouzhi01','wrong',newPassword,newPassword,device),/不正确/);
 assert.throws(()=>f.registry.changePassword(f.mappings[0].email,oldPassword,newPassword,newPassword,otherDevice),/不匹配/);
 assert.throws(()=>f.registry.changePassword('zhouzhi03',oldPassword,newPassword,newPassword,device),/未激活/);
 assert.throws(()=>f.registry.changePassword('zhouzhics',oldPassword,newPassword,newPassword,otherDevice),/管理员/);
 assert.throws(()=>f.registry.changePassword('zhouzhi01',oldPassword,newPassword,'different',device),/不一致/);
 assert.deepEqual(f.registry.changePassword(f.mappings[0].email,oldPassword,newPassword,newPassword,device),{ok:true});
 assert.equal(f.registry.authenticate(a,device),null);assert.equal(f.registry.authenticate(a2,device),null);assert.ok(f.registry.authenticate(b,otherDevice));
 const after={...f.registry.data.users[0],passwordHash:before.passwordHash};delete after.passwordChangedAt;assert.deepEqual(after,before);
 assert.throws(()=>f.registry.login('zhouzhi01',oldPassword,device),/不正确/);
 assert.equal(f.registry.authenticate(f.registry.login(f.mappings[0].email,newPassword,device),device).id,before.id);
});
test('激活和密码变更落盘失败不留下已消耗激活码或内存密码变化',t=>{
 const f=fixture(t);f.registry.applyEmailAliases(f.mappings);let before=structuredClone(f.registry.data),save=f.registry.save;f.registry.save=()=>{throw Error('fixture disk unavailable');};
 assert.throws(()=>f.registry.activate('zhouzhi01',f.issued[0].activationCode,device));assert.deepEqual(f.registry.data,before);f.registry.save=save;
 f.registry.activate('zhouzhi01',f.issued[0].activationCode,device);f.registry.login('zhouzhi01',oldPassword,device);before=structuredClone(f.registry.data);f.registry.save=()=>{throw Error('fixture disk unavailable');};
 assert.throws(()=>f.registry.changePassword('zhouzhi01',oldPassword,newPassword,newPassword,device));assert.deepEqual(f.registry.data,before);f.registry.save=save;
});
test('激活页面无密码、修改密码页面在登录页；网关无需激活密码且不能免密码登录',async t=>{
 const f=fixture(t);f.registry.applyEmailAliases(f.mappings);
 const app=express(),server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const origin=`http://127.0.0.1:${server.address().port}`;
 installMemberGateway(app,{root:path.resolve(import.meta.dirname,'..'),data:f.dir,origin,registry:f.registry,pool:{get(){throw Error('fixture must not start a worker');},close(){}}});
 const send=(url,body,extra={})=>fetch(origin+url,{redirect:'manual',method:body?'POST':'GET',headers:{'X-Zhouzhi-Installation':device,...(body?{Origin:origin,'Content-Type':'application/x-www-form-urlencoded','X-Tongzhou-Client':'workspace'}:{}),...extra},body:body?new URLSearchParams(body):undefined});
 assert.doesNotMatch(memberPage(true),/name="password"|remember-login|password-dialog|激活并登录/);assert.match(memberPage(false),/修改密码/);
 let r=await send('/member/activate',{username:f.mappings[0].email,code:f.issued[0].activationCode});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/member/login?activated=1');assert.equal(r.headers.get('set-cookie'),null);assert.equal(f.registry.data.sessions.length,0);
 assert.equal((await send('/api/bootstrap')).status,401);assert.equal((await send('/member/login',{username:f.mappings[0].email})).status,401);
 r=await send('/member/login',{username:f.mappings[0].email,password:oldPassword});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/');const token=r.headers.get('set-cookie').match(/zhouzhi_member=([^;]+)/)[1];assert.ok(f.registry.authenticate(token,device));
 const body={username:f.mappings[0].email,password:oldPassword,newPassword,confirmPassword:newPassword};
 assert.equal((await send('/member/password',body,{Origin:'http://invalid.example'})).status,403);
 assert.equal((await send('/member/password',body,{'X-Tongzhou-Client':''})).status,403);
 r=await send('/member/password',body);assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});assert.match(r.headers.get('set-cookie'),/Max-Age=0/);assert.equal(f.registry.authenticate(token,device),null);
 r=await send('/member/password.js');assert.equal(r.status,200);assert.match(await r.text(),/zhouzhiLogin\?\.clear/);
 assert.equal((await send('/member/login',{username:'zhouzhi01',password:newPassword})).status,303);
});
