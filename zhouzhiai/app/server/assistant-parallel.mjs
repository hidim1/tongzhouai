// Bounded independent reads/reviews, not delegated agents or unbounded fan-out.
export async function mapConcurrent(items,work,{concurrency=2,cancelled=()=>false}={}){
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>3)throw Error('处理并发范围无效');const results=new Array(items.length);let next=0,failure;
 const worker=async()=>{while(next<items.length&&!failure){if(cancelled()){failure=Error('已停止任务');break;}const index=next++;try{results[index]=await work(items[index],index);}catch(error){failure??=error;}}};
 await Promise.all(Array.from({length:Math.min(concurrency,items.length)},worker));if(failure)throw failure;return results;
}
