import { extractDocument } from "./documents.mjs";
import fs from "node:fs";
import path from "node:path";
import { uid, projectDir, timestamp, save } from "./store.mjs";
export async function ingest(p, source, name = path.basename(source)) {
  const id = uid("file"),
    ext = path.extname(name).toLowerCase();
  const filePath = path.join(projectDir(p.id), "inputs", id + ext);
  fs.copyFileSync(source, filePath);
  const f = {
    id,
    name,
    ext,
    size: fs.statSync(filePath).size,
    path: filePath,
    status: "parsed",
    category: [".dwg", ".dxf"].includes(ext)
      ? "工艺图纸"
      : name.includes("需求")
        ? "招标要求"
        : name.includes("设计")
          ? "设计输入"
          : name.includes("清单")
            ? "材料清单"
            : "投标资料",
    text: "",
    addedAt: timestamp(),
  };
  try {
    const parsed = await extractDocument(filePath);
    Object.assign(f, parsed);
    if (parsed.unsupported) f.status = "pending";
    if (!f.text && f.status === "parsed") f.status = "empty";
  } catch (e) {
    f.status = "failed";
    f.error = e.message.slice(0, 250);
  }
  if ([".png", ".jpg", ".jpeg"].includes(ext)) {
    f.preview = filePath;
    f.status = "preview";
  }
  p.files.push(f);
  p.updatedAt = timestamp();
  save();
  return f;
}
export function derive(p) {
  const requirements = [];
  const materials = [];
  for (const f of p.files) {
    if (f.category === "招标要求" && !(f.tables || []).length) {
      const body = f.text.split(/\n五、技术要求\n/).at(-1) || "";
      const sections = body.split(/\n(?=[ \t]*5\.\d+\s*[^\n]*)/);
      for (const section of sections) {
        const heading =
          section
            .split("\n")
            .find((x) => /^5\./.test(x.trim()))
            ?.trim() || "技术要求";
        const chunks = section.split(/\n\s*(必需|期望)\s*\n/);
        for (let i = 0; i + 1 < chunks.length; i += 2) {
          const content = chunks[i]
            .split("\n")
            .map((x) => x.replace(/\u0007/g, " ").trim())
            .filter(
              (x) =>
                x &&
                !/^5\.\d+/.test(x) &&
                ![
                  "编号",
                  "要求",
                  "期望值",
                  "响应值",
                  "类别",
                  "需求",
                  "项目",
                  "品牌",
                ].includes(x) &&
                !x.startsWith("编号 "),
            )
            .join("\n")
            .trim();
          if (content.length < 5) continue;
          requirements.push({
            id: "URS-" + String(requirements.length + 1).padStart(3, "0"),
            category: heading.replace(/^5\.\d+\s*/, ""),
            content,
            expected: chunks[i + 1],
            status: "待确认",
            response: "",
            source: `${f.name} · ${heading} · 文本条目${i / 2 + 1}`,
            fileId: f.id,
          });
        }
      }
    }
    if (f.category === "招标要求")
      for (const [ti, table] of (f.tables || []).entries())
        for (const [ri, row] of table.entries()) {
          if (!row.includes("必需") && !row.includes("期望")) continue;
          const content = row
            .filter((c) => !["必需", "期望", ""].includes(c))
            .sort((a, b) => b.length - a.length)[0];
          if (!content || content.length < 8) continue;
          requirements.push({
            id: "URS-" + String(requirements.length + 1).padStart(3, "0"),
            category:
              content.includes("PLC") || content.includes("HMI")
                ? "电气自控"
                : content.includes("膜")
                  ? "工艺设备"
                  : "通用要求",
            content,
            expected: row.includes("必需") ? "必需" : "期望",
            status: "待确认",
            response: "",
            source: `${f.name} · 表${ti + 1}行${ri + 1}`,
            fileId: f.id,
          });
        }
    if (f.category === "材料清单")
      for (const sheet of f.sheets || [])
        for (const row of sheet.rows) {
          const n = Object.keys(row).find((k) => /^D\d+$/.test(k));
          if (!n) continue;
          const i = n.slice(1);
          if (!row["K" + i] || !row[n] || row[n] === "产品名称") continue;
          materials.push({
            id: "mat-" + f.id + "-" + i,
            name: row[n],
            spec: row["E" + i] || "",
            material: row["F" + i] || "",
            unit: (row["G" + i] || "").trim(),
            brand: row["H" + i] || "",
            quantity: Number(row["I" + i]) || null,
            tag: row["K" + i] || "",
            price: null,
            status: "待确认",
            source: `${f.name} · ${sheet.name}!D${i}:K${i}`,
            fileId: f.id,
            note: "原始清单示例，尚未与图纸核对",
          });
        }
  }
  const urs = p.files.find((f) => f.category === "招标要求");
  const design = p.files.find((f) => f.category === "设计输入");
  const issues = [];
  if (urs?.text.includes("300m2") && design?.text.includes("E2=74"))
    issues.push({
      id: "issue-area",
      title: "膜面积与设计输入存在范围差异",
      detail:
        "URS 要求膜面积 ≥300㎡；设计输入为 74㎡。请确认是否属于同一项目、同一套数或同一版本，不能直接判定满足。",
      severity: "high",
      status: "待确认",
      source: `${urs.name} · 5.1；${design.name} · 投标设计!E2`,
      note: "",
    });
  if (urs?.text.includes("20m³") && design?.text.includes("B3=0.8"))
    issues.push({
      id: "issue-volume",
      title: "单批处理量口径待核实",
      detail:
        "URS 约20m³/批；设计输入滤液总体积为0.8m³/批。进料与滤液不是同一指标，请工程师确认计算边界。",
      severity: "medium",
      status: "待确认",
      source: `${urs.name} · 5.1；${design.name} · 投标设计!B3`,
      note: "",
    });
  if (!p.files.some((f) => f.name.includes("价格") || f.name.includes("报价")))
    issues.push({
      id: "issue-price",
      title: "缺少有效物料价格来源",
      detail:
        "当前未提供供应商报价或历史采购价格。材料清单可先整理，金额留空并标记待询价。",
      severity: "medium",
      status: "待确认",
      source: "项目资料清单",
      note: "",
    });
  return {
    requirements,
    materials,
    issues,
    sections: [],
    source: "本地资料预解析",
    updatedAt: timestamp(),
    summary: `已从实际文件提取 ${requirements.length} 条需求、${materials.length} 条原始材料记录。图纸及工程参数仍需复核。`,
  };
}
export function draftSections(p, result) {
  return [
    {
      id: "s1",
      title: "一 技术需求偏离和响应情况",
      content: `本文件为${p.name}技术标初稿，供工程师审核。当前整理 ${result.requirements.length} 条需求。未确认的条目不承诺无偏离；具体响应见后附需求响应表。`,
    },
    {
      id: "s2",
      title: "二 综合技术说明",
      content:
        "依据客户用户需求说明书，系统方案涉及供料、循环过滤、膜组件、清洗、在线仪表与自动控制。具体设备选型、处理能力、最小运行体积、换热面积和清洗罐容积需设计人员核定。\n膜面积、处理量及设计版本一致性待确认；本初稿不代替最终设计。",
    },
    {
      id: "s3",
      title: "三 设备配置与选型依据",
      content: `当前材料清单共 ${result.materials.length} 条记录，保留来源、工艺位号及确认状态。未提供图纸支持的数量不补猜，未提供有效价格的物料标记待询价。`,
    },
    {
      id: "s4",
      title: "四 自动化方案",
      content:
        "按 URS 要求核对 PLC、HMI、I/O 点位余量、通讯、报警与权限管理。实施配置及型号须由电气工程师确认，不能以通用描述替代逐条技术响应。",
    },
    {
      id: "s5",
      title: "五 质量保障与交付资料",
      content:
        "设计、制造、安装及测试计划待项目团队补充。按客户要求整理工艺图纸、设备清单、操作维护资料及 FAT、SAT、DQ/IQ/OQ/PQ 等文件清单。具体交付范围、周期与承诺由企业确认。",
    },
    {
      id: "s6",
      title: "六 待确认事项",
      content:
        result.issues
          .filter((x) => x.status !== "已确认")
          .map((x, i) => `${i + 1}. ${x.title}\n${x.detail}`)
          .join("\n\n") || "当前未登记待确认事项，仍需工程师终审。",
    },
  ];
}
