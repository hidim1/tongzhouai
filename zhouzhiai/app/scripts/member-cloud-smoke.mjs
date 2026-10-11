// Runs only against a disposable staging workspace, never against issued customer codes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {MemberRegistry} from '../server/member-registry.mjs';
const root=path.resolve(import.meta.dirname,'..'),pid=process.argv[2];
if(!/^\d+$/.test(pid||''))throw new Error('需要当前服务进程编号');
const inherited=Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
const data=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-member-cloud-qa-'));
const registry=new MemberRegistry(path.join(data,'private/members.json')),accounts=registry.provision(10,'zhouzhi-cloud-qa-password');
const changeOwner=dir=>{fs.chownSync(dir,993,985);for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())changeOwner(f);else fs.chownSync(f,993,985);}};changeOwner(data);
const free=http.createServer();free.listen(0,'127.0.0.1');await once(free,'listening');const port=free.address().port;await new Promise(r=>free.close(r));const base=`http://127.0.0.1:${port}`;
const env={...inherited,TONGZHOU_DATA_DIR:data,TONGZHOU_PUBLIC_ORIGIN:base,PORT:String(port),ZHOUZHI_PROVIDER_FILE:path.join(inherited.TONGZHOU_DATA_DIR,'private/provider.json')};
const child=fork(path.join(root,'server/index.mjs'),[],{env,uid:993,gid:985,stdio:['ignore','pipe','pipe','ipc']});
const log=fs.createWriteStream(path.join(data,'qa.log'),{mode:0o600});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
const devices=[randomBytes(32).toString('hex'),randomBytes(32).toString('hex')],tokens=[];
const request=(url,{token,device=devices[0],method='GET',body,form}={})=>fetch(base+url,{redirect:'manual',method,headers:{'X-Zhouzhi-Installation':device,...(token?{Cookie:'zhouzhi_member='+token}:{}),...(method!=='GET'?{Origin:base,'X-Tongzhou-Client':'workspace','Content-Type':form?'application/x-www-form-urlencoded':'application/json'}:{})},body:body?(form?new URLSearchParams(body).toString():JSON.stringify(body)):undefined});
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('验收服务启动超时')),60000);child.stdout.on('data',chunk=>{if(String(chunk).includes('Zhouzhi:')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(new Error('验收服务启动失败'));});});
 for(let i=0;i<2;i++){const r=await request('/member/activate',{method:'POST',device:devices[i],form:true,body:{username:accounts[i].username,password:accounts[i].password,code:accounts[i].activationCode}});assert.equal(r.status,303);tokens.push(r.headers.get('set-cookie').split(';')[0].split('=')[1]);}
 assert.equal((await request('/member/activate',{method:'POST',form:true,body:{username:accounts[0].username,password:accounts[0].password,code:accounts[0].activationCode}})).status,401);
 assert.equal((await request('/api/engine/provider',{token:tokens[0]})).status,403);
 for(let i=0;i<2;i++){const r=await request('/api/bootstrap',{token:tokens[i],device:devices[i]});assert.equal(r.status,200);const b=await r.json();assert.equal(b.role,'member');assert.equal(b.projects.length,0);assert.deepEqual(Object.keys(b.engine).sort(),['authenticated','connected']);}
 const session=await(await request('/api/preview/sessions',{token:tokens[0],method:'POST',body:{name:'隔离验收'}})).json();
 const otherState=await(await request('/api/preview/state',{token:tokens[1],device:devices[1]})).json();assert.equal(otherState.sessions.length,0);
 assert.equal((await request(`/api/preview/sessions/${session.id}/tasks`,{token:tokens[1],device:devices[1],method:'POST',body:{message:'不应可访问'}})).status,400);
 const job=await(await request(`/api/preview/sessions/${session.id}/tasks`,{token:tokens[0],method:'POST',body:{message:'这是部署验收：不要读取文件、不要使用工具、不要访问网络。简短介绍舟知，不要披露技术配置。再生成一个非空Markdown文件，仅写“工作区验证通过”。'}})).json();
 let finished;for(let i=0;i<180;i++){const s=await(await request('/api/preview/state',{token:tokens[0]})).json();const j=s.jobs.find(j=>j.id===job.id);if(j.status!=='running'){finished=j;break;}await new Promise(r=>setTimeout(r,1000));}
 assert.equal(finished?.status,'completed','真实AI验收未通过');assert.ok(finished.answer);assert.ok(!/gpt-|codex|mikoto|openai|chatgpt|https?:\/\/api\./i.test(JSON.stringify(finished)));
 assert.ok(finished.files.length);assert.equal((await request(finished.files[0].url,{token:tokens[0]})).status,200);assert.equal((await request(finished.files[0].url,{token:tokens[1],device:devices[1]})).status,404);
 const home=await(await request('/',{token:tokens[0]})).text();assert.ok(home.includes('member-'));assert.ok(!home.includes('当前模型'));
 console.log(JSON.stringify({passed:true,oneTimeActivation:true,independentEmptyWorkspaces:true,otherAccountDownloadDenied:true,settingsDenied:true,realAI:true,download:true,qaDirectory:data}));
}finally{child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,5000))]);log.end();}
