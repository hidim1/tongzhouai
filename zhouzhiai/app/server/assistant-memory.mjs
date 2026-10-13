import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {containsInternal} from './member-policy.mjs';
export function memoryIntent(message){
 const direct=String(message).replace(/```[\s\S]*?```|“[^”]*”|「[^」]*」|"[^"\n]*"/g,'').split(/[。！？;\n，,]/).map(s=>s.trim()),prefix='^(?:(?:请|请你|你帮我|帮我|麻烦|麻烦你|我希望你|我需要你|我想让你|给我|然后|再)\\s*)*';
 const save=direct.some(s=>new RegExp(prefix+'(?:记住|记下|保存.{0,30}(?:项目|背景|事实|信息|记忆)|更新.{0,20}记忆)').test(s))&&!/(?:不要|不用|不必|别).{0,20}(?:记住|记下|保存)/.test(message);
 const remove=direct.some(s=>new RegExp(prefix+'(?:忘记|删除.{0,20}(?:记忆|背景)|清除.{0,20}(?:记忆|背景))').test(s));return{save,remove};
}
// Account-specific DATA is isolated by member workers. Nothing is imported automatically.
export function memoryStore(data){const file=path.join(data,'preview','project-memory.json');
 const read=()=>{if(!fs.existsSync(file))return [];const value=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(value))throw Error('项目记忆暂不可读取');return value;};
 const write=items=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(items),{mode:0o600});fs.renameSync(file+'.tmp',file);};
 return{
  search({project='',query='',includeExpired=false,offset=0,limit=20}={}){
   if(typeof project!=='string'||project.length>100||typeof query!=='string'||query.length>200||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40)throw Error('记忆检索范围无效');
   const items=read().filter(m=>(!project||m.project===project)&&(!query||(m.title+' '+m.text).toLocaleLowerCase().includes(query.toLocaleLowerCase()))).map(m=>({...m,expired:!!m.expiresAt&&Date.parse(m.expiresAt)<=Date.now()})).filter(m=>includeExpired||!m.expired).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
   return{total:items.length,items:items.slice(offset,offset+limit),nextOffset:offset+limit<items.length?offset+limit:null,note:'仅为用户授权保存的本账号背景，不是本轮重新核实的事实；过期内容不可当当前结论，不授权访问原资料或其他账号。'};
  },
  update(message,{action,id='',project='',title='',text='',expiresAt='',sourceIds=[]},permittedIds=[]){
   if(!['save','update','delete'].includes(action))throw Error('记忆操作无效');
   const {save:saveAllowed,remove:deleteAllowed}=memoryIntent(message);
   if(action==='delete'?!deleteAllowed:!saveAllowed)throw Error('本轮没有授权保存、修改或删除项目记忆');
   const items=read(),index=items.findIndex(m=>m.id===id);if(action!=='save'&&index<0)throw Error('本账号记忆不存在');
   if(action==='delete'){items.splice(index,1);write(items);return{deleted:true,id};}
   if(!project.trim()||project.length>100||!title.trim()||title.length>160||!text.trim()||text.length>2000||sourceIds.length>12||sourceIds.some(id=>!permittedIds.includes(id)))throw Error('记忆内容、项目或来源范围无效');
   if(containsInternal(text)||containsInternal(title)||containsInternal(project)||/(?:密码|密钥|激活码|身份证|银行卡|sk-[\w-]+|https?:\/\/[^\s]+(?:token|secret|password))/i.test(project+title+text))throw Error('不能保存凭据、敏感身份信息或技术配置');
   if(expiresAt&&(!/^\d{4}-\d{2}-\d{2}T/.test(expiresAt)||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.now()))throw Error('有效期须为未来的明确日期');
   if(action==='save'&&items.length>=100)throw Error('项目记忆已达100条，请先整理或删除过期条目');
   const prior=index>=0?items[index]:null,entry={id:prior?.id||randomUUID(),project,title,text,sourceIds,expiresAt,createdAt:prior?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),version:(prior?.version||0)+1};
   if(action==='save')items.push(entry);else items[index]=entry;write(items);return{saved:true,...entry};
  },
 };
}
