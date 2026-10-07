import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { ROOT } from "../server/config.mjs";
test("desktop bootstrap guard and fresh installation privacy", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tz-guard-"));
  const token = "a".repeat(64);
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: "14321",
      TONGZHOU_DATA_DIR: dir,
      TONGZHOU_DESKTOP: "1",
      TONGZHOU_SESSION_TOKEN: token,
      TONGZHOU_NO_AUTO_CONNECT: "1",
    },
    stdio: "ignore",
  });
  t.after(async () => {
    child.kill();
    await sleep(300);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:14321";
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base);
      break;
    } catch {
      await sleep(100);
    }
  }
  assert.equal((await fetch(base + "/api/bootstrap")).status, 401);
  assert.equal(
    (await fetch(base, { headers: { "X-Tongzhou-Session": "é".repeat(64) } }))
      .status,
    401,
  );
  const r = await fetch(base + "/api/bootstrap", {
    headers: { "X-Tongzhou-Session": token },
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const d = await r.json();
  assert.equal(d.projects.length, 1);
  assert.equal(d.projects[0].files.length, 0);
  assert.equal(d.jobs.length, 0);
  const cookie = `tz_session=${token}`;
  assert.equal(
    (await fetch(base + "/api/bootstrap", { headers: { Cookie: cookie } }))
      .status,
    200,
  );
  assert.equal(
    (
      await fetch(base + "/api/bootstrap", {
        headers: { Cookie: cookie, Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/projects", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: '{"name":"bad"}',
      })
    ).status,
    403,
  );
});
