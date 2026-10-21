import {assertPublicOutput} from './member-policy.mjs';
import {instructionText} from './assistant-task-contract.mjs';
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
 if(typeof message!=='string'||typeof answer!=='string'||!answer.trim()||answer.length>600)return false;
 // Only a direct user request may establish this fallback. Quoted/source
 // instructions and requests to explain or translate them are not authority.
 const directText=value=>instructionText(value).replace(/‘[^’]*’|'[^'\n]*'/g,' ');
 const request=directText(message).split(/[。；;\n]/).filter(part=>
  !/(?:附件|文件|网页|文档|材料|原文|引用)(?:中|里|内|上)?(?:的)?(?:内容|写着|要求|指令|说|提到)\s*[:：]?/.test(part)
  &&!/^\s*(?:请)?(?:翻译|解释|改写|润色|引用|举例|讨论)(?:下面|以下|这段|这句|这条|一句|一段|文字|内容|指令|话|要求|的|\s)*[:：]/.test(part)).join('。');
 if(/(?:无需|不用|不必|不要|不需要|别)\s*(?:再|先)?\s*(?:确认|询问|问清|问我|追问)/.test(request))return false;
 const explicit=/(?:先|首先)\s*(?:请)?\s*(?:问我|问一下我|询问我)/.test(request)
  ||/(?:先|首先).{0,6}(?:确认|询问|问清).{0,24}(?:口径|需求|用途|版本|收件人|收件团队|接收人|接收团队|受众|发给|给谁)/.test(request)
  ||/(?:确认.{0,16}(?:后|以后)|(?:收到|等|等待).{0,14}(?:回答|答复|确认).{0,6}(?:后|以后)?).{0,8}(?:再|才)(?:制作|生成|整理|开始|执行|处理)/.test(request);
 if(!explicit)return false;
 const response=directText(answer).trim();
 // An optional follow-up appended to a completed answer is not a checkpoint.
 if(/(?:已经|已)\s*(?:生成|制作|交付|导出|保存|整理好|完成任务)|(?:文件|通知|文档)\s*(?:已经|已)(?:完成|生成|制作)/.test(response))return false;
 const sentences=response.split(/[。！!\n]/).map(s=>s.trim()).filter(Boolean);
 return sentences.some(sentence=>{
  if(/(?:如果|如有|若|还需要|还要|还想|是否还|需要我再|需要我继续|要不要)/.test(sentence))return false;
  if(/(?:示例|例如|比如|引用|原文|问题是)\s*[:：]/.test(sentence))return false;
  return /^(?:(?:制作|生成|开始|继续)(?:前|之前)[，,：:]?\s*)?(?:(?:请|麻烦)(?:您|你)?\s*(?:先)?\s*(?:确认|补充|说明|告诉我|选择)|(?:需要|还需)(?:您|你)\s*(?:先)?\s*(?:确认|补充|说明))/.test(sentence)
   ||(/[？?]/.test(sentence)&&/(?:哪个|哪一|哪种|什么用途|什么口径|发给谁|给谁|收件人|收件团队|受众|是否|还是)/.test(sentence));
 });
}
