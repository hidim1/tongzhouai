import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.env.ZHOUZHI_MEMBRANE_DATA || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../membrane/data');
export const templates = JSON.parse(fs.readFileSync(path.join(root, 'history_templates.json')));
export const prices = JSON.parse(fs.readFileSync(path.join(root, 'procurement_price_book.json'))).prices;
export const actions = ['沿用', '调整', '替换', '新增', '删除', '待确认'];
export function candidates(ids) {
  return templates.filter(t => ids.includes(t.template_id)).map(t => ({id:t.template_id, name:t.project_name, routes:t.route_tags, rows:t.bom.rows.map((r,i) => ({index:i, ...r}))}));
}
export function templateCatalog(){
  const depth=r=>Number(String(r.level).match(/\d+$/)?.[0]||0);
  return templates.map(t=>{
    const rows=t.bom.rows,positive=rows.map(depth).filter(n=>n>0),topLevel=positive.length?Math.min(...positive):0;
    const modules=rows.flatMap((r,index)=>{
      if(depth(r)!==topLevel)return [];
      let end=index+1;while(end<rows.length&&depth(rows[end])>topLevel)end++;
      return [{id:t.template_id+':'+index,name:r.name,start:index,end:end-1,count:end-index}];
    });
    return {id:t.template_id,name:t.project_name,routes:t.route_tags,count:rows.length,modules};
  });
}
export function selectedModules(selection){
  const ids=selection?.templateIds,moduleIds=selection?.moduleIds;
  if(!Array.isArray(ids)||!ids.length||ids.length>3||new Set(ids).size!==ids.length)throw new Error('AI 历史匹配范围无效');
  if(!Array.isArray(moduleIds)||!moduleIds.length||moduleIds.length>12||new Set(moduleIds).size!==moduleIds.length)throw new Error('AI 组件模块范围无效');
  const catalog=templateCatalog(),allowed=catalog.filter(t=>ids.includes(t.id)).flatMap(t=>t.modules.map(m=>({...m,templateId:t.id})));
  const modules=moduleIds.map(id=>allowed.find(m=>m.id===id));
  if(modules.some(m=>!m)||ids.some(id=>!modules.some(m=>m.templateId===id)))throw new Error('AI 引用了历史目录中不存在或不属于匹配样机的模块');
  return candidates(ids).map(t=>({...t,rows:t.rows.filter(r=>modules.some(m=>m.templateId===t.id&&r.index>=m.start&&r.index<=m.end))}));
}
export function hydratePlan(plan,selected){
  for(const row of plan?.rows||[]){
    const source=selected.find(t=>t.id===row.templateId)?.rows.find(r=>r.index===row.rowIndex);
    if(!source)continue;
    if(!row.name)row.name=source.name;
    if(!row.unit)row.unit=source.unit||'';
    if(['沿用','调整','删除','待确认'].includes(row.action)){
      if(!row.spec)row.spec=source.specification||'';
      if(!row.material)row.material=source.material||'';
    }
  }
  return plan;
}
export function expandAssembly(plan,selected){
  if(!Array.isArray(plan?.groups)||!Array.isArray(plan?.additions))throw new Error('AI未返回可核验的组件决策');
  const rows=[];
  for(const group of plan.groups){
    if(!Array.isArray(group.rowIndices)||!group.rowIndices.length)throw new Error('AI组件决策组没有来源行号');
    if(group.rowIndices.length>1&&group.name)throw new Error('多条历史组件不能统一改成同一名称，请分别确认');
    const {rowIndices,...fields}=group;
    for(const index of rowIndices){
      if(!selected.find(t=>t.id===group.templateId)?.rows.some(r=>r.index===index))throw new Error('AI组件决策超出后台匹配范围');
      rows.push({...fields,rowIndex:index,fileIds:[...group.fileIds]});
    }
  }
  for(const row of plan.additions){if(row.templateId||row.rowIndex!==null||row.action!=='新增')throw new Error('新增组件不能伪造历史来源');rows.push(row);}
  const covered=new Set(rows.filter(r=>r.templateId).map(r=>`${r.templateId}:${r.rowIndex}`));
  const missing=selected.reduce((n,t)=>n+t.rows.filter(r=>!covered.has(`${t.id}:${r.index}`)).length,0);
  return hydratePlan({summary:plan.summary,rows,documents:plan.documents,questions:[...plan.questions,...(missing?[`本轮还有${missing}条候选历史记录未纳入决策范围，需确认是否与新项目相关；不得视为完整采购BOM。`]:[])]},selected);
}
export function validatePlan(plan, selected, fileIds) {
  if (!plan || !Array.isArray(plan.rows) || !Array.isArray(plan.documents) || !plan.rows.length) throw new Error('没有可核验的重组清单');
  if (plan.rows.length > 1200) throw new Error('清单过长，请分模块整理');
  const seen = new Set();
  for (const row of plan.rows) {
    if (!actions.includes(row.action) || !row.name || !row.reason) throw new Error('每项必须包含名称、重组动作和依据');
    if (row.quantity !== null && (!Number.isFinite(row.quantity) || row.quantity <= 0)) throw new Error('数量必须为正数或待确认');
    if (!Array.isArray(row.fileIds) || row.fileIds.some(id => !fileIds.includes(id))) throw new Error('清单引用了非本项目资料');
    if (row.templateId) {
      const t = selected.find(t => t.id === row.templateId);
      const source = t?.rows.find(r => r.index === row.rowIndex);
      if (!source) throw new Error('历史样机行号无效');
      const key = `${t.id}:${row.rowIndex}`;
      if (seen.has(key)) throw new Error('同一历史组件出现重复引用，请合并或明确独立位号');
      seen.add(key);
      row.historyName = t.name;
      row.original = source;
      // A changed specification must not silently retain an old item's material code/price.
      row.priceCode = ['沿用','调整'].includes(row.action) && source.specification === row.spec && source.material === row.material && source.name === row.name ? source.code : '';
      row.property = source.property;
      row.level = source.level;
      const depth = level => Number(String(level).match(/\d+$/)?.[0] || 0);
      const next = t.rows.find(r=>r.index===row.rowIndex+1);
      row.hasChildren = !!next && depth(next.level)>depth(source.level);
    } else {
      if (['沿用','调整','替换','删除'].includes(row.action)) throw new Error('沿用、调整、替换或删除必须指向历史组件');
      row.priceCode = '';
    }
    row.reviewed = false;
    row.id = `row-${plan.rows.indexOf(row)}`;
  }
  for (const d of plan.documents) if (!d.name || !d.reason) throw new Error('投标文件必须注明编制依据');
  return plan;
}
function dateValue(value) {
  if (!value) return null;
  if (typeof value === 'number' || /^\d{5}(\.\d+)?$/.test(String(value))) return new Date(Date.UTC(1899,11,30) + Number(value)*86400000).toISOString().slice(0,10);
  const s = String(value).replace(/\//g,'-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` : null;
}
export function procurementSubtotal(rows, book = prices, today = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})) {
  let subtotal = 0, matched = 0;
  const details = rows.filter(r => r.action !== '删除').map(r => {
    let explanation = '规格、数量或物料编码待确认';
    const sourceTemplate=templates.find(t=>t.template_id===r.templateId), nextSource=sourceTemplate?.bom.rows[r.rowIndex+1];
    const sourceDepth=level=>Number(String(level).match(/\d+$/)?.[0]||0);
    const hasChildren = r.hasChildren || (nextSource && sourceDepth(nextSource.level)>sourceDepth(r.level)) || (r.original && rows.some(x => x !== r && x.action !== '删除' && x.templateId === r.templateId && String(x.level).startsWith(String(r.level)+'.')));
    const valid = r.reviewed && !hasChildren && r.property === '外购' && r.priceCode && r.quantity > 0;
    const options = valid ? book.filter(p => String(p.material_code) === String(r.priceCode) && p.document_status === '已审核' && (p.currency === '人民币' || p.currency === 'CNY' || p.currency === 'RMB') && p.unit === r.unit && Number(p.tax_included_unit_price) > 0 && dateValue(p.effective_date) && dateValue(p.effective_date) <= today && (!p.expiry_date || (dateValue(p.expiry_date) && dateValue(p.expiry_date) >= today))) : [];
    options.sort((a,b) => dateValue(b.effective_date).localeCompare(dateValue(a.effective_date)) || Number(a.tax_included_unit_price)-Number(b.tax_included_unit_price));
    const price = options[0];
    if (price) { matched++; subtotal += Number(price.tax_included_unit_price)*r.quantity; explanation = '同编码、同单位、有效且已审核的最新含税采购价'; }
    else if (hasChildren) explanation = '父级组件，避免与子件重复计价';
    else if (!r.reviewed) explanation = '未人工核对，不进入采购金额';
    else if (r.property !== '外购') explanation = '自制/制造费用另行核算';
    else if (valid) explanation = '缺少有效的已审核采购价';
    return {id:r.id, price:price ? Number(price.tax_included_unit_price) : null, amount:price ? Math.round(Number(price.tax_included_unit_price)*r.quantity*100)/100 : null, supplier:price?.supplier || '', explanation};
  });
  return {subtotal:Math.round(subtotal*100)/100, matched, unmatched:details.length-matched, details, scope:'仅已核对且匹配有效价格的外购件小计；不含未确认物料、制造、装配、物流、税差及利润，不是项目总价或正式报价。'};
}
export function demoPlan(selected, fileIds=[]) {
  const t = selected[0];
  if (!t) throw new Error('请选择历史样机');
  const indices = t.rows.filter(r => r.name && r.property === '外购' && !/螺|垫|弯头|三通|管件/.test(r.name)).slice(0,5);
  const rows = indices.map((r,i) => ({name:r.name,spec:r.specification || '',material:r.material || '',unit:r.unit || '',quantity:i===1?null:Number(r.quantity)||null,action:i===0?'沿用':i===1?'调整':i===2?'替换':i===3?'删除':'待确认',templateId:t.id,rowIndex:r.index,fileIds:[],reason:i===0?'演示：选型经确认后可沿用；此处尚无真实需求证据':i===1?'演示：新处理量下需重新计算，不照搬历史数量':i===2?'演示：按新项目材质/品牌要求重新选型':i===3?'演示：新范围不包含此组件，保留删除记录':'演示：缺少图纸或设计依据，暂不确定',note:'交互样例，不是本项目工程结论'}));
  rows.push({name:'在线电导率检测模块',spec:'量程与接口待确认',material:'待确认',unit:'套',quantity:null,action:'新增',templateId:'',rowIndex:null,fileIds:[],reason:'演示：模拟新招标增加的检测功能；真实项目需文件证据',note:'不自动匹配历史价格'});
  return validatePlan({summary:'演示重组：从历史组件中选择、调整、替换与剔除，并补充新要求。没有调用模型，不是完整采购清单。',rows,documents:[{name:'新项目技术响应表',reason:'逐项响应本项目招标要求，不复制历史承诺',status:'待编制'},{name:'新供货范围与偏差说明',reason:'依据本轮重新组装的清单编制',status:'待编制'},{name:'计算书与图纸目录',reason:'缺少已核准的计算与图纸，须由设计确认',status:'待设计确认'}],questions:['请提供新项目招标文件、设计输入及图纸导出的装配清单','确认处理量、膜面积、材质、品牌和供货边界','原生3D文件仅归档，不声称已完成三维自动算量']},selected,fileIds);
}
