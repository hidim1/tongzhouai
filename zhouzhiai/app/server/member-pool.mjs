import fs from 'node:fs';
import path from 'node:path';
import {fork} from 'node:child_process';

export class MemberPool {
 constructor({root,data,env=process.env}){this.root=root;this.data=data;this.env=env;this.workers=new Map();}
 async get(user){
  if(this.workers.has(user.id))return this.workers.get(user.id).ready;
  if(!/^member-[a-f0-9]{32}$/.test(user.id))throw new Error('账号无效');
  const data=path.join(this.data,'members',user.id);fs.mkdirSync(data,{recursive:true,mode:0o700});
  const env={...this.env,PORT:'0',TONGZHOU_DATA_DIR:data,ZHOUZHI_MEMBER_MODE:'1',ZHOUZHI_MEMBER_USERNAME:user.username,TONGZHOU_DEPLOYMENT:'server',ZHOUZHI_PROVIDER_FILE:this.env.ZHOUZHI_PROVIDER_FILE||path.join(this.data,'private/provider.json')};
  // A member worker is not the public gateway and may not inherit admin auth/session material.
  for(const key of ['TONGZHOU_PUBLIC_ORIGIN','TONGZHOU_PASSWORD_HASH','TONGZHOU_AUTH_SECRET','TONGZHOU_WORKSPACE_USERNAME','TONGZHOU_SESSION_TOKEN','ZHOUZHI_MEMBER_REGISTRY','ZHOUZHI_LOCAL_PREVIEW','TONGZHOU_DESKTOP'])delete env[key];
  const child=fork(path.join(this.root,'server/index.mjs'),[],{env,stdio:['ignore','pipe','pipe','ipc']});
  const log=fs.createWriteStream(path.join(data,'server.log'),{flags:'a',mode:0o600});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const record={child,ready:null};record.ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('工作区启动超时，请重试'));},60000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.on('message',msg=>{if(msg.type==='member-ready'){clearTimeout(timer);resolve(msg.port);}});child.once('exit',()=>{clearTimeout(timer);this.workers.delete(user.id);log.end();reject(new Error('工作区暂时不可用'));});});this.workers.set(user.id,record);return record.ready;
 }
 close(){for(const {child} of this.workers.values())child.kill('SIGTERM');this.workers.clear();}
}
