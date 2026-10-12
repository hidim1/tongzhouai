import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),builder=createRequire(require.resolve('electron-builder')),arb=createRequire(builder.resolve('app-builder-lib'));
const ResEdit=arb('resedit'),asar=arb('@electron/asar');
const dir=path.resolve(process.argv[2]),root=path.resolve(import.meta.dirname,'..'),setup=path.join(dir,'Zhouzhi-V1.0-Windows-x64-Setup.exe');
const logo=fs.readFileSync(path.join(root,'public/brand/app-icon.png'));
const installedIcon=path.join(dir,'win-unpacked/zhouzhi-crossflow-v1.ico');
assert.deepEqual(fs.readFileSync(installedIcon),fs.readFileSync(path.join(root,'member-client/icon.ico')));
const installer=fs.readFileSync(path.join(dir,'installer.nsi'),'utf8');
assert.match(installer,/CreateShortCut "\$DESKTOP\\舟知.lnk"[^\n]+zhouzhi-crossflow-v1.ico/);
for(const filename of [setup,path.join(dir,'win-unpacked/舟知.exe')]){
 const exe=ResEdit.NtExecutable.from(fs.readFileSync(filename)),res=ResEdit.NtExecutableResource.from(exe);
 assert.ok(res.entries.some(e=>e.type===3&&Buffer.from(e.bin).equals(logo)),filename+' 必须包含同舟图标');
 assert.ok(res.entries.filter(e=>e.type===3).length>=7);
 if(filename.endsWith('/舟知.exe'))assert.equal(exe.newHeader.fileHeader.machine,0x8664);
}
const archive=path.join(dir,'win-unpacked/resources/app.asar');
const names=['credentials.cjs','icon.png','main.cjs','package.json','preload.cjs'];
assert.deepEqual(asar.listPackage(archive).sort(),names.map(n=>'/'+n));
for(const name of names)assert.deepEqual(asar.extractFile(archive,name),fs.readFileSync(path.join(root,'member-client',name)));
const sha256=createHash('sha256').update(fs.readFileSync(setup)).digest('hex');
if(process.argv[3])assert.equal(sha256,process.argv[3],'安装程序下载不完整或与编译端不一致');
console.log(JSON.stringify({ok:true,clientAndInstallerIcons:true,clientSourceMatches:true,noHistoryOrCredentialsPackaged:true,bytes:fs.statSync(setup).size,sha256,windowsNativeTest:false}));
