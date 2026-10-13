import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import JSZip from 'jszip';
import {officePackage,readPresentation,xml} from '../server/office-package.mjs';import {editOffice} from '../server/office-edit.mjs';
function dir(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'zhouzhi-native-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
const save=async(zip,file)=>fs.writeFileSync(file,await zip.generateAsync({type:'nodebuffer'}));
test('PPT按实际页面顺序读取和修改，保持母版、图片与未修改页面字节不变',async t=>{
 const d=dir(t),source=path.join(d,'source.pptx'),target=path.join(d,'edited.pptx'),z=new JSZip();
 z.file('ppt/presentation.xml','<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="second"/><p:sldId r:id="first"/></p:sldIdLst><p:sldSz cx="100" cy="60"/></p:presentation>');z.file('ppt/_rels/presentation.xml.rels','<Relationships><Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide2.xml"/></Relationships>');
 const slide=text=>'<p:sld xmlns:p="p" xmlns:a="a"><p:sp><p:cNvPr id="1"/><a:p><a:r><a:t>'+text+'</a:t></a:r></a:p></p:sp></p:sld>';
 z.file('ppt/slides/slide1.xml',slide('第二页'));z.file('ppt/slides/slide2.xml',slide('第一页原文'));z.file('ppt/slideMasters/slideMaster1.xml','原始母版');z.file('ppt/media/logo.png','原始图片');await save(z,source);
 assert.equal((await readPresentation(source)).slides[0].title,'第一页原文');await editOffice(source,target,{replacements:[{part:'slide:0',find:'第一页原文',replace:'第一页更新'}]});const changed=await officePackage(target);assert.equal((await readPresentation(target)).slides[0].title,'第一页更新');
 for(const name of ['ppt/slideMasters/slideMaster1.xml','ppt/media/logo.png','ppt/slides/slide1.xml'])assert.deepEqual(await changed.file(name).async('nodebuffer'),await z.file(name).async('nodebuffer'));
});
test('Word跨文字run局部替换保留格式，歧义替换拒绝且源文件不被覆盖',async t=>{
 const d=dir(t),source=path.join(d,'source.docx'),target=path.join(d,'edited.docx'),z=new JSZip();z.file('word/document.xml','<w:document xmlns:w="w"><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>工作</w:t></w:r><w:r><w:t>通知</w:t></w:r></w:p></w:document>');await save(z,source);const before=fs.readFileSync(source);
 await editOffice(source,target,{replacements:[{part:'document',find:'工作通知',replace:'资料通知'}]});const result=await(await officePackage(target)).file('word/document.xml').async('string');assert.equal(xml(result)('w\\:t').text(),'资料通知');assert.equal(xml(result)('w\\:b').length,1);assert.deepEqual(fs.readFileSync(source),before);
 await assert.rejects(editOffice(source,target,{replacements:[{part:'document',find:'不存在',replace:'x'}]}),/不存在或不唯一/);
});
test('Excel局部数值写入支持带前缀命名空间，不把公式字符串当作执行指令',async t=>{
 const d=dir(t),source=path.join(d,'source.xlsx'),target=path.join(d,'edited.xlsx'),z=new JSZip();z.file('xl/workbook.xml','<x:workbook xmlns:x="x" xmlns:r="r"><x:sheets><x:sheet name="数据" r:id="one"/></x:sheets></x:workbook>');z.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Target="/xl/worksheets/sheet1.xml"/></Relationships>');z.file('xl/worksheets/sheet1.xml','<x:worksheet xmlns:x="x"><x:sheetData><x:row><x:c r="A1" s="2"><x:v>1</x:v></x:c><x:c r="B1"><x:f>A1*2</x:f><x:v>2</x:v></x:c></x:row></x:sheetData></x:worksheet>');await save(z,source);
 await editOffice(source,target,{cells:[{sheet:'数据',address:'A1',value:'=HYPERLINK("https://example.com")'}]});const $=xml(await(await officePackage(target)).file('xl/worksheets/sheet1.xml').async('string'));assert.equal($('x\\:c[r="A1"]').attr('t'),'inlineStr');assert.equal($('x\\:c[r="A1"]').attr('s'),'2');assert.equal($('x\\:f').text(),'A1*2');
 await assert.rejects(editOffice(source,target,{cells:[{sheet:'其他账号',address:'A1',value:1}]}),/无效/);
 assert.throws(()=>xml('<!DOCTYPE x><x/>'),/外部定义/);
});
