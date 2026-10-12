export const validColor=c=>/^#[0-9a-f]{6}$/i.test(c||'');
export function canvasProblems(plan){
 const issues=[],assetIds=new Set((plan.assets||[]).map(a=>a.id));
 const references=plan.slides.flatMap(s=>s.elements||[]).filter(e=>e.kind==='image').map(e=>e.assetId);
 for(const a of plan.assets||[])if(!references.includes(a.id))issues.push('存在没有使用的配图，禁止多余生图');
 for(const [i,s] of plan.slides.entries()){
  const prefix=`第${i+1}页`;
  if(!s.title?.trim()||!validColor(s.background)||!Array.isArray(s.elements)||!s.elements.length||s.elements.length>32){issues.push(prefix+'缺少有效构图');continue;}
  const ids=new Set();for(const e of s.elements){
   if(!e.id||ids.has(e.id))issues.push(prefix+'元素标识重复');ids.add(e.id);
   if(![e.x,e.y,e.width,e.height].every(Number.isFinite)||e.x<0||e.y<0||e.width<=0||e.height<=0||e.x+e.width>1280||e.y+e.height>720)issues.push(prefix+'元素越出画布');
   if(e.kind==='text'&&(!e.text?.trim()||!validColor(e.color)||!Number.isFinite(e.fontSize)||e.fontSize<20||e.fontSize>100||e.height<e.fontSize||/\*\*/.test(e.text)))issues.push(prefix+'文字样式无效或仍含排版标记');
   if(e.kind==='image'&&!assetIds.has(e.assetId))issues.push(prefix+'配图没有有效素材');
   if(e.kind==='table'&&(!e.headers?.length||e.headers.length>6||!e.rows?.length||e.rows.length>8||e.rows.some(r=>r.length!==e.headers.length)||e.columnWeights.length!==e.headers.length||e.columnWeights.some(w=>!Number.isFinite(w)||w<=0)||e.fontSize<20))issues.push(prefix+'表格无效或过密');
   if(e.kind==='chart'&&(!e.categories?.length||e.categories.length>10||!e.series?.length||e.series.length>3||e.series.some(r=>r.values.length!==e.categories.length||r.values.some(v=>!Number.isFinite(v)))))issues.push(prefix+'图表数据无效');
   if(!['text','table','chart','image'].includes(e.kind))issues.push(prefix+'不支持的元素');
  }
  if(!s.elements.some(e=>e.kind==='text'&&e.role==='title'&&e.text===s.title))issues.push(prefix+'缺少原生标题');
  const content=s.elements.filter(e=>!(e.kind==='image'&&e.layer==='background'));
  for(let a=0;a<content.length;a++)for(let b=a+1;b<content.length;b++){
   const p=content[a],q=content[b],x=Math.min(p.x+p.width,q.x+q.width)-Math.max(p.x,q.x),y=Math.min(p.y+p.height,q.y+q.height)-Math.max(p.y,q.y);
   if(x>2&&y>2)issues.push(prefix+'正文元素重叠');
  }
 }
 return [...new Set(issues)];
}
export function presentationFacts(plan){
 return JSON.stringify({assets:plan.assets,slides:plan.slides.map(s=>({title:s.title,notes:s.notes,elements:s.elements.map(e=>({id:e.id,kind:e.kind,...(e.kind==='text'?{text:e.text,role:e.role}:e.kind==='image'?{assetId:e.assetId}:e.kind==='table'?{headers:e.headers,rows:e.rows}:{chartType:e.chartType,categories:e.categories,series:e.series,unit:e.unit})})).sort((a,b)=>a.id.localeCompare(b.id))}))});
}
