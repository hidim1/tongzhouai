const fs=require('node:fs');
const path=require('node:path');
exports.isLoginSender=(event,webContents,origin)=>{try{const url=new URL(event.senderFrame.url);return event.sender===webContents&&event.senderFrame===webContents.mainFrame&&url.origin===origin&&['/member','/member/login','/member/activate','/login'].includes(url.pathname);}catch{return false;}};
exports.createCredentialStore=(directory,safeStorage)=>{
 const file=path.join(directory,'remembered-login.enc');
 const clear=()=>{if(fs.existsSync(file))fs.unlinkSync(file);return true;};
 const available=()=>safeStorage.isEncryptionAvailable();
 const normalize=value=>{
  if(!value||typeof value.username!=='string'||typeof value.password!=='string'||!value.username.trim()||value.username.length>64||!value.password||value.password.length>128)throw Error('账号信息无效');
  return {username:value.username.trim(),password:value.password};
 };
 return {
  read(){if(!fs.existsSync(file))return null;if(!available())return null;try{return normalize(JSON.parse(safeStorage.decryptString(fs.readFileSync(file))));}catch{clear();return null;}},
  save(value){if(!available())throw Error('本机无法安全保存密码');const content=normalize(value);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file+'.tmp',safeStorage.encryptString(JSON.stringify(content)),{mode:0o600});fs.renameSync(file+'.tmp',file);return true;},
  clear
 };
};
