import fs from "node:fs";
import path from "node:path";
import { uid, timestamp, projectDir, save } from "./store.mjs";
import { draftSections } from "./intake.mjs";
import { writeDocx, writeXlsx } from "./documents.mjs";
export async function exportProject(p, mode, type) {
  const result = p.results[mode];
  const id = uid("artifact");
  const dir = path.join(projectDir(p.id), "outputs");
  fs.mkdirSync(dir, { recursive: true });
  const name = `${mode === "demo" ? "演示_" : ""}${type === "xlsx" ? "工艺材料清单" : "技术标初稿"}_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.${type}`;
  const target = path.join(dir, id + "." + type);
  if (type === "xlsx") await writeXlsx(target, p.name, mode, result);
  else if (type === "docx")
    await writeDocx(target, p.name, mode, {
      ...result,
      fileNames: Object.fromEntries(p.files.map((f) => [f.id, f.name])),
      sections: result.sections.length
        ? result.sections
        : draftSections(p, result),
    });
  else throw new Error("不支持的文件格式");
  const a = {
    id,
    name,
    type,
    mode,
    path: target,
    size: fs.statSync(target).size,
    createdAt: timestamp(),
    source: result.source,
  };
  p.artifacts.unshift(a);
  save();
  return a;
}
