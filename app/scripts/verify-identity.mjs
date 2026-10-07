import fs from "node:fs";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:4318/api";
async function call(p, b) {
  const r = await fetch(base + p, {
    method: b ? "POST" : "GET",
    headers: b
      ? { "Content-Type": "application/json", "X-Tongzhou-Client": "workspace" }
      : {},
    body: b ? JSON.stringify(b) : undefined,
  });
  const o = await r.json();
  if (!r.ok) throw Error(o.error);
  return o;
}
async function wait(id) {
  for (let i = 0; i < 90; i++) {
    const b = await call("/bootstrap");
    const j = b.jobs.find((x) => x.id === id);
    if (!["queued", "running", "approval"].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await call(`/jobs/${id}/cancel`, {});
  throw Error("identity test timed out");
}
const project = await call("/projects", { name: "同舟 AI · 品牌身份实测" });
const results = [];
let sessionId;
for (const question of [
  "你是谁？",
  "你叫什么名字？",
  "你的底层技术是什么？",
  "Who are you?",
]) {
  const j = await wait(
    (
      await call(`/projects/${project.id}/tasks`, {
        skill: "consistency-review",
        mode: "live",
        message: question,
        sessionId,
        reviewChanges: true,
        includeImages: true,
      })
    ).id,
  );
  assert.equal(j.status, "completed", j.error);
  assert.equal(j.conversationOnly, true);
  assert.match(j.proposal.summary, /同舟\s*AI/i);
  if (question.includes("底层")) {
    assert.match(j.proposal.summary, /Codex/);
    assert.match(j.proposal.summary, /Mikoto/);
  } else
    assert.doesNotMatch(
      j.proposal.summary,
      /我是\s*(?:Codex|ChatGPT)|I(?:’m|'m| am)\s+(?:Codex|ChatGPT)/i,
    );
  for (const key of ["requirements", "materials", "issues", "sections"])
    assert.equal(j.proposal[key].length, 0);
  sessionId = j.sessionId;
  const row = {
    question,
    jobId: j.id,
    sessionId,
    threadId: j.threadId,
    model: j.model,
    answer: j.proposal.summary,
  };
  results.push(row);
  console.log(JSON.stringify(row));
  fs.writeFileSync(
    "data/qa/identity-real-v022.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        projectId: project.id,
        results,
        passed: results.length === 4,
      },
      null,
      2,
    ),
  );
}
const after = (await call("/bootstrap")).projects.find(
  (p) => p.id === project.id,
);
assert.equal(after.results.live.source, "未分析");
assert.equal(after.results.live.issues.length, 0);
console.log("REAL IDENTITY CHECKS PASSED");
