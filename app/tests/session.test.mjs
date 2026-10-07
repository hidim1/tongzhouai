import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tz-session-"));
process.env.TONGZHOU_DATA_DIR = dir;
const { store, newProject, newSession, save } =
  await import("../server/store.mjs");
const { startJob, applyProposal } = await import("../server/jobs.mjs");
const { codex } = await import("../server/codex.mjs");
const empty = {
  summary: "待采纳的建议",
  requirements: [],
  materials: [],
  issues: [],
  sections: [],
};
function wait(id) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const t = setInterval(() => {
      const j = store.jobs.find((j) => j.id === id);
      if (!["queued", "running", "approval"].includes(j.status)) {
        clearInterval(t);
        resolve(j);
      } else if (Date.now() - started > 5000) {
        clearInterval(t);
        reject(Error("timeout"));
      }
    }, 20);
  });
}
test("native session resume, image input, adoption and isolation", async (t) => {
  const oldRequest = codex.request,
    oldConnect = codex.connect;
  let threadN = 0,
    turnN = 0;
  const calls = [];
  codex.connect = async () => {
    codex.status.authenticated = true;
  };
  codex.request = async (method, p) => {
    calls.push({ method, p });
    if (method === "skills/list")
      return {
        data: [
          {
            skills: [
              {
                name: "consistency-review",
                enabled: true,
                path: "/fixture/SKILL.md",
              },
            ],
          },
        ],
      };
    if (method === "thread/start")
      return { thread: { id: "native-" + ++threadN }, model: "fixture-model" };
    if (method === "thread/resume")
      return { thread: { id: p.threadId }, model: "fixture-model" };
    if (method === "thread/inject_items") return {};
    if (method === "turn/start") {
      const id = "turn-" + ++turnN;
      setTimeout(() => {
        codex.emit("event", {
          method: "item/completed",
          params: {
            threadId: p.threadId,
            item: {
              type: "agentMessage",
              text: JSON.stringify(
                p.input.some((i) => i.text?.startsWith("本轮仅是助手身份"))
                  ? {
                      ...empty,
                      summary: "我是同舟 AI，同舟纵横的工程智能助手。",
                    }
                  : {
                      ...empty,
                      sections: [
                        { id: "draft-1", title: "建议", content: "AI建议" },
                      ],
                    },
              ),
            },
          },
        });
        codex.emit("event", {
          method: "turn/completed",
          params: { threadId: p.threadId, turn: { id, status: "completed" } },
        });
      }, 30);
      return { turn: { id } };
    }
    throw Error(method);
  };
  t.after(() => {
    codex.request = oldRequest;
    codex.connect = oldConnect;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const p = newProject("会话单测"),
    s = newSession(p.id, "live");
  p.files.push({
    id: "f",
    name: "image.png",
    status: "preview",
    text: "",
    preview: "/fixture/image.png",
  });
  let j = startJob(p.id, "consistency-review", "live", "第一轮", {
    sessionId: s.id,
    reviewChanges: true,
    includeImages: true,
  });
  j = await wait(j.id);
  assert.equal(j.status, "completed");
  assert.equal(p.results.live.sections.length, 0);
  assert.ok(j.proposal);
  assert.equal(s.threadId, j.threadId);
  assert.ok(
    calls
      .find((c) => c.method === "turn/start")
      .p.input.some((i) => i.type === "localImage"),
  );
  applyProposal(j);
  assert.equal(p.results.live.sections.length, 1);
  p.results.live.sections[0].manual = true;
  p.results.live.sections[0].content = "人工确认";
  applyProposal(j);
  assert.equal(p.results.live.sections[0].content, "人工确认");
  const next = await wait(
    startJob(p.id, "consistency-review", "live", "继续", {
      sessionId: s.id,
      reviewChanges: true,
    }).id,
  );
  assert.equal(next.threadId, j.threadId);
  assert.equal(calls.filter((c) => c.method === "thread/start").length, 1);
  assert.equal(calls.filter((c) => c.method === "thread/resume").length, 1);
  for (const c of calls.filter(
    (c) => c.method === "thread/start" || c.method === "thread/resume",
  ))
    assert.match(
      c.p.developerInstructions,
      /我是同舟 AI，同舟纵横的工程智能助手/,
    );
  applyProposal(next);
  assert.equal(p.results.live.sections[0].content, "人工确认");
  const resultsBeforeIntro = structuredClone(p.results.live);
  delete s.identityRevision; // Simulate a conversation created before branded identity existed.
  p.files[0].text = "PRIVATE_ENGINEERING_FIXTURE";
  const intro = await wait(
    startJob(p.id, "consistency-review", "live", "你是谁？", {
      sessionId: s.id,
      includeImages: true,
      reviewChanges: false,
    }).id,
  );
  assert.equal(intro.status, "completed");
  assert.equal(intro.conversationOnly, true);
  assert.equal(intro.title, "助手问答");
  assert.equal(intro.applied, undefined);
  assert.deepEqual(p.results.live, resultsBeforeIntro);
  assert.throws(() => applyProposal(intro), /无需采纳/);
  const introTurn = calls.filter((c) => c.method === "turn/start").at(-1);
  assert.ok(
    !JSON.stringify(introTurn.p.input).includes("PRIVATE_ENGINEERING_FIXTURE"),
  );
  assert.ok(!introTurn.p.input.some((i) => i.type === "localImage"));
  const identityUpdates = calls.filter(
    (c) => c.method === "thread/inject_items",
  );
  assert.equal(identityUpdates.length, 1);
  assert.equal(identityUpdates[0].p.items[0].role, "developer");
  assert.match(
    identityUpdates[0].p.items[0].content[0].text,
    /当前生效的同舟 AI/,
  );
  assert.ok(s.identityRevision);
  const demoBeforeIntro = structuredClone(p.results.demo);
  const demoIntro = await wait(
    startJob(p.id, "consistency-review", "demo", "你是谁？").id,
  );
  assert.equal(demoIntro.conversationOnly, true);
  assert.match(demoIntro.proposal.summary, /我是同舟 AI/);
  assert.match(demoIntro.proposal.summary, /本地演示模式/);
  assert.deepEqual(p.results.demo, demoBeforeIntro);
  assert.throws(
    () => startJob(p.id, "consistency-review", "demo", "", { sessionId: s.id }),
    /模式/,
  );
  const other = newProject("另一个项目");
  assert.throws(
    () =>
      startJob(other.id, "consistency-review", "live", "", { sessionId: s.id }),
    /当前项目/,
  );
  save();
  const disk = JSON.parse(fs.readFileSync(path.join(dir, "workspace.json")));
  assert.equal(disk.sessions.find((x) => x.id === s.id).threadId, j.threadId);
});
