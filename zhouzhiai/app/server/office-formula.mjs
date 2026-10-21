const functions=new Set(('SUM AVERAGE MIN MAX ROUND ROUNDUP ROUNDDOWN ABS IF IFS COUNT COUNTA COUNTBLANK SUMIF SUMIFS COUNTIF COUNTIFS AND OR NOT IFERROR IFNA DATE YEAR MONTH DAY TODAY NOW EDATE EOMONTH DAYS NETWORKDAYS WORKDAY SUMPRODUCT SUBTOTAL AGGREGATE VLOOKUP HLOOKUP XLOOKUP INDEX MATCH XMATCH CHOOSE LEFT RIGHT MID LEN TRIM CLEAN UPPER LOWER CONCAT CONCATENATE TEXTJOIN TEXT VALUE SUBSTITUTE REPLACE FIND SEARCH EXACT ISNUMBER ISTEXT ISBLANK ISERROR ISNA INT MOD CEILING FLOOR MEDIAN STDEV.S STDEV.P VAR.S VAR.P RANK.EQ LARGE SMALL').split(' '));
export function safeOfficeFormula(formula){
 if(typeof formula!=='string'||!formula.trim()||formula.length>4000||/[\[\]|;\\]|https?:|WEBSERVICE|DDE|RTD|HYPERLINK|INDIRECT|IMPORT|EXEC|CALL|REGISTER/i.test(formula))throw Error('不支持外部、网络或间接访问公式');
 const clean=formula.replace(/^=/,''),syntax=clean.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'/g,'');
 if(/["']/.test(syntax))throw Error('公式引号未闭合');
 for(const m of syntax.matchAll(/((?:_xlfn\.)?[A-Z_][A-Z0-9_.]*)\s*\(/gi))if(!functions.has(m[1].replace(/^_xlfn\./i,'').toUpperCase()))throw Error('此公式函数尚不能可靠核对');
 return clean;
}
