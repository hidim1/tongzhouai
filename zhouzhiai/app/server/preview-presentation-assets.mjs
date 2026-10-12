import fs from 'node:fs/promises';import path from 'node:path';
export async function presentationAssets(plan,{sourceFiles=[],root,buildDir,generateImage,allowGenerated=false,cancelled=()=>false}={}){
 const assets=new Map();let generated=0;
 for(const asset of plan.assets||[]){
  if(cancelled())throw Error('已停止任务');
  if(!asset.id||assets.has(asset.id))throw Error('PPT素材标识缺失或重复');
  let filename;
  if(asset.kind==='brand'){filename=path.join(root,'public/brand/crossflow-logo.png');}
  else if(asset.kind==='uploaded'){
   const f=sourceFiles.find(f=>f.id===asset.fileId);if(!f)throw Error('配图不属于本轮资料，禁止跨账号或项目引用');
   filename=f.preview&&/\.(png|jpe?g)$/i.test(f.preview)?f.preview:/\.(png|jpe?g)$/i.test(f.name)?f.path:null;
   if(!filename)throw Error('资料不能作为配图，请提供图片或导出视图');
  }else if(asset.kind==='generated'){
   if(!allowGenerated||!generateImage)throw Error('尚未允许自动生图，请改用现有素材');
   if(!asset.prompt?.trim()||asset.prompt.length>4000)throw Error('配图描述为空或过长');generated++;
   filename=path.join(buildDir,`illustration-${generated}.jpg`);
   try{await fs.access(filename);}catch{await generateImage({action:'presentation-image',target:filename,description:asset.prompt});}
  }else throw Error('PPT素材类型无效');
  const bytes=await fs.readFile(filename);if(bytes.length>12*1024*1024)throw Error('PPT配图超过12MB，请压缩后使用');
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(!png&&!jpeg)throw Error('配图格式无效，只接受真实PNG或JPEG');
  assets.set(asset.id,{bytes,contentType:png?'image/png':'image/jpeg',alt:asset.alt||'配图',kind:asset.kind,generated:asset.kind==='generated'});
 }
 return assets;
}
