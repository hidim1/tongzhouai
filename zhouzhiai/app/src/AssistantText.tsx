import React,{useRef,useState} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Copy,Check} from 'lucide-react';
import {assistantTableColumns} from './assistant-table';
import {SoftScrollArea} from './SoftScrollArea';

function AssistantTable({children,node}:{children?:React.ReactNode;node?:Parameters<typeof assistantTableColumns>[0]}){
  const columns=assistantTableColumns(node),total=columns.reduce((sum,c)=>sum+c.idealWidth,0),minWidth=columns.reduce((sum,c)=>sum+c.minWidth,0);
  return <SoftScrollArea className="zh-answer-table" edgeHints tabIndex={0} role="region" aria-label="回答表格，可横向滚动"><table style={{minWidth}}><colgroup>{columns.map((c,i)=><col key={i} style={{width:`${c.idealWidth/total*100}%`,minWidth:c.minWidth}}/>)}</colgroup>{children}</table></SoftScrollArea>;
}

export function safeChatUrl(value:string){
  try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}
}
export function AssistantText({text}:{text:string}){
  const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false),body=useRef<HTMLDivElement>(null);
  async function copy(){
    const value=body.current?.innerText||text;
    let ok=false;
    try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(value);ok=true;}else{
      const field=document.createElement('textarea');field.value=value;field.setAttribute('readonly','');field.style.position='fixed';field.style.left='-9999px';document.body.append(field);const focused=document.activeElement as HTMLElement|null;try{field.select();ok=document.execCommand('copy');}finally{field.remove();focused?.focus();}
    }}catch{}
    setCopyError(!ok);setCopied(ok);if(ok)setTimeout(()=>setCopied(false),2000);
  }
  return <><div className="zh-answer-body" ref={body}><Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeChatUrl} components={{
    a:({href,children})=>href?<a href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>,
    img:({alt})=><span className="zh-image-alt">{alt||'图片'}</span>,
    table:AssistantTable,
  }}>{text}</Markdown></div><button type="button" className="zh-copy" onClick={()=>void copy()} aria-label="复制回答">{copied?<Check size={14}/>:<Copy size={14}/>} {copied?'已复制':'复制'}</button>{copyError&&<small role="status">未能复制，请选择正文后复制。</small>}</>;
}
