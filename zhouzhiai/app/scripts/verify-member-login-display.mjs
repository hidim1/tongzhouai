// Read-only checks of the live client entry pages; no account login/activation.
import assert from 'node:assert/strict';
import http from 'node:http';
const origin=process.env.TONGZHOU_PUBLIC_ORIGIN;
assert.ok(origin,'需在正式服务环境运行');
const request=pathname=>new Promise((resolve,reject)=>{
 const req=http.get({host:'127.0.0.1',port:18082,path:pathname,headers:{Host:new URL(origin).host,'X-Zhouzhi-Installation':'a'.repeat(64)}},res=>{
  let page='';res.on('data',chunk=>page+=chunk);res.on('end',()=>resolve({status:res.statusCode,page}));
 });req.on('error',reject);req.setTimeout(10000,()=>req.destroy(new Error('入口检查连接超时')));
});
for(const pathname of ['/member/login','/member/activate']){
 const {status,page}=await request(pathname);assert.equal(status,200);
 assert.doesNotMatch(page,/当前为未加密内测连接|请仅在可信网络使用/);
 assert.match(page,/记住账号密码/);assert.match(page,/显示密码/);assert.match(page,/舟知/);
 assert.match(page,/name="password" type="password"/);
 if(pathname.endsWith('activate'))assert.match(page,/分隔线自动补齐/);
}
console.log(JSON.stringify({ok:true,loginAndActivationPages:true,noticeRemoved:true,credentialFeaturesPreserved:true,accountsUnchanged:true}));
