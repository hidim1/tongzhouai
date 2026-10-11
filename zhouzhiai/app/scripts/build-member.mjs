import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await build({root,build:{outDir:'dist-member',rollupOptions:{input:path.join(root,'member.html')}}});
fs.renameSync(path.join(root,'dist-member/member.html'),path.join(root,'dist-member/index.html'));
