import fs from 'node:fs';
import path from 'node:path';
import { SOURCE, SERVER } from '../server/config.mjs';
import { store,newProject,save } from '../server/store.mjs';
import { ingest,derive } from '../server/intake.mjs';
import { DEMO_PROJECT_DESCRIPTION } from '../server/branding.mjs';
export async function seed(){if(store.projects.length)return;if(process.env.TONGZHOU_DESKTOP || SERVER){newProject('我的第一个工程项目');return;}const p=newProject('膜分离设备 · 智能投标示范项目');p.description=DEMO_PROJECT_DESCRIPTION;
if(fs.existsSync(SOURCE))for(const name of fs.readdirSync(SOURCE).sort())if(/^\d\./.test(name))await ingest(p,path.join(SOURCE,name),name);
p.results.live=derive(p);p.results.demo=structuredClone(p.results.live);p.results.demo.source='演示数据 / 本地预解析';save();console.log(`Prepared ${p.files.length} files, ${p.results.live.requirements.length} requirements`);}
if(process.argv[1]?.endsWith('seed.mjs'))await seed();
