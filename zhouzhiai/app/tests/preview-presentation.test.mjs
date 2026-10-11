import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePresentation} from '../server/preview-presentation.mjs';
import {generalSchema,selectionSchema} from '../server/preview-ai.mjs';
const data=()=>({design:{rationale:'根据内容选择',background:'#FAF9F6',textColor:'#202C30',accentColor:'#006B65',fontFamily:'Arial Unicode MS'},slides:[{layout:'text',title:'工作安排',subtitle:'',paragraphs:['整理资料'],columns:[],tableHeaders:[],tableRows:[],chart:{type:'bar',categories:[],series:[],unit:''},notes:''}]});
test('通用AI输出支持原生PPT结构，不要求参考模板',()=>{
 const file=generalSchema.properties.files.items;assert.ok(file.properties.format.enum.includes('pptx'));assert.ok(file.properties.presentation);assert.deepEqual(validatePresentation(data()),data());assert.equal(selectionSchema.properties.templateIds.type,'array');
});
test('PPT低对比、未知字体、过密内容和伪造无效图表拒绝交付',()=>{
 for(const patch of [{background:'#202C30'},{fontFamily:'不存在的字体'}]){const d=data();Object.assign(d.design,patch);assert.throws(()=>validatePresentation(d));}
 const dense=data();dense.slides[0].paragraphs=['文'.repeat(400)];assert.throws(()=>validatePresentation(dense),/过密/);
 const chart=data();chart.slides[0].layout='chart';chart.slides[0].chart={type:'bar',categories:['一'],series:[{name:'数值',values:[1,2]}]};assert.throws(()=>validatePresentation(chart),/数据不完整/);
});
