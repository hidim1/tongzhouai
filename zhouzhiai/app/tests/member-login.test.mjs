import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {memberPage} from '../server/member-gateway.mjs';
const require=createRequire(import.meta.url),{createCredentialStore,isLoginSender}=require('../member-client/credentials.cjs');
const script=fs.readFileSync(new URL('../public/member/login.js',import.meta.url),'utf8');
test('客户端密码仅加密落盘，取消记住可清除，损坏或不可加密时不回退明文',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-credentials-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const key=randomBytes(32),safeStorage={isEncryptionAvailable:()=>true,encryptString(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]);},decryptString(data){const d=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));d.setAuthTag(data.subarray(12,28));return Buffer.concat([d.update(data.subarray(28)),d.final()]).toString('utf8');}};
 const store=createCredentialStore(dir,safeStorage),credentials={username:'test-user',password:'test-only-private-password'};
 assert.equal(store.read(),null);store.save(credentials);assert.deepEqual(store.read(),credentials);
 const file=path.join(dir,'remembered-login.enc'),bytes=fs.readFileSync(file);assert.ok(!bytes.includes(Buffer.from(credentials.password)));assert.ok(!bytes.includes(Buffer.from(credentials.username)));assert.equal(fs.statSync(file).mode&0o777,0o600);
 store.clear();assert.equal(store.read(),null);store.save(credentials);fs.writeFileSync(file,'corrupt');assert.equal(store.read(),null);
 safeStorage.isEncryptionAvailable=()=>false;assert.throws(()=>store.save(credentials),/安全保存/);assert.equal(fs.existsSync(file),false);
 safeStorage.isEncryptionAvailable=()=>true;assert.throws(()=>store.save({username:'',password:''}),/无效/);
});
test('密码读写桥仅接受受信任登录页主框架，无文件或电脑控制接口',()=>{
 const origin='http://36.140.247.61:18082',frame={url:origin+'/member/login'},webContents={mainFrame:frame},event={sender:webContents,senderFrame:frame};
 assert.ok(isLoginSender(event,webContents,origin));frame.url=origin+'/';assert.equal(isLoginSender(event,webContents,origin),false);
 frame.url='https://example.org/member/login';assert.equal(isLoginSender(event,webContents,origin),false);frame.url=origin+'/member/activate';
 assert.equal(isLoginSender({...event,senderFrame:{url:frame.url}},webContents,origin),false);assert.equal(isLoginSender({...event,sender:{}},webContents,origin),false);
 let exposed;vm.runInNewContext(fs.readFileSync(new URL('../member-client/preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{exposed=value;}},ipcRenderer:{invoke:()=>{}}})});assert.deepEqual(Object.keys(exposed),['read','save','clear']);assert.ok(Object.isFrozen(exposed));
});
const element=props=>({value:'',checked:false,disabled:false,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(name,value){this[name]=value;},...props});
function fixture({saved=null,bridge=true,success=true}={}){
 const username=element(),password=element({type:'password'}),show=element(),remember=element({closest:()=>({})}),error=element({textContent:''}),submit=element(),form=element({action:'http://36.140.247.61:18082/member/login',reportValidity:()=>true,querySelector:()=>submit}),calls={saved:[],clear:0,redirect:[],alerts:[]};
 const nodes={'form':form,'input[name="password"]':password,'input[name="username"]':username,'.error':error};
 const context={document:{querySelector:s=>nodes[s],getElementById:id=>id==='show-password'?show:remember},window:{location:{replace:s=>calls.redirect.push(s)},alert:s=>calls.alerts.push(s),...(bridge?{zhouzhiLogin:{read:async()=>saved,save:async value=>calls.saved.push(value),clear:async()=>{calls.clear++;}}}:{})},URL,URLSearchParams,FormData:class{constructor(){return [['username',username.value],['password',password.value]];}},DOMParser:class{parseFromString(){return{querySelector:()=>({textContent:'账号或密码不正确'})};}},fetch:async()=>({ok:success,redirected:success,url:'http://36.140.247.61:18082/',text:async()=>''})};
 vm.runInNewContext(script,context);return{username,password,show,remember,error,submit,form,calls};
}
test('登录和激活页支持密码显隐，记住默认关闭；成功才保存，失败不保存',async()=>{
 for(const activated of [false,true]){const page=memberPage(activated);assert.match(page,/id="remember-login" type="checkbox">记住账号密码/);assert.match(page,/id="show-password" type="button"/);assert.match(page,/\/member\/login.js/);}
 const f=fixture();await Promise.resolve();assert.equal(f.remember.checked,false);assert.equal(f.password.type,'password');
 f.show.listeners.click();assert.equal(f.password.type,'text');assert.equal(f.show['aria-pressed'],'true');f.show.listeners.click();assert.equal(f.password.type,'password');
 f.username.value='user';f.password.value='password';f.remember.checked=true;await f.form.listeners.submit({preventDefault(){}});assert.equal(f.calls.saved[0].password,'password');assert.deepEqual(f.calls.redirect,['/']);
 const failed=fixture({success:false});await Promise.resolve();failed.remember.checked=true;await failed.form.listeners.submit({preventDefault(){}});assert.equal(failed.calls.saved.length,0);assert.match(failed.error.textContent,/不正确/);
 const restored=fixture({saved:{username:'old-user',password:'saved-password'}});await Promise.resolve();assert.equal(restored.username.value,'old-user');assert.equal(restored.password.type,'password');assert.equal(restored.remember.checked,true);restored.remember.checked=false;restored.remember.listeners.change();assert.equal(restored.calls.clear,1);
 const oldClient=fixture({bridge:false});assert.equal(oldClient.remember.disabled,true);oldClient.show.listeners.click();assert.equal(oldClient.password.type,'text');
 const race=fixture({saved:{username:'old',password:'old'}});race.username.value='new';race.username.listeners.input();await Promise.resolve();assert.equal(race.username.value,'new');assert.equal(race.password.value,'');
 assert.doesNotMatch(script,/localStorage|sessionStorage|document\.cookie/);
});
test('客户端登录/激活页移除底部连接提示，但不改账号、密码或激活功能',()=>{
 for(const activate of [false,true]){
  const page=memberPage(activate,'测试错误');
  assert.doesNotMatch(page,/当前为未加密内测连接|请仅在可信网络使用/);
  assert.match(page,/name="username"/);assert.match(page,/name="password" type="password"/);
  assert.match(page,/id="remember-login"/);assert.match(page,/id="show-password"/);
  assert.match(page,/测试错误/);assert.match(page,/\/member\/(?:login|activate)/);
 }
 assert.match(memberPage(true),/分隔线自动补齐/);
 const gateway=fs.readFileSync(new URL('../server/member-gateway.mjs',import.meta.url),'utf8');
 assert.match(gateway,/HttpOnly; SameSite=Strict/);
 assert.match(gateway,/req\.get\('origin'\)!==origin/);
});
