// Generate a private delivery artifact; never print plaintext credentials to the terminal.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [sourceList,outputFile]=process.argv.slice(2);
if(!sourceList||!outputFile||fs.existsSync(outputFile))throw new Error('需要原管理员清单与尚不存在的新发放文件');
const source=fs.readFileSync(sourceList,'utf8'),password=source.match(/密码：([^\r\n]+)/)?.[1];
if(!password||password.length<12)throw new Error('未找到指定固定密码');
const username='zhouzhics',activationCode='ZZ-'+randomBytes(20).toString('hex').toUpperCase().match(/.{1,8}/g).join('-');
fs.mkdirSync(path.dirname(outputFile),{recursive:true,mode:0o700});
fs.writeFileSync(outputFile,`舟知 V1.0 测试账号（仅管理员保管）\n账号：${username}\n密码：${password}\n激活码：${activationCode}\n\n独立普通账号，首次激活绑定安装实例，单次激活。无需重新安装客户端。\n`,{flag:'wx',mode:0o600});
const args=['-S','/tmp/zhouzhi-member-deploy.rmJoUO/ssh-control','-o','BatchMode=yes','root@36.140.247.61'];
try {
 const remote='systemctl stop tongzhou-ai.service && cp -p /var/lib/tongzhou-ai/private/members.json /var/backups/tongzhou-ai/before-test-account-20261010/members-before-add.json && /opt/tongzhou-runtime/node/bin/node /opt/tongzhou-ai/current/app/scripts/member-add-account.mjs /var/lib/tongzhou-ai/private/members.json zhouzhics --service-stopped && chown tongzhou-ai:tongzhou-ai /var/lib/tongzhou-ai/private/members.json && systemctl start tongzhou-ai.service && systemctl is-active tongzhou-ai.service';
 const result=execFileSync('ssh',[...args,remote],{input:JSON.stringify({username,password,activationCode}),encoding:'utf8',timeout:45000});
 process.stdout.write(result);
} catch {
 execFileSync('ssh',[...args,'systemctl start tongzhou-ai.service'],{stdio:'ignore'});
 throw new Error('发放文件已保留，但云端添加未确认成功，请检查状态后再发放');
}
