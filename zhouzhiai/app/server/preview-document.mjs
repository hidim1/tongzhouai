import fs from 'node:fs/promises';
import {Document,Packer,Paragraph,TextRun,HeadingLevel,Table,TableRow,TableCell,WidthType,AlignmentType,ExternalHyperlink} from 'docx';
import {parseMarkdown,nodeText,formatMarkdown} from '../shared/markdown.mjs';

const font='Microsoft YaHei';
export function documentTitle(title){return String(title||'').trim().replace(/\.(docx|xlsx|pptx|md)$/i,'');}
function runs(nodes,style={}){return(nodes||[]).flatMap(n=>{
 if(n.type==='html'||n.type==='image')return n.type==='image'&&n.alt?[new TextRun({...style,text:n.alt})]:[];
 if(n.type==='strong')return runs(n.children,{...style,bold:true});
 if(n.type==='emphasis')return runs(n.children,{...style,italics:true});
 if(n.type==='delete')return runs(n.children,{...style,strike:true});
 if(n.type==='link'){try{const u=new URL(n.url);if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password)return[new ExternalHyperlink({link:u.href,children:runs(n.children,{...style,style:'Hyperlink'})})];}catch{}return runs(n.children,style);}
 if(n.type==='break')return[new TextRun({...style,break:1})];
 if(n.type==='footnoteReference')return[new TextRun({...style,text:'['+(n.label||n.identifier)+']',superScript:true})];
 return[new TextRun({...style,text:nodeText(n),...(n.type==='inlineCode'?{font:'Consolas'}:{})})];
});}
export function documentChildren(title,body){
 title=documentTitle(title);
 const tree=parseMarkdown(body),children=[new Paragraph({text:title,heading:HeadingLevel.TITLE})];let listId=0;
 function blocks(nodes,level=0,list=null){for(const n of nodes||[]){
  if(n.type==='heading'){
   if(n.depth===1&&nodeText(n).trim()===title.trim())continue;
   children.push(new Paragraph({children:runs(n.children),heading:[HeadingLevel.HEADING_1,HeadingLevel.HEADING_2,HeadingLevel.HEADING_3][Math.min(2,n.depth-1)],keepNext:true}));
  }else if(n.type==='paragraph'||n.type==='blockquote'){
   if(n.type==='blockquote'){blocks(n.children,level,list);continue;}
   children.push(new Paragraph({children:runs(n.children),...(list?{numbering:{reference:list.ref,level:Math.min(level,2),instance:list.id}}:{}),spacing:{after:140,line:310},widowControl:true}));
  }else if(n.type==='list')blocks(n.children,list?level+1:level,{ref:n.ordered?'ordered':'bullets',id:++listId});
  else if(n.type==='listItem')blocks(n.children,level,list);
  else if(n.type==='table'){
   const rows=n.children.map(r=>r.children.map(nodeText)),count=rows[0]?.length||0;
   if(count>8)throw Error('Word表格列数过多，请拆分或改为Excel交付');
   const weights=Array.from({length:count},(_,i)=>Math.max(4,Math.min(30,...[Math.max(...rows.map(r=>[...r[i]].length))]))),total=weights.reduce((a,b)=>a+b,0),widths=weights.map(w=>Math.round(9360*w/total));
   const border={style:'single',size:4,color:'D9D9D9'};
   children.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:widths,borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},rows:n.children.map((r,i)=>new TableRow({tableHeader:i===0,children:r.children.map((cell,c)=>new TableCell({width:{size:widths[c],type:WidthType.DXA},margins:{top:120,bottom:120,left:150,right:150},verticalAlign:'center',shading:{fill:i===0?'E8EDF2':i%2?'FFFFFF':'F6F8FA'},children:[new Paragraph({children:runs(cell.children,{bold:i===0}),spacing:{after:0,line:290},alignment:n.align?.[c]==='right'?AlignmentType.RIGHT:n.align?.[c]==='center'?AlignmentType.CENTER:AlignmentType.LEFT})]}))}))}));children.push(new Paragraph({spacing:{after:100}}));
  }else if(n.type==='code')children.push(new Paragraph({children:[new TextRun({text:n.value,font:'Consolas',size:20})],spacing:{after:140},widowControl:true}));
  else if(n.type==='footnoteDefinition')children.push(new Paragraph({children:[new TextRun({text:'['+(n.label||n.identifier)+'] ',bold:true}),new TextRun(nodeText(n))],spacing:{after:100},widowControl:true}));
  else if(n.type==='thematicBreak')children.push(new Paragraph({spacing:{after:120}}));
 }
 }
 blocks(tree.children);return children;
}
export async function makeDocument(title,body,target){
 title=documentTitle(title);
 if(!body?.trim())throw Error('文档正文为空，请补充内容');
 const doc=new Document({creator:'舟知',title,styles:{default:{document:{run:{font,size:24,color:'000000'},paragraph:{spacing:{after:140,line:310}}}},paragraphStyles:[{id:'Title',name:'Title',basedOn:'Normal',next:'Normal',run:{font,size:40,bold:true,color:'000000'},paragraph:{spacing:{after:260},keepNext:true}},{id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',run:{font,size:30,bold:true,color:'000000'},paragraph:{spacing:{before:260,after:140},keepNext:true}},{id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',run:{font,size:26,bold:true,color:'000000'},paragraph:{spacing:{before:200,after:100},keepNext:true}}]},numbering:{config:[{reference:'bullets',levels:[{level:0,format:'bullet',text:'•',alignment:'left',style:{paragraph:{indent:{left:360,hanging:180}}}},{level:1,format:'bullet',text:'◦',alignment:'left',style:{paragraph:{indent:{left:720,hanging:180}}}}]},{reference:'ordered',levels:[{level:0,format:'decimal',text:'%1.',alignment:'left',style:{paragraph:{indent:{left:360,hanging:180}}}}]}]},sections:[{properties:{page:{size:{width:12240,height:15840},margin:{top:1100,bottom:1100,left:1440,right:1440}}},children:documentChildren(title,body)}]});
 await fs.writeFile(target,await Packer.toBuffer(doc));
}
export async function makeMarkdown(title,body,target){
 title=documentTitle(title);
 const tree=parseMarkdown(body),first=tree.children[0],same=first?.type==='heading'&&nodeText(first).trim()===title.trim();
 await fs.writeFile(target,formatMarkdown((same?'':`# ${title}\n\n`)+body));
}
