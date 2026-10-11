import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const [command,filename]=process.argv.slice(2),data=process.env.TONGZHOU_DATA_DIR;
assert.ok(data&&filename&&['capture','verify'].includes(command));
const registryFile=process.env.ZHOUZHI_MEMBER_REGISTRY||path.join(data,'private/members.json');
const registry=JSON.parse(fs.readFileSync(registryFile,'utf8')),snapshot={};let active=0;
for(const scope of ['',...registry.users.map(u=>'members/'+u.id)])for(const name of ['workspace.json','preview/preview.json']){
 const f=path.join(data,scope,name);if(!fs.existsSync(f))continue;const d=JSON.parse(fs.readFileSync(f,'utf8'));
 active+=['jobs','images'].reduce((n,key)=>n+(d[key]||[]).filter(j=>['running','queued','approval','awaiting_approval'].includes(j.status)).length,0);
 snapshot[scope+'/'+name]=createHash('sha256').update(JSON.stringify(d)).digest('hex');
}
snapshot.registry=createHash('sha256').update(fs.readFileSync(registryFile)).digest('hex');
if(command==='capture'){assert.equal(active,0,'有活动任务，禁止重启发布');fs.writeFileSync(filename,JSON.stringify(snapshot),{mode:0o600});}
else assert.deepEqual(snapshot,JSON.parse(fs.readFileSync(filename,'utf8')),'发布前后业务或授权资料变化，须核对');
console.log(JSON.stringify({ok:true,action:command,activeTasks:active,workspaces:registry.users.length}));
