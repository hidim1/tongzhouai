import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveItem,restoreItem} from '../server/preview-archive.mjs';
test('删除只归档，恢复保留资料和成果',()=>{
 const item={id:'s',name:'测试对话',files:[{id:'f'}],messages:[{text:'保留'}]};
 const before=structuredClone(item);const result=archiveItem(item,[]);
 assert.equal(result.id,'s');assert.ok(item.archivedAt);assert.deepEqual(item.files,before.files);assert.deepEqual(item.messages,before.messages);
 restoreItem(item);assert.deepEqual(item,before);
});
test('活动对话、工程任务或效果图阻止归档',()=>{
 for(const status of ['running','queued','approval','awaiting_approval']){
  const item={id:'p'};assert.throws(()=>archiveItem(item,[{projectId:'p',status}]),{status:409});assert.equal(item.archivedAt,undefined);
  assert.throws(()=>archiveItem(item,[{sessionId:'p',status}]),{status:409});
 }
 assert.throws(()=>archiveItem({id:'p'},[],[{versionId:'v',status:'running'}],[{id:'v',projectId:'p'}]),{status:409});
 const item={id:'p'};archiveItem(item,[{projectId:'other',status:'running'},{projectId:'p',status:'completed'}]);assert.ok(item.archivedAt);
});
test('未知或重复归档/恢复不会成功',()=>{
 assert.throws(()=>archiveItem(undefined,[]),{status:404});
 assert.throws(()=>archiveItem({id:'s',archivedAt:'old'},[]),{status:404});
 assert.throws(()=>restoreItem(undefined),{status:404});assert.throws(()=>restoreItem({id:'s'}),{status:404});
});
