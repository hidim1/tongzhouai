import {Decimal} from './assistant-decimal.mjs';
// Deterministic cross-tabulation over the full explicitly selected row range.
// This creates a derived result, not an edit to a native Excel pivot cache.
export function pivotTable(sheet,{rowColumns,columnColumn='',valueColumn,startRow=2,endRow=0,operation='sum',offset=0,limit=100}){
 if(sheet.requiresConfirmation)throw Error('识别数据存在疑点，请先核对，不按未确认数字汇总');
 const column=v=>/^[A-Z]{1,3}$/.test(v);
 if(!Array.isArray(rowColumns)||!rowColumns.length||rowColumns.length>3||new Set(rowColumns).size!==rowColumns.length||rowColumns.some(c=>!column(c))||columnColumn&&!column(columnColumn)||!column(valueColumn)||!['sum','average','min','max','count'].includes(operation)||!Number.isSafeInteger(startRow)||startRow<1||!Number.isSafeInteger(endRow)||endRow<0||endRow&&endRow<startRow||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('交叉汇总字段或范围无效');
 if(sheet.rows.length>100000)throw Error('交叉汇总范围较大，请先缩小明确数据范围');
 const groups=new Map();let totalRecords=0,missing=0,nonNumeric=0;
 for(const row of sheet.rows){const entries=Object.entries(row),number=Number(entries[0]?.[0].match(/\d+$/)?.[0]);if(!number||number<startRow||endRow&&number>endRow)continue;totalRecords++;
  const get=c=>entries.find(([a])=>a.replace(/\d+$/,'')===c)?.[1],keyValues=rowColumns.map(c=>{const v=get(c);return v===null||v===undefined||v===''?null:String(v);}),columnValue=columnColumn?(get(columnColumn)??null):null;
  const key=JSON.stringify([keyValues,columnValue]),group=groups.get(key)||{rowKey:keyValues,columnKey:columnValue,records:0,numericCount:0,missing:0,nonNumeric:0,sum:Decimal.from(0),min:null,max:null};group.records++;
  const raw=get(valueColumn);if(raw===null||raw===undefined||raw===''){group.missing++;missing++;}
  else if(typeof raw==='boolean'||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(raw).trim())){group.nonNumeric++;nonNumeric++;}
  else {const value=Decimal.from(raw);group.numericCount++;group.sum=group.sum.add(value);group.min=group.min===null||value.compare(group.min)<0?value:group.min;group.max=group.max===null||value.compare(group.max)>0?value:group.max;}
  groups.set(key,group);if(groups.size>20000)throw Error('交叉分类过多，请先缩小字段范围');
 }
 const items=[...groups.values()].map(g=>{const decimal=operation==='count'?Decimal.from(g.numericCount):!g.numericCount?null:operation==='sum'?g.sum:operation==='average'?g.sum.div(g.numericCount):operation==='min'?g.min:g.max;const result=decimal?.result();return{rowKey:g.rowKey,columnKey:g.columnKey,records:g.records,numericCount:g.numericCount,missing:g.missing,nonNumeric:g.nonNumeric,value:result?.value??null,decimal:result?.decimal??null,exact:result?.exact??null,...(result?.ratio?{ratio:result.ratio}:{})};});
 return{sheet:sheet.name,rowColumns,columnColumn,valueColumn,startRow,endRow,operation,totalRecords,missing,nonNumeric,totalGroups:items.length,items:items.slice(offset,offset+limit),nextOffset:offset+limit<items.length?offset+limit:null,note:'交叉统计覆盖指定全量范围，保留前导零与缺值；空组金额是未知，不是零。count统计数值记录数，records为全部记录数。源透视表缓存和原件不修改；合计行、币种单位与重复可累计口径须先确认。'};
}
