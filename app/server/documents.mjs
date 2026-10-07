import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { load } from "cheerio";
import { extractText, getDocumentProxy } from "unpdf";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  Header,
  Footer,
  PageNumber,
  ShadingType,
} from "docx";

// Portable document processing: no Office, Python or host-specific runtime.
export async function extractDocument(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".docx") {
    const raw = await mammoth.extractRawText({ path: file });
    const html = await mammoth.convertToHtml({ path: file });
    const $ = load(html.value);
    const tables = $("table")
      .toArray()
      .map((t) =>
        $(t)
          .find("tr")
          .toArray()
          .map((r) =>
            $(r)
              .children("td,th")
              .toArray()
              .map((c) => $(c).text().trim()),
          ),
      );
    return { text: raw.value.replace(/\n\n/g, "\n"), tables };
  }
  if (ext === ".doc") {
    const d = await new WordExtractor().extract(file);
    return {
      text: d
        .getBody()
        .replace(/\r/g, "\n")
        .replace(/[\u0007\t]/g, "\n"),
      tables: [],
      parseNote:
        "旧版 DOC 按正文提取，修订中已删除的文字不计入当前正文；表格编号与版式请核对原文。",
    };
  }
  if (ext === ".xlsx") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const sheets = wb.worksheets.map((s) => {
      const rows = [];
      s.eachRow((row) => {
        const cells = {};
        row.eachCell((cell) => {
          let value = cell.value;
          if (value && typeof value === "object") {
            value =
              value.result ??
              value.text ??
              value.richText?.map((r) => r.text).join("") ??
              "";
          }
          if (value !== null && value !== "")
            cells[cell.address] = String(value);
        });
        if (Object.keys(cells).length) rows.push(cells);
      });
      return { name: s.name, rows };
    });
    return {
      sheets,
      text: sheets
        .map(
          (s) =>
            s.name +
            "\n" +
            s.rows
              .map((r) =>
                Object.entries(r)
                  .map(([k, v]) => k + "=" + v)
                  .join(" | "),
              )
              .join("\n"),
        )
        .join("\n"),
    };
  }
  if (ext === ".pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
    try {
      const { text } = await extractText(pdf, { mergePages: false });
      return { text: text.map((p, i) => `第${i + 1}页\n${p}`).join("\n") };
    } finally {
      await pdf.destroy();
    }
  }
  if ([".txt", ".md", ".csv"].includes(ext))
    return { text: fs.readFileSync(file, "utf8") };
  return { text: "", unsupported: true };
}
export async function writeXlsx(target, project, mode, result) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "同舟 AI";
  const sheet = wb.addWorksheet("材料清单");
  const widths = [7, 24, 28, 16, 9, 18, 10, 16, 18, 14, 48, 62];
  sheet.columns = widths.map((width) => ({ width }));
  sheet.mergeCells("A1:L1");
  sheet.getCell("A1").value =
    `${mode === "demo" ? "演示数据 · " : ""}${project} 材料清单草稿`;
  sheet.getCell("A1").font = { name: "Microsoft YaHei", size: 16, bold: true };
  sheet.getRow(1).height = 34;
  sheet.mergeCells("A2:L2");
  sheet.getCell("A2").value =
    "未知数量和价格留空；工程师审核后使用。来源：" + result.source;
  sheet.getRow(2).height = 24;
  sheet.addRow([]);
  sheet.getRow(4).values = [
    "序号",
    "产品名称",
    "规格型号",
    "材质",
    "单位",
    "品牌",
    "数量",
    "单价（元）",
    "工艺位号",
    "确认状态",
    "备注",
    "来源",
  ];
  for (const [i, x] of result.materials.entries())
    sheet.addRow([
      i + 1,
      x.name,
      x.spec,
      x.material,
      x.unit,
      x.brand,
      x.quantity,
      x.price,
      x.tag,
      x.status,
      x.note,
      x.source,
    ]);
  sheet.eachRow((row, ri) => {
    if (ri < 4) return;
    let lines = 1;
    row.eachCell({ includeEmpty: true }, (c, ci) => {
      c.font = {
        name: "Microsoft YaHei",
        size: 10,
        ...(ri === 4 ? { bold: true, color: { argb: "FFFFFFFF" } } : {}),
      };
      c.alignment = { vertical: "middle", wrapText: true };
      c.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb: ri === 4 ? "17384A" : ri % 2 === 0 ? "F2F6F8" : "FFFFFF",
        },
      };
      c.border = Object.fromEntries(
        ["top", "bottom", "left", "right"].map((k) => [
          k,
          { style: "thin", color: { argb: "DCE4E9" } },
        ]),
      );
      const count = [...String(c.value ?? "")].reduce(
        (n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1),
        0,
      );
      lines = Math.max(lines, Math.ceil(count / (widths[ci - 1] - 2)));
    });
    row.height = ri === 4 ? 28 : Math.max(36, lines * 14 + 14);
  });
  sheet.getColumn(8).numFmt = "#,##0.00";
  sheet.views = [{ state: "frozen", ySplit: 4, showGridLines: false }];
  sheet.autoFilter = { from: "A4", to: `L${Math.max(4, sheet.rowCount)}` };
  await wb.xlsx.writeFile(target);
}
export async function writeDocx(target, project, mode, result) {
  const font = "Arial Unicode MS";
  const text = (p) =>
    new Paragraph({
      children: [new TextRun({ text: String(p), font, size: 21 })],
      spacing: { after: 120, line: 300 },
    });
  const heading = (t) =>
    new Paragraph({
      text: t,
      heading: HeadingLevel.HEADING_1,
      keepNext: true,
      spacing: { before: 240, after: 120 },
    });
  const sourceNames = result.fileNames || {};
  const readable = (t) =>
    String(t).replace(/file-[a-z0-9]+/g, (id) => sourceNames[id] || id);
  const table = (heads, rows, widths) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: widths,
      rows: [heads, ...rows].map(
        (row, ri) =>
          new TableRow({
            tableHeader: ri === 0,
            children: row.map(
              (v, i) =>
                new TableCell({
                  width: { size: widths[i], type: WidthType.DXA },
                  shading: {
                    type: ShadingType.CLEAR,
                    fill:
                      ri === 0 ? "17384A" : ri % 2 === 0 ? "F3F6F8" : "FFFFFF",
                  },
                  margins: { top: 90, bottom: 90, left: 90, right: 90 },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: String(v ?? ""),
                          font,
                          size: 18,
                          bold: ri === 0,
                          color: ri === 0 ? "FFFFFF" : "243546",
                        }),
                      ],
                    }),
                  ],
                }),
            ),
          }),
      ),
    });
  const children = [
    new Paragraph({ text: "技术标初稿", heading: HeadingLevel.TITLE }),
    text(project),
    text(
      mode === "demo"
        ? "演示模式输出，不作为正式技术承诺。"
        : "依据现有项目资料整理，未经确认的参数和承诺保留待确认状态。",
    ),
    text("生成依据：" + result.source),
    text(result.summary),
  ];
  for (const s of result.sections) {
    children.push(
      heading(s.title),
      ...readable(s.content).split("\n").filter(Boolean).map(text),
    );
  }
  children.push(
    new Paragraph({
      text: "附表：用户需求响应表",
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
    }),
    table(
      ["编号", "需求及来源", "供方响应"],
      result.requirements.map((x) => [
        x.id,
        x.content + "\n来源：" + x.source,
        x.status + "\n" + (x.response || "需工程师确认具体响应"),
      ]),
      [1100, 5900, 2600],
    ),
  );
  children.push(
    heading("附表：设备配置草稿"),
    table(
      ["名称", "规格型号", "数量", "状态"],
      result.materials.map((x) => [x.name, x.spec, x.quantity, x.status]),
      [2600, 4300, 1000, 1700],
    ),
  );
  const doc = new Document({
    creator: "同舟 AI",
    styles: {
      default: {
        document: {
          run: { font, size: 21 },
          paragraph: { spacing: { after: 120 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
          },
        },
        headers: {
          default: new Header({
            children: [text("同舟纵横（厦门）流体技术有限公司")],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "同舟 AI · 工程师审核稿    ",
                    font,
                    size: 18,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    font,
                    size: 18,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  fs.writeFileSync(target, await Packer.toBuffer(doc));
}
