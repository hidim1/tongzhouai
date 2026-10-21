import fs from 'node:fs';
import path from 'node:path';
import {randomBytes, createHash, scryptSync, timingSafeEqual} from 'node:crypto';

export const digest = value => createHash('sha256').update(String(value)).digest('hex');
// Keep the original issued-code hashes compatible; separators and the ZZ prefix are presentation only.
export function normalizeActivationCode(value) {
 const compact=String(value||'').trim().toUpperCase().replace(/[\s\-\u2010-\u2015\u2212\uff0d]/g,'').replace(/^ZZ/,'');
 return /^[A-F0-9]{40}$/.test(compact)?'ZZ-'+compact.match(/.{1,8}/g).join('-'):'';
}
const equal = (a,b) => typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function passwordHash(password) {const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
function passwordMatches(password,hash) {if(typeof password!=='string'||password.length>256)return false;const [salt,key]=String(hash).split(':');return !!salt&&!!key&&equal(scryptSync(password,salt,64).toString('hex'),key);}
export function normalizeLogin(value){return typeof value==='string'&&value.length<=64?value.trim().toLowerCase():'';}
export class MemberRegistry {
  constructor(file,now=Date.now){this.file=file;this.now=now;this.attempts=new Map();this.data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{version:1,users:[],sessions:[]};}
  save(){fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data),{mode:0o600});fs.chmodSync(this.file+'.tmp',0o600);fs.renameSync(this.file+'.tmp',this.file);}
  provision(count,password){
    if(this.data.users.length)throw new Error('账号已配置，禁止覆盖或重复生成');
    if(count!==10||typeof password!=='string'||password.length<12||password.length>128)throw new Error('须配置10个账号及至少12位密码');
    const issued=[];
    for(let i=1;i<=count;i++){const code='ZZ-'+randomBytes(20).toString('hex').toUpperCase().match(/.{1,8}/g).join('-'),username='zhouzhi'+String(i).padStart(2,'0');
      this.data.users.push({id:'member-'+randomBytes(16).toString('hex'),username,passwordHash:passwordHash(password),activationHash:digest(code),installationHash:null,activatedAt:null,disabled:false});
      issued.push({username,password,activationCode:code});
    }
    this.save();return issued;
  }
  // Administrator maintenance only: append one account without replacing existing accounts or sessions.
  addMember(username,password,code,email){
    if(!/^[a-z][a-z0-9_]{2,31}$/.test(username||'')||typeof password!=='string'||password.length<12||password.length>128)throw new Error('账号格式或密码长度不正确');
    if(this.data.users.some(u=>u.username===username))throw new Error('账号已存在，禁止覆盖');
    const alias=email===undefined?undefined:normalizeLogin(email);
    if(email!==undefined&&(!alias||! /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(alias)))throw new Error('企业邮箱格式不正确');
    if(alias&&this.data.users.some(u=>normalizeLogin(u.email)===alias||normalizeLogin(u.username)===alias))throw new Error('企业邮箱已关联其他账号，禁止覆盖');
    const activationCode=code===undefined?'ZZ-'+randomBytes(20).toString('hex').toUpperCase().match(/.{1,8}/g).join('-'):normalizeActivationCode(code);
    if(!activationCode||this.data.users.some(u=>u.activationHash===digest(activationCode)))throw new Error('激活码格式不正确或已分配');
    this.data.users.push({id:'member-'+randomBytes(16).toString('hex'),username,...(alias?{email:alias}:{}),passwordHash:passwordHash(password),activationHash:digest(activationCode),installationHash:null,activatedAt:null,disabled:false});
    try{this.save();}catch(error){this.data.users.pop();throw error;}return {username,...(alias?{email:alias}:{}),password,activationCode};
  }
  identity(username,installation,address='local'){
    if(!/^[a-f0-9]{64}$/.test(installation||''))throw new Error('请从舟知安装版登录');
    for(const [key,value] of this.attempts)if(value.until<=this.now())this.attempts.delete(key);
    const login=normalizeLogin(username),user=login?this.data.users.find(u=>normalizeLogin(u.username)===login||u.email&&normalizeLogin(u.email)===login):null;
    // Email and original username share the same attempt budget and account identity.
    const key=String(address)+':'+(user?.id||login),attempt=this.attempts.get(key);
    if(this.attempts.size>=1000||(attempt?.count||0)>=6)throw new Error('尝试次数过多，请15分钟后再试');
    this.attempts.set(key,{count:(attempt?.count||0)+1,until:attempt?.until||this.now()+900000});
    return {user,key,installationHash:digest(installation)};
  }
  credentials(username,password,installation,address){
    const identity=this.identity(username,installation,address),{user}=identity;
    // Same expensive operation for unknown usernames; never disclose account existence.
    const valid=passwordMatches(password,user?.passwordHash||'0'.repeat(32)+':'+'0'.repeat(128));
    if(!user||user.disabled||!valid)throw new Error('账号、密码或激活信息不正确');
    return identity;
  }
  activate(username,code,installation,address){
    const {user,key,installationHash}=this.identity(username,installation,address);
    if(!user||user.disabled)throw new Error('账号或激活信息不正确');
    // All checks and the atomic write occur synchronously in this single gateway process.
    if(user.activatedAt||user.installationHash)throw new Error('账号已激活，请前往登录；如登录提示授权不匹配，请联系管理员');
    const normalized=normalizeActivationCode(code);
    if(!normalized||!equal(user.activationHash,digest(normalized)))throw new Error('激活码不正确，请核对该账号对应的激活码');
    const previous={installationHash:user.installationHash,activatedAt:user.activatedAt,activationHash:user.activationHash};
    user.installationHash=installationHash;user.activatedAt=new Date(this.now()).toISOString();user.activationHash=null;
    try{this.save();}catch(error){Object.assign(user,previous);throw error;}
    this.attempts.delete(key);return {ok:true}; // Activation never authenticates a session or changes a password.
  }
  login(username,password,installation,address){const {user,key,installationHash}=this.credentials(username,password,installation,address);if(!user.activatedAt)throw new Error('账号尚未激活，请先完成激活');if(!equal(user.installationHash,installationHash))throw new Error('账号已激活，但当前安装授权不匹配，请联系管理员重新授权');this.attempts.delete(key);return this.session(user);}
  // Administrator maintenance only. Never rename the stored username or workspace id.
  applyEmailAliases(assignments){
    if(!Array.isArray(assignments)||assignments.length!==10)throw Error('须提供10个常规账号的邮箱对应关系');
    const seen=new Set(),names=new Set(),next=this.data.users.map(u=>({...u}));
    for(const a of assignments){
      const email=normalizeLogin(a?.email),name=a?.username;
      if(!/^zhouzhi(?:0[1-9]|10)$/.test(name||'')||names.has(name)||!email||! /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(email)||seen.has(email))throw Error('邮箱对应关系格式不正确或重复');
      const user=next.find(u=>u.username===name);if(!user)throw Error('对应账号不存在');
      names.add(name);seen.add(email);user.email=email;
    }
    const aliases=new Set();for(const u of next)for(const alias of [normalizeLogin(u.username),...(u.email?[normalizeLogin(u.email)]:[])]){if(aliases.has(alias))throw Error('登录标识重复');aliases.add(alias);}
    const previous=this.data.users;this.data.users=next;try{this.save();}catch(error){this.data.users=previous;throw error;}
    return {updated:10};
  }
  changePassword(username,password,nextPassword,confirmation,installation,address){
    const {user,key,installationHash}=this.credentials(username,password,installation,address);
    if(!user.email||!/^zhouzhi(?:0[1-9]|[1-9]\d+)$/.test(user.username))throw Error('当前账号请联系管理员修改密码');
    if(!user.activatedAt)throw Error('账号尚未激活，请先完成激活再修改密码');
    if(!equal(user.installationHash,installationHash))throw Error('当前安装授权不匹配，请联系管理员');
    if(typeof nextPassword!=='string'||nextPassword.length<12||nextPassword.length>128)throw Error('新密码须为12至128位');
    if(nextPassword!==confirmation)throw Error('两次输入的新密码不一致');
    if(passwordMatches(nextPassword,user.passwordHash))throw Error('新密码不能与原密码相同');
    const previous={passwordHash:user.passwordHash,sessions:this.data.sessions,changed:user.passwordChangedAt};
    user.passwordHash=passwordHash(nextPassword);user.passwordChangedAt=new Date(this.now()).toISOString();
    this.data.sessions=this.data.sessions.filter(s=>s.userId!==user.id);
    try{this.save();}catch(error){user.passwordHash=previous.passwordHash;if(previous.changed===undefined)delete user.passwordChangedAt;else user.passwordChangedAt=previous.changed;this.data.sessions=previous.sessions;throw error;}
    this.attempts.delete(key);return {ok:true};
  }
  // Administrator-only maintenance, never exposed as an ordinary-user endpoint.
  resetActivation(username,code){
    const user=this.data.users.find(u=>u.username===username),normalized=normalizeActivationCode(code);
    if(!user||!normalized)throw new Error('账号或激活码格式不正确');
    user.activationHash=digest(normalized);user.installationHash=null;user.activatedAt=null;
    this.data.sessions=this.data.sessions.filter(s=>s.userId!==user.id);
    this.save();return {username:user.username,activated:false};
  }
  session(user){const token=randomBytes(32).toString('hex');this.data.sessions=this.data.sessions.filter(s=>s.expires>this.now());this.data.sessions.push({tokenHash:digest(token),userId:user.id,expires:this.now()+12*3600000});this.save();return token;}
  authenticate(token,installation){if(!/^[a-f0-9]{64}$/.test(token||'')||!/^[a-f0-9]{64}$/.test(installation||''))return null;const session=this.data.sessions.find(s=>equal(s.tokenHash,digest(token))&&s.expires>this.now());const user=session&&this.data.users.find(u=>u.id===session.userId&&!u.disabled);return user&&equal(user.installationHash,digest(installation))?{id:user.id,username:user.username,role:'member'}:null;}
  logout(token){this.data.sessions=this.data.sessions.filter(s=>!equal(s.tokenHash,digest(token||'')));this.save();}
}
