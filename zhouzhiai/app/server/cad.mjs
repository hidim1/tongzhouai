import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import DxfParser from "dxf-parser";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { dwgBinary, fontFile } from "./platform.mjs";
const exec = promisify(execFile);
const require = createRequire(import.meta.url);
let ready;
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
const plain = (s) =>
  String(s || "")
    .replace(/\\P/g, "\n")
    .replace(/\\[A-Za-z][^;]*;/g, "")
    .replace(/[{}]/g, "")
    .replace(/%%d/g, "°")
    .replace(/%%c/g, "Ø");
const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
export async function renderCad(source, out) {
  fs.mkdirSync(out, { recursive: true });
  let dxf = source;
  if (path.extname(source).toLowerCase() === ".dwg") {
    dxf = path.join(out, "process.dxf");
    const r = await exec(dwgBinary(), ["-y", "-o", dxf, source], {
      timeout: 90000,
      maxBuffer: 6 * 1024 * 1024,
      windowsHide: true,
    });
    fs.writeFileSync(path.join(out, "conversion.log"), r.stdout + r.stderr);
  }
  const raw = fs.readFileSync(dxf, "utf8");
  const drawing = new DxfParser().parseSync(raw);
  // dxf-parser skips INSERT attribute records. Recover placed attributes from ENTITIES,
  // not ATTDEF templates, so equipment tags remain available as evidence.
  const lines = raw.split(/\r?\n/);
  let section = "",
    record = [];
  const attrs = [];
  function flush() {
    if (section !== "ENTITIES" || record[0]?.[1] !== "ATTRIB") return;
    const get = (c) => record.find(([k]) => k === c)?.[1];
    if (Number(get(70) || 0) & 1) return;
    attrs.push({
      type: "ATTRIB",
      text: get(1) || "",
      position: { x: Number(get(10)), y: Number(get(20)) },
      height: Number(get(40) || 2),
      rotation: Number(get(50) || 0),
      layer: get(8) || "0",
    });
  }
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim()),
      value = lines[i + 1].trim();
    if (code === 0) {
      flush();
      record = [];
      if (value === "ENDSEC") section = "";
    }
    record.push([code, value]);
    if (code === 2 && record[0]?.[1] === "SECTION") section = value;
  }
  flush();
  drawing.entities.push(...attrs);
  const parts = [],
    texts = [],
    warnings = new Set();
  let count = 0;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  function point(p, m) {
    const x = m[0] * p.x + m[2] * p.y + m[4],
      y = m[1] * p.x + m[3] * p.y + m[5];
    if (!Number.isFinite(x + y)) return;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  function render(
    entities,
    m = [1, 0, 0, 1, 0, 0],
    depth = 0,
    inheritedColor = "#203644",
    inheritedLayer = "0",
  ) {
    if (depth > 12) {
      warnings.add("块嵌套超过12层");
      return;
    }
    for (const e of entities || []) {
      if (++count > 100000) throw new Error("图元数量超过预览上限");
      if (e.invisible) continue;
      const layerName = e.layer === "0" ? inheritedLayer : e.layer;
      const layer = drawing.tables?.layer?.layers?.[layerName];
      if (layer?.visible === false || layer?.frozen) continue;
      let rgb = e.colorIndex === 0 ? null : (e.color ?? layer?.color);
      if (rgb != null && rgb !== 16777215) {
        const r = (rgb >> 16) & 255,
          g = (rgb >> 8) & 255,
          b = rgb & 255;
        if (0.2126 * r + 0.7152 * g + 0.0722 * b > 155)
          rgb =
            (Math.round(r * 0.5) << 16) |
            (Math.round(g * 0.5) << 8) |
            Math.round(b * 0.5);
      }

      const color =
        rgb == null
          ? inheritedColor
          : rgb === 16777215 || rgb === 0
            ? "#203644"
            : "#" + rgb.toString(16).padStart(6, "0");
      let node = "";
      const pts = e.vertices || e.points;
      if (e.type === "INSERT") {
        const b = drawing.blocks[e.name];
        if (!b) {
          warnings.add("缺失块定义");
          continue;
        }
        const a = ((e.rotation || 0) * Math.PI) / 180,
          c = Math.cos(a),
          s = Math.sin(a),
          sx = e.xScale ?? 1,
          sy = e.yScale ?? 1,
          pos = e.position || { x: 0, y: 0 },
          origin = b.position || { x: 0, y: 0 };
        const n = multiply(
          [c * sx, s * sx, -s * sy, c * sy, pos.x, pos.y],
          [1, 0, 0, 1, -origin.x, -origin.y],
        );
        render(b.entities, multiply(m, n), depth + 1, color, layerName);
        continue;
      }
      if (e.type === "DIMENSION") {
        const b = drawing.blocks[e.block];
        if (b) render(b.entities, m, depth + 1, color, layerName);
        else warnings.add("未展开尺寸标注");
        continue;
      }
      if (
        ["LINE", "LWPOLYLINE", "POLYLINE", "SOLID", "3DFACE"].includes(
          e.type,
        ) &&
        pts?.length
      ) {
        pts.forEach((p) => point(p, m));
        let d = `M ${pts[0].x} ${pts[0].y}`;
        const end = pts.length + (e.shape ? 1 : 0);
        for (let i = 1; i < end; i++) {
          const p = pts[(i - 1) % pts.length],
            q = pts[i % pts.length],
            b = p.bulge;
          if (b) {
            const r =
              (Math.hypot(q.x - p.x, q.y - p.y) * (1 + b * b)) /
              (4 * Math.abs(b));
            d += ` A ${r} ${r} 0 ${Math.abs(b) > 1 ? 1 : 0} ${b > 0 ? 1 : 0} ${q.x} ${q.y}`;
          } else d += ` L ${q.x} ${q.y}`;
        }
        if (["SOLID", "3DFACE"].includes(e.type)) d += " Z";
        node = `<path d="${d}"/>`;
      } else if (["CIRCLE", "ARC", "ELLIPSE"].includes(e.type)) {
        const c = e.center;
        if (!c) continue;
        const a = e.majorAxisEndPoint;
        const rx = e.radius || Math.hypot(a?.x || 0, a?.y || 0),
          ry = e.type === "ELLIPSE" ? rx * e.axisRatio : rx;
        point({ x: c.x - rx, y: c.y - rx }, m);
        point({ x: c.x + rx, y: c.y + rx }, m);
        if (e.type === "CIRCLE")
          node = `<circle cx="${c.x}" cy="${c.y}" r="${rx}"/>`;
        else {
          let start = e.startAngle || 0,
            span = (e.endAngle ?? Math.PI * 2) - start;
          while (span <= 0) span += Math.PI * 2;
          const rotation = e.type === "ELLIPSE" ? Math.atan2(a.y, a.x) : 0;
          const curve = Array.from({ length: 65 }, (_, i) => {
            const t = start + (span * i) / 64,
              x = rx * Math.cos(t),
              y = ry * Math.sin(t);
            return `${c.x + x * Math.cos(rotation) - y * Math.sin(rotation)},${c.y + x * Math.sin(rotation) + y * Math.cos(rotation)}`;
          });
          node = `<polyline points="${curve.join(" ")}"/>`;
        }
      } else if (["TEXT", "MTEXT", "ATTRIB", "ATTDEF"].includes(e.type)) {
        const p = e.position || e.startPoint;
        if (!p) continue;
        const t = plain(e.text);
        texts.push(t);
        const h = e.height || e.textHeight || 2;
        point(p, m);
        point(
          {
            x: p.x + Math.max(...t.split("\n").map((s) => s.length)) * h * 0.65,
            y: p.y + h * 1.5,
          },
          m,
        );
        node = `<g transform="translate(${p.x} ${p.y}) rotate(${e.rotation || 0}) scale(1 -1)"><text fill="${color}" stroke="none" font-size="${h}" font-family="${process.platform === "win32" ? "Microsoft YaHei" : "Arial Unicode MS"}">${t
          .split("\n")
          .map(
            (line, i) =>
              `<tspan x="0" dy="${i ? h * 1.25 : 0}">${esc(line)}</tspan>`,
          )
          .join("")}</text></g>`;
      } else if (e.type !== "POINT")
        warnings.add(
          e.type === "SPLINE" ? "SPLINE 未渲染" : `未渲染 ${e.type}`,
        );
      if (node)
        parts.push(
          `<g stroke="${color}" transform="matrix(${m.join(" ")})">${node}</g>`,
        );
    }
  }
  render(drawing.entities);
  if (!Number.isFinite(minX) || maxX <= minX)
    throw new Error("没有可预览的二维图元");
  const pad = (maxX - minX) * 0.02,
    w = maxX - minX + pad * 2,
    h = maxY - minY + pad * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2800" height="${Math.max(200, Math.round((2800 * h) / w))}" viewBox="${minX - pad} ${-maxY - pad} ${w} ${h}"><rect x="${minX - pad}" y="${-maxY - pad}" width="${w}" height="${h}" fill="white"/><g transform="scale(1 -1)" fill="none" stroke="#203644" stroke-width="${w / 5000}">${parts.join("")}</g></svg>`;
  fs.writeFileSync(path.join(out, "process.svg"), svg);
  ready ??= initWasm(
    fs.readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
  );
  await ready;
  const font = fontFile();
  const renderer = new Resvg(svg, {
    fitTo: { mode: "width", value: 2800 },
    font: { fontBuffers: font ? [new Uint8Array(fs.readFileSync(font))] : [] },
  });
  const rendered = renderer.render();
  const preview = path.join(out, "process.png");
  fs.writeFileSync(preview, rendered.asPng());
  rendered.free();
  renderer.free();
  const text = [...new Set(texts.filter(Boolean))].join("\n");
  fs.writeFileSync(path.join(out, "texts.txt"), text);
  return {
    preview,
    text,
    stats: { entities: count, textItems: texts.length },
    note: `LibreDWG → DXF → 二维 PNG 预览。文字排版近似，亮色已适配白底。图元计数不是设备数量。${[...warnings].length ? " " + [...warnings].join("；") + "。" : ""}需核对原图，不构成完整算量。`,
  };
}
