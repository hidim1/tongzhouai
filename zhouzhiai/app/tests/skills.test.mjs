import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBundledSkills } from "../server/skills.mjs";

test("existing projects receive updated built-in skills without deleting extra files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tongzhou-skills-"));
  const src = path.join(dir, "bundled"), dst = path.join(dir, "project");
  try {
    fs.mkdirSync(path.join(src, "bom-draft/references"), { recursive: true });
    fs.writeFileSync(path.join(src, "bom-draft/SKILL.md"), "version one");
    fs.writeFileSync(path.join(src, "bom-draft/references/schema.json"), "{}");
    syncBundledSkills(src, dst);
    fs.writeFileSync(path.join(dst, "notes.txt"), "keep project additions");
    fs.writeFileSync(path.join(dst, "bom-draft/extra.md"), "keep extra references");
    fs.writeFileSync(path.join(src, "bom-draft/SKILL.md"), "version two");
    syncBundledSkills(src, dst);
    assert.equal(fs.readFileSync(path.join(dst, "bom-draft/SKILL.md"), "utf8"), "version two");
    assert.equal(fs.readFileSync(path.join(dst, "notes.txt"), "utf8"), "keep project additions");
    assert.equal(fs.readFileSync(path.join(dst, "bom-draft/extra.md"), "utf8"), "keep extra references");
    assert.equal(fs.readFileSync(path.join(dst, "bom-draft/references/schema.json"), "utf8"), "{}");
    const mtime = fs.statSync(path.join(dst, "bom-draft/SKILL.md")).mtimeMs;
    syncBundledSkills(src, dst);
    assert.equal(fs.statSync(path.join(dst, "bom-draft/SKILL.md")).mtimeMs, mtime);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
