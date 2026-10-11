import fs from 'node:fs';
import path from 'node:path';
import {MemberRegistry} from '../server/member-registry.mjs';
const [registryFile,listFile]=process.argv.slice(2);
if(!registryFile||!listFile)throw new Error('需要注册表路径和管理员清单路径');
if(fs.existsSync(registryFile)||fs.existsSync(listFile))throw new Error('目标已存在，禁止覆盖');
let input='';
if(process.stdin.isTTY){process.stdin.setRawMode(true);console.log('请输入固定密码（输入隐藏），回车确认：');}
for await(const chunk of process.stdin){input+=chunk;if(input.includes('\u0003'))process.exit(1);if(process.stdin.isTTY&&/[\r\n]/.test(input))break;}
if(process.stdin.isTTY)process.stdin.setRawMode(false);
const password=input.trim();
const accounts=new MemberRegistry(registryFile).provision(10,password);
fs.mkdirSync(path.dirname(listFile),{recursive:true,mode:0o700});
fs.writeFileSync(listFile,'舟知 V1.0 普通账号授权清单（仅管理员保管）\n激活码单次使用；首次激活绑定安装实例。每人仅发放对应的一组信息。\n当前 HTTP 内测连接未加密，请在可信网络使用。\n\n'+accounts.map((a,i)=>`${i+1}. 账号：${a.username}\n密码：${a.password}\n激活码：${a.activationCode}\n`).join('\n'),{mode:0o600});
fs.chmodSync(listFile,0o600);
console.log('已生成10组授权信息；服务器注册表仅包含密码和激活码哈希。');
