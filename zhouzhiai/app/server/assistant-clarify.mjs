import {assertPublicOutput} from './member-policy.mjs';
export function requestClarification(job,{question,options=[]}){
 if(typeof question!=='string'||!question.trim()||question.length>600||!Array.isArray(options)||options.length>4||options.some(v=>typeof v!=='string'||!v.trim()||v.length>100))throw Error('补充问题无效');
 if(job.files?.length)throw Error('本轮已生成部分成果，请先说明已完成范围，再就未完成部分提问');
 assertPublicOutput({question,options});const text=question.trim()+(options.length?'\n\n'+options.map((v,i)=>(i+1)+'. '+v).join('\n'):'');
 (job.checkpoint??={}).clarification={question:text,createdAt:new Date().toISOString()};return{needsUserInput:true,question:text,instruction:'本轮暂停文件制作，直接把这个必要问题自然交给用户，不猜测选项，不继续制作文件。'};
}
export function resolveClarification(session,message){
 const pending=session.pendingClarification;if(!pending)return message;delete session.pendingClarification;
 const newTask=/^(?:取消|不用继续|不要继续|换个|另一个|新任务)/.test(message)||message.length>500||/^(?:请)?(?:生成|制作|写一|帮我(?:整理|分析|查)|查一|介绍一下|分析一下)/.test(message);
 return newTask?message:pending.request+'\n前轮提出的必要问题：'+pending.question+'\n用户本轮明确补充：'+message;
}
