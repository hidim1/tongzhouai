import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{EventEmitter}from'node:events';import fs from'node:fs';
const require=createRequire(import.meta.url),{webURL,isAppURL,installNavigation}=require('../member-client/navigation.cjs');
const origin='http://36.140.247.61:18082',flush=()=>new Promise(r=>setImmediate(r));
function fixture({answer=0,fail=false,wait}={}){
 const contents=new EventEmitter(),calls={open:[],dialogs:[],load:[],download:[]};let source=origin+'/';
 Object.assign(contents,{isDestroyed:()=>false,getURL:()=>source,setWindowOpenHandler:fn=>contents.popup=fn,loadURL:async url=>calls.load.push(url),downloadURL:url=>calls.download.push(url)});
 const dialog={showMessageBox:async(_window,options)=>{calls.dialogs.push(options);if(wait)await wait;return{response:answer};}},shell={openExternal:async(...args)=>{calls.open.push(args);if(fail)throw Error('test-only failure');}};
 installNavigation({window:{webContents:contents},origin,shell,dialog});
 const navigate=(url,{redirect=false,modern=false}={})=>{let prevented=false;const event={preventDefault(){prevented=true;},...(modern?{url}:{})};contents.emit(redirect?'will-redirect':'will-navigate',event,modern?undefined:url);return prevented;};
 return{contents,calls,navigate,setSource:value=>source=value};
}
test('只接受有效HTTP(S)，拒绝危险协议、凭据、控制字符、歧义反斜线和伪造同源',()=>{
 for(const u of ['https://example.com/a?x=1#b','http://example.com','https://中文.example/资料'])assert.ok(webURL(u));
 for(const u of ['javascript:alert(1)','file:///C:/Windows/calc.exe','data:text/html,test','blob:https://example.com/test','mailto:a@example.com','ms-settings:','https://user:secret@example.com','https://example.com\n/evil','https://example.com\\@evil.test','//example.com','not a url','https://','https://example.com/'+ 'a'.repeat(8200)])assert.equal(webURL(u),null,u);
 assert.equal(isAppURL(origin+'/member',origin),true);assert.equal(isAppURL(origin+'.evil.test',origin),false);assert.equal(isAppURL('http://36.140.247.61:18083',origin),false);
});
test('点击新窗口外链经确认后打开系统浏览器，仍拒绝创建客户端新窗口',async()=>{
 const f=fixture();assert.deepEqual(f.contents.popup({url:'https://example.com/page'}),{action:'deny'});await flush();assert.deepEqual(f.calls.open,[['https://example.com/page',{activate:true}]]);
 assert.equal(f.calls.dialogs[0].defaultId,1);assert.equal(f.calls.dialogs[0].cancelId,1);assert.equal(f.calls.load.length,0);assert.equal(f.calls.download.length,0);
 const cancelled=fixture({answer:1});cancelled.contents.popup({url:'https://example.com'});await flush();assert.equal(cancelled.calls.open.length,0);
});
test('同窗口外链旧版及新版事件均拦截后交给浏览器，自动重定向不启动浏览器',async()=>{
 for(const modern of [false,true]){const f=fixture();assert.equal(f.navigate('https://example.com',{modern}),true);await flush();assert.equal(f.calls.open.length,1);}
 const f=fixture();assert.equal(f.navigate(origin+'/member/login',{modern:true}),false);assert.equal(f.navigate('https://example.com',{redirect:true,modern:true}),true);await flush();assert.equal(f.calls.open.length,0);
});
test('恶意协议、非受信任源和POST弹窗都不触发OS程序',async()=>{
 const f=fixture();for(const url of ['file:///x','javascript:alert(1)','data:test','https://a:b@example.com']){f.contents.popup({url});assert.equal(f.navigate(url),true);}f.contents.popup({url:'https://example.com',postBody:{data:[]}});await flush();assert.equal(f.calls.dialogs.length,0);assert.equal(f.calls.open.length,0);
 f.setSource('https://evil.test');f.contents.popup({url:'https://example.com'});f.navigate('https://example.com');await flush();assert.equal(f.calls.open.length,0);
});
test('私有下载保持在认证会话，普通同源页面保持在客户端，不向浏览器传递授权',async()=>{
 const f=fixture();f.contents.popup({url:origin+'/api/preview/outputs/report'});f.contents.popup({url:origin+'/api/projects/p/files/f'});f.contents.popup({url:origin+'/member/login'});await flush();assert.equal(f.calls.download.length,2);assert.deepEqual(f.calls.load,[origin+'/member/login']);assert.equal(f.calls.open.length,0);
});
test('防止重复确认弹窗，打开失败有中文提示且不会跳离客户端',async()=>{
 let release;const waiting=new Promise(r=>release=r),f=fixture({wait:waiting});f.contents.popup({url:'https://example.com/a'});f.contents.popup({url:'https://example.com/b'});assert.equal(f.calls.dialogs.length,1);release();await flush();assert.equal(f.calls.open.length,1);
 const failed=fixture({fail:true});failed.contents.popup({url:'https://example.com'});await flush();assert.equal(failed.calls.dialogs.length,2);assert.match(failed.calls.dialogs[1].message,/无法打开此链接/);assert.equal(failed.calls.load.length,0);
});
test('安装包及重打包脚本包含导航模块，保留隔离、同源网络限制与安装身份',()=>{
 const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
 for(const file of ['member-client/builder.yml','scripts/build-member-logo.mjs','scripts/verify-member-client-logo.mjs'])assert.match(read(file),/navigation\.cjs/);
 assert.match(read('scripts/build-member-logo.mjs'),/--base-unpacked/);assert.match(read('scripts/build-member-logo.mjs'),/NSISDIR:process\.env\.NSISDIR/);
 const main=read('member-client/main.cjs');assert.match(main,/installNavigation\(\{window,origin,shell,dialog\}\)/);assert.match(main,/nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true/);assert.match(main,/onBeforeSendHeaders\(\{urls:\[origin\+'\/\*'\]\}/);assert.match(main,/callback\(\{cancel:!allowed\}\)/);assert.match(main,/installation\.enc/);assert.match(main,/persist:zhouzhi-member/);
});
