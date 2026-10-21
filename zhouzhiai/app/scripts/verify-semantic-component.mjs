import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const data=process.env.TONGZHOU_DATA_DIR;assert.ok(data&&/^\/(?:private\/)?(?:var\/)?tmp\/zhouzhi-benchmark-[a-zA-Z0-9_-]+$/.test(data),'只允许独立合成验收目录');
const {initializeProvider}=await import('../server/provider.mjs');await initializeProvider();
const {askAI,previewAI}=await import('../server/preview-ai.mjs'),{semanticFind}=await import('../server/assistant-semantic.mjs');
try{const checkpoint={},files=[{id:'design',name:'设计职责',text:'设计团队维护全量物料库、设备图纸与零部件规格。'},{id:'operations',name:'运营职责',text:'运营管理团队维护采购价目表，以及自制标准件制造成本。'}];
 const result=await semanticFind(files,{query:'Who maintains prices of bought-in parts?',offset:0,limit:2},{askAI,id:'semantic-component',checkpoint});
 assert.equal(result.results[0]?.id,'operations');assert.match(result.results[0].text,/采购价目表/);assert.equal(result.nextOffset,null);
 await fs.writeFile(data+'/semantic-component.json',JSON.stringify({ok:true,method:result.method,firstMatch:result.results[0].id,scannedRange:result.scannedRange}),{mode:0o600});console.log(JSON.stringify({semanticComponentPassed:true,firstMatch:result.results[0].id}));
}finally{previewAI.close();}
