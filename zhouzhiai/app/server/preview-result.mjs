// Validate the subset of JSON Schema used by preview tasks before delivering output.
// A completed message is not necessarily a completed task (commentary is progress).
export function matchesOutputSchema(value, schema) {
  if (schema.anyOf) return schema.anyOf.some(s => matchesOutputSchema(value, s));
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (schema.type && !types.includes(type) && !(type === 'number' && Number.isInteger(value) && types.includes('integer'))) return false;
  if (type === 'number' && !Number.isFinite(value)) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (type === 'array') return (schema.minItems === undefined || value.length >= schema.minItems)
    && (schema.maxItems === undefined || value.length <= schema.maxItems)
    && value.every(v => matchesOutputSchema(v, schema.items));
  if (type === 'object') {
    if ((schema.required || []).some(k => !Object.hasOwn(value, k))) return false;
    return Object.entries(value).every(([k, v]) => schema.properties && Object.hasOwn(schema.properties, k)
      ? matchesOutputSchema(v, schema.properties[k]) : schema.additionalProperties !== false);
  }
  return true;
}

export function parseTaskResult(text, schema, guard) {
  const value = JSON.parse(text);
  if (!matchesOutputSchema(value, schema)) throw new Error('AI未返回有效结构化结果，请重试');
  return guard(value);
}

export const finalDeliveryInstructions = '完成任务后的交付结果必须在 final_answer 阶段一次提交符合本轮结构的完整 JSON，随后立即结束本轮。commentary 仅用于简短进度，不能把完整交付 JSON 放在该阶段，也不能在完成后继续等待。日常对话由程序直接显示完整 answer；只有本轮明确允许文件交付时，程序才按结果制作文件，无需为制作文件另行调用工具。';
export const recoverFinalInstructions = '上一条消息已包含完整交付内容，但被放在进度阶段。请现在将经过核对的完整 JSON 作为 final_answer 正式提交并结束本轮；不要再发进度消息，不要重复检索或调用工具。保持事实、来源、附件边界及原输出结构，不添加未经核实的内容。';
export const recoverEmptyInstructions = '上一条消息为空，不能作为任务结果。请继续完成本轮必要的检索和核对，尚未返回的检索结果应等待，不能编造或提前声称完成。在实际完成后，将符合本轮结构的完整 JSON 作为 final_answer 正式提交并结束本轮；不要用空白回复维持等待。';
