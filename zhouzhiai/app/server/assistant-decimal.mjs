// Exact bounded rational arithmetic; no binary floating point during calculation.
const MAX_DIGITS=4096;
const abs=n=>n<0n?-n:n;
const gcd=(a,b)=>{a=abs(a);b=abs(b);while(b)[a,b]=[b,a%b];return a;};
function bounded(n){if(abs(n).toString().length>MAX_DIGITS)throw Error('数值计算范围过大，请拆分计算');return n;}
export class Decimal {
 constructor(n,d=1n){if(!d)throw Error('除数不能为零');bounded(n);bounded(d);if(d<0n){n=-n;d=-d;}const g=gcd(n,d);this.n=n/g;this.d=d/g;}
 static from(value){
  if(value instanceof Decimal)return value;
  const s=String(value).trim(),m=s.match(/^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i);
  if(!m||s.length>2000)throw Error('数值无效');const exponent=Number(m[3]||0);if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>1000)throw Error('数值指数范围过大');
  const [whole,fraction='']=m[2].split('.'),scale=fraction.length-exponent,n=BigInt((whole||'0')+fraction)*(m[1]==='-'?-1n:1n);
  return scale>=0?new Decimal(n,10n**BigInt(scale)):new Decimal(n*10n**BigInt(-scale));
 }
 add(v){v=Decimal.from(v);return new Decimal(this.n*v.d+v.n*this.d,this.d*v.d);}
 sub(v){v=Decimal.from(v);return new Decimal(this.n*v.d-v.n*this.d,this.d*v.d);}
 mul(v){v=Decimal.from(v);return new Decimal(this.n*v.n,this.d*v.d);}
 div(v){v=Decimal.from(v);return new Decimal(this.n*v.d,this.d*v.n);}
 neg(){return new Decimal(-this.n,this.d);}
 abs(){return new Decimal(abs(this.n),this.d);}
 compare(v){v=Decimal.from(v);const diff=this.n*v.d-v.n*this.d;return diff<0n?-1:diff>0n?1:0;}
 pow(v){v=Decimal.from(v);if(v.d!==1n||abs(v.n)>1000n)throw Error('幂计算仅支持绝对值不超过1000的整数指数');const power=abs(v.n);if(BigInt(Math.max(abs(this.n).toString().length,this.d.toString().length))*power>BigInt(MAX_DIGITS))throw Error('幂计算范围过大');return v.n<0n?new Decimal(this.d**power,this.n**power):new Decimal(this.n**power,this.d**power);}
 round(places=0){
  if(!Number.isInteger(places)||Math.abs(places)>MAX_DIGITS)throw Error('舍入位数无效');
  const factor=10n**BigInt(Math.abs(places)),n=abs(this.n)*(places>=0?factor:1n),d=this.d*(places<0?factor:1n);
  // Half away from zero, symmetric for negative amounts.
  const rounded=(n/d+(n%d*2n>=d?1n:0n))*(this.n<0n?-1n:1n);
  return places>=0?new Decimal(rounded,factor):new Decimal(rounded*factor);
 }
 result(){
  let d=this.d,twos=0,fives=0;while(d%2n===0n){d/=2n;twos++;}while(d%5n===0n){d/=5n;fives++;}
  const exact=d===1n,places=exact?Math.max(twos,fives):Math.max(34,this.d.toString().length-abs(this.n).toString().length+34);
  if(places>MAX_DIGITS)throw Error('数值显示范围过大');const factor=10n**BigInt(places),rounded=this.round(places),scaled=rounded.n*factor/rounded.d;
  const digits=abs(scaled).toString().padStart(places+1,'0');let decimal=places?digits.slice(0,-places)+'.'+digits.slice(-places):digits;
  if(places)decimal=decimal.replace(/0+$/,'').replace(/\.$/,'');if(scaled<0n)decimal='-'+decimal;
  const value=Number(decimal);if(!Number.isFinite(value)||value===0&&this.n!==0n)throw Error('数值超过可交付范围');
  return {value,decimal,exact,...(!exact?{ratio:this.n+'/'+this.d}:{}),rounding:'half-away-from-zero'};
 }
}
