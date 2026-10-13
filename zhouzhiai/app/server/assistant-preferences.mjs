import fs from 'node:fs';import path from 'node:path';import {containsInternal} from './member-policy.mjs';
const allowed=['voice','length','documentStyle'];
export function preferenceStore(data){const file=path.join(data,'preview','preferences.json');
 return {read(){if(!fs.existsSync(file))return {};const value=JSON.parse(fs.readFileSync(file,'utf8'));return Object.fromEntries(Object.entries(value).filter(([key])=>allowed.includes(key)));},
 update(message,{key,value}){
  if(!allowed.includes(key)||typeof value!=='string'||value.length>300)throw Error('只能保存简短的表达和文件风格偏好');
  if(!/(?:记住|记下|保存.*偏好|忘记|清除.*偏好|删除.*偏好)/.test(message)||/(?:不要|不用|别|不必).*(?:记住|记下|保存)/.test(message))throw Error('本轮没有授权保存或删除偏好');
  if(containsInternal(value)||/(?:密码|密钥|激活码|身份证|银行卡|sk-[\w-]+|https?:\/\/)/i.test(value))throw Error('不能把凭据或敏感资料保存为偏好');
  const preferences=this.read();if(!value){if(!/(?:忘记|清除|删除)/.test(message))throw Error('未授权清除偏好');delete preferences[key];}else preferences[key]=value;
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(preferences),{mode:0o600});fs.renameSync(file+'.tmp',file);return {saved:!!value,key};
 }};
}
