import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import {MemberRegistry} from './member-registry.mjs';
import {MemberPool} from './member-pool.mjs';
import {memberRouteAllowed} from './member-policy.mjs';
import {scrollbarTheme} from './scrollbar-theme.mjs';

const html=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const accountError=e=>typeof e?.message==='string'&&/^[\u3400-\u9fff\u3000-\u303f\uff00-\uffef0-9 ]+$/.test(e.message)?e.message:'操作未完成，请稍后重试或联系管理员';
const passwordIcon='<svg class="eye-open" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="eye-closed" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m3 3 18 18M10.6 5.1A12 12 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-3.1 4.1M6.1 6.1A18 18 0 0 0 2 12s3.6 7 10 7a12 12 0 0 0 5.1-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const passwordDialog=`<dialog id="password-dialog" aria-labelledby="password-title"><button type="button" class="dialog-close" id="close-password" aria-label="关闭修改密码">×</button><h2 id="password-title">修改密码</h2><form id="password-form" method="POST" action="/member/password"><label for="change-username">企业邮箱或用户名</label><input id="change-username" name="username" maxlength="64" autocomplete="username" required><label for="change-old">原密码</label><div class="password-input"><input id="change-old" name="password" type="password" autocomplete="current-password" maxlength="128" required><button type="button" data-password-target="change-old" aria-pressed="false" aria-label="显示密码">${passwordIcon}</button></div><label for="change-new">新密码</label><div class="password-input"><input id="change-new" name="newPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><button type="button" data-password-target="change-new" aria-pressed="false" aria-label="显示密码">${passwordIcon}</button></div><p class="notice">新密码须为12至128位，与原密码不同。</p><label for="change-confirm">确认新密码</label><div class="password-input"><input id="change-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><button type="button" data-password-target="change-confirm" aria-pressed="false" aria-label="显示密码">${passwordIcon}</button></div><p class="error" id="password-error" role="alert"></p><button type="submit">确认修改</button><button type="button" class="return-login" id="return-login">返回登录</button></form></dialog>`;
export const memberPage=(activate=false,message='',success='')=>`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>舟知</title>
<style data-zhouzhi-scrollbars>${scrollbarTheme}</style>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#edf3f8;color:#173e52;font-family:system-ui,sans-serif}.card{width:min(520px,92vw);background:white;border:1px solid #d8e6ec;border-radius:18px;padding:32px}img{width:210px}h1{font-size:27px}p,label{font-size:14px;line-height:1.7}label{display:block;margin-top:16px}input,button{width:100%;font:inherit;padding:12px;border:1px solid #cddde5;border-radius:8px}button{margin-top:24px;background:#008eaf;color:white;border:0;cursor:pointer}a{color:#008eaf}.error{color:#a43d3d}.notice{font-size:12px;color:#6c8492}.activation-input{display:flex;align-items:center;border:1px solid #cddde5;border-radius:8px;margin-top:4px;padding-left:12px;font-family:monospace}.activation-input:focus-within{outline:2px solid #008eaf}.activation-input span{flex:none;color:#008eaf}.activation-input input{min-width:0;border:0;outline:0;font-size:13px;font-family:monospace}</style>
<style>.password-input{position:relative}.password-input input{padding-right:52px}.password-input button{position:absolute;right:2px;top:2px;width:40px;height:40px;display:grid;place-items:center;margin:0;padding:0;background:transparent;color:#008eaf;font-size:12px;border-radius:5px}.remember{display:flex;gap:8px;align-items:center;margin:14px 0 0}.remember input{width:16px;height:16px;margin:0;padding:0;accent-color:#008eaf}button:disabled{opacity:.6;cursor:not-allowed}.password-input button:focus-visible{outline:2px solid #008eaf;outline-offset:-2px}.password-input .eye-closed,.password-input button[aria-pressed="true"] .eye-open{display:none}.password-input button[aria-pressed="true"] .eye-closed{display:block}</style>
<style>.login-options{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}.login-options .remember{margin:0}.password-link{width:auto;margin:0;padding:0;background:transparent;color:#008eaf;font-size:14px}dialog{width:min(480px,92vw);max-height:calc(100dvh - 40px);overflow:auto;background:#fff;color:#173e52;border:1px solid #d8e6ec;border-radius:18px;padding:28px}dialog::backdrop{background:#173e5238}.dialog-close{position:absolute;right:14px;top:10px;width:auto;margin:0;background:transparent;color:#6c8492;font-size:24px;padding:4px 8px}.return-login{background:transparent;color:#008eaf;margin-top:10px}.success{color:#24806b;font-size:14px}h2{margin:0 0 20px;font-size:24px}</style>
<main class="card"><img src="/member/brand.png" alt="同舟纵横"><h1>舟知</h1><p>${activate?'首次使用，请输入账号与对应激活码完成授权。':'登录你的独立工作区。'}</p><form method="POST" action="/member/${activate?'activate':'login'}"><label for="member-username">企业邮箱或用户名</label><input id="member-username" name="username" autocomplete="off" maxlength="64" placeholder="输入企业邮箱或原用户名" required>${activate?'':`<label for="member-password">密码</label><div class="password-input"><input id="member-password" name="password" type="password" autocomplete="off" maxlength="128" required><button id="show-password" type="button" aria-controls="member-password" aria-pressed="false" aria-label="显示密码">${passwordIcon}</button></div><div class="login-options"><label class="remember"><input id="remember-login" type="checkbox">记住账号密码</label><button type="button" class="password-link" id="open-password">修改密码</button></div>`}
${activate?'<label for="activation-code">激活码</label><div class="activation-input"><span aria-hidden="true">ZZ-</span><input id="activation-code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="80" aria-describedby="code-help" placeholder="粘贴激活码或输入字母和数字" required></div><p id="code-help" class="notice">ZZ- 已预填，分隔线自动补齐，无需手动输入；也可以直接粘贴完整激活码。</p>':''}
<button type="submit">${activate?'激活':'登录'}</button></form><p class="error" role="alert">${html(message)}</p><p class="success" id="password-success" role="status">${html(success)}</p><a href="/member/${activate?'login':'activate'}">${activate?'已经激活，前往登录':'首次使用，激活安装版'}</a></main>${activate?'':passwordDialog}<script src="/member/login.js" defer></script>${activate?'<script src="/member/activation.js" defer></script>':'<script src="/member/password.js" defer></script>'}</html>`;
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
  if(req.path==='/member/password.js'&&req.method==='GET')return res.sendFile(path.join(root,'public/member/password.js'));
  if(req.path==='/member/password'&&req.method==='POST'){
   if(req.get('origin')!==origin||req.get('X-Tongzhou-Client')!=='workspace')return res.status(403).json({error:'请求来源无效'});
   return form(req,res,error=>{if(error)return res.status(400).json({error:'输入格式不正确'});try{registry.changePassword(req.body.username,req.body.password,req.body.newPassword,req.body.confirmPassword,installation,req.ip);res.set('Set-Cookie',`${cookieName}=; ${flags}Max-Age=0`);return res.json({ok:true});}catch(e){return res.status(401).json({error:accountError(e)});}});
  }
  if(['/member','/member/login','/member/activate','/login'].includes(req.path)&&req.method==='GET'){
   if(registry.authenticate(token,installation))return res.redirect(303,'/');
   return res.type('html').send(memberPage(req.path==='/member/activate','',req.query.activated==='1'?'激活成功，请使用现有密码登录。':''));
  }
  if(['/member/login','/member/activate'].includes(req.path)&&req.method==='POST'){
   if(req.get('origin')!==origin)return res.status(403).send('请求来源无效');
   return form(req,res,error=>{if(error)return res.status(400).type('html').send(memberPage(req.path.endsWith('activate'),'输入格式不正确'));try{if(req.path.endsWith('activate')){registry.activate(req.body.username,req.body.code,installation,req.ip);return res.redirect(303,'/member/login?activated=1');}const session=registry.login(req.body.username,req.body.password,installation,req.ip);res.set('Set-Cookie',`${cookieName}=${session}; ${flags}Max-Age=43200`);return res.redirect(303,'/');}catch(e){return res.status(401).type('html').send(memberPage(req.path.endsWith('activate'),accountError(e)));}});
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
