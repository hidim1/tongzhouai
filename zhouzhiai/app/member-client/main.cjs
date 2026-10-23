const {app,BrowserWindow,Menu,dialog,safeStorage,ipcMain,shell}=require('electron');
const {createCredentialStore,isLoginSender}=require('./credentials.cjs');
const {installNavigation}=require('./navigation.cjs');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const origin='http://36.140.247.61:18082';
let window;
app.setName('舟知');
if(process.platform==='win32')app.setAppUserModelId('cn.crossflow.zhouzhi.member');
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>{if(window){window.restore();window.show();window.focus();}});
 app.whenReady().then(start).catch(()=>{dialog.showErrorBox('舟知','无法启动，请重试或联系管理员。');app.quit();});
}
async function start(){
 app.setAboutPanelOptions({applicationName:'舟知',applicationVersion:'1.0'});
 if(!safeStorage.isEncryptionAvailable())throw new Error('安全存储不可用');
 const file=path.join(app.getPath('userData'),'installation.enc');
 let installation;
 if(fs.existsSync(file))installation=safeStorage.decryptString(fs.readFileSync(file));
 else{installation=randomBytes(32).toString('hex');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,safeStorage.encryptString(installation),{mode:0o600});}
 if(!/^[a-f0-9]{64}$/.test(installation))throw new Error('安装授权不可用');
 window=new BrowserWindow({width:1440,height:960,minWidth:920,minHeight:680,title:'舟知',backgroundColor:'#edf3f8',icon:path.join(__dirname,'icon.png'),webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:false,preload:path.join(__dirname,'preload.cjs'),partition:'persist:zhouzhi-member'}});
 const credentials=createCredentialStore(app.getPath('userData'),safeStorage);
 for(const [operation,handle] of [['read',()=>credentials.read()],['save',value=>credentials.save(value)],['clear',()=>credentials.clear()]])ipcMain.handle('zhouzhi-login:'+operation,(event,value)=>{if(!isLoginSender(event,window.webContents,origin))throw Error('请求无效');try{return handle(value);}catch{throw Error('本机账号保存失败，请重试');}});
 const session=window.webContents.session;
 session.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
 session.webRequest.onBeforeSendHeaders({urls:[origin+'/*']},(details,callback)=>{callback({requestHeaders:{...details.requestHeaders,'X-Zhouzhi-Installation':installation}});});
 session.webRequest.onBeforeRequest((details,callback)=>{let allowed=false;try{allowed=new URL(details.url).origin===origin||details.url.startsWith('devtools://');}catch{}callback({cancel:!allowed});});
 installNavigation({window,origin,shell,dialog});
 window.webContents.on('page-title-updated',event=>{event.preventDefault();window.setTitle('舟知');});
 session.on('will-download',(_event,item)=>{item.setSaveDialogOptions({title:'保存舟知成果',defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()))});});
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'舟知',submenu:[{label:'刷新',click:()=>window.webContents.reload()},{label:'退出',role:'quit'}]},{label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]}]));
 window.webContents.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3)dialog.showErrorBox('舟知','暂时无法连接工作区，请检查网络后点击“舟知 → 刷新”。');});
 await window.loadURL(origin+'/member');
 window.on('closed',()=>{window=null;});
}
app.on('window-all-closed',()=>app.quit());
