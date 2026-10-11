import { useEffect, useState } from 'react';
import { Sparkles, RefreshCw, KeyRound, ShieldCheck, ExternalLink } from 'lucide-react';
import { api } from './api';
import type { Engine } from './types';

type Provider = { provider: 'openai' | 'mikoto'; defaultModel: string; hasKey: boolean; credentialStorage: string };
type Diagnostics = { checks: { id: string; name: string; status: string; detail: string }[] };
export function PreviewSettings({ engine, running, onChanged, server=false }: { server?: boolean; engine: Engine; running: boolean; onChanged: () => Promise<void> }) {
  const [saved, setSaved] = useState<Provider>();
  const [provider, setProvider] = useState('openai'), [model, setModel] = useState('');
  const [key, setKey] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [diagnostics, setDiagnostics] = useState<Diagnostics>();
  const [login, setLogin] = useState<{ loginId: string; authUrl: string }>();
  useEffect(() => {
    let active = true;
    void api<Provider>('/engine/provider').then(p => { if (active) { setSaved(p); setProvider(p.provider); setModel(p.defaultModel); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); await onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const ready = engine.connected && engine.authenticated;
  return <>
    <div className="zh-heading"><div><span className="zh-eyebrow">AI CONNECTION</span><h1>AI 连接设置</h1><p>智能工作助理与膜预算平台共用这一套连接。</p></div></div>
    <div className="zh-settings-layout">
      {running && <div className="zh-warning">有 AI 任务正在执行，请等待完成或停止任务后再更改连接。</div>}
      {error && <p className="zh-inline-error" role="alert">{error}</p>}
      {message && <p className="zh-settings-message" role="status">{message}</p>}
      <section className="zh-panel">
        <div className="zh-connection-title"><Sparkles size={21}/><h2>共享 AI 服务</h2><span className={'zh-connection-state '+(ready?'ready':'')}>{ready?'已连接':'待就绪'}</span></div>
        <dl className="zh-connection-details"><div><dt>连接方式</dt><dd>{saved?.provider==='mikoto'?'Mikoto API':'ChatGPT 账号'}</dd></div><div><dt>当前模型</dt><dd>{saved?.defaultModel || engine.defaultModel || '读取中…'}</dd></div><div><dt>运行方式</dt><dd>{server?'资料在服务器保存，AI 通过云端连接完成任务':'资料在本地保存，AI 推理通过已配置的服务完成'}</dd></div></dl>
        {engine.error && <p className="zh-inline-error">{engine.error}</p>}
        <button className="zh-secondary" disabled={busy||running} onClick={()=>void act(async()=>{ await api('/engine/connect',{}); setMessage('连接状态已刷新。'); })}><RefreshCw size={15}/>重新连接</button>
      </section>
      <section className="zh-panel">
        <div className="zh-connection-title"><KeyRound size={21}/><h2>连接配置</h2></div>
        <form onSubmit={e=>{e.preventDefault();void act(async()=>{
          const next=await api<Provider & {engine:{error?:string}}>('/engine/provider',{provider,model,...(key?{apiKey:key}:{})},'PUT');
          setSaved(next);setKey('');setMessage(next.engine.error?`配置已保存，连接尚未就绪：${next.engine.error}`:'配置已保存并连接。切换连接后请新建对话。');
        });}}>
          <label className="zh-field">连接方式<select aria-label="连接方式" value={provider} disabled={busy||running||!saved} onChange={e=>setProvider(e.target.value)}><option value="openai">ChatGPT 账号登录</option><option value="mikoto">Mikoto API</option></select></label>
          <label className="zh-field">默认模型<input aria-label="默认模型" value={model} required maxLength={100} disabled={busy||running||!saved} onChange={e=>setModel(e.target.value)}/></label>
          {provider==='mikoto'&&<><label className="zh-field">API 地址<input readOnly value="https://api.mikoto.vip/v1"/></label><label className="zh-field">API 密钥<input aria-label="API 密钥" type="password" value={key} autoComplete="new-password" spellCheck={false} maxLength={512} disabled={busy||running} placeholder={saved?.hasKey?'已保存，留空保留':'输入 API 密钥'} onChange={e=>setKey(e.target.value)}/></label></>}
          <p className="zh-muted">{saved?.credentialStorage || '仅保存在本机'}。密钥不会显示在页面，也不写入源码或成果文件。</p>
          <div className="zh-result-actions"><button type="submit" className="zh-primary" disabled={busy||running||!saved}>保存并连接</button><button type="button" className="zh-secondary" disabled={busy||saved?.provider!=='mikoto'||!saved?.hasKey} onClick={()=>void act(async()=>{const result=await api<{message:string}>('/engine/provider/check',{});setMessage(result.message);})}>检查 API</button></div>
        </form>
      </section>
      <section className="zh-panel"><div className="zh-connection-title"><ShieldCheck size={21}/><h2>账号与运行检查</h2></div><p className="zh-muted">使用 ChatGPT 账号时，沿用当前运行环境的登录。重新登录可能更新共用账号状态。</p>
        <div className="zh-result-actions"><button className="zh-secondary" disabled={busy} onClick={()=>void act(async()=>{setDiagnostics(await api('/diagnostics'));})}><RefreshCw size={15}/>检查运行环境</button><button className="zh-secondary" disabled={busy||running||!!login||saved?.provider!=='openai'} onClick={()=>void act(async()=>{setLogin(await api('/engine/login',{}));})}>重新登录 ChatGPT</button></div>
        {login&&<div className="zh-info"><a className="zh-secondary" href={login.authUrl} target="_blank" rel="noreferrer">打开登录页面<ExternalLink size={14}/></a><button className="zh-link" disabled={busy} onClick={()=>void act(async()=>{await api('/engine/login/cancel',{loginId:login.loginId});setLogin(undefined);})}>结束登录流程</button><p>完成登录后点击上方“重新连接”刷新状态。</p></div>}
        {diagnostics?.checks.map(c=><div className="zh-diagnostic" key={c.id}><div><b>{c.name}</b><small>{c.detail}</small></div><span>{c.status==='ready'?'就绪':'待处理'}</span></div>)}
      </section>
    </div>
  </>;
}
