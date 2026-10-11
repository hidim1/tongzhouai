import { createHash } from 'node:crypto';
import { procurementSubtotal } from './preview-core.mjs';
import {estimateParameters,requirementNames} from './preview-estimate.mjs';
export const extraCategories=['制造与装配','设计与验证','运输与安装','其他费用'];
export function directionInput(body){
 const p=body.parameters||body;
 if(p.requirements!==undefined||!['pharma','food','chemical','water','battery'].includes(p.industry)){
  const normalized=estimateParameters(p);
  if(!['low','mid','high'].includes(body.tier))throw new Error('请选择方案档次');
  if(body.targetCost!==undefined&&body.targetCost!==null&&(!Number.isFinite(body.targetCost)||body.targetCost<=0))throw new Error('目标成本必须为正数');
  return normalized;
 }
 if(!['pharma','food','chemical','water','battery'].includes(p.industry))throw new Error('请选择有效行业');
 if(!Array.isArray(p.routes)||!p.routes.length||p.routes.some(r=>!['uf','nf','ro','hollow','ceramic','ed','ion_exchange'].includes(r))||new Set(p.routes).size!==p.routes.length)throw new Error('请选择有效技术路线');
 if(!Number.isFinite(p.capacity)||p.capacity<=0||p.capacity>10000)throw new Error('处理量必须在0至10000之间');
 if(!['standard','sanitary','gmp'].includes(p.compliance)||typeof p.explosion_proof!=='boolean')throw new Error('合规或防爆要求无效');
 if(!['low','mid','high'].includes(body.tier))throw new Error('请选择方案档次');
 if(body.targetCost!==undefined&&body.targetCost!==null&&(!Number.isFinite(body.targetCost)||body.targetCost<=0))throw new Error('目标成本必须为正数');
 return {industry:p.industry,routes:[...p.routes],capacity:p.capacity,compliance:p.compliance,explosion_proof:p.explosion_proof,explosion_class:p.explosion_proof?'pending':''};
}
export function directionContext(d){
 if(!d)return '旧版本未记录初步方案方向；不得补造初始估算。';
 return JSON.stringify({id:d.id,industry:d.estimate.industry_name,routes:d.estimate.route_names,capacity:d.parameters.capacity,compliance:d.parameters.compliance,qualityRequirements:requirementNames(d.parameters),customerRequirements:d.parameters.requirementNotes||'',purpose:d.parameters.purpose||'',explosionProof:d.parameters.explosion_proof,tier:d.option.name||d.tier,configurationIntent:d.option.configuration||d.option.description||'配置要求待细化',targetCost:d.targetCost,estimateCost:d.option.total_cost,costRange:d.option.cost_low==null?null:[d.option.cost_low,d.option.cost_high],estimateKind:d.estimate.kind||'legacy-rules',costBasis:d.option.lines?.map(l=>({category:l.category,configuration:l.configuration,source:l.source,basis:l.basis,quantityBasis:l.quantityBasis}))||[],pending:d.option.missing||[],note:'这是初步选型与档次约束，不是招标事实。上传资料中的明确要求优先，若冲突须指出并列为待确认；不得为符合成本而忽略技术要求，也不得把粗估组件数量直接当作新清单数量。'});
}
export const filesSnapshot=files=>files.map(f=>({id:f.id,name:f.name,hash:createHash('sha256').update(JSON.stringify([f.text||'',f.size,f.status,f.preview||''])).digest('hex')}));
export function updateBudget(version,body){
 if(!Array.isArray(body.lines)||!Array.isArray(body.extras))throw new Error('预算明细无效');
 const seen=new Set();
 const lines=body.lines.map(l=>{
  if(!version.rows.some(r=>r.id===l.rowId&&r.action!=='删除')||seen.has(l.rowId))throw new Error('预算行不存在或重复');seen.add(l.rowId);
  return {...validatedEntry(l),rowId:l.rowId};
 });
 const categories=new Set();
 const extras=body.extras.map(e=>{
  if(!extraCategories.includes(e.category)||categories.has(e.category))throw new Error('费用分类无效或重复');categories.add(e.category);
  return {...validatedEntry(e,true),category:e.category};
 });
 return {lines,extras,updatedAt:new Date().toISOString()};
}
function validatedEntry(e,extra=false){
 const value=extra?e.amount:e.unitPrice;
 if(value!==null&&(!Number.isFinite(value)||value<0||value>1e12))throw new Error('金额必须为非负数或待确认');
 if(typeof e.source!=='string'||e.source.length>1200||typeof e.reviewed!=='boolean')throw new Error('请填写有效核对依据');
 if(e.reviewed&&(value===null||!e.source.trim()))throw new Error('确认金额前需填写金额和依据；不发生的费用也需说明为零的原因');
 return {[extra?'amount':'unitPrice']:value,source:e.source.trim(),reviewed:e.reviewed};
}
export function detailedBudget(v,book,today){
 const procurement=procurementSubtotal(v.rows,book,today),byId=new Map(procurement.details.map(x=>[x.id,x]));
 const stored=v.budget||{lines:[],extras:[]};
 const lines=v.rows.filter(r=>r.action!=='删除').map(r=>{
  const auto=byId.get(r.id),manual=stored.lines.find(l=>l.rowId===r.id);
  const parent=auto?.explanation==='父级组件，避免与子件重复计价';
  const known=!parent&&r.reviewed&&r.action!=='待确认'&&r.quantity>0;
  const manualReady=manual?.reviewed&&manual.unitPrice!==null&&!!manual.source;
  const price=known?(manualReady?manual.unitPrice:auto?.price??null):null;
  return {rowId:r.id,name:r.name,spec:r.spec,unit:r.unit,quantity:r.quantity,parent,unitPrice:price,amount:price===null?null:Math.round(price*r.quantity*100)/100,source:manualReady?manual.source:auto?.price!==null&&auto?.price!==undefined?`${auto.supplier} · 有效已审核采购价`:'待询价或补充成本依据',confirmed:price!==null,note:parent?'父级不重复计价':!r.reviewed?'清单尚未核对':r.quantity===null?'数量待确认':price===null?'价格待核对':'已核对'};
 });
 const extras=extraCategories.map(category=>{const e=stored.extras.find(e=>e.category===category);return{category,amount:e?.reviewed?e.amount:null,source:e?.source||'',reviewed:!!e?.reviewed};});
 const leaf=lines.filter(l=>!l.parent),known=leaf.filter(l=>l.amount!==null),knownExtras=extras.filter(e=>e.amount!==null);
 const confirmedSubtotal=Math.round((known.reduce((n,l)=>n+l.amount,0)+knownExtras.reduce((n,e)=>n+e.amount,0))*100)/100;
 const complete=!!leaf.length&&known.length===leaf.length&&extras.every(e=>e.reviewed&&e.amount!==null)&&v.rows.every(r=>r.reviewed)&&v.status==='reviewed';
 const target=v.direction?.targetCost??null;
 const delta=target===null||!(known.length||knownExtras.length)?null:Math.round((confirmedSubtotal-target)*100)/100;
 return {lines,extras,confirmedSubtotal:known.length||knownExtras.length?confirmedSubtotal:null,total:complete?confirmedSubtotal:null,complete,pendingLines:leaf.length-known.length,pendingExtras:extras.length-knownExtras.length,target,delta,overTarget:delta!==null&&delta>0,scope:'仅汇总本方案已核对的金额；制造/装配等费用只能填入清单未计入部分，已包含费用填0并说明依据。缺项时不作为项目总预算或正式报价。',revision:v.revision||0};
}
export function invalidateBudget(v,row){
 const line=v.budget?.lines.find(l=>l.rowId===row.id);if(line){line.reviewed=false;line.unitPrice=null;}
}
export function versionChanged(v){v.revision=(v.revision||0)+1;v.updatedAt=new Date().toISOString();}
