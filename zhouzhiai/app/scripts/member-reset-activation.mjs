import fs from 'node:fs';
import {MemberRegistry} from '../server/member-registry.mjs';
const [registryFile,username,confirmation]=process.argv.slice(2);
if(!registryFile||!/^zhouzhi(?:\d{2}|cs)$/.test(username||'')||confirmation!=='--service-stopped')throw new Error('需要注册表、账号和服务停止确认');
let code='';for await(const chunk of process.stdin)code+=chunk;
if(!fs.existsSync(registryFile))throw new Error('注册表不存在');
// Stop the gateway before this maintenance operation, otherwise its in-memory registry can overwrite the reset.
console.log(JSON.stringify(new MemberRegistry(registryFile).resetActivation(username,code.trim())));
