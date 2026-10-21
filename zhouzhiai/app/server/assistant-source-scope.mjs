import path from 'node:path';
import {taskFailure} from './assistant-recovery.mjs';

// Reading a file does not authorize changing it. A named original authorizes
// only that original and versions produced from it by this same task.
export function assertEditSource(job, source) {
  const contract=job.taskContract;
  if(contract?.mode!=='edit'||path.extname(source.path||source.name||'').toLowerCase()==='.pptx')return true;
  const selected=new Set((contract.sourceFileIds||[]).filter(id=>typeof id==='string'&&id));
  if(contract.sourceSelectionRequired||!selected.size)
    throw taskFailure('TASK_NEEDS_INPUT','请先确认要修改哪一份原件，不能根据文件顺序猜测。');
  const denied=()=>taskFailure('TASK_UNAUTHORIZED','本轮只允许修改已确认的原件及本任务生成的后续版本，请先确认其他文件。');
  if(typeof source.id!=='string'||!source.id)throw denied();
  if(selected.has(source.id))return true;
  const generated=new Map();
  for(const file of job.files||[]){
    if(!generated.has(file.id))generated.set(file.id,[]);
    generated.get(file.id).push(file);
  }
  let id=source.id;const seen=new Set();
  while(!selected.has(id)){
    if(seen.has(id))throw denied();
    seen.add(id);
    const candidates=generated.get(id);
    if(candidates?.length!==1)throw denied();
    const parent=candidates[0].parentId;
    if(typeof parent!=='string'||!parent)throw denied();
    id=parent;
  }
  return true;
}
