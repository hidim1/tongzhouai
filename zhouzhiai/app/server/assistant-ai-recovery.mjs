// A stalled finalization is different from a slow task. This deadline starts
// only after an empty/draft result, and is suspended while a tool is running.
export const AI_FINAL_WAIT_MS=90000;
export const AI_CLEANUP_WAIT_MS=5000;

export function aiFailure(code,message){return Object.assign(new Error(message),{code});}

export function finalizationWatchdog(onTimeout,{delayMs=AI_FINAL_WAIT_MS}={}){
 let timer,kind,stopped=false;const work=new Set();
 const clear=()=>{clearTimeout(timer);timer=undefined;};
 const arm=()=>{
  if(stopped||!kind||work.size||timer)return;
  timer=setTimeout(()=>{timer=undefined;if(!stopped&&!work.size)onTimeout(kind);},delayMs);
  timer.unref?.();
 };
 return{
  request(value){kind=value;arm();},
  startWork(token){if(stopped)return;work.add(token);clear();},
  endWork(token){work.delete(token);arm();},
  stop(){stopped=true;clear();work.clear();},
 };
}

// Interrupt is best-effort transport cleanup, not a second unbounded wait for
// the user. Late acknowledgements must not prevent failure/cancellation delivery.
export async function boundedInterrupt(interrupt){
 let timer;
 try{await Promise.race([interrupt(),new Promise(resolve=>{timer=setTimeout(resolve,AI_CLEANUP_WAIT_MS);timer.unref?.();})]);}
 catch{}
 finally{clearTimeout(timer);}
}
