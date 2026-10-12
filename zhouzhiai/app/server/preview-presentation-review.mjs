import {presentationFacts} from './preview-canvas.mjs';
import {presentationReviewSchema,canvasPresentationSchema} from './preview-design-schema.mjs';

export async function reviewPresentation(plan,previews,{askAI,id,cancelled=()=>false}={}){
 const revised=structuredClone(plan),problems=[];
 for(let offset=0;offset<previews.length;offset+=4){
  if(cancelled())throw Error('已停止任务');
  const indices=previews.slice(offset,offset+4).map((_,i)=>offset+i);
  const result=await askAI(id,`只核对以下真实渲染页面，不生成文件。按图片順序逐页看文字可读性、留白、视觉主线、图文关系、中文字体、重叠/裁切、表格宽度及图表单位。不能因为没有照片就要求生图，不追求装饰堆砌。若有明确排版问题，提供对应index的完整修正版slide，仅调整坐标、尺寸、字体大小和颜色；不改变任何原文、数字、表格、图表数据、notes、元素ID或素材，不新增事实，不删减内容。已经适合实际用途的页面不要修改。acceptable=true时repairs为空。若不可接受却无法保留内容修好，problems写明。\n本批全局0开始索引：${JSON.stringify(indices)}\n页面设计数据：${JSON.stringify(indices.map(index=>({index,slide:plan.slides[index]})))}\n全局颜色：${JSON.stringify(plan.design)}`,presentationReviewSchema,previews.slice(offset,offset+4),undefined,'low',{allowWebSearch:false,timeoutMs:0,completeOnFinal:true,deliveryInstructions:'只提交本轮排版检查结果，不回答其他问题，不重新检索。'});
  if(!result.acceptable){problems.push(...result.problems);if(!result.repairs.length)throw Error('PPT视觉检查未通过，请调整内容密度或构图后重试');}
  const seen=new Set();for(const repair of result.repairs){if(!indices.includes(repair.index)||seen.has(repair.index))throw Error('PPT视觉检查返回了越界或重复页面');seen.add(repair.index);revised.slides[repair.index]=repair.slide;}
 }
 if(presentationFacts(revised)!==presentationFacts(plan))throw Error('排版修正改变了原始内容，已停止交付');
 if(JSON.stringify(revised)!==JSON.stringify(plan)){const error=Error('PPT需要排版修正');error.revisedPresentation=revised;throw error;}
 if(problems.length)throw Error('PPT视觉检查未通过');
}
export async function repairPresentationLayout(plan,problem,{askAI,id,cancelled=()=>false}={}){
 if(cancelled())throw Error('已停止任务');
 const fixed=await askAI(id,`现有PPT未通过排版检查，保留完整原文、所有数据、素材、页数、notes和元素ID，只调整构图、坐标、尺寸、颜色和字号。不能缩小至不可读、改变表格/图表信息或新增配图。问题：${problem}\n原始设计：${JSON.stringify(plan)}`,canvasPresentationSchema,[],undefined,'low',{allowWebSearch:false,timeoutMs:0,completeOnFinal:true,deliveryInstructions:'仅修复排版，不生成文件，不重新联网或生图。'});
 if(presentationFacts(fixed)!==presentationFacts(plan))throw Error('排版修正改变了原始内容，已停止交付');return fixed;
}
