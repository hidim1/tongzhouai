import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tz-provider-"));
process.env.TONGZHOU_DATA_DIR = dir;
const {
  initializeProvider,
  saveProvider,
  providerStatus,
  providerModels,
  normalizeProvider,
  redact,
  codexProviderRuntime,
  assertSessionProvider,
  providerIdentity,
} = await import("../server/provider.mjs");
test("Mikoto credentials stay local, masked, host-pinned, and independent of official Codex", async (t) => {
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await initializeProvider();
  assert.equal(providerStatus().hasKey, false);
  const secret = "sk-fixture-only-not-a-real-credential";
  const status = await saveProvider({
    provider: "mikoto",
    model: "gpt-5.4",
    apiKey: secret,
  });
  assert.equal(status.hasKey, true);
  assert.ok(!JSON.stringify(status).includes(secret));
  assert.equal(
    fs.statSync(path.join(dir, "private/provider.json")).mode & 0o777,
    0o600,
  );
  assert.equal(redact(`error Bearer ${secret}`), "error Bearer [REDACTED]");
  const runtime = codexProviderRuntime();
  assert.ok(!runtime.args.join(" ").includes(secret));
  assert.match(runtime.args.join(" "), /wire_api="responses"/);
  assert.equal(runtime.env.TONGZHOU_PROVIDER_API_KEY, secret);
  assert.ok(runtime.env.CODEX_HOME.startsWith(dir));
  assert.throws(
    () =>
      normalizeProvider({
        provider: "mikoto",
        baseUrl: "https://evil.example/v1",
      }),
    /仅支持/,
  );
  assert.throws(
    () => normalizeProvider({ provider: "mikoto", model: 'x"\nkey=bad' }),
    /模型/,
  );
  assert.throws(
    () =>
      normalizeProvider({ provider: "mikoto", apiKey: "bad\r\nheader:value" }),
    /密钥/,
  );
  const models = await providerModels(async (url, init) => {
    assert.equal(url, "https://api.mikoto.vip/v1/models");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, `Bearer ${secret}`);
    return {
      ok: true,
      json: async () => ({ data: [{ id: "gpt-5.4" }, { id: "bad\nmodel" }] }),
    };
  });
  assert.equal(models.data.length, 1);
  await assert.rejects(
    providerModels(async () => {
      throw Error(secret);
    }),
    (e) => !e.message.includes(secret),
  );
  await assert.rejects(
    providerModels(async () => ({ ok: false, status: 502 })),
    /HTTP 502/,
  );
  assert.throws(
    () => assertSessionProvider({ threadId: "old-official-session" }),
    /新建会话/,
  );
  assert.doesNotThrow(() =>
    assertSessionProvider({
      threadId: "native",
      providerIdentity: providerIdentity(),
    }),
  );
  await saveProvider({ provider: "openai" });
  assert.deepEqual(codexProviderRuntime(), { args: [], env: {} });
  assert.throws(
    () =>
      assertSessionProvider({
        threadId: "native",
        providerIdentity: "mikoto:https://api.mikoto.vip/v1",
      }),
    /新建会话/,
  );
  assert.doesNotThrow(() =>
    assertSessionProvider({ threadId: "old-official-session" }),
  );
  await saveProvider({ provider: "mikoto", apiKey: "" });
  assert.equal(
    providerStatus().hasKey,
    true,
    "blank password preserves stored key",
  );
  await saveProvider({ provider: "mikoto", clearKey: true });
  assert.equal(providerStatus().hasKey, false);
  assert.throws(() => codexProviderRuntime(), /保存/);
  assert.ok(
    !fs
      .readFileSync(path.join(dir, "private/provider.json"), "utf8")
      .includes(secret),
  );
});
