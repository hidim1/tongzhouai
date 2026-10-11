import { z } from "zod";
const str = z.string().max(18000);
export const requirement = z.object({
  id: str,
  category: str,
  content: str,
  expected: str,
  status: str,
  response: str,
  source: str,
  fileId: str,
});
export const material = z.object({
  id: str,
  name: str.describe("设备或物料名称，例如手动球阀、离心泵；不是材质。"),
  spec: str.describe("原文明确给出的型号、规格或额定参数，例如 DN25；未知为空字符串。"),
  material: str.describe("材质或材料牌号，例如 316L、304、PTFE；不是设备或物料名称。只采用原文明确的材质，未知为空字符串。"),
  unit: str,
  brand: str,
  quantity: z.number().nonnegative().nullable().describe("原文明确的数量；未提供则 null，不能根据出现次数推断。"),
  tag: str.describe("原始工艺位号，例如 V-101；未提供为空字符串。"),
  price: z.number().nonnegative().nullable().describe("有有效报价来源的单价；未提供则 null，不能填 0 或估价。"),
  status: str,
  source: str,
  fileId: str,
  note: str,
});
export const issue = z.object({
  id: str,
  title: str,
  detail: str,
  severity: z.enum(["high", "medium", "low"]),
  status: str,
  source: str,
  note: str,
});
export const section = z.object({ id: str, title: str, content: str });
export const resultSchema = z.object({
  summary: str,
  requirements: z.array(requirement).max(150),
  materials: z.array(material).max(150),
  issues: z.array(issue).max(50),
  sections: z.array(section).max(30),
});
export const jsonSchema = z.toJSONSchema(resultSchema);
