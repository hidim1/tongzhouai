import fs from 'node:fs';
import { initializeProvider, providerStatus, saveProvider } from '../server/provider.mjs';
await initializeProvider();
if(!providerStatus().hasKey && providerStatus().provider==='mikoto') {
  // Reuse authorized local credentials without printing or changing the source env file.
  const source=process.env.ZHOUZHI_IMAGE_ENV;
  let key='';
  if(source&&fs.existsSync(source))for(const line of fs.readFileSync(source,'utf8').split('\n')){const i=line.indexOf('=');if(line.slice(0,i).trim()==='IMAGE_API_KEY')key=line.slice(i+1).trim().replace(/^["']|["']$/g,'');}
  let accessible=false;
  if(key)try{const r=await fetch('https://api.mikoto.vip/v1/models',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000),redirect:'error'});const d=await r.json();accessible=r.ok&&d.data?.some(m=>m.id==='gpt-6.1-sol');}catch{}
  if(accessible){await saveProvider({provider:'mikoto',model:'gpt-6.1-sol',apiKey:key});console.log('本地预览已复用现有模型连接（凭据仅保存在独立本地私有目录）。');}
  else {await saveProvider({provider:'openai',clearKey:true});console.log('本地预览使用当前 Codex / ChatGPT 登录；可在连接设置切换现有API。');}
}
