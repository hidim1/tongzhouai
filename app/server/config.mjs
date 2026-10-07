import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const DATA = path.resolve(
  process.env.TONGZHOU_DATA_DIR || path.join(ROOT, "data"),
);
export const RUNTIME =
  process.env.CODEX_RUNTIME ||
  path.join(
    os.homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies",
  );
export const PYTHON =
  process.env.TONGZHOU_PYTHON || path.join(RUNTIME, "python/bin/python3");
export const BUNDLED_NODE = path.join(RUNTIME, "node/bin/node");
export const SOURCE = path.resolve(
  ROOT,
  "../reference_materials/20260922-AI赋能-鼎捷",
);
export const SKILLS = [
  "project-intake",
  "urs-analysis",
  "bom-draft",
  "bid-draft",
  "consistency-review",
];
export const skillNames = {
  "project-intake": "项目资料整理",
  "urs-analysis": "招标需求解析",
  "bom-draft": "材料清单整理",
  "bid-draft": "技术标编制",
  "consistency-review": "一致性审查",
};
