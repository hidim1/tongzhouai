import {assertPublicOutput} from './member-policy.mjs';
export function requestClarification(job,{question,options=[]}){
 if(typeof question!=='string'||!question.trim()||question.length>600||!Array.isArray(options)||options.length>4||options.some(v=>typeof v!=='string'||!v.trim()||v.length>100))throw Error('补充问题无效');
 const cp=job.checkpoint??={};
 // A pending question is immutable until answered. Already-created artifacts
 // remain available for resumption; they do not prevent asking about the rest.
 if(cp.clarification)return{needsUserInput:true,question:cp.clarification.question,instruction:'正在等待用户回答，不得继续调用工具或制作文件。'};
 assertPublicOutput({question,options});const text=question.trim()+(options.length?'\n\n'+options.map((v,i)=>(i+1)+'. '+v).join('\n'):'');
 cp.clarification={question:text,createdAt:new Date().toISOString()};return{needsUserInput:true,question:text,instruction:'本轮立即暂停执行，直接把这个必要问题自然交给用户，不猜测选项，不继续制作文件。已完成的工作会在回答后继续使用。'};
}
export const isExplicitNewTask=message=>/^(?:新任务|换个(?:任务|话题|主题|问题)?|另一个(?:任务|话题|问题)?|(?:取消|不用继续|不要继续)(?:原任务|这个任务|当前任务|任务)?)(?:[，,。！!\s：:]|$)/.test(message.trim());
export function resolveClarification(session,message){
 const pending=session.pendingClarification;if(!pending)return message;delete session.pendingClarification;
 return isExplicitNewTask(message)?message:pending.request+'\n前轮提出的必要问题：'+pending.question+'\n用户本轮明确补充：'+message;
}
// A narrowly scoped fallback for explicitly requested clarification. It does
// not turn a normal answer's optional follow-up into an unfinished task.
export function shouldRetainQuestion(message,answer){
 return /(?:先|首先).{0,6}(?:确认|询问|问清).{0,10}(?:口径|需求|用途|版本)/s.test(message)&&typeof answer==='string'&&(/[？?]/.test(answer)||/请(?:确认|补充|说明)/.test(answer));
}
