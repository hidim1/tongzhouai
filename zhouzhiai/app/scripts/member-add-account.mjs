import fs from 'node:fs';
import {MemberRegistry} from '../server/member-registry.mjs';
const [registryFile,username,confirmation]=process.argv.slice(2);
if(!registryFile||!/^zhouzhi(?:\d{2}|cs)$/.test(username||'')||confirmation!=='--service-stopped'||!fs.existsSync(registryFile))throw new Error('需要已有注册表、账号和服务停止确认');
let input='';for await(const chunk of process.stdin)input+=chunk;
const credentials=JSON.parse(input);
if(credentials.username!==username||!credentials.activationCode)throw new Error('发放信息不匹配');
new MemberRegistry(registryFile).addMember(username,credentials.password,credentials.activationCode,credentials.email);
console.log(JSON.stringify({username,activated:false,added:true}));
