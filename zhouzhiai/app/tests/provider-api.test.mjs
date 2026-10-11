import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { ROOT } from "../server/config.mjs";
test("provider settings HTTP boundary persists, redacts and clears credentials", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tz-provider-api-"));
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: "14322",
      TONGZHOU_DATA_DIR: dir,
      TONGZHOU_DESKTOP: "1",
      TONGZHOU_NO_AUTO_CONNECT: "1",
      CODEX_BIN: path.join(dir, "not-installed"),
    },
    stdio: "ignore",
  });
  t.after(async () => {
    child.kill();
    await sleep(200);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:14322/api";
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base + "/bootstrap");
      break;
    } catch {
      await sleep(100);
    }
  }
  const secret = "sk-fixture-http-boundary-test";
  const body = { provider: "mikoto", model: "gpt-5.4", apiKey: secret };
  const put = (value, headers = {}) =>
    fetch(base + "/engine/provider", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Tongzhou-Client": "workspace",
        ...headers,
      },
      body: JSON.stringify(value),
    });
  assert.equal(
    (await put(body, { Origin: "https://untrusted.example" })).status,
    403,
  );
  let r = await put(body);
  assert.equal(r.status, 200);
  let response = await r.text();
  assert.ok(!response.includes(secret));
  assert.equal(JSON.parse(response).hasKey, true);
  for (const route of ["/engine/provider", "/engine", "/bootstrap"])
    assert.ok(!(await (await fetch(base + route)).text()).includes(secret));
  assert.equal(
    (await put({ ...body, baseUrl: "https://attacker.invalid/v1" })).status,
    400,
  );
  r = await put({ provider: "mikoto", model: "gpt-5.4", apiKey: "" });
  assert.equal((await r.json()).hasKey, true);
  r = await put({ provider: "mikoto", model: "gpt-5.4", clearKey: true });
  assert.equal((await r.json()).hasKey, false);
  assert.ok(
    !fs
      .readFileSync(path.join(dir, "private/provider.json"), "utf8")
      .includes(secret),
  );
});
