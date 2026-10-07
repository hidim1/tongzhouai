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
  name: str,
  spec: str,
  material: str,
  unit: str,
  brand: str,
  quantity: z.number().nonnegative().nullable(),
  tag: str,
  price: z.number().nonnegative().nullable(),
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
