// Statistics over the complete parsed worksheet, without sampling or code execution.
import {Decimal} from './assistant-decimal.mjs';
export function tableStats(sheet,{valueColumn,groupColumn='',startRow=2,operation='sum',offset=0,limit=100}={}){
 if(sheet.requiresConfirmation)throw Error('识别表格存在疑点，请先人工核对数据，不自动按未确认数字汇总');
 if(!/^[A-Z]{1,3}$/.test(valueColumn)||groupColumn&&!/^[A-Z]{1,3}$/.test(groupColumn)||!Number.isSafeInteger(startRow)||startRow<1||!['sum','average','min','max','count'].includes(operation))throw Error('统计范围或方式无效');
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('统计分页无效');
 const groups=new Map();let totalRows=0,missing=0,nonNumeric=0;
 function add(group,value){const g=groups.get(group)||{group,numericCount:0,sum:Decimal.from(0),min:null,max:null};g.numericCount++;g.sum=g.sum.add(value);g.min=g.min===null||value.compare(g.min)<0?value:g.min;g.max=g.max===null||value.compare(g.max)>0?value:g.max;groups.set(group,g);}
 for(const row of sheet.rows){const entries=Object.entries(row),rowNumber=Number(entries[0]?.[0].match(/\d+$/)?.[0]);if(!rowNumber||rowNumber<startRow)continue;totalRows++;
  const get=column=>entries.find(([address])=>address.replace(/\d+$/,'')===column)?.[1],raw=get(valueColumn);if(raw===null||raw===undefined||raw===''){missing++;continue;}if(typeof raw==='boolean'||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(raw).trim())){nonNumeric++;continue;}const value=Number(raw);if(!Number.isFinite(value)){nonNumeric++;continue;}
  add(groupColumn?String(get(groupColumn)??'未填写分组'):'全部',Decimal.from(raw));
 }
 const all=[...groups.values()].map(g=>{const result=(operation==='sum'?g.sum:operation==='count'?Decimal.from(g.numericCount):operation==='min'?g.min:operation==='max'?g.max:g.sum.div(g.numericCount)).result();return{group:g.group,numericCount:g.numericCount,sum:g.sum.result().value,min:g.min.result().value,max:g.max.result().value,result:result.value,decimal:result.decimal,exact:result.exact,...(result.ratio?{ratio:result.ratio}:{}),sumDecimal:g.sum.result().decimal};});
 return {sheet:sheet.name,valueColumn,groupColumn,startRow,operation,totalRows,numericCount:all.reduce((n,g)=>n+g.numericCount,0),missing,nonNumeric,groups:all.slice(offset,offset+limit),totalGroups:all.length,nextOffset:offset+limit<all.length?offset+limit:null,note:'未提供或非数值的记录未当作零；统计仅对应指定工作表、列和起始行。'};
}
