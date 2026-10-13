import dns from 'node:dns/promises';import http from 'node:http';import https from 'node:https';import {isIP} from 'node:net';import {createHash} from 'node:crypto';import {load} from 'cheerio';
import {normalizeSources} from './preview-search.mjs';
export function publicAddress(address){
 if(isIP(address)===4){const p=address.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&(p[1]===168||p[1]===0&&(p[2]===0||p[2]===2)||p[1]===88&&p[2]===99)||p[0]===100&&p[1]>=64&&p[1]<=127||p[0]===198&&(p[1]===18||p[1]===19||p[1]===51&&p[2]===100)||p[0]===203&&p[1]===0&&p[2]===113);}
 if(isIP(address)===6){const a=address.toLowerCase();return /^2[0-9a-f]{3}:/.test(a)&&!/^2001:(?:db8|0|2|10|20):/.test(a);}
 return false;
}
export function sourceURL(value){const [source]=normalizeSources([{title:'原文',url:value}]);if(!source)throw Error('只能读取不含凭据的公开网页');const url=new URL(source.url);if(url.port&&!(url.protocol==='https:'&&url.port==='443'||url.protocol==='http:'&&url.port==='80'))throw Error('不读取非公开标准端口');return url;}
function requestPage(url,addresses,cancelled){return new Promise((resolve,reject)=>{
 if(cancelled())return reject(Error('已停止任务'));let done=false,bytes=0,chunks=[];const finish=(error,value)=>{if(done)return;done=true;clearInterval(poll);error?reject(error):resolve(value);};
 const request=(url.protocol==='https:'?https:http).get(url,{headers:{'User-Agent':'Zhouzhi/1.0 public-reference','Accept':'text/html,text/plain','Accept-Encoding':'identity'},lookup:(_host,opts,cb)=>opts?.all?cb(null,addresses):cb(null,addresses[0].address,addresses[0].family)},response=>{
  const redirect=response.headers.location;if([301,302,303,307,308].includes(response.statusCode)&&redirect){response.resume();finish(null,{redirect:new URL(redirect,url).href});return;}
  if(response.statusCode!==200||!/^(?:text\/html|text\/plain|application\/xhtml\+xml)/i.test(response.headers['content-type']||'')||response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'){response.resume();finish(Error('网页正文暂不可读取，请使用其他公开依据'));return;}
  response.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){request.destroy();finish(Error('网页正文过大，请换用简明原文'));}else chunks.push(chunk);});response.on('end',()=>finish(null,{html:Buffer.concat(chunks).toString('utf8')}));response.on('error',()=>finish(Error('网页读取未完成')));
 });
 const poll=setInterval(()=>{if(cancelled()){request.destroy();finish(Error('已停止任务'));}},250);request.setTimeout(20000,()=>{request.destroy();finish(Error('网页读取超时，请换用其他来源'));});request.on('error',()=>finish(Error('网页读取未完成')));
 });}
export async function readWebSource(value,{cancelled=()=>false,resolver=dns.lookup,request=requestPage}={}){
 let url=sourceURL(value);for(let redirects=0;redirects<=3;redirects++){
  if(cancelled())throw Error('已停止任务');const addresses=await resolver(url.hostname,{all:true,verbatim:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('不读取内网、本机或保留地址');
  const page=await request(url,addresses,cancelled);if(page.redirect){url=sourceURL(page.redirect);continue;}
  const $=load(page.html);$('script,style,noscript,iframe,form,svg,nav,footer').remove();const title=$('title').first().text().trim().slice(0,240),root=$('article,main').first().length?$('article,main').first():$('body');root.find('p,div,li,tr,h1,h2,h3,h4,br').each((_i,n)=>$(n).append('\n'));
  const body=root.text().replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n\n').trim(),headings=$('body h1').toArray().map(n=>$(n).text().replace(/\s+/g,' ').trim()).filter(t=>t&&!body.includes(t)).slice(0,8),text=[...new Set(headings),body].filter(Boolean).join('\n\n'),publishedAt=$('meta[property="article:published_time"],meta[name="date"]').first().attr('content')||$('time[datetime]').first().attr('datetime')||'';
  if(!text)throw Error('网页没有可读正文');if(text.length>120000)throw Error('网页正文超过单篇范围，请提供更精确的原文页面');
  const documentTitle=title||url.hostname;return{url:url.href,title:documentTitle,text,textVersion:3,publishedAt,retrievedAt:new Date().toISOString(),fingerprint:createHash('sha256').update(JSON.stringify({title:documentTitle,text,publishedAt})).digest('hex')};
 }throw Error('网页重定向过多');
}
const canonical=s=>sourceURL(s).href;
const normalize=s=>String(s).replace(/\s+/g,' ').trim();
export function registerClaims(checkpoint,claims){
 if(!Array.isArray(claims)||!claims.length||claims.length>30)throw Error('证据条目无效');const snapshots=checkpoint.webSources||{},items=checkpoint.researchClaims??=[];
 for(const c of claims){if(!/^[a-zA-Z0-9_-]{1,48}$/.test(c.id))throw Error('证据条目id须为1至48位英文、数字、下划线或连字符，不能填中文或空值');if(!c.claim?.trim()||c.claim.length>1200||!c.topic?.trim()||c.topic.length>160||!c.quote?.trim()||c.quote.length>2000)throw Error('证据的claim、topic和quote须有实质内容；引文只能使用已读原文');if(!c.urls?.length||c.urls.length>8)throw Error('证据的urls须有1至8个已读取的公开原文URL');if(!Number.isSafeInteger(c.maxAgeDays)||c.maxAgeDays<0||c.maxAgeDays>3650)throw Error('maxAgeDays须为0至3650的天数，无时效判断填0，不能填日期');
  const evidence=c.urls.map(u=>{const url=canonical(u),s=snapshots[url],bodyMatched=!!s&&normalize(s.text).includes(normalize(c.quote)),titleMatched=!!s?.title&&normalize(s.title)===normalize(c.quote),quoteMatched=bodyMatched||titleMatched,date=Date.parse(s?.publishedAt),age=Number.isFinite(date)?(Date.now()-date)/86400000:null;return{url,read:!!s,quoteMatched,quoteField:bodyMatched?'body':titleMatched?'document_title':null,publishedAt:s?.publishedAt||'',retrievedAt:s?.retrievedAt||'',fingerprint:s?.fingerprint||'',freshness:c.maxAgeDays===0?'not_required':age===null?'unknown':age< -1?'future_date':age>c.maxAgeDays?'old':'within_requested_window'};});
  const entry={...c,evidence,recordedAt:new Date().toISOString(),supportedExcerpt:evidence.some(e=>e.quoteMatched),note:'原文匹配仅证明引文确实存在，不自动证明该结论真实或最新；需核对主体、适用范围及相反证据。document_title仅证明整段引文等于实际网页标题元数据，不代表正文存在同样的标题或支持标题中的宣传结论。'};const index=items.findIndex(i=>i.id===c.id);if(index>=0)items[index]=entry;else{if(items.length>=100)throw Error('本任务证据条目过多，请整理重复条目');items.push(entry);}
 }return researchSummary(checkpoint);
}
export function researchSummary(checkpoint){const claims=checkpoint.researchClaims||[],topics=new Map();for(const c of claims){const prior=topics.get(c.topic)||new Set();if(c.value)prior.add(c.value);topics.set(c.topic,prior);}return{claims,possibleConflicts:[...topics].filter(([,v])=>v.size>1).map(([topic,v])=>({topic,values:[...v],needsReview:true})),note:'不同值是需要核查的潜在冲突，不能自动选一个当事实；正文综合表述必要限制，后台依据不默认附到对话。'};}
export function searchEvent(item){
 const action=item.action||{},type=action.type||'search';if(!['search','openPage','findInPage'].includes(type))return null;
 let url='';if(action.url){try{url=sourceURL(action.url).href;}catch{return null;}}
 return{id:String(item.id||'').slice(0,160),type,...(url?{url}:{}),completedAt:new Date().toISOString()};
}
