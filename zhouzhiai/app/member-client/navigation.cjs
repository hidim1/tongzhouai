// External pages never load in the authenticated client. Only an explicitly
// confirmed HTTP(S) URL may be handed to the OS, without headers or cookies.
function webURL(value){
 if(typeof value!=='string'||value.length>8192||/[\x00-\x20\x7f\\]/.test(value)||!/^https?:\/\//i.test(value))return null;
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&url.hostname&&!url.username&&!url.password?url:null;}catch{return null;}
}
function isAppURL(value,origin){const url=webURL(value);return !!url&&url.origin===origin;}
function installNavigation({window,origin,shell,dialog}){
 const contents=window.webContents;let opening=false;
 const trusted=()=>!contents.isDestroyed()&&isAppURL(contents.getURL(),origin);
 const notice=async()=>{try{await dialog.showMessageBox(window,{type:'info',title:'舟知',message:'无法打开此链接，请复制链接到浏览器中重试。',buttons:['知道了']});}catch{}};
 const outside=async value=>{
  const url=webURL(value);if(!url||url.origin===origin||!trusted()||opening)return;
  opening=true;
  try{
   const answer=await dialog.showMessageBox(window,{type:'question',title:'打开外部网页',message:'是否在系统浏览器中打开此网页？',detail:url.href,buttons:['打开网页','取消'],defaultId:1,cancelId:1,noLink:true});
   if(answer.response===0&&trusted())await shell.openExternal(url.href,{activate:true});
  }catch{if(!contents.isDestroyed())await notice();}
  finally{opening=false;}
 };
 contents.setWindowOpenHandler(details=>{
  if(!trusted()||details.postBody)return {action:'deny'};
  if(isAppURL(details.url,origin)){
   const url=new URL(details.url);
   // Keep private downloads in the existing authenticated session, never in
   // the system browser (which does not have the installation header/cookie).
   if(/^\/api\/preview\/(?:outputs|images)\/[^/]+$/.test(url.pathname)||/^\/api\/projects\/[^/]+\/(?:files|preview|artifacts)\/[^/]+$/.test(url.pathname))contents.downloadURL(url.href);
   else void contents.loadURL(url.href).catch(error=>{if(error.code!=='ERR_ABORTED')return notice();});
  }else void outside(details.url);
  return {action:'deny'};
 });
 contents.on('will-navigate',(event,legacyURL)=>{
  const url=event.url||legacyURL;if(isAppURL(url,origin))return;
  event.preventDefault();void outside(url);
 });
 // An automatic server redirect is not permission to launch an OS app.
 contents.on('will-redirect',(event,legacyURL)=>{if(!isAppURL(event.url||legacyURL,origin))event.preventDefault();});
}
module.exports={webURL,isAppURL,installNavigation};
