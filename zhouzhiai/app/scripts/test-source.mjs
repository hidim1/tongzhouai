// Deterministic tests without production catalogs, credentials or workspaces.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-source-test-'));
try{
  const tests=fs.readdirSync(path.join(app,'tests')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>'tests/'+name);
  const result=spawnSync(process.execPath,['--test',...tests],{cwd:app,stdio:'inherit',env:{...process.env,TONGZHOU_DATA_DIR:scratch,ZHOUZHI_MEMBRANE_DATA:path.join(app,'tests/fixtures/membrane')}});
  if(result.error)throw result.error;
  process.exitCode=result.status??1;
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
