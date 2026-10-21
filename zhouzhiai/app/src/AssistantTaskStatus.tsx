import React from 'react';

type Task = {id:string;status:string;phase?:string;error?:string;canResume?:boolean};
export function AssistantTaskStatus({job,busy,onCancel,onContinue}:{job?:Task;busy:boolean;onCancel:(id:string)=>void;onContinue:(id:string)=>void}){
  if(!job)return null;
  if(job.status==='waiting_user')return <div className="zh-task-question" role="status">
    <strong>等待你补充后继续</strong>
    <p>请回答上方问题，已完成的处理会保留；待发送消息暂不执行。</p>
    <button type="button" className="zh-link" disabled={busy} onClick={()=>onCancel(job.id)}>取消此任务</button>
  </div>;
  if(job.status==='failed')return <div className="zh-inline-error" role="alert">
    上次执行未成功：{job.error||'任务未完成，请稍后重试。'}
    {job.canResume&&<button type="button" className="zh-link" disabled={busy} onClick={()=>onContinue(job.id)}>继续处理</button>}
  </div>;
  return null;
}
