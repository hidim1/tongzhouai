// Existing cloud records remain available without embedding the retired page.
export function ProjectHistory({project,jobs}:any){
 const records=jobs.filter((j:any)=>j.projectId===project.id);
 const artifacts=project.artifacts||[];
 const result=project.results?.live;
 if(!records.length&&!artifacts.length&&!result?.requirements?.length)return null;
 return <details className="mw-section mw-details"><summary>历史工程记录与成果 · {records.length} 次任务 · {artifacts.length} 份文件</summary>
  <p className="mw-hint">保留原有项目记录。历史成果不自动计入新方案或预算。</p>
  {artifacts.map((a:any)=><p key={a.id}><a href={`/api/projects/${project.id}/artifacts/${a.id}`} download={a.name}>{a.name}</a></p>)}
  {result?.requirements?.length>0&&<details><summary>历史需求与核对结果</summary><p>{result.summary}</p>{['requirements','materials','issues','sections'].map(k=><details key={k}><summary>{{requirements:'需求记录',materials:'材料记录',issues:'核对问题',sections:'技术章节'}[k as 'requirements']||k} · {result[k]?.length||0}</summary>{(result[k]||[]).map((r:any,i:number)=><pre key={i} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(r,null,2)}</pre>)}</details>)}</details>}
  {records.map((j:any)=><details key={j.id}><summary>{j.title||'历史任务'} · {j.createdAt?.slice(0,10)} · {j.status==='completed'?'已完成':j.status==='failed'?'未完成':j.status}</summary><p style={{whiteSpace:'pre-wrap'}}>我的任务：{j.message}</p><p style={{whiteSpace:'pre-wrap'}}>{j.finalText||j.outputText||j.error||'无文字结果'}</p></details>)}
 </details>;
}
