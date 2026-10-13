import {Decimal} from './assistant-decimal.mjs';
// Bounded numeric expression parser, deliberately no eval, code or property access.
export function calculate(expression){
 if(typeof expression!=='string'||expression.length>2000||!expression.trim())throw Error('计算表达式无效');
 const tokens=expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[A-Za-z]+|[+\-*/^(),]/gi)||[];
 if(tokens.join('').toLowerCase()!==expression.replace(/\s+/g,'').toLowerCase()||tokens.length>500)throw Error('只支持数字、四则运算、幂和常用数学函数');
 let i=0,depth=0;
 function primary(){if(++depth>30)throw Error('表达式嵌套过深');let value,t=tokens[i++];
  if(t==='+'||t==='-'){value=expr(3);if(t==='-')value=value.neg();}
  else if(t==='('){value=expr(0);if(tokens[i++]!==')')throw Error('计算括号不匹配');}
  else if(/^[\d.]/.test(t||''))value=Decimal.from(t);
  else if(/^[a-z]+$/i.test(t||'')){if(tokens[i++]!=='(')throw Error('函数参数缺失');const args=[];if(tokens[i]!==')'){do{args.push(expr(0));}while(tokens[i]===','&&++i);}if(tokens[i++]!==')')throw Error('函数括号不匹配');const sum=a=>a.reduce((s,v)=>s.add(v),Decimal.from(0)),funcs={SUM:sum,MIN:a=>a.reduce((s,v)=>s.compare(v)<=0?s:v),MAX:a=>a.reduce((s,v)=>s.compare(v)>=0?s:v),AVG:a=>sum(a).div(a.length),ABS:a=>{if(a.length!==1)throw Error('ABS参数无效');return a[0].abs();},ROUND:a=>{const p=a[1]||Decimal.from(0);if(a.length>2||p.d!==1n||p.abs().compare(12)>0)throw Error('ROUND参数无效');return a[0].round(Number(p.n));}};if(!funcs[t.toUpperCase()]||!args.length)throw Error('不支持该计算函数');value=funcs[t.toUpperCase()](args);}
  else throw Error('计算项无效');depth--;return value;
 }
 function expr(min){let value=primary();const precedence={'+':1,'-':1,'*':2,'/':2,'^':3};while(precedence[tokens[i]]>=min){const op=tokens[i++],right=expr(precedence[op]+(op==='^'?0:1));value=op==='+'?value.add(right):op==='-'?value.sub(right):op==='*'?value.mul(right):op==='/'?value.div(right):value.pow(right);}return value;}
 const value=expr(0);if(i!==tokens.length)throw Error('计算表达式含未处理内容');return {expression,...value.result()};
}
