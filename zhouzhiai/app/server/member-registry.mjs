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
  addMember(username,password,code){
    if(!/^[a-z][a-z0-9_]{2,31}$/.test(username||'')||typeof password!=='string'||password.length<12||password.length>128)throw new Error('账号格式或密码长度不正确');
    if(this.data.users.some(u=>u.username===username))throw new Error('账号已存在，禁止覆盖');
    const activationCode=code===undefined?'ZZ-'+randomBytes(20).toString('hex').toUpperCase().match(/.{1,8}/g).join('-'):normalizeActivationCode(code);
    if(!activationCode||this.data.users.some(u=>u.activationHash===digest(activationCode)))throw new Error('激活码格式不正确或已分配');
    this.data.users.push({id:'member-'+randomBytes(16).toString('hex'),username,passwordHash:passwordHash(password),activationHash:digest(activationCode),installationHash:null,activatedAt:null,disabled:false});
    this.save();return {username,password,activationCode};
  }
  credentials(username,password,installation,address='local'){
    if(!/^[a-f0-9]{64}$/.test(installation||''))throw new Error('请从舟知安装版登录');
    for(const [key,value] of this.attempts)if(value.until<=this.now())this.attempts.delete(key);
    const key=String(address)+':'+String(username).slice(0,64),attempt=this.attempts.get(key);
    if(this.attempts.size>=1000||(attempt?.count||0)>=6)throw new Error('尝试次数过多，请15分钟后再试');
    this.attempts.set(key,{count:(attempt?.count||0)+1,until:attempt?.until||this.now()+900000});
    const user=this.data.users.find(u=>u.username===username&&!u.disabled);
    // Same expensive operation for unknown usernames; never disclose account existence.
    const valid=passwordMatches(password,user?.passwordHash||'0'.repeat(32)+':'+'0'.repeat(128));
    if(!user||!valid)throw new Error('账号、密码或激活信息不正确');
    return {user,key,installationHash:digest(installation)};
  }
  activate(username,password,code,installation,address){
    const {user,key,installationHash}=this.credentials(username,password,installation,address);
    // All checks and the atomic write occur synchronously in this single gateway process.
    if(user.activatedAt||user.installationHash)throw new Error('账号已激活，请前往登录；如登录提示授权不匹配，请联系管理员');
    const normalized=normalizeActivationCode(code);
    if(!normalized||!equal(user.activationHash,digest(normalized)))throw new Error('激活码不正确，请核对该账号对应的激活码');
    user.installationHash=installationHash;user.activatedAt=new Date(this.now()).toISOString();user.activationHash=null;
    this.attempts.delete(key);this.save();return this.session(user);
  }
  login(username,password,installation,address){const {user,key,installationHash}=this.credentials(username,password,installation,address);if(!user.activatedAt)throw new Error('账号尚未激活，请先完成激活');if(!equal(user.installationHash,installationHash))throw new Error('账号已激活，但当前安装授权不匹配，请联系管理员重新授权');this.attempts.delete(key);return this.session(user);}
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
