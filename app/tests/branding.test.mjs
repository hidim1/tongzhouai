import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEMO_PROJECT_DESCRIPTION, PRODUCT_NAME, migrateProjectBranding, migrateWorkspaceBranding } from "../server/branding.mjs";

test("rename previous product defaults while retaining custom workspace names and history", () => {
  for (const brand of ["同舟 AI", "同舟AI", "同州 AI", "同州AI"]) {
    const history = [{ summary: "我是同舟 AI" }];
    const workspace = { brand, jobs: history };
    assert.equal(migrateWorkspaceBranding(workspace), true);
    assert.equal(workspace.brand, PRODUCT_NAME);
    assert.equal(workspace.jobs, history);
    assert.equal(history[0].summary, "我是同舟 AI");
    assert.equal(migrateWorkspaceBranding(workspace), false);
  }
  const custom = { brand: "工程一部助手" };
  assert.equal(migrateWorkspaceBranding(custom), false);
  assert.equal(custom.brand, "工程一部助手");
});

test("workspace name migration persists even without project-description changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zhouzhi-branding-"));
  try {
    const file = path.join(dir, "workspace.json");
    const workspace = { version: 2, brand: "同舟 AI", jobs: [], sessions: [], projects: [{ id: "fixture", description: "工程投标项目", files: [] }] };
    fs.writeFileSync(file, JSON.stringify(workspace));
    for (let run = 0; run < 2; run++) {
      execFileSync(process.execPath, ["--input-type=module", "-e", "import './server/store.mjs';"], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, TONGZHOU_DATA_DIR: dir },
      });
      assert.deepEqual(JSON.parse(fs.readFileSync(file)), { ...workspace, brand: PRODUCT_NAME });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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
    fs.writeFileSync(file, JSON.stringify({ version: 2, brand: "舟知", jobs: [], sessions: [], projects: [{ id: "fixture", description: "鼎捷 AI 赋能 · 同舟纵横流体技术", files: [] }] }));
    execFileSync(process.execPath, ["--input-type=module", "-e", "import './server/store.mjs';"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, TONGZHOU_DATA_DIR: dir },
    });
    assert.equal(JSON.parse(fs.readFileSync(file)).projects[0].description, DEMO_PROJECT_DESCRIPTION);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
