import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantTableColumns} from '../src/assistant-table.ts';
const cell=(value,tagName='td')=>({tagName,children:[{value}]}),row=(...cells)=>({tagName:'tr',children:cells});
test('对话表格按内容分配宽度，短字段紧凑，长字段保留阅读宽度',()=>{
 const columns=assistantTableColumns({tagName:'table',children:[row(cell('序号','th'),cell('企业','th'),cell('资料摘要','th'),cell('待确认事项','th')),row(cell('01'),cell('鲁抗医药'),cell('原料药、氨基酸等业务；涉及发酵原料药项目。'),cell('项目规模、具体工艺需求与采购计划。'))]});
 assert.equal(columns.length,4);assert.equal(columns[0].minWidth,80);assert.ok(columns[2].minWidth>=200);assert.ok(columns[3].idealWidth>columns[1].idealWidth);
 assert.ok(columns.every(c=>c.minWidth>=80&&c.minWidth<=240&&c.idealWidth<=380));
 assert.deepEqual(assistantTableColumns(),[]);
});
test('多列与无空格长文本仍有有界列宽，不改变原始文本',()=>{
 const node={tagName:'table',children:[row(...Array.from({length:12},()=>cell('https://example.com/'+('a'.repeat(300)))))]},before=JSON.stringify(node),columns=assistantTableColumns(node);
 assert.equal(columns.length,12);assert.ok(columns.reduce((n,c)=>n+c.minWidth,0)>900);assert.equal(JSON.stringify(node),before);
});
