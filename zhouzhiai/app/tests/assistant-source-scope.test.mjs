import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {assertEditSource} from '../server/assistant-source-scope.mjs';
import {createAssistantTools} from '../server/assistant-tools.mjs';

const original={id:'a',name:'原件.docx'};
const job=files=>({taskContract:{mode:'edit',sourceSelectionRequired:false,sourceFileIds:['a']},files:files||[]});
const unauthorized=error=>error.code==='TASK_UNAUTHORIZED';
const value=result=>JSON.parse(result.contentItems.find(c=>c.type==='inputText').text);

test('只允许选中原件与本任务真实生成的后代，不信任传入parentId或其他任务分支',()=>{
  const current=job([{id:'a1',parentId:'a'},{id:'a2',parentId:'a1'}]);
  assert.equal(assertEditSource(current,original),true);
  assert.equal(assertEditSource(current,{id:'a2',name:'二次修订.docx'}),true);
  assert.throws(()=>assertEditSource(current,{id:'b',name:'另一份.docx',parentId:'a'}),unauthorized);
  assert.throws(()=>assertEditSource({...current,priorOutputIds:['old-branch']},{id:'old-branch',name:'其他任务修订.docx',parentId:'a'}),unauthorized);
  assert.throws(()=>assertEditSource(job([{id:'child',parentId:'old-branch'}]),{id:'child',name:'后代.docx'}),unauthorized);
});

test('未选源、同名歧义要求确认；版本环和冲突ID不能冒充有效后代',()=>{
  for(const contract of [{mode:'edit',sourceFileIds:[]},{mode:'edit',sourceFileIds:['a'],sourceSelectionRequired:true}])
    assert.throws(()=>assertEditSource({taskContract:contract,files:[]},original),e=>e.code==='TASK_NEEDS_INPUT');
  assert.throws(()=>assertEditSource(job([{id:'x',parentId:'y'},{id:'y',parentId:'x'}]),{id:'x',name:'循环.docx'}),unauthorized);
  assert.throws(()=>assertEditSource(job([{id:'x',parentId:'a'},{id:'x',parentId:'b'}]),{id:'x',name:'冲突.docx'}),unauthorized);
  assert.equal(assertEditSource({files:[]},original),true,'旧任务未保存contract时维持既有权限检查');
  assert.equal(assertEditSource({taskContract:{mode:'create',sourceFileIds:[]}},original),true);
  assert.equal(assertEditSource({taskContract:{mode:'edit',sourceFileIds:[]}}, {id:'p',name:'既有演示.pptx'}),true,'本轮不更改PPT能力');
});

test('真实Markdown编辑工具阻断B，允许A与A的新版本连续修改，原件保持不变',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'zhouzhi-source-scope-'));
  const a={id:'a',name:'说明A.md',path:path.join(dir,'a.md'),text:'旧内容A。'},b={id:'b',name:'说明B.md',path:path.join(dir,'b.md'),text:'旧内容B。'};
  await fs.writeFile(a.path,a.text);await fs.writeFile(b.path,b.text);
  const state={...job(),id:'scope-'+randomUUID(),status:'running',message:'修改说明A.md',deliveryFormats:['md'],fileIds:['a','b'],checkpoint:{}};
  t.after(async()=>{await Promise.all(state.files.map(f=>fs.rm(f.path,{force:true})));await fs.rm(dir,{recursive:true,force:true});});
  let modelCalls=0;
  const tools=createAssistantTools({session:{files:[a,b],messages:[]},job:state,save(){},askAI:async()=>{modelCalls++;throw Error('纯文本编辑不应调用模型');},extractDocument:async file=>({text:await fs.readFile(file,'utf8')})});
  const edit=(id,find,replace)=>tools.execute('zhouzhi_edit_file',{id,title:'工作说明',replacements:[{part:'',find,replace}],cells:[]},randomUUID());
  const rejected=await edit('b','旧内容B。','错误改写。');
  assert.equal(rejected.success,false);assert.match(value(rejected).error,/已确认的原件/);assert.equal(state.files.length,0);
  const first=await edit('a','旧内容A。','第一次修订。');assert.equal(first.success,true,JSON.stringify(first));
  const child=state.files[0];assert.equal(child.parentId,'a');assert.equal(await fs.readFile(child.path,'utf8'),'第一次修订。');
  const second=await edit(child.id,'第一次修订。','第二次修订。');assert.equal(second.success,true,JSON.stringify(second));
  assert.equal(state.files[1].parentId,child.id);assert.equal(await fs.readFile(state.files[1].path,'utf8'),'第二次修订。');
  assert.equal(await fs.readFile(a.path,'utf8'),a.text);assert.equal(await fs.readFile(b.path,'utf8'),b.text);assert.equal(modelCalls,0);
});

test('Word与Excel结构编辑入口同样阻断未选中原件，先拒绝而非开始写文件',async()=>{
  for(const [format,tool] of [['docx','zhouzhi_edit_template'],['xlsx','zhouzhi_edit_workbook']]){
    const files=['a','b'].map(id=>({id,name:id+'.'+format,path:'/not-a-real-file/'+id+'.'+format,text:'已解析',visualMetadataVersion:2,cellMetadataVersion:2}));
    const state={...job(),id:'blocked-'+format,status:'running',message:'修改A',deliveryFormats:[format],fileIds:['a','b'],checkpoint:{}};
    const tools=createAssistantTools({session:{files,messages:[]},job:state,save(){},askAI:async()=>{throw Error('不应开始审核');}});
    const result=await tools.execute(tool,{id:'b',title:'修订',fingerprint:'not-needed',operations:[]},'blocked-call');
    assert.equal(result.success,false);assert.match(value(result).error,/已确认的原件/);assert.equal(state.files.length,0);
  }
});
