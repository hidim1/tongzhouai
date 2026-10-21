// Manual administrator-only acceptance launcher. No production data is copied.
import fs from 'node:fs';import path from 'node:path';import {execFileSync,spawn} from 'node:child_process';
if(process.platform!=='linux'||process.getuid()!==0)throw Error('此启动器仅用于服务器管理员隔离验收');
const app=path.resolve(process.argv[2]||'');if(!app.startsWith('/var/tmp/zhouzhi-review-')||!fs.existsSync(path.join(app,'scripts/benchmark-assistant.mjs')))throw Error('必须提供独立待验收代码目录');
const pid=execFileSync('systemctl',['show','-p','MainPID','--value','tongzhou-ai.service'],{encoding:'utf8'}).trim();if(!/^\d+$/.test(pid)||pid==='0')throw Error('线上服务未运行，不能借用已有连接配置');
const env=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
const provider=env.ZHOUZHI_PROVIDER_FILE||path.join(env.TONGZHOU_DATA_DIR,'private/provider.json');
if(!fs.existsSync(provider))throw Error('现有连接配置不可读取');
const data=fs.mkdtempSync('/var/tmp/zhouzhi-benchmark-'),uid=Number(execFileSync('id',['-u','tongzhou-ai'],{encoding:'utf8'})),gid=Number(execFileSync('id',['-g','tongzhou-ai'],{encoding:'utf8'}));fs.chmodSync(data,0o700);fs.chownSync(data,uid,gid);
Object.assign(env,{TONGZHOU_DATA_DIR:data,ZHOUZHI_PROVIDER_FILE:provider,ZHOUZHI_MEMBRANE_DATA:path.join(app,'tests/fixtures/assistant-isolation/membrane'),ZHOUZHI_MEMBER_MODE:'1',TONGZHOU_NO_AUTO_CONNECT:'1'});
for(const key of ['TONGZHOU_PUBLIC_ORIGIN','ZHOUZHI_MEMBER_REGISTRY','TONGZHOU_DESKTOP'])delete env[key];
const node='/opt/tongzhou-runtime/node/bin/node',components=process.argv.includes('--semantic-component'),nativePages=process.argv.some(a=>a.startsWith('--native-pages=')),entry=components?'verify-semantic-component.mjs':nativePages?'verify-native-pages.mjs':'benchmark-assistant.mjs',child=spawn(node,[path.join(app,'scripts',entry),...process.argv.slice(3)],{cwd:app,env,uid,gid,stdio:'inherit'});console.log(JSON.stringify({isolatedWorkspace:data}));
child.on('exit',code=>{for(const relative of ['private/codex-mikoto']){const target=path.join(data,relative);if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});}process.exitCode=code??1;});
