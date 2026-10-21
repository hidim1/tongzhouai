import {createHash} from 'node:crypto';

// Bound repeated work, not total task duration. Never erase completed effects.
export function repairDecision(checkpoint,verdict,draft){
 const missing=verdict.checks.filter(c=>c.status==='missing');
 const evidence=[...new Set((checkpoint.toolReceipts||[]).filter(r=>!r.failed&&!r.cached&&r.tool!=='zhouzhi_task_plan').map(r=>JSON.stringify([r.tool,r.arguments,r.summary])))];
 const signature=createHash('sha256').update(JSON.stringify([missing.map(c=>c.id).sort(),draft,evidence])).digest('hex');
 const history=checkpoint.repairHistory??=[];
 const repeated=history.filter(h=>h.signature===signature).length;
 const rounds=checkpoint.repairRounds||0;
 const result={signature,missing:missing.map(c=>c.id),round:rounds,continue:rounds<6&&repeated<2,
  reason:rounds>=6?'repair_limit':repeated>=2?'no_progress':'targeted_repair'};
 history.push({...result,at:new Date().toISOString()});if(history.length>20)history.shift();return result;
}

export function recoveryInfo(error){
 const message=String(error.message||'');
 if(error.code==='TASK_NEEDS_INPUT')return{kind:'needs_input',canResume:false};
 if(/停止|取消/.test(message))return{kind:'cancelled',canResume:false};
 if(/未授权|不属于|权限|密钥|凭据|密码|激活|billing|unauthorized|forbidden/i.test(message))return{kind:'authorization',canResume:false};
 if(/不支持|暂不|无法安全|格式无效|范围无效|版本已经变化/.test(message))return{kind:'unsupported',canResume:false};
 return{kind:'recoverable',canResume:true};
}
