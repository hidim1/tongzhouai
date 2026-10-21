import React,{useEffect,useState,useRef} from 'react';
import {Bot,Layers3,ArrowUp,Paperclip,Plus,Sparkles,FileText,Download,Settings,RefreshCw,FolderOpen,ChevronRight,TriangleAlert,Trash2,Undo2,Users} from 'lucide-react';
import {MembraneWorkspace} from './MembraneWorkspace';
import {AssistantText} from './AssistantText';
import {AssistantQueue} from './AssistantQueue';
import {AssistantControls} from './AssistantControls';
import {SoftScrollArea} from './SoftScrollArea';
import {composerAction,elapsedLabel} from './assistant-input';
import './preview.css';
import './preview-assistant.css';
async function request(url:string,body?:unknown,method?:string){const r=await fetch('/api'+url,{method:method||(body===undefined?'GET':'POST'),headers:body===undefined?{}:{'Content-Type':'application/json','X-Tongzhou-Client':'workspace'},body:body===undefined?undefined:JSON.stringify(body)});if(r.status===401){window.location.assign('/login');throw new Error('登录已过期');}const d=await r.json();if(!r.ok)throw new Error(d.error||'请求失败');return d;}
async function upload(url:string,files:FileList|null){if(!files?.length)return;const body=new FormData();for(const f of Array.from(files))body.append('files',f);const r=await fetch('/api'+url,{method:'POST',headers:{'X-Tongzhou-Client':'workspace'},body});if(r.status===401){window.location.assign('/login');throw new Error('登录已过期');}const d=await r.json();if(!r.ok)throw new Error(d.error||'上传失败');return d;}
export function Preview({SettingsView:PreviewSettings,MembersView}:any={}){
 const [nav,setNav]=useState(window.location.hash==='#members'&&MembersView?'members':'assistant'),[state,setState]=useState<any>(null),[boot,setBoot]=useState<any>(null),[sessionId,setSessionId]=useState(''),[projectId,setProjectId]=useState(''),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[deleting,setDeleting]=useState<any>(null),[recycle,setRecycle]=useState(false),[newName,setNewName]=useState('');
 const input=useRef<HTMLInputElement>(null),bottom=useRef<HTMLDivElement>(null),composing=useRef(false),compositionEnded=useRef(0),sending=useRef(false),pendingSend=useRef({key:'',id:''}),follow=useRef(true),lastView=useRef(''),currentSession=useRef(sessionId);
 currentSession.current=sessionId;
 const [notice,setNotice]=useState({sessionId:'',text:''});
 const [stopping,setStopping]=useState(false),stopPending=useRef(false);
 const modifier=typeof navigator!=='undefined'&&/Mac|iPhone|iPad/.test(navigator.platform)?'⌘':'Ctrl';
 const refresh=async()=>{const [s,b]=await Promise.all([request('/preview/state'),request('/bootstrap')]);setState(s);setBoot(b);setSessionId(id=>s.sessions.some((x:any)=>x.id===id)?id:s.sessions[0]?.id||'');setProjectId(id=>b.projects.some((p:any)=>p.id===id)?id:b.projects[0]?.id||'');};
 useEffect(()=>{void refresh().catch(e=>setError(e.message));const timer=setInterval(()=>void refresh().catch(()=>{}),2000);return()=>clearInterval(timer);},[]);
 const perform=async(fn:()=>Promise<any>)=>{setBusy(true);setError('');try{await fn();await refresh();return true;}catch(e:any){setError(e.message);return false;}finally{setBusy(false);}};
 const session=state?.sessions.find((s:any)=>s.id===sessionId),project=boot?.projects.find((p:any)=>p.id===projectId);
 const generalJobs=state?.jobs.filter((j:any)=>j.sessionId===sessionId)||[],assemblyJobs=state?.jobs.filter((j:any)=>j.projectId===projectId)||[];
 const generalRunning=generalJobs.some((j:any)=>j.status==='running'),assemblyRunning=assemblyJobs.some((j:any)=>j.status==='running');
 const currentGeneralJob=generalJobs.find((j:any)=>j.status==='running');
 const generalProgress=currentGeneralJob?elapsedLabel(currentGeneralJob.startedAt||currentGeneralJob.createdAt):'';
 const queuedMessages=generalJobs.filter((j:any)=>j.status==='queued');
 useEffect(()=>{const panel=bottom.current?.parentElement,key=nav+sessionId;if(lastView.current!==key){follow.current=true;lastView.current=key;}if(follow.current)panel?.scrollTo({top:panel.scrollHeight,behavior:'smooth'});},[sessionId,nav,session?.messages.length,generalRunning,currentGeneralJob?.answerUpdates?.length]);
 useEffect(()=>{window.scrollTo({top:0});},[nav,projectId]);
 useEffect(()=>{if(boot&&nav==='members'&&!(boot.role==='admin'&&boot.adminMembersEnabled&&MembersView))setNav('assistant');},[boot,nav,MembersView]);
 const newSession=async()=>{const s=await request('/preview/sessions',{});currentSession.current=s.id;setSessionId(s.id);return s;};
 const send=async(mode:'queue'|'steer'='queue')=>{
  if(sending.current||busy||!text.trim())return;sending.current=true;const draft=text;
  try{await perform(async()=>{
   const s=session||await newSession(),key=JSON.stringify([s.id,mode,draft]);
   if(pendingSend.current.key!==key)pendingSend.current={key,id:globalThis.crypto?.randomUUID?.()||`msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`};
   const result=await request(`/preview/sessions/${s.id}/tasks`,{message:draft,mode,requestId:pendingSend.current.id});
   setNotice({sessionId:s.id,text:result.notice||'已发送'});follow.current=true;
   if(currentSession.current===s.id)setText(value=>value===draft?'':value);
   pendingSend.current={key:'',id:''};
  });}finally{sending.current=false;}
 };
 const stopGeneral=async()=>{
  if(stopPending.current||!currentGeneralJob)return;stopPending.current=true;setStopping(true);
  try{await request(`/preview/jobs/${currentGeneralJob.id}/cancel`,{});await refresh();}catch(e:any){setError(e.message);}finally{stopPending.current=false;setStopping(false);}
 };
 const doUpload=(files:FileList|null)=>perform(async()=>{if(nav==='assistant'){const s=session||await newSession();await upload(`/preview/sessions/${s.id}/files`,files);}else await upload(`/preview/projects/${projectId}/files`,files);if(input.current)input.current.value='';});
 const anyRunning=state?.jobs.some((j:any)=>['running','queued','approval','awaiting_approval'].includes(j.status))||state?.images.some((j:any)=>j.status==='running')||boot?.jobs.some((j:any)=>['running','queued','approval','awaiting_approval'].includes(j.status));
 if(!state||!boot)return <div className="zh-loading">舟知正在准备…{error&&<p>{error}</p>}</div>;
 return <div className={'zh-shell '+(nav==='assistant'?'zh-assistant-page':'')}><aside className="zh-sidebar">
  <div className="zh-brand"><img src="/brand/crossflow-logo.png" alt="CROSSFLOW 同舟纵横"/><div><strong>舟知</strong><span>全量工作助手</span></div></div><div className="zh-side-label">我的工作空间</div>
  <button className={'zh-nav '+(nav==='assistant'?'is-active':'')} onClick={()=>{setNav('assistant');setText('');}}><Bot size={20}/>智能工作助理<small>AI</small></button><button className={'zh-nav '+(nav==='membrane'?'is-active':'')} onClick={()=>{setNav('membrane');setText('');}}><Layers3 size={20}/>膜预算平台<small>AI</small></button>
  {boot.role==='admin'&&boot.adminMembersEnabled&&MembersView&&<><div className="zh-side-label">管理中心</div><button className={'zh-nav '+(nav==='members'?'is-active':'')} onClick={()=>{setNav('members');setText('');}}><Users size={20}/>成员工作区</button></>}
  {['assistant','membrane'].includes(nav)&&<div className="zh-side-label">{nav==='assistant'?'工作对话':'膜设备项目'}<button title="新建对话或项目" onClick={()=>nav==='assistant'?void perform(newSession):setNewName('未命名膜设备项目')}><Plus size={16}/></button></div>}
  <div className="zh-side-list">{['assistant','membrane'].includes(nav)&&(nav==='assistant'?state.sessions:boot.projects).map((item:any)=><div key={item.id} className={'zh-side-item '+((nav==='assistant'?sessionId:projectId)===item.id?'selected':'')}><button className="zh-side-open" title={item.name} onClick={()=>{if(nav==='assistant')setSessionId(item.id);else{setProjectId(item.id);}setText('');}}>{nav==='assistant'?<FileText size={15}/>:<FolderOpen size={15}/>}<span>{item.name}</span></button><button className="zh-side-delete" aria-label={'删除'+(nav==='assistant'?'对话：':'项目：')+item.name} title="删除" disabled={busy} onClick={()=>setDeleting({id:item.id,name:item.name,type:nav==='assistant'?'sessions':'projects'})}><Trash2 size={14}/></button></div>)}</div>
  {boot.role!=='member'&&PreviewSettings&&<button className={'zh-settings '+(nav==='settings'?'is-active':'')} onClick={()=>setNav('settings')}><Settings size={17}/> AI连接设置</button>}<button className="zh-settings zh-recycle" onClick={()=>setRecycle(true)}><Trash2 size={15}/>回收站</button>
 </aside><main className="zh-main"><header className="zh-topbar"><div>工作空间<ChevronRight size={14}/><b>{nav==='members'?'成员工作区':nav==='settings'?'AI 连接设置':nav==='assistant'?'智能工作助理':'膜预算平台'}</b></div>{boot.server&&<form method="post" action="/logout"><button className="zh-link">退出登录</button></form>}</header>
 {error&&<div className="zh-error" role="alert"><TriangleAlert size={17}/>{error}<button onClick={()=>setError('')}>×</button></div>}
 {nav==='assistant'&&session?.files.length>0&&<div className="zh-attachmentbar"><Paperclip size={14}/><span>本轮资料：</span>{session.files.map((f:any)=><span key={f.id} title={f.status}>{f.name} · {f.status}</span>)}</div>}
 {nav==='membrane'&&assemblyRunning&&<div className="zh-taskbar"><RefreshCw className="zh-spin" size={15}/><span>AI任务执行中，较长工程清单需要几分钟。</span><button disabled={busy} onClick={()=>void perform(()=>request(`/preview/jobs/${assemblyJobs.find((j:any)=>j.status==='running').id}/cancel`,{}))}>停止当前任务</button></div>}
 {nav==='members'&&boot.role==='admin'&&boot.adminMembersEnabled&&MembersView?<MembersView/>:nav==='settings'&&boot.role!=='member'&&PreviewSettings?<PreviewSettings server={boot.server} engine={boot.engine} running={anyRunning} onChanged={refresh}/>:nav==='assistant'?<><div className="zh-heading"><div><h1>把日常工作，交给舟知搭把手。</h1></div>{boot.engine.connected&&boot.engine.authenticated&&<span className="mw-ai ready" role="status"><Sparkles size={15}/>AI 已连接</span>}</div>
  <div className="zh-assistant-layout"><section className="zh-chat"><div className="zh-chat-header"><Bot size={18}/><b>{session?.name||'新工作对话'}</b><button className="zh-link" onClick={()=>void perform(newSession)}><Plus size={16}/>新对话</button></div>
  <SoftScrollArea className="zh-messages" tabIndex={0} aria-label="工作对话内容" onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;}}>
   {!session?.messages.length?<div className="zh-welcome"><div className="zh-ai-symbol"><Sparkles size={32}/></div><h2>你说任务，我来整理。</h2><p>从一个问题、一份资料、一张表开始。</p><div className="zh-suggestions">{['帮我理一理这件事，给点建议','提炼这份资料的重点','把这些内容做成 PPT'].map(t=><button key={t} onClick={()=>setText(t)}>{t}<ArrowUp size={16}/></button>)}</div></div>:session.messages.map((m:any,i:number)=><article className={'zh-message '+m.role} key={i}>
    <small>{m.role==='user'?'我':'舟知'}{m.delivery==='steer'&&<span className="zh-steer-receipt"> · 已补充到本轮</span>}</small>
    {m.role==='assistant'?<AssistantText text={m.text}/>:<div className="zh-user-text">{m.text}</div>}
    {m.files?.map((f:any)=><a key={f.id} href={f.url} download={f.name} className="zh-file-download"><FileText size={20}/><span>{f.name}<small>已生成 · 点击下载</small></span><Download size={16}/></a>)}
   </article>)}
   {generalRunning&&currentGeneralJob?.answerUpdates?.map((update:any,i:number)=><article className="zh-message assistant" key={currentGeneralJob.id+'-update-'+i}><small>舟知</small><AssistantText text={update.text}/></article>)}
   {generalRunning&&<div className="zh-waiting"><small>舟知</small><div><span className="zh-wait-status" role="status"><span className="zh-thinking-dots" aria-hidden="true"><i/><i/><i/></span>思考中…</span><span className="zh-wait-time">{generalProgress}</span></div></div>}
   {generalJobs.filter((j:any)=>j.status!=='queued').slice(-1).filter((j:any)=>j.status==='failed').map((j:any)=><div className="zh-inline-error" key={j.id}>{j.needsInput?'这部分还需要补充：':'上次执行未成功：'}{j.error}{j.canResume&&<button className="zh-link" disabled={busy||generalRunning} onClick={()=>void perform(()=>request(`/preview/jobs/${j.id}/continue`,{}))}>继续处理</button>}</div>)}<div ref={bottom}/>
  </SoftScrollArea>
  <AssistantQueue items={queuedMessages} running={generalRunning} busy={busy} onEdit={(id:string,message:string)=>perform(()=>request(`/preview/sessions/${sessionId}/queue/${id}`,{message},'PATCH'))} onRemove={(id:string)=>perform(()=>request(`/preview/sessions/${sessionId}/queue/${id}`,{},'DELETE'))} onResume={()=>perform(()=>request(`/preview/sessions/${sessionId}/queue/resume`,{}))}/>
  <div className="zh-composer"><textarea aria-label="通用工作任务" aria-describedby="zh-composer-hint" placeholder="说说你想处理的事，或上传资料…" value={text} maxLength={12000} onChange={e=>{setText(e.target.value);setNotice({sessionId:'',text:''});}} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;compositionEnded.current=Date.now();}} onKeyDown={e=>{
   const action=composerAction({...e,keyCode:e.nativeEvent.keyCode,isComposing:e.nativeEvent.isComposing},generalRunning,composing.current||Date.now()-compositionEnded.current<80);
   if(action){e.preventDefault();void send(action);}
  }}/><div><button className="zh-link" onClick={()=>input.current?.click()} disabled={busy}><Paperclip size={16}/>添加资料</button><AssistantControls running={generalRunning} hasText={!!text.trim()} busy={busy} stopping={stopping} onSend={mode=>void send(mode)} onStop={()=>void stopGeneral()}/></div><p id="zh-composer-hint" className="zh-composer-hint">{generalRunning?`回车排队 · ${modifier} + 回车补充本轮 · Shift + 回车换行`:'回车发送 · Shift + 回车换行'}</p></div>
  {notice.sessionId===sessionId&&notice.text&&<p className="zh-send-notice" role="status">{notice.text}</p>}
  </section>
  </div></>:!project?<div className="zh-settings-layout"><section className="zh-panel"><h1>还没有膜设备项目</h1><p className="zh-muted">新建项目开始工作，或从回收站恢复已有项目。</p><form onSubmit={e=>{e.preventDefault();void perform(async()=>{const p=await request('/projects',{name:newName.trim()||'新膜设备项目'});setProjectId(p.id);setNewName('');});}}><label className="zh-field">项目名称<input aria-label="新项目名称" value={newName} placeholder="新膜设备项目" maxLength={80} onChange={e=>setNewName(e.target.value)}/></label><button className="zh-primary" disabled={busy}>创建项目</button></form></section></div>:<>
  {newName&&<div className="zh-newproject"><input aria-label="新项目名称" value={newName} onChange={e=>setNewName(e.target.value)}/><button className="zh-primary" onClick={()=>void perform(async()=>{const p=await request('/projects',{name:newName});setProjectId(p.id);setNewName('');})}>创建项目</button><button onClick={()=>setNewName('')}>取消</button></div>}
  <MembraneWorkspace key={projectId} project={project} boot={boot} state={state} busy={busy} perform={perform} onUpload={()=>input.current?.click()} onCreate={()=>setNewName('未命名膜设备项目')}/>
 </>}
 <input ref={input} type="file" multiple hidden accept=".doc,.docx,.pptx,.xlsx,.pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.dwg,.dxf,.step,.stp,.iges,.igs,.sldprt,.sldasm" onChange={e=>void doUpload(e.target.files)}/><footer className="zh-footer">舟知<span>正式成果需人工复核</span></footer></main>
 {deleting&&<div className="zh-modal-backdrop"><section className="zh-modal" role="dialog" aria-modal="true" aria-labelledby="zh-delete-title"><h2 id="zh-delete-title">删除{deleting.type==='sessions'?'对话':'项目'}？</h2><p>{deleting.name}</p><p className="zh-muted">删除后不再显示在列表中。相关资料与成果保留在工作区，可在回收站恢复。</p>{error&&<p role="alert" className="zh-inline-error">{error}</p>}<div className="zh-result-actions"><button className="zh-secondary" disabled={busy} onClick={()=>{setDeleting(null);setError('');}}>取消</button><button className="zh-danger" disabled={busy} onClick={()=>void(async()=>{const ok=await perform(()=>request(`/preview/${deleting.type}/${deleting.id}`,{},'DELETE'));if(ok){setDeleting(null);setText('');}})()}>确认删除</button></div></section></div>}
 {recycle&&<div className="zh-modal-backdrop"><section className="zh-modal" role="dialog" aria-modal="true" aria-labelledby="zh-recycle-title"><h2 id="zh-recycle-title">回收站</h2><p className="zh-muted">删除的对话和项目仍保存在工作区，恢复后重新出现在列表中。</p>{!state.archived?.length?<p>回收站为空。</p>:state.archived.map((item:any)=><div className="zh-archive-row" key={item.type+item.id}><div><b>{item.name}</b><small>{item.type==='sessions'?'工作对话':'膜设备项目'}</small></div><button className="zh-secondary" disabled={busy} aria-label={'恢复：'+item.name} onClick={()=>void perform(()=>request(`/preview/archive/${item.type}/${item.id}/restore`,{}))}><Undo2 size={14}/>恢复</button></div>)}{error&&<p role="alert" className="zh-inline-error">{error}</p>}<button className="zh-secondary" onClick={()=>{setRecycle(false);setError('');}}>关闭</button></section></div>}
 </div>;
}
