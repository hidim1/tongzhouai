// Only use the already-authorized file set; a newer timestamp is not proof of supersession.
export function versionCatalog(files,query='') {
  const byId=new Map(files.map(f=>[f.id,f])),children=new Map();
  for(const file of files)if(file.parentId&&byId.has(file.parentId)){
    const ids=children.get(file.parentId)||[];ids.push(file.id);children.set(file.parentId,ids);
  }
  function lineage(file){
    const seen=new Set();let current=file;
    while(current.parentId&&byId.has(current.parentId)){
      if(seen.has(current.id))return {rootId:null,historyIncomplete:true,cyclic:true};
      seen.add(current.id);current=byId.get(current.parentId);
    }
    return {rootId:current.id,historyIncomplete:!!current.parentId,cyclic:false};
  }
  const lines=new Map(files.map(f=>[f.id,lineage(f)]));
  return files.filter(f=>!query||f.name.includes(query)).map(f=>{
    const line=lines.get(f.id),heads=files.filter(x=>lines.get(x.id).rootId===line.rootId&&!(children.get(x.id)||[]).length);
    const sameNameRoots=new Set(files.filter(x=>x.name===f.name).map(x=>lines.get(x.id).rootId));
    return {id:f.id,name:f.name,createdAt:f.createdAt||null,version:f.version||1,parentId:byId.has(f.parentId)?f.parentId:null,
      changes:f.changes||[],...line,supersededBy:children.get(f.id)||[],
      isLatestCandidate:!line.cyclic&&!(children.get(f.id)||[]).length,
      needsSelection:line.cyclic||line.historyIncomplete||heads.length!==1||sameNameRoots.size>1,
      note:line.cyclic?'版本关系异常，请明确指定文件':heads.length>1?'存在多个分支版本，请明确使用哪份':!f.createdAt?'旧文件没有精确生成时间，不按名称或时间猜测版本先后':''};
  });
}
