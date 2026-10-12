export type ComposerKey={key:string;shiftKey?:boolean;ctrlKey?:boolean;metaKey?:boolean;altKey?:boolean;repeat?:boolean;isComposing?:boolean;keyCode?:number};
export function composerAction(key:ComposerKey,running:boolean,compositionActive=false):'queue'|'steer'|null{
  if(key.key!=='Enter'||key.repeat||key.altKey||key.isComposing||key.keyCode===229||compositionActive)return null;
  if(key.shiftKey)return null;
  if(running&&(key.ctrlKey||key.metaKey))return 'steer';
  return 'queue';
}
export function elapsedLabel(createdAt:string,now=Date.now()){
  const seconds=Math.max(0,Math.floor((now-Date.parse(createdAt))/1000));
  if(!Number.isFinite(seconds))return '用时 0 秒';
  return seconds<60?`用时 ${seconds} 秒`:`用时 ${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
}
