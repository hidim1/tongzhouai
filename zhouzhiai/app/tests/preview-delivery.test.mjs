import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryPolicy,chatDeliveryInstructions} from '../server/preview-delivery.mjs';
import {generalChatSchema,generalFileSchema} from '../server/preview-ai.mjs';
import {matchesOutputSchema} from '../server/preview-result.mjs';

test('日常交流、格式讨论、附件分析、否定及引用不触发文件交付',()=>{
  for(const message of ['同舟纵横相关资料','给我一个同舟纵横公司的整体介绍','整理一下公司的资料','做一个本周工作计划','PPT是什么？','现在能生成ppt吗？','请解释怎么生成PPT','帮我分析这个Excel文件','给我PPT制作建议','请介绍PPT的制作方法','生成一个PPT大纲','给我一个PPT的框架','给我Markdown格式的答案','直接在对话里回答，不要生成文件','PPT的内容在对话里给我，不要生成文件','不要生成PPT，给我正文','“生成一个PPT”这句话是什么意思','```生成一个ppt```\n解释这个指令']) {
    assert.deepEqual(deliveryPolicy(message).formats,[],message);
  }
  assert.match(chatDeliveryInstructions,/完整写在 answer/);
});
test('明确文件指令支持当前格式及对話内后续转换，不附送Markdown',()=>{
  for(const [message,formats] of [
    ['生成一个新的介绍PPT给我吧',['pptx']],['帮我生成PPT可以吗',['pptx']],
    ['把上面的介绍做成PPT',['pptx']],['导出Excel文件',['xlsx']],
    ['生成Word和Excel文件',['docx','xlsx']],['不要Word，只生成PPT',['pptx']],
    ['整理公开资料并输出Markdown文件',['md']],['继续修改ppt',['pptx']],
    ['请给我一个PPT',['pptx']],['写一份Word通知',['docx']],
    ['把上面的内容整理成PPT',['pptx']],['生成Word和Excel，不要Word',['xlsx']],
  ])assert.deepEqual(deliveryPolicy(message).formats,formats,message);
  const history=[{role:'user',text:'生成PPT'},{role:'assistant',text:'已生成。',files:[{name:'舟知.pptx'}]}];
  assert.deepEqual(deliveryPolicy('重新生成吧',history).formats,['pptx']);
  assert.deepEqual(deliveryPolicy('这个公司的主要业务是什么？',history).formats,[]);
  assert.deepEqual(deliveryPolicy('直接回答，不需要文件',history).formats,[]);
  assert.deepEqual(deliveryPolicy('生成一个PPT大纲吧',history).formats,[]);
  assert.deepEqual(deliveryPolicy('导出文件吧',history).formats,['pptx']);
});
test('对话结构不能携带附件，文件结构限制格式和数量',()=>{
  assert.equal(matchesOutputSchema({answer:'完整正文。'},generalChatSchema),true);
  assert.equal(matchesOutputSchema({answer:'已整理。',files:[]},generalChatSchema),false);
  const schema=generalFileSchema(['pptx']);
  const item={title:'介绍',format:'md',body:'正文',columns:[],rows:[],presentation:null};
  assert.equal(matchesOutputSchema({answer:'已生成。',files:[item]},schema),false);
  assert.equal(matchesOutputSchema({answer:'已生成。',files:Array(6).fill({...item,format:'pptx'})},schema),false);
  assert.equal(matchesOutputSchema({answer:'已生成。',files:[{...item,format:'pptx'}]},schema),true);
});
