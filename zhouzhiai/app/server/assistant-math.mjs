// Small numeric expression parser, deliberately no eval, code or property access.
export function calculate(expression){
 if(typeof expression!=='string'||expression.length>2000||!expression.trim())throw Error('计算表达式无效');
 const tokens=expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[A-Za-z]+|[+\-*/^(),]/gi)||[];
 if(tokens.join('').toLowerCase()!==expression.replace(/\s+/g,'').toLowerCase()||tokens.length>500)throw Error('只支持数字、四则运算、幂和常用数学函数');
 let i=0,depth=0;const finite=v=>{if(!Number.isFinite(v))throw Error('计算结果无效，请检查除数或输入范围');return v;};
 function primary(){if(++depth>30)throw Error('表达式嵌套过深');let value,t=tokens[i++];
  if(t==='+'||t==='-')value=(t==='-'?-1:1)*expr(3);
  else if(t==='('){value=expr(0);if(tokens[i++]!==')')throw Error('计算括号不匹配');}
  else if(/^[\d.]/.test(t||''))value=Number(t);
  else if(/^[a-z]+$/i.test(t||'')){if(tokens[i++]!=='(')throw Error('函数参数缺失');const args=[];if(tokens[i]!==')'){do{args.push(expr(0));}while(tokens[i]===','&&++i);}if(tokens[i++]!==')')throw Error('函数括号不匹配');const funcs={SUM:a=>a.reduce((s,v)=>s+v,0),MIN:a=>Math.min(...a),MAX:a=>Math.max(...a),AVG:a=>a.reduce((s,v)=>s+v,0)/a.length,ABS:a=>a.length===1?Math.abs(a[0]):NaN,ROUND:a=>a.length<=2&&Number.isInteger(a[1]??0)&&Math.abs(a[1]??0)<=12?Math.round(a[0]*10**(a[1]??0))/10**(a[1]??0):NaN};if(!funcs[t.toUpperCase()]||!args.length)throw Error('不支持该计算函数');value=funcs[t.toUpperCase()](args);}
  else throw Error('计算项无效');depth--;return finite(value);
 }
 function expr(min){let value=primary();const precedence={'+':1,'-':1,'*':2,'/':2,'^':3};while(precedence[tokens[i]]>=min){const op=tokens[i++],right=expr(precedence[op]+(op==='^'?0:1));value=finite(op==='+'?value+right:op==='-'?value-right:op==='*'?value*right:op==='/'?value/right:value**right);}return value;}
 const value=expr(0);if(i!==tokens.length)throw Error('计算表达式含未处理内容');return {expression,value};
}
