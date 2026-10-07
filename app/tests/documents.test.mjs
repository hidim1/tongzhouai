import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { extractDocument, writeDocx, writeXlsx } from "../server/documents.mjs";
import { derive } from "../server/intake.mjs";
import { SOURCE } from "../server/config.mjs";
test("portable document exports round-trip and formulas remain text", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tz-docs-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = {
    summary: "实际内容",
    source: "验收",
    sections: [
      { id: "s", title: "项目概况", content: "正文第一段\n正文第二段" },
    ],
    requirements: [],
    materials: [
      {
        name: "=1+1",
        spec: "中文规格",
        material: "316L",
        unit: "台",
        brand: "待确认",
        quantity: null,
        price: null,
        tag: "P-1",
        status: "待确认",
        note: "测试",
        source: "资料.xlsx!A1",
      },
    ],
  };
  await writeXlsx(path.join(dir, "a.xlsx"), "项目", "live", result);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(dir, "a.xlsx"));
  assert.equal(wb.worksheets[0].getCell("B5").value, "=1+1");
  assert.equal(wb.worksheets[0].getCell("G5").value, null);
  await writeDocx(path.join(dir, "a.docx"), "项目", "live", result);
  const read = await extractDocument(path.join(dir, "a.docx"));
  assert.match(read.text, /正文第一段/);
  assert.match(read.text, /正文第二段/);
  assert.match(read.text, /同州|实际内容/);
});
test(
  "sample DOC extraction excludes tracked deletions and retains active requirements",
  { skip: !fs.existsSync(SOURCE) },
  async () => {
    const name = fs.readdirSync(SOURCE).find((n) => n.endsWith(".doc"));
    const parsed = await extractDocument(path.join(SOURCE, name));
    assert.match(parsed.text, /膜面积/);
    assert.ok(!parsed.text.includes("必须提供安全评估"));
    const r = derive({
      files: [{ ...parsed, id: "u", name, category: "招标要求" }],
    });
    assert.equal(r.requirements.length, 117);
    assert.match(parsed.parseNote, /修订/);
  },
);
