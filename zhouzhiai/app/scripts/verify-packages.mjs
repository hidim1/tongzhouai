import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const sha = (p) =>
  createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const report = { at: new Date().toISOString(), packages: [], payloads: [] };
for (const name of [
  "Tongzhou-AI-0.2.2-mac-arm64.dmg",
  "Tongzhou-AI-0.2.2-mac-arm64.zip",
  "Tongzhou-AI-0.2.2-win-x64.exe",
]) {
  const p = path.join("release", name);
  assert.ok(fs.statSync(p).size > 10000000);
  report.packages.push({ name, bytes: fs.statSync(p).size, sha256: sha(p) });
}
for (const [target, root] of [
  ["mac-arm64", "release/mac-arm64/同舟 AI.app/Contents/Resources"],
  ["win-x64", "release/win-unpacked/resources"],
]) {
  const archive = path.join(root, "app.asar");
  const files = asar.listPackage(archive);
  const secret = fs.existsSync("data/private/provider.json")
    ? JSON.parse(fs.readFileSync("data/private/provider.json")).apiKey
    : "";
  if (secret)
    assert.ok(
      !fs.readFileSync(archive).includes(Buffer.from(secret)),
      "credential must not be bundled",
    );
  assert.equal(files.filter((p) => p.endsWith("/SKILL.md")).length, 5);
  assert.ok(
    !files.some((p) =>
      /^\/(data|reference_materials|tests|desktop\/\.cache)(\/|$)/.test(p),
    ),
  );
  assert.ok(
    !files.some((p) => p.endsWith("/auth.json") || p.endsWith("/config.toml")),
  );
  const version = JSON.parse(asar.extractFile(archive, "package.json")).version;
  assert.equal(version, "0.2.2");
  for (const f of [
    "server/jobs.mjs",
    "server/identity.mjs",
    "server/cad.mjs",
    "server/provider.mjs",
    "desktop/main.cjs",
    "desktop/provider-vault.cjs",
    "dist/brand/crossflow-logo.png",
  ])
    assert.equal(
      createHash("sha256").update(asar.extractFile(archive, f)).digest("hex"),
      sha(f),
    );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "runtime/manifest.json")),
  );
  for (const f of manifest.files)
    assert.equal(sha(path.join(root, "runtime", f.path)), f.sha256);
  report.payloads.push({
    target,
    skills: 5,
    version,
    files: files.length,
    customerDataIncluded: false,
    credentialIncluded: false,
    runtimeManifestVerified: true,
  });
}
fs.writeFileSync("data/qa/packages-v022.json", JSON.stringify(report, null, 2));
fs.writeFileSync(
  "release/SHA256SUMS.txt",
  report.packages.map((p) => `${p.sha256}  ${p.name}`).join("\n") + "\n",
);
console.log(JSON.stringify(report, null, 2));
