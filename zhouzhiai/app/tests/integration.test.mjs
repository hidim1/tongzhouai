import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { ROOT, SOURCE } from "../server/config.mjs";
const base = "http://127.0.0.1:14319";
const headers = {
  "Content-Type": "application/json",
  "X-Tongzhou-Client": "workspace",
};
async function call(url, body, method = "POST") {
  const r = await fetch(base + "/api" + url, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}
async function state() {
  return (await fetch(base + "/api/bootstrap")).json();
}
async function waitJob(id) {
  for (let i = 0; i < 50; i++) {
    const j = (await state()).jobs.find((j) => j.id === id);
    if (["completed", "failed", "cancelled"].includes(j.status)) return j;
    await sleep(100);
  }
  throw new Error("Job timeout");
}
test(
  "MVP local API end-to-end with isolated data",
  { timeout: 180000 },
  async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tongzhou-test-"));
    let output = "";
    const child = spawn(process.execPath, ["server/index.mjs"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: "14319",
        TONGZHOU_DATA_DIR: dir,
        TONGZHOU_NO_AUTO_CONNECT: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (b) => (output += b));
    child.stderr.on("data", (b) => (output += b));
    t.after(async () => {
      child.kill("SIGTERM");
      await sleep(300);
      if (child.exitCode === null) child.kill("SIGKILL");
      fs.rmSync(dir, { recursive: true, force: true });
    });
    for (let i = 0; i < 150; i++) {
      try {
        await state();
        break;
      } catch {
        if (i === 149) throw new Error(output);
        await sleep(100);
      }
    }
    const initial = await state();
    const p = initial.projects[0];
    if (fs.existsSync(SOURCE)) {
      assert.equal(p.files.length, 6);
      assert.ok(p.results.live.requirements.length > 100);
    } else assert.equal(p.files.length, 0);
    await t.test(
      "mutation requests reject missing CSRF client header",
      async () => {
        const r = await fetch(base + "/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"name":"bad"}',
        });
        assert.equal(r.status, 403);
      },
    );
    await t.test(
      "demo cancellation really reaches cancelled state",
      async () => {
        const j = await call(`/projects/${p.id}/tasks`, {
          mode: "demo",
          skill: "bid-draft",
        });
        await call(`/jobs/${j.id}/cancel`, {});
        assert.equal((await waitJob(j.id)).status, "cancelled");
        await sleep(1200);
        assert.equal((await waitJob(j.id)).status, "cancelled");
      },
    );
    await t.test(
      "demo generation, mode isolation and human edit preservation",
      async () => {
        const before = p.results.live.materials.length;
        let j = await call(`/projects/${p.id}/tasks`, {
          mode: "demo",
          skill: "bom-draft",
        });
        assert.equal((await waitJob(j.id)).status, "completed");
        let project = (await state()).projects[0];
        assert.ok(project.results.demo.materials.length > before);
        assert.equal(project.results.live.materials.length, before);
        const row = project.results.demo.materials[0];
        await call(
          `/projects/${p.id}/results/demo/materials/${row.id}`,
          { ...row, note: "人工确认记录" },
          "PATCH",
        );
        j = await call(`/projects/${p.id}/tasks`, {
          mode: "demo",
          skill: "bom-draft",
        });
        await waitJob(j.id);
        project = (await state()).projects[0];
        assert.equal(
          project.results.demo.materials.find((x) => x.id === row.id).note,
          "人工确认记录",
        );
        assert.equal(project.results.demo.materials.length, before + 8);
      },
    );
    await t.test("new project upload and text extraction", async () => {
      const fresh = await call("/projects", { name: "测试上传项目" });
      const form = new FormData();
      form.append(
        "files",
        new Blob(["sample requirement\nflow 20m3"], { type: "text/plain" }),
        "notes.txt",
      );
      const response = await fetch(base + `/api/projects/${fresh.id}/files`, {
        method: "POST",
        headers: { "X-Tongzhou-Client": "workspace" },
        body: form,
      });
      assert.equal(response.status, 200);
      const files = await response.json();
      assert.match(files[0].textPreview, /20m3/);
      assert.ok(!("path" in files[0]));
    });
    await t.test("demo draft and real downloadable OOXML exports", async () => {
      const j = await call(`/projects/${p.id}/tasks`, {
        mode: "demo",
        skill: "bid-draft",
      });
      await waitJob(j.id);
      for (const type of ["docx", "xlsx"]) {
        const a = await call(`/projects/${p.id}/export`, {
          mode: "demo",
          type,
        });
        assert.match(a.name, /演示/);
        const download = await fetch(
          base + `/api/projects/${p.id}/artifacts/${a.id}`,
        );
        const bytes = new Uint8Array(await download.arrayBuffer());
        assert.equal(bytes[0], 80);
        assert.equal(bytes[1], 75);
        assert.ok(bytes.length > 1000);
        assert.equal(a.mode, "demo");
      }
    });
  },
);
