import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/Preview.tsx',import.meta.url),'utf8');
test('通用助手仅在AI就绪时显示连接提示，侧栏使用固定图标与删除列',()=>{
 assert.ok(source.includes('boot.engine.connected&&boot.engine.authenticated&&<span className="mw-ai ready" role="status"><Sparkles size={15}/>AI 已连接</span>'));
 assert.ok(source.includes('title={item.name}'));
 const css=fs.readFileSync(new URL('../src/preview.css',import.meta.url),'utf8');
 assert.ok(css.includes('grid-template-columns:minmax(0,1fr) 28px'));
 assert.ok(css.includes('grid-template-columns:16px minmax(0,1fr)'));
 assert.ok(css.includes('-webkit-line-clamp:2'));
});
test('通用工作页移除说明和右栏，保留上传、下载、回收站和新设置页',()=>{
 assert.ok(!source.includes('className="zh-context"'));
 assert.ok(!source.includes('读资料、理思路、写文档、整理表格、制作 PPT。无需先进入工程项目。'));
 for(const content of ['className="zh-file-download"','添加资料','className="zh-composer"','PreviewSettings','确认删除','回收站','crossflow-logo.png','全量工作助手'])assert.ok(source.includes(content),content);
 assert.ok(source.includes('sessionId,nav,session?.messages.length'));
});
test('膜平台按一体化方案组织，AI融入步骤而非单独工作区',()=>{
 const membrane=fs.readFileSync(new URL('../src/MembraneWorkspace.tsx',import.meta.url),'utf8'),estimate=fs.readFileSync(new URL('../src/SchemeEstimate.tsx',import.meta.url),'utf8');
 assert.ok(source.includes('MembraneWorkspace'));
 assert.ok(!source.includes('EngineeringWorkspace'));
 const steps=['<SchemeEstimate','<h2>结合项目资料，生成新清单</h2>','<h2>详细预算核对</h2>','<h2>输出本方案成果</h2>'];
 const positions=steps.map(s=>membrane.indexOf(s));
 assert.ok(positions.every((p,i)=>p>=0&&(!i||p>positions[i-1])));
 assert.ok(!membrane.includes('项目 AI 协作'));
 for(const s of ['AI 已连接','AI 编制技术响应与标书'])assert.ok(membrane.includes(s));
 assert.ok(membrane.includes('不能据当前小计判断是否低于目标'));
 assert.ok(estimate.includes('AI 分析并估算'));assert.ok(estimate.includes('质量与合规（可叠加）'));assert.ok(estimate.includes('未经 AI'));assert.ok(!estimate.includes("api('/preview/calculate'"));
 assert.ok(!estimate.includes('money(direction.option.total_cost)'));
 assert.ok(estimate.includes("setTier('mid');setJobId('');")); // Polling must not overwrite user tier/target after consumption.
 const routes=fs.readFileSync(new URL('../server/preview-workflow-routes.mjs',import.meta.url),'utf8');
 const estimateRoute=routes.slice(routes.indexOf("app.post('/api/preview/projects/:id/estimate'"),routes.indexOf("app.post('/api/preview/projects/:id/direction'"));
 assert.ok(!estimateRoute.includes('runBridge'));assert.ok(!estimateRoute.includes('legacyParameters'));
});
