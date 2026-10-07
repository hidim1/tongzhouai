import test from "node:test";
import assert from "node:assert/strict";
import { derive, draftSections } from "../server/intake.mjs";
import { resultSchema, material } from "../server/schema.mjs";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../server/config.mjs";
test("material schema keeps unknown price null and rejects negative quantities", () => {
  const m = {
    id: "m",
    name: "泵",
    spec: "",
    material: "",
    unit: "台",
    brand: "",
    quantity: null,
    tag: "",
    price: null,
    status: "待确认",
    source: "输入",
    fileId: "",
    note: "",
  };
  assert.equal(material.parse(m).price, null);
  assert.throws(() => material.parse({ ...m, quantity: -1 }));
});
test("review distinguishes volume definitions and finds membrane mismatch", () => {
  const p = {
    files: [
      {
        id: "u",
        name: "URS.doc",
        category: "招标要求",
        text: "20m³ 300m2",
        tables: [],
      },
      {
        id: "d",
        name: "设计.xlsx",
        category: "设计输入",
        text: "E2=74 B3=0.8",
      },
    ],
  };
  const r = derive(p);
  assert.ok(r.issues.find((x) => x.id === "issue-area"));
  assert.match(
    r.issues.find((x) => x.id === "issue-volume").detail,
    /不是同一指标/,
  );
  assert.equal(r.materials.length, 0);
});
test("structured output rejects invented incomplete rows", () => {
  assert.throws(() =>
    resultSchema.parse({
      summary: "done",
      requirements: [{ id: "fake" }],
      materials: [],
      issues: [],
      sections: [],
    }),
  );
});
test("generated sections retain pending claims rather than unconditional compliance", () => {
  const sections = draftSections(
    { name: "样例" },
    {
      requirements: [],
      materials: [],
      issues: [{ title: "面积待确认", detail: "74 vs 300", status: "待确认" }],
    },
  );
  assert.match(sections.map((x) => x.content).join("\n"), /74 vs 300/);
  assert.match(sections[0].content, /不承诺无偏离/);
});
test("all five native skills have entrypoint and output schema", () => {
  for (const name of [
    "project-intake",
    "urs-analysis",
    "bom-draft",
    "bid-draft",
    "consistency-review",
  ]) {
    const dir = path.join(ROOT, ".agents/skills", name);
    assert.match(
      fs.readFileSync(path.join(dir, "SKILL.md"), "utf8"),
      new RegExp("name: " + name),
    );
    assert.ok(
      JSON.parse(
        fs.readFileSync(
          path.join(dir, "references/result.schema.json"),
          "utf8",
        ),
      ).properties,
    );
  }
});

test("interrupt retries the native turn-start registration race", async () => {
  const { CodexAdapter } = await import("../server/codex.mjs");
  const adapter = new CodexAdapter();
  let attempts = 0;
  adapter.request = async () => {
    attempts++;
    if (attempts < 3) throw new Error("no active turn to interrupt");
    return {};
  };
  assert.deepEqual(await adapter.interrupt("thread-test", "turn-test"), {});
  assert.equal(attempts, 3);
});
