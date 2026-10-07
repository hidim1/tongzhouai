import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEMO_PROJECT_DESCRIPTION, migrateProjectBranding } from "../server/branding.mjs";

test("remove only obsolete demo attribution and preserve user documents", () => {
  const file = { name: "鼎捷原始资料.pdf", text: "原始资料内容不改" };
  const projects = [
    { description: "鼎捷 AI 赋能 · 同舟纵横流体技术", files: [file] },
    { description: "客户自定义：鼎捷项目", files: [] },
    { description: "工程投标项目", files: [] },
  ];
  assert.equal(migrateProjectBranding(projects), true);
  assert.equal(projects[0].description, DEMO_PROJECT_DESCRIPTION);
  assert.equal(projects[0].files[0], file);
  assert.equal(projects[1].description, "客户自定义：鼎捷项目");
  assert.equal(projects[2].description, "工程投标项目");
  assert.equal(migrateProjectBranding(projects), false);
});

test("existing workspace attribution migration persists across startup", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tongzhou-branding-"));
  try {
    const file = path.join(dir, "workspace.json");
    fs.writeFileSync(file, JSON.stringify({ version: 2, brand: "同舟 AI", jobs: [], sessions: [], projects: [{ id: "fixture", description: "鼎捷 AI 赋能 · 同舟纵横流体技术", files: [] }] }));
    execFileSync(process.execPath, ["--input-type=module", "-e", "import './server/store.mjs';"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, TONGZHOU_DATA_DIR: dir },
    });
    assert.equal(JSON.parse(fs.readFileSync(file)).projects[0].description, DEMO_PROJECT_DESCRIPTION);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
