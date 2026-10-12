type TableNode={tagName?:string;value?:string;children?:TableNode[]};
function nodeText(node:TableNode):string{return node.value||node.children?.map(nodeText).join('')||'';}
// Estimate readable widths, not semantic data. No cell text is altered or truncated.
export function assistantTableColumns(node?:TableNode){
  const rows:string[][]=[];
  function visit(n:TableNode){if(n.tagName==='tr')rows.push((n.children||[]).filter(c=>c.tagName==='th'||c.tagName==='td').map(c=>nodeText(c).replace(/\s+/g,' ').trim()));else n.children?.forEach(visit);}
  if(node)visit(node);
  const count=Math.max(0,...rows.map(row=>row.length));
  return Array.from({length:count},(_,index)=>{
    const units=Math.max(0,...rows.map(row=>Array.from(row[index]||'').reduce((sum,c)=>sum+(c.charCodeAt(0)>255?2:1),0)));
    return {minWidth:Math.min(240,Math.max(80,units*7+32)),idealWidth:Math.min(380,Math.max(80,units*7+32))};
  });
}
