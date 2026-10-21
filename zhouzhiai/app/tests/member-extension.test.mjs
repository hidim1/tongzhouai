import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MemberRegistry} from '../server/member-registry.mjs';
const password='fixture-initial-password',updated='fixture-changed-password',device='a'.repeat(64);
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-member-extension-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const r=new MemberRegistry(path.join(dir,'members.json'));r.provision(10,password);return r;}
test('新增带邮箱的第11个普通账号，邮箱与用户名可激活登录并修改密码，旧账号不变',t=>{
 const r=fixture(t),before=structuredClone(r.data),a=r.addMember('zhouzhi11',password,undefined,' Person11@Company.Example ');
 assert.equal(a.email,'person11@company.example');assert.equal(r.data.users.length,11);
 assert.deepEqual(r.data.users.slice(0,10),before.users);assert.deepEqual(r.data.sessions,before.sessions);
 assert.equal(r.data.users[10].activatedAt,null);assert.equal(r.data.users[10].installationHash,null);
 assert.deepEqual(new MemberRegistry(r.file).data,r.data);
 r.activate(a.email,a.activationCode,device);const token=r.login('zhouzhi11',password,device);
 assert.equal(r.authenticate(token,device).username,'zhouzhi11');
 assert.deepEqual(r.changePassword(a.email,password,updated,updated,device),{ok:true});
 assert.equal(r.authenticate(token,device),null);
 assert.equal(r.authenticate(r.login(a.email,updated,device),device).username,'zhouzhi11');
 assert.deepEqual(r.data.users.slice(0,10),before.users);
});
test('新增账号拒绝重复邮箱和错误邮箱，写入失败回退，不改既有账号',t=>{
 const r=fixture(t);r.addMember('zhouzhi11',password,undefined,'person11@company.example');
 const before=structuredClone(r.data),bytes=fs.readFileSync(r.file);
 assert.throws(()=>r.addMember('zhouzhi12',password,undefined,'PERSON11@COMPANY.EXAMPLE'),/已关联/);
 assert.throws(()=>r.addMember('zhouzhi12',password,undefined,'invalid'),/格式/);
 assert.throws(()=>r.addMember('zhouzhi12',password,undefined,''),/格式/);
 assert.deepEqual(r.data,before);assert.deepEqual(fs.readFileSync(r.file),bytes);
 r.save=()=>{throw Error('fixture disk unavailable');};
 assert.throws(()=>r.addMember('zhouzhi12',password,undefined,'person12@company.example'),/unavailable/);
 assert.deepEqual(r.data,before);assert.deepEqual(fs.readFileSync(r.file),bytes);
});
