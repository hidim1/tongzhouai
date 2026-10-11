const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('zhouzhiLogin',Object.freeze({
 read:()=>ipcRenderer.invoke('zhouzhi-login:read'),
 save:value=>ipcRenderer.invoke('zhouzhi-login:save',{username:value?.username,password:value?.password}),
 clear:()=>ipcRenderer.invoke('zhouzhi-login:clear')
}));
