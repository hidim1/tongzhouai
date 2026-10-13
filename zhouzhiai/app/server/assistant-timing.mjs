// Private diagnostics in the existing hidden checkpoint; never in public DTOs.
export async function measureStage(job,stage,work,save=()=>{}){
 const cp=job.checkpoint??={version:1,stage:'analysis'},timings=cp.timings??=[];
 const entry={stage,startedAt:new Date().toISOString(),status:'running'},start=performance.now();
 timings.push(entry);if(timings.length>200)timings.splice(0,timings.length-200);save();
 try{const value=await work();entry.status='completed';return value;}
 catch(error){entry.status='failed';throw error;}
 finally{entry.durationMs=Math.round(performance.now()-start);entry.completedAt=new Date().toISOString();save();}
}
