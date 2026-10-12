import React,{useState} from 'react';
import {Pencil,Trash2,Play} from 'lucide-react';
export function AssistantQueue({items,running,busy,onEdit,onRemove,onResume}:any){
  const [editing,setEditing]=useState(''),[draft,setDraft]=useState('');
  if(!items.length)return null;
  return <section className="zh-queue" aria-label="待发送消息"><header><span>下一轮处理 · {items.length} 条</span>{!running&&<button disabled={busy} onClick={()=>void onResume()}><Play size={13}/>继续队列</button>}</header><div className="zh-queue-items">{items.map((j:any)=><div className="zh-queue-item" key={j.id}>{editing===j.id?<div className="zh-queue-edit"><textarea aria-label="编辑待发送消息" value={draft} maxLength={12000} onChange={e=>setDraft(e.target.value)}/><div><button disabled={busy||!draft.trim()} onClick={()=>void(async()=>{if(await onEdit(j.id,draft))setEditing('');})()}>保存</button><button disabled={busy} onClick={()=>setEditing('')}>取消</button></div></div>:<><p>{j.message}</p><button disabled={busy} title="编辑待发送消息" aria-label={'编辑：'+j.message} onClick={()=>{setEditing(j.id);setDraft(j.message);}}><Pencil size={13}/></button><button disabled={busy} title="移出队列" aria-label={'移出队列：'+j.message} onClick={()=>void onRemove(j.id)}><Trash2 size={13}/></button></>}</div>)}</div></section>;
}
