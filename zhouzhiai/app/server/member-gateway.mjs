import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import {MemberRegistry} from './member-registry.mjs';
import {MemberPool} from './member-pool.mjs';
import {memberRouteAllowed} from './member-policy.mjs';

const html=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const memberPage=(activate=false,message='')=>`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>舟知</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#edf3f8;color:#173e52;font-family:system-ui,sans-serif}.card{width:min(520px,92vw);background:white;border:1px solid #d8e6ec;border-radius:18px;padding:32px}img{width:210px}h1{font-size:27px}p,label{font-size:14px;line-height:1.7}label{display:block;margin-top:16px}input,button{width:100%;font:inherit;padding:12px;border:1px solid #cddde5;border-radius:8px}button{margin-top:24px;background:#008eaf;color:white;border:0;cursor:pointer}a{color:#008eaf}.error{color:#a43d3d}.notice{font-size:12px;color:#6c8492}.activation-input{display:flex;align-items:center;border:1px solid #cddde5;border-radius:8px;margin-top:4px;padding-left:12px;font-family:monospace}.activation-input:focus-within{outline:2px solid #008eaf}.activation-input span{flex:none;color:#008eaf}.activation-input input{min-width:0;border:0;outline:0;font-size:13px;font-family:monospace}</style>
<style>.password-input{position:relative}.password-input input{padding-right:92px}.password-input button{position:absolute;right:5px;top:5px;width:auto;margin:0;padding:7px 8px;background:transparent;color:#008eaf;font-size:12px;border-radius:5px}.remember{display:flex;gap:8px;align-items:center;margin:14px 0 0}.remember input{width:16px;height:16px;margin:0;padding:0;accent-color:#008eaf}button:disabled{opacity:.6;cursor:not-allowed}</style>
<main class="card"><img src="/member/brand.png" alt="同舟纵横"><h1>舟知</h1><p>${activate?'首次使用，请输入激活码完成授权。':'登录你的独立工作区。'}</p><form method="POST" action="/member/${activate?'activate':'login'}"><label for="member-username">账号</label><input id="member-username" name="username" autocomplete="off" maxlength="64" required><label for="member-password">密码</label><div class="password-input"><input id="member-password" name="password" type="password" autocomplete="off" maxlength="128" required><button id="show-password" type="button" aria-controls="member-password" aria-pressed="false">显示密码</button></div><label class="remember"><input id="remember-login" type="checkbox">记住账号密码</label>
${activate?'<label for="activation-code">激活码</label><div class="activation-input"><span aria-hidden="true">ZZ-</span><input id="activation-code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="80" aria-describedby="code-help" placeholder="粘贴激活码或输入字母和数字" required></div><p id="code-help" class="notice">ZZ- 已预填，分隔线自动补齐，无需手动输入；也可以直接粘贴完整激活码。</p>':''}
<button type="submit">${activate?'激活并登录':'登录'}</button></form><p class="error" role="alert">${html(message)}</p><a href="/member/${activate?'login':'activate'}">${activate?'已经激活，前往登录':'首次使用，激活安装版'}</a></main><script src="/member/login.js" defer></script>${activate?'<script src="/member/activation.js" defer></script>':''}</html>`;
export function installMemberGateway(app,{root,data,origin=process.env.TONGZHOU_PUBLIC_ORIGIN,registry,pool}={}){
 if(process.env.ZHOUZHI_MEMBER_MODE==='1')return {close(){}};
 const file=process.env.ZHOUZHI_MEMBER_REGISTRY||path.join(data,'private/members.json');
 registry||=fs.existsSync(file)?new MemberRegistry(file):null;
 pool||=new MemberPool({root,data});
 // The administrator reader shares the gateway registry; it never creates workers.
 pool.registry=registry;
 const cookieName='zhouzhi_member';
 const cookie=req=>String(req.get('cookie')||'').split(/;\s*/).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 const flags=`HttpOnly; SameSite=Strict; Path=/; ${origin?.startsWith('https:')?'Secure; ':''}`;
 const form=express.urlencoded({extended:false,limit:'2kb'});
 app.use(async(req,res,next)=>{
  const installation=req.get('X-Zhouzhi-Installation'),token=cookie(req),memberPath=req.path.startsWith('/member');
  if(!installation&&!token&&!memberPath)return next();
  res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'"});
  if(!origin||req.get('host')!==new URL(origin).host||req.get('origin')&&req.get('origin')!==origin)return res.status(403).send('请求来源无效');
  if(req.path==='/member/brand.png')return res.sendFile(path.join(root,'public/brand/crossflow-logo.png'));
  if(!registry)return res.status(503).type('html').send(memberPage(false,'账号服务尚未启用，请联系管理员'));
  if(!/^[a-f0-9]{64}$/.test(installation||''))return res.status(403).type('html').send(memberPage(false,'请从舟知安装版访问'));
  if(req.path==='/member/activation.js'&&req.method==='GET')return res.sendFile(path.join(root,'public/member/activation.js'));
  if(req.path==='/member/login.js'&&req.method==='GET')return res.sendFile(path.join(root,'public/member/login.js'));
  if(['/member','/member/login','/member/activate','/login'].includes(req.path)&&req.method==='GET'){
   if(registry.authenticate(token,installation))return res.redirect(303,'/');
   return res.type('html').send(memberPage(req.path==='/member/activate'));
  }
  if(['/member/login','/member/activate'].includes(req.path)&&req.method==='POST'){
   if(req.get('origin')!==origin)return res.status(403).send('请求来源无效');
   return form(req,res,error=>{if(error)return res.status(400).type('html').send(memberPage(false,'输入格式不正确'));try{const session=req.path.endsWith('activate')?registry.activate(req.body.username,req.body.password,req.body.code,installation,req.ip):registry.login(req.body.username,req.body.password,installation,req.ip);res.set('Set-Cookie',`${cookieName}=${session}; ${flags}Max-Age=43200`);return res.redirect(303,'/');}catch(e){return res.status(401).type('html').send(memberPage(req.path.endsWith('activate'),e.message));}});
  }
  if(['/logout','/member/logout'].includes(req.path)&&req.method==='POST'){if(req.get('origin')!==origin)return res.status(403).send('请求来源无效');registry.logout(token);res.set('Set-Cookie',`${cookieName}=; ${flags}Max-Age=0`);return res.redirect(303,'/member/login');}
  const user=registry.authenticate(token,installation);
  if(!user)return req.path.startsWith('/api/')?res.status(401).json({error:'请先登录舟知'}):res.redirect(303,'/member/login');
  // Fail closed. Member traffic never falls through into the legacy/admin workspace.
  if(req.path.startsWith('/api/')&&!memberRouteAllowed(req))return res.status(403).json({error:'当前账号无权执行此操作'});
  if(!['GET','HEAD'].includes(req.method)&&req.path.startsWith('/api/')&&(req.get('origin')!==origin||req.get('X-Tongzhou-Client')!=='workspace'))return res.status(403).json({error:'请求来源无效'});
  try{
   const port=await pool.get(user),headers={...req.headers,host:`127.0.0.1:${port}`};delete headers.cookie;delete headers.origin;delete headers['x-zhouzhi-installation'];delete headers['x-tongzhou-session'];delete headers['x-forwarded-for'];delete headers['x-forwarded-host'];delete headers['x-forwarded-proto'];
   const upstream=http.request({host:'127.0.0.1',port,path:req.url,method:req.method,headers},response=>{res.status(response.statusCode);for(const [key,value] of Object.entries(response.headers))if(value!==undefined&&!['set-cookie','connection','transfer-encoding','content-security-policy','cache-control'].includes(key))res.setHeader(key,value);response.pipe(res);});
   upstream.on('error',()=>{if(!res.headersSent)res.status(503).json({error:'工作区暂时不可用，请稍后重试'});else res.end();});req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
  }catch{res.status(503).json({error:'工作区暂时不可用，请稍后重试'});}
 });
 return pool;
}
