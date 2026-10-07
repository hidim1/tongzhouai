import { CodexAdapter } from '../server/codex.mjs';
import { ROOT } from '../server/config.mjs';
const engine=new CodexAdapter();
let timeout;
try {
 await engine.connect();
 const {thread}=await engine.request('thread/start',{cwd:ROOT,sandbox:'read-only',approvalPolicy:'on-request',developerInstructions:'This is a cancellation smoke test. Do not use tools or access files.'});
 const completed=new Promise((resolve,reject)=>{
  timeout=setTimeout(()=>reject(new Error('No interruption event received')),20000);
  engine.on('event',event=>{if(event.method==='turn/completed'&&event.params.threadId===thread.id)resolve(event.params.turn);});
 });
 const {turn}=await engine.request('turn/start',{threadId:thread.id,effort:'medium',input:[{type:'text',text:'Generate a numbered list from 1 to 100. This request will be cancelled by the test.',text_elements:[]}]});
 await engine.interrupt(thread.id,turn.id);
 const result=await completed;
 if(result.status!=='interrupted')throw new Error('Expected interrupted, got '+result.status);
 console.log(JSON.stringify({passed:true,threadId:thread.id,turnId:turn.id,status:result.status}));
} finally { clearTimeout(timeout);engine.close(); }
