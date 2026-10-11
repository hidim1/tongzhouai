import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("SSH server mode reports server storage and seeds no customer fixtures", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tongzhou-server-"));
  try {
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { SERVER } from './server/config.mjs';
      import { seed } from './scripts/seed.mjs';
      import { store } from './server/store.mjs';
      await seed();
      console.log(JSON.stringify({ server: SERVER, projects: store.projects }));
    `], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, TONGZHOU_DATA_DIR: dir, TONGZHOU_DEPLOYMENT: "server", TONGZHOU_PUBLIC_ORIGIN: "", TONGZHOU_DESKTOP: "" },
      encoding: "utf8",
    });
    const data = JSON.parse(output);
    assert.equal(data.server, true);
    assert.equal(data.projects.length, 1);
    assert.equal(data.projects[0].name, "我的第一个工程项目");
    assert.equal(data.projects[0].files.length, 0);
    assert.equal(data.projects[0].results.live.requirements.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
