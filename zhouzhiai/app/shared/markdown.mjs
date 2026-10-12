import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';

// Repair only literal text nodes with paired Chinese emphasis. Code, HTML,
// links/images and explicitly escaped stars remain literal; no HTML is injected.
export function chineseStrong(){return(tree,file)=>{
 const original=String(file.value||'');
 function walk(parent){
  if(['code','inlineCode','html','link','image','definition'].includes(parent.type)||!parent.children)return;
  parent.children=parent.children.flatMap(node=>{
   if(node.type!=='text'){walk(node);return[node];}
   const raw=original.slice(node.position?.start?.offset??0,node.position?.end?.offset??original.length);
   if(/\\\*/.test(raw))return[node];
   const value=node.value,out=[];let last=0;
   for(const match of value.matchAll(/(?<!\*)\*\*([^*\n]+)\*\*(?!\*)/gu)){
    const body=match[1].trim();if(!/[\u3400-\u9fff]/u.test(body)||!body)continue;
    if(match.index>last)out.push({type:'text',value:value.slice(last,match.index)});
    out.push({type:'strong',children:[{type:'text',value:body}]});last=match.index+match[0].length;
   }
   if(!out.length)return[node];if(last<value.length)out.push({type:'text',value:value.slice(last)});return out;
  });
 }
 walk(tree);
};}
const parser=unified().use(remarkParse).use(remarkGfm).use(chineseStrong).use(remarkStringify,{bullet:'-',fences:true});
export function parseMarkdown(value){const text=String(value||'');return parser.runSync(parser.parse(text),{value:text});}
export function formatMarkdown(value){
 const tree=parseMarkdown(value);
 function readable(parent){if(!parent.children)return;const out=[];for(const [i,n] of parent.children.entries()){
  readable(n);const last=n.children?.at(-1),next=parent.children[i+1];
  // Keep Chinese punctuation outside the bold span at a word boundary so the
  // Markdown source stays readable without serializer-generated Han entities.
  if(n.type==='strong'&&last?.type==='text'&&next?.type==='text'&&/^[\u3400-\u9fff]/u.test(next.value)){
   const punctuation=last.value.match(/[\p{P}]+$/u)?.[0];if(punctuation&&last.value.length>punctuation.length){last.value=last.value.slice(0,-punctuation.length);out.push(n,{type:'text',value:punctuation});continue;}
  }out.push(n);
 }parent.children=out;}
 readable(tree);return parser.stringify(tree);
}
export function nodeText(node){return typeof node?.value==='string'?node.value:(node?.children||[]).map(nodeText).join('');}
