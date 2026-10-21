import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const source=process.argv.find(a=>a.startsWith('--native-pages='))?.slice(15),data=process.env.TONGZHOU_DATA_DIR;
assert.ok(source&&/^\/var\/tmp\/zhouzhi-benchmark-[a-zA-Z0-9_-]+$/.test(source));assert.ok(data&&/^\/var\/tmp\/zhouzhi-benchmark-[a-zA-Z0-9_-]+$/.test(data));
const {renderOffice}=await import('../server/office-render.mjs'),db=JSON.parse(await fs.readFile(source+'/preview/preview.json','utf8')),file=db.jobs.filter(j=>j.status==='completed').flatMap(j=>j.files||[]).find(f=>f.name.endsWith('.pptx'));
assert.ok(file&&file.path.startsWith(source+'/preview/outputs/'));
const rendered=await renderOffice(file.path,data+'/native-pages');assert.equal(rendered.totalPages,3);await fs.writeFile(data+'/native-pages.json',JSON.stringify(rendered,null,2),{mode:0o600});console.log(JSON.stringify({nativePages:true,...rendered}));
