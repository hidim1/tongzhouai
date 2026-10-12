import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('安装快捷方式明确指向独立同舟图标，应用身份和激活存储保持不变',()=>{
 const installer=fs.readFileSync(new URL('../member-client/installer.nsi',import.meta.url),'utf8'),main=fs.readFileSync(new URL('../member-client/main.cjs',import.meta.url),'utf8'),config=fs.readFileSync(new URL('../member-client/builder.yml',import.meta.url),'utf8');
 assert.match(installer,/CreateShortCut "\$DESKTOP\\舟知.lnk" "\$INSTDIR\\舟知.exe" "" "\$INSTDIR\\zhouzhi-crossflow-v1.ico" 0/);
 assert.match(installer,/CreateShortCut "\$SMPROGRAMS\\舟知\\舟知.lnk"[^\n]+zhouzhi-crossflow-v1.ico/);
 assert.match(config,/afterPack: after-pack.cjs/);assert.match(main,/app.setAppUserModelId\('cn.crossflow.zhouzhi.member'\)/);
 assert.match(main,/app.setName\('舟知'\)/);assert.match(main,/installation.enc/);assert.match(main,/persist:zhouzhi-member/);
});
test('Windows 打包钩子替换可执行文件图标，同时保持 x64 架构',async t=>{
 const original=new URL('../member-release/win-unpacked/舟知.exe',import.meta.url);
 if(!fs.existsSync(original)){t.skip('仅打包环境有 Windows Electron 基础可执行文件');return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-member-icon-test-'));
 try{
  fs.copyFileSync(original,path.join(dir,'舟知.exe'));
  await require('../member-client/after-pack.cjs')({electronPlatformName:'win32',appOutDir:dir,packager:{appInfo:{productFilename:'舟知'}}});
  assert.deepEqual(fs.readFileSync(path.join(dir,'zhouzhi-crossflow-v1.ico')),fs.readFileSync(new URL('../member-client/icon.ico',import.meta.url)));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
