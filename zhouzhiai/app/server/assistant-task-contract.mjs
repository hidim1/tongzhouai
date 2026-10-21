// A deterministic authorization boundary, not a claim to understand every task.
// File contents and assistant suggestions may supply data, never permission.
const formats = [
  ['pptx', /(?:pptx?|powerpoint|幻灯片|演示文稿)/i],
  ['docx', /(?:docx?|word|文字文档|工作文档)/i],
  ['xlsx', /(?:xlsx?|excel|电子表格|工作簿)/i],
  ['md', /(?:markdown|\bmd\b)/i],
];
const create = /(?:生成|制作|做成|做个|做一|输出|导出|下载|保存|另存|交付|给我|提供|写一|写个|整理成|重新整理|重做)/i;
const edit = /(?:修改|调整|更新|补充|替换|重写|加上|添加|删除|改一下|改为|改成|改到|改(?=第.{1,6}[章节]|[A-Z]{1,3}[1-9]\d*)|填入|填写|写入)/i;
const convert = /(?:转成|转换为|转换成)/i;
const negative = /(?:不要|不用|无需|不需要|别|不必|不生成|不输出|不导出|不制作|不做|不修改|不更新|不调整)/;
const noRebuild = /(?:不要|不用|别|不必|不)\s*(?:重新)?(?:重做|重建|重排|重写|重新生成)/;
const question = /(?:是什么|什么意思|怎么|如何|为什么|为啥|能不能|能否|是否|可以吗|能.*吗|支持.*吗|不能生成)/i;
const directRequest = /(?:请|帮我|麻烦|给我|我要|我需要)\s*(?:重新)?(?:(?:把|将|在)[^，。；!?？\n]{0,40})?(?:生成|制作|做成|做一|做个|导出|输出|下载|写一|写个|修改|调整|更新|替换|改为|填入|写入)/;
const reference = /(?:刚才|上面|之前|那份|这份|这个|它|原件|原文件|原文档|原工作簿|附件|文件|文档|工作簿|继续|接着|第.{1,6}[章节]|[A-Z]{1,3}[1-9]\d*)/i;
const topic = /(?:pptx?|powerpoint|幻灯片|演示文稿|docx?|word|xlsx?|excel|markdown)(?:的)?\s*(?:制作建议|制作方法|制作流程|大纲|框架|提纲|教程|建议|方法|流程|格式|含义|区别|能力)/i;
const readOnlyRequest = /^\s*(?:(?:请|帮我|麻烦)\s*)?(?:只|仅|先)?\s*(?:分析|检查|审阅|评估|解释|讨论|指出|列出|告诉我|看看|看一下)/;
const executionAfterAnalysis = /(?:然后|再|并|后)\s*(?:直接)?(?:修改|调整|更新|替换|生成|制作|导出|输出)/;
const fileExtension = /\.(pptx|docx|xlsx|md)$/i;

function knownFormats(text) { return formats.filter(([,pattern])=>pattern.test(text)).map(([format])=>format); }

export function instructionText(message) {
  // A quoted filename is still a usable reference, but quoted verbs are not actions.
  const filename = value => /^(?:[^\n<>:]+)\.(?:pptx|docx|xlsx|md)$/i.test(value.trim()) && !/[，。；]/.test(value) && !/(?:生成|制作|修改|删除|请|帮我)/.test(value) ? value : ' ';
  return String(message ?? '')
    .replace(/```[\s\S]*?```|<untrusted_text\b[^>]*>[\s\S]*?<\/untrusted_text>/gi, ' ')
    .replace(/^\s*>.*$/gm, ' ')
    .replace(/“([^”]*)”|「([^」]*)」|『([^』]*)』|"([^"\n]*)"|`([^`\n]*)`/g, (_, ...groups) => filename(groups.slice(0,5).find(v=>v!==undefined)||''));
}

function metadataFiles(history, attachments) {
  const unique = new Map();
  for (const f of [...history.flatMap(m=>m.files||[]), ...attachments]) {
    if (typeof f.id !== 'string' || typeof f.name !== 'string' || !fileExtension.test(f.name)) continue;
    unique.set(f.id, {id:f.id,name:f.name,format:f.name.match(fileExtension)[1].toLowerCase()});
  }
  return [...unique.values()];
}

function contextualFormats(history, attachments, allowTopic, preferAttachments=false) {
  // An explicit current export/edit is required before using any of this context.
  // Search the nearest file-bearing exchange rather than unioning unrelated files.
  const attached=[...new Set(attachments.map(f=>f.name?.match(fileExtension)?.[1]?.toLowerCase()).filter(Boolean))];
  if (preferAttachments && attached.length) return attached;
  for (const m of [...history].reverse().slice(0,8)) {
    const fromFiles=(m.files||[]).map(f=>f.name?.match(fileExtension)?.[1]?.toLowerCase()).filter(Boolean);
    if (fromFiles.length) return [...new Set(fromFiles)];
    if (m.role==='user') {
      const text=instructionText(m.text);
      if (negative.test(text) && !noRebuild.test(text)) continue;
      const found=knownFormats(text);
      if (found.length && (allowTopic || create.test(text) || edit.test(text))) return found;
    }
  }
  return attached;
}

/** context contains server-scoped metadata only. continuationAuthorized must be
 * supplied by the lifecycle after matching an actual pending clarification. */
export function taskContract(message, history=[], context={}) {
  const text=instructionText(message), attachments=context.attachments||[];
  const empty=reason=>({version:1,mode:'chat',formats:[],deliveryAuthorized:false,editOnly:false,sourceFileIds:[],authorizationSource:'none',reason});
  const noFiles=/(?:不要|不用|无需|不需要|别|不必)\s*(?:生成|制作|导出|输出|下载|给|发)?\s*(?:任何|可下载的|可下载)?(?:文件|附件)/.test(text);
  const analysisOnly=/(?:只|仅|先)\s*(?:分析|讨论|解释|评估|检查|给(?:出)?建议|回答|看一下)[^。\n]{0,40}(?:不(?:要|用|必)?(?:实际)?(?:制作|生成|修改|执行|操作)|别(?:改|动))|(?:不要|别|不必)\s*(?:实际)?(?:修改|改动|动|操作)\s*(?:任何)?(?:文件|附件|原件)/.test(text);
  const onlyAnalysis=/(?:只|仅)\s*(?:分析|讨论|解释|评估|检查|给(?:出)?建议|回答|看一下)/.test(text)&&!executionAfterAnalysis.test(text);
  if (noFiles || analysisOnly || onlyAnalysis) return empty('explicit_no_delivery');
  const selected=new Set(), excluded=new Set();
  let generic=false, hasEdit=false, hasCreate=false, hasConvert=false, hasAction=false;
  for (const clause of text.split(/[，,。；;！!？?\n]/).filter(Boolean)) {
    // Instructions described as document/web content cannot authorize delivery.
    if (/(?:附件|文件|网页|文档|材料)(?:中|里|内|上)?(?:的)?(?:内容|写着|要求|指令|说|提到)\s*[:：]?/.test(clause) && !/^\s*(?:(?:请|帮我|麻烦)\s*)?(?:按|根据).*(?:生成|制作|修改|导出)/.test(clause)) continue;
    if (negative.test(clause)) {
      if (noRebuild.test(clause) && edit.test(text)) continue;
      for (const f of knownFormats(clause)) excluded.add(f);
      continue;
    }
    if (readOnlyRequest.test(clause) && !executionAfterAnalysis.test(clause)) continue;
    if (/(?:修改|调整|更新|编辑|改稿)(?:建议|方法|方案|流程|教程|思路)/.test(clause) && !/(?:文件|附件|导出|下载)/.test(clause)) continue;
    if (question.test(clause) && (!directRequest.test(clause) || /(?:看看|看一下|分析|解释|告诉我).*(?:是否|怎么|如何|能否|能不能)/.test(clause))) continue;
    if (topic.test(clause) && !/(?:文件|附件|导出|下载)/.test(clause)) continue;
    if (!create.test(clause) && !edit.test(clause) && !convert.test(clause)) continue;
    hasAction=true;hasEdit ||= edit.test(clause);hasCreate ||= create.test(clause);hasConvert ||= convert.test(clause);
    for (const f of knownFormats(clause)) selected.add(f);
    generic ||= /(?:生成|制作|导出|下载|保存|输出|交付|另存).*(?:文件|附件)|(?:文件|附件).*(?:生成|制作|导出|下载|修改|更新|调整)/.test(clause);
  }
  if (!selected.size && hasAction && (generic || reference.test(text) || /(?:导出|下载|重新生成|另存).*(?:吧|一下|一份)/.test(text))) {
    for (const f of contextualFormats(history,attachments,generic,hasEdit&&!/(?:刚才|上面|之前|继续|接着)/.test(text))) selected.add(f);
    if (!selected.size && generic && !hasEdit) for (const [f] of formats) selected.add(f);
  }
  const allowed=[...selected].filter(f=>!excluded.has(f));
  // A clarification reply inherits a *server-stored* contract, not arbitrary chat.
  const pending=context.pendingTaskContract;
  if (context.continuationAuthorized===true && /^(?:取消|不用继续|不要继续|不要改了|不用改了|别改了|换个|另一个|新任务)/.test(text.trim())) return empty('continuation_cancelled');
  if (!allowed.length && context.continuationAuthorized===true && pending?.deliveryAuthorized) {
    const pendingFormats=(pending.formats||[]).filter(f=>formats.some(([known])=>known===f)&&!excluded.has(f));
    if (pendingFormats.length) return {...pending,formats:pendingFormats,sourceFileIds:[...(pending.sourceFileIds||[])],authorizationSource:'pending_clarification'};
  }
  if (!allowed.length) return empty(excluded.size?'delivery_excluded':'no_explicit_file_request');
  const originalReference=reference.test(text)||/\.(?:docx|xlsx|md)\b|保留.*(?:样式|格式|公式|版式)/i.test(text);
  const mode=hasConvert?'convert':hasEdit&&(!hasCreate||originalReference)?'edit':'create';
  // Keep legacy presentation routing unchanged; this iteration hardens document edits.
  const editOnly=(mode==='edit'&&allowed.some(f=>f!=='pptx'))||(hasEdit&&noRebuild.test(text));
  const candidates=metadataFiles(history,attachments).filter(f=>allowed.includes(f.format));
  const named=candidates.filter(f=>text.includes(f.name));
  const duplicateNames=named.some(f=>named.filter(other=>other.name===f.name).length>1);
  const allVersions=/(?:所有|全部)(?:历史)?版本|两份都|两版都/.test(text);
  const sources=mode==='edit'&&(!duplicateNames||allVersions)?(named.length?named:candidates.length===1?candidates:[]):[];
  return {version:1,mode,formats:allowed,deliveryAuthorized:true,editOnly,sourceFileIds:sources.map(f=>f.id),sourceSelectionRequired:mode==='edit'&&!sources.length,authorizationSource:'current_message',reason:'explicit_file_request'};
}
