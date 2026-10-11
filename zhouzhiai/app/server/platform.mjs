import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ROOT, DATA } from "./config.mjs";
const exec = promisify(execFile);
const require = createRequire(import.meta.url);
export function resourceRoot() {
  return (
    process.env.TONGZHOU_RESOURCES ||
    path.join(
      ROOT,
      "desktop/resources",
      `${process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : process.platform}-${process.arch}`,
    )
  );
}
export function codexBinary() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const exe = process.platform === "win32" ? "codex.exe" : "codex";
  const packaged = path.join(resourceRoot(), "codex/bin", exe);
  if (fs.existsSync(packaged)) return packaged;
  try {
    const pkg = path.dirname(
      require.resolve(
        `@openai/codex-${process.platform}-${process.arch}/package.json`,
      ),
    );
    const vendor = path.join(pkg, "vendor");
    for (const target of fs.readdirSync(vendor)) {
      const bin = path.join(vendor, target, "bin", exe);
      if (fs.existsSync(bin)) return bin;
    }
  } catch {}
  const desktop =
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
  if (process.platform === "darwin" && fs.existsSync(desktop)) return desktop;
  return exe;
}
export function dwgBinary() {
  const exe = process.platform === "win32" ? "dwg2dxf.exe" : "dwg2dxf";
  const candidates = [
    process.env.TONGZHOU_DWG_BIN,
    path.join(resourceRoot(), "cad", exe),
    "/opt/homebrew/bin/dwg2dxf",
    "/usr/local/bin/dwg2dxf",
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || exe;
}
export function fontFile() {
  return [
    process.env.TONGZHOU_FONT,
    process.platform === "win32"
      ? path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "msyh.ttc")
      : null,
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ].find((p) => p && fs.existsSync(p));
}
export async function diagnostics() {
  const checks = [];
  for (const [id, name, bin] of [
    ["codex", "Codex 引擎", codexBinary()],
    ["cad", "DWG 转换器", dwgBinary()],
  ]) {
    try {
      const { stdout } = await exec(bin, ["--version"], {
        timeout: 10000,
        windowsHide: true,
      });
      checks.push({
        id,
        name,
        status: "ready",
        detail: stdout.trim().split("\n")[0],
        path: bin,
      });
    } catch (e) {
      checks.push({
        id,
        name,
        status: "missing",
        detail:
          id === "cad"
            ? "DWG 转换不可用；仍可导入 DXF / PNG。"
            : "请检查安装包内置引擎或配置 CODEX_BIN。",
        path: bin,
      });
    }
  }
  fs.mkdirSync(DATA, { recursive: true });
  try {
    fs.accessSync(DATA, fs.constants.W_OK);
    checks.push({
      id: "storage",
      name: "本地数据目录",
      status: "ready",
      detail: DATA,
    });
  } catch {
    checks.push({
      id: "storage",
      name: "本地数据目录",
      status: "missing",
      detail: "目录不可写",
    });
  }
  checks.push({
    id: "documents",
    name: "Word / Excel / PDF",
    status: "ready",
    detail: "内置跨平台处理，无需安装 Office 或 Python",
  });
  checks.push({
    id: "font",
    name: "图纸中文字体",
    status: fontFile() ? "ready" : "missing",
    detail: fontFile() || "缺少中文字体，图中文字预览可能不完整",
  });
  return {
    platform: process.platform,
    arch: process.arch,
    version: "0.2.3",
    desktop: !!process.env.TONGZHOU_DESKTOP,
    checks,
  };
}
