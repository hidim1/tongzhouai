import {Decimal} from './assistant-decimal.mjs';
const column=c=>/^[A-Z]{1,3}$/.test(c);
const number=v=>typeof v!=='boolean'&&v!==null&&v!==undefined&&String(v).trim()!==''&&/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(String(v).trim());
const cell=(row,c)=>Object.entries(row).find(([a])=>a.replace(/\d+$/,'')===c)?.[1];
function matches(row,filters){return filters.every(f=>{
 if(!column(f.column)||!['eq','ne','contains','gte','lte','gt','lt'].includes(f.op)||typeof f.value!=='string')throw Error('筛选条件无效');
 const v=cell(row,f.column);if(['eq','ne','contains'].includes(f.op)){const actual=String(v??'').trim();return f.op==='eq'?actual===f.value:f.op==='ne'?actual!==f.value:actual.includes(f.value);}
 if(!number(v)||!number(f.value))return false;const compare=Decimal.from(v).compare(f.value);return f.op==='gte'?compare>=0:f.op==='lte'?compare<=0:f.op==='gt'?compare>0:compare<0;
});}
// Exact composite joins across up to eight explicitly scoped sources. Never fuzzy join.
export function reconcileTables(sources,{duplicateMode='reject',offset=0,limit=100}={}){
 if(!Array.isArray(sources)||sources.length<2||sources.length>8||!['reject','sum'].includes(duplicateMode)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('多表关联范围无效');
 const labels=new Set(),allKeys=new Map(),summaries=[];let dimensions=null;
 const indexed=sources.map(source=>{
  const {sheet,label,keyColumns,valueColumn,startRow=2,endRow=0,filters=[],keyMappings=[],multiplier='1',unit='',currency=''}=source;
  if(sheet?.requiresConfirmation)throw Error('识别表格存在疑点，请先人工核对数据，不自动按未确认数字关联');
  if(!sheet?.rows||!label?.trim()||labels.has(label)||!keyColumns?.length||keyColumns.length>6||keyColumns.some(c=>!column(c))||new Set(keyColumns).size!==keyColumns.length||!column(valueColumn)||!Number.isSafeInteger(startRow)||startRow<1||!Number.isSafeInteger(endRow)||endRow!==0&&endRow<startRow||filters.length>10||keyMappings.length>100)throw Error('关联来源、列或行范围无效');
  labels.add(label);if(dimensions!==null&&dimensions!==keyColumns.length)throw Error('各表关联字段数量必须一致');dimensions=keyColumns.length;
  const factor=Decimal.from(multiplier);if(factor.compare(0)<=0)throw Error('换算系数必须为已明确的正数');
  const mappings=new Map();for(const m of keyMappings){if(!keyColumns.includes(m.column)||typeof m.from!=='string'||typeof m.to!=='string'||mappings.has(m.column+'\0'+m.from))throw Error('字段映射无效或重复');mappings.set(m.column+'\0'+m.from,m.to);}
  const groups=new Map(),summary={label,sheet:sheet.name,records:0,filtered:0,missingKeys:0,nonNumeric:0,duplicates:0,unit,currency,multiplier:factor.result().decimal};
  if(sheet.rows.length>100000)throw Error('工作表过大，请明确分批行范围');
  for(const row of sheet.rows){const rowNumber=Number(Object.keys(row)[0]?.match(/\d+$/)?.[0]);if(!rowNumber||rowNumber<startRow||endRow&&rowNumber>endRow)continue;
   if(!matches(row,filters)){summary.filtered++;continue;}summary.records++;
   const key=keyColumns.map(c=>{const v=String(cell(row,c)??'').trim();return mappings.get(c+'\0'+v)??v;});if(key.some(v=>!v)){summary.missingKeys++;continue;}
   const id=JSON.stringify(key),entry=groups.get(id)||{key,rows:[],sum:Decimal.from(0),unknown:0};entry.rows.push(rowNumber);
   const raw=cell(row,valueColumn);if(!number(raw)){entry.unknown++;summary.nonNumeric++;}else entry.sum=entry.sum.add(Decimal.from(raw).mul(factor));groups.set(id,entry);allKeys.set(id,key);
  }
  summary.duplicates=[...groups.values()].filter(g=>g.rows.length>1).length;summaries.push(summary);return{groups,summary};
 });
 const compatible=summaries.every(s=>s.unit===summaries[0].unit&&s.currency===summaries[0].currency),totals=indexed.map(()=>Decimal.from(0));let comparableCount=0;
 const results=[...allKeys].map(([id,key])=>{
  const values=indexed.map(({groups})=>{const g=groups.get(id);if(!g)return {status:'missing',rows:[],decimal:null};
   if(g.rows.length>1&&duplicateMode==='reject')return{status:'duplicate',rows:g.rows,decimal:null};
   if(g.unknown)return{status:'unknown',rows:g.rows,decimal:null,unknown:g.unknown};
   return{status:g.rows.length>1?'aggregated':'matched',rows:g.rows,decimal:g.sum.result().decimal};});
  const comparable=compatible&&values.every(v=>v.decimal!==null);if(comparable){comparableCount++;values.forEach((v,i)=>totals[i]=totals[i].add(v.decimal));}
  return{key,values:values.map((v,i)=>({...v,label:summaries[i].label})),comparable,differences:values.map((v,i)=>({label:summaries[i].label,decimal:compatible&&v.decimal!==null&&values[0].decimal!==null?Decimal.from(v.decimal).sub(values[0].decimal).result().decimal:null}))};
 });
 return{sources:summaries,duplicateMode,compatibleUnits:compatible,totalKeys:results.length,comparableCount,comparableTotals:totals.map((v,i)=>({label:summaries[i].label,decimal:compatible?v.result().decimal:null,difference:compatible?v.sub(totals[0]).result().decimal:null})),items:results.slice(offset,offset+limit),nextOffset:offset+limit<results.length?offset+limit:null,note:'按完整组合字段精确关联，仅明确映射可合并别名，不模糊猜测。汇总只含所有来源均有有效金额的键；单侧、未知和未确认重复不当零。sum仅用于已确认可累加的重复明细。单位/币种不同不比较；换算系数和目标单位须来自用户或真实依据，小计合计需明确排除。'};
}
