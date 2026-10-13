// Statistics over the complete parsed worksheet, without sampling or code execution.
export function tableStats(sheet,{valueColumn,groupColumn='',startRow=2,operation='sum',offset=0,limit=100}={}){
 if(!/^[A-Z]{1,3}$/.test(valueColumn)||groupColumn&&!/^[A-Z]{1,3}$/.test(groupColumn)||!Number.isSafeInteger(startRow)||startRow<1||!['sum','average','min','max','count'].includes(operation))throw Error('统计范围或方式无效');
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('统计分页无效');
 const groups=new Map();let totalRows=0,missing=0,nonNumeric=0;
 function add(group,value){const g=groups.get(group)||{group,numericCount:0,sum:0,min:null,max:null};g.numericCount++;g.sum+=value;g.min=g.min===null?value:Math.min(g.min,value);g.max=g.max===null?value:Math.max(g.max,value);groups.set(group,g);}
 for(const row of sheet.rows){const entries=Object.entries(row),rowNumber=Number(entries[0]?.[0].match(/\d+$/)?.[0]);if(!rowNumber||rowNumber<startRow)continue;totalRows++;
  const get=column=>entries.find(([address])=>address.replace(/\d+$/,'')===column)?.[1],raw=get(valueColumn);if(raw===null||raw===undefined||raw===''){missing++;continue;}if(typeof raw==='boolean'||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(raw).trim())){nonNumeric++;continue;}const value=Number(raw);if(!Number.isFinite(value)){nonNumeric++;continue;}
  add(groupColumn?String(get(groupColumn)??'未填写分组'):'全部',value);
 }
 const all=[...groups.values()].map(g=>({...g,result:operation==='sum'?g.sum:operation==='count'?g.numericCount:operation==='min'?g.min:operation==='max'?g.max:g.sum/g.numericCount}));
 return {sheet:sheet.name,valueColumn,groupColumn,startRow,operation,totalRows,numericCount:all.reduce((n,g)=>n+g.numericCount,0),missing,nonNumeric,groups:all.slice(offset,offset+limit),totalGroups:all.length,nextOffset:offset+limit<all.length?offset+limit:null,note:'未提供或非数值的记录未当作零；统计仅对应指定工作表、列和起始行。'};
}
