// Explicit-key comparison over complete parsed sheets; no implicit first-match joins.
const numeric=value=>value!==null&&value!==undefined&&value!==''&&typeof value!=='boolean'&&/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(value).trim())&&Number.isFinite(Number(value));
function index(sheet,keyColumn,valueColumn,startRow,endRow){
 if(!/^[A-Z]{1,3}$/.test(keyColumn)||!/^[A-Z]{1,3}$/.test(valueColumn)||!Number.isSafeInteger(startRow)||startRow<1||!Number.isSafeInteger(endRow)||endRow!==0&&endRow<startRow)throw Error('对比列或数据行范围无效');const groups=new Map();let missingKeys=0,records=0;
 for(const row of sheet.rows){const entries=Object.entries(row),rowNumber=Number(entries[0]?.[0].match(/\d+$/)?.[0]);if(!rowNumber||rowNumber<startRow||endRow&&rowNumber>endRow)continue;records++;const get=col=>entries.find(([a])=>a.replace(/\d+$/,'')===col)?.[1],raw=get(keyColumn);
  if(raw===null||raw===undefined||String(raw).trim()===''){missingKeys++;continue;}const key=String(raw).trim(),items=groups.get(key)||[];items.push({row:rowNumber,value:get(valueColumn)??null});groups.set(key,items);
 }return {groups,missingKeys,records};
}
export function compareTables(left,right,{leftKeyColumn,rightKeyColumn,leftValueColumn,rightValueColumn,leftStartRow=2,rightStartRow=2,leftEndRow=0,rightEndRow=0,offset=0,limit=100}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('对比分页无效');const a=index(left,leftKeyColumn,leftValueColumn,leftStartRow,leftEndRow),b=index(right,rightKeyColumn,rightValueColumn,rightStartRow,rightEndRow),results=[],counts={matched:0,leftOnly:0,rightOnly:0,duplicate:0,nonNumeric:0};let leftTotal=0,rightTotal=0;
 for(const key of new Set([...a.groups.keys(),...b.groups.keys()])){
  const l=a.groups.get(key)||[],r=b.groups.get(key)||[];let status,difference=null;
  if(l.length>1||r.length>1){status='duplicate';counts.duplicate++;}
  else if(!l.length){status='rightOnly';counts.rightOnly++;}
  else if(!r.length){status='leftOnly';counts.leftOnly++;}
  else if(!numeric(l[0].value)||!numeric(r[0].value)){status='nonNumeric';counts.nonNumeric++;}
  else{status='matched';counts.matched++;leftTotal+=Number(l[0].value);rightTotal+=Number(r[0].value);difference=Number(r[0].value)-Number(l[0].value);}
  results.push({key,status,left:l,right:r,difference});
 }
 return {leftSheet:left.name,rightSheet:right.name,leftStartRow,rightStartRow,leftEndRow,rightEndRow,leftRecords:a.records,rightRecords:b.records,leftMissingKeys:a.missingKeys,rightMissingKeys:b.missingKeys,totalKeys:results.length,counts,comparableTotals:{left:leftTotal,right:rightTotal,difference:rightTotal-leftTotal},items:results.slice(offset,offset+limit),nextOffset:offset+limit<results.length?offset+limit:null,note:'按去掉首尾空格后的文本键精确匹配，前导零保留。重复键不自动取第一条或相加；缺失、非数值与真实零不同。合计只涵盖指定行范围内两侧唯一匹配且均为数值的记录，不能当作整张表总额；需明确排除小计与合计行，不能双重计数。'};
}
