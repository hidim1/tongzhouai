// Source distribution bootstrap: empty databases only; existing data is never replaced.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../membrane');
const dir=path.resolve(process.env.ZHOUZHI_MEMBRANE_DATA||path.join(root,'data'));
fs.mkdirSync(dir,{recursive:true,mode:0o700});
for(const [name,value] of Object.entries({'history_templates.json':[],'procurement_price_book.json':{prices:[]}})){
  try{fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});console.log('已创建空库：'+name);}
  catch(error){if(error.code!=='EEXIST')throw error;console.log('保留已有文件：'+name);}
}
