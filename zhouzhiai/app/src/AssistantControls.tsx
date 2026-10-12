import React,{useEffect,useRef,useState} from 'react';
import {ArrowUp,ChevronDown,Square,CornerDownLeft,Clock3} from 'lucide-react';

export function AssistantControls({running,hasText,busy,stopping,onSend,onStop}:{running:boolean;hasText:boolean;busy:boolean;stopping:boolean;onSend:(mode:'queue'|'steer')=>void;onStop:()=>void}){
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),toggle=useRef<HTMLButtonElement>(null);
  const stop=running&&!hasText,label=stop?(stopping?'正在停止':'停止回答'):running?'补充本轮':'发送消息';
  useEffect(()=>{setOpen(false);},[running]);
  useEffect(()=>{
    if(!open)return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  function choose(action:'queue'|'steer'|'stop'){
    setOpen(false);toggle.current?.focus();if(action==='stop')onStop();else onSend(action);
  }
  return <div className="zh-composer-actions" ref={root} onKeyDown={e=>{
    if(!open)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);toggle.current?.focus();}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'||e.key==='Home'||e.key==='End'){
      e.preventDefault();const buttons=Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')||[]),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();
    }
  }}>
    {open&&running&&<div className="zh-composer-menu" role="menu" aria-label="发送选项" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)&&!root.current?.contains(e.relatedTarget))setOpen(false);}}>
      <button type="button" role="menuitem" disabled={busy||stopping||!hasText} onClick={()=>choose('steer')}><CornerDownLeft size={15}/><span>补充本轮<small>结合新要求继续处理</small></span></button>
      <button type="button" role="menuitem" disabled={busy||stopping||!hasText} onClick={()=>choose('queue')}><Clock3 size={15}/><span>排队发送<small>当前回答结束后处理</small></span></button>
      <button type="button" role="menuitem" disabled={stopping} onClick={()=>choose('stop')}><Square size={14}/><span>停止回答<small>保留输入及排队消息</small></span></button>
    </div>}
    <button type="button" title={stop?'停止当前回答，保留输入及排队消息':running?'补充当前回答；新任务可选择排队发送':'发送消息'} aria-label={label} className={'zh-primary zh-send'+(stop?' zh-send-stop':'')} disabled={stop?stopping:busy||stopping||!hasText} onClick={()=>stop?onStop():onSend(running?'steer':'queue')}>{stop?<Square size={17}/>:<ArrowUp size={20}/>}<span>{stop?(stopping?'正在停止':'停止'):running?'补充本轮':'发送'}</span></button>
    {running&&<button type="button" ref={toggle} className="zh-send-options" aria-label="更多发送选项" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><ChevronDown size={15}/></button>}
  </div>;
}
