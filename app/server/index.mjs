import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { ROOT, DATA, SKILLS, skillNames } from "./config.mjs";
import {
  store,
  save,
  getProject,
  newProject,
  projectDir,
  timestamp,
  newSession,
  getSession,
} from "./store.mjs";
import { seed } from "../scripts/seed.mjs";
import { ingest, derive } from "./intake.mjs";
import {
  startJob,
  cancelJob,
  approveJob,
  applyProposal,
  events,
} from "./jobs.mjs";
import { codex } from "./codex.mjs";
import { exportProject } from "./export.mjs";
import { requirement, material, issue, section } from "./schema.mjs";
import { renderCad } from "./cad.mjs";
import { diagnostics } from "./platform.mjs";
import { timingSafeEqual } from "node:crypto";
import { createAccessGuard } from "./access.mjs";
import {
  initializeProvider,
  providerStatus,
  saveProvider,
  providerModels,
  redact,
} from "./provider.mjs";
await initializeProvider();
Object.assign(codex.status, providerStatus());
await seed();
const app = express();
const port = Number(process.env.PORT || 4318);
let providerChanging = false;
app.disable("x-powered-by");
if (process.env.TONGZHOU_PUBLIC_ORIGIN) app.set("trust proxy", "loopback");
app.use(createAccessGuard());
const sessionToken = process.env.TONGZHOU_SESSION_TOKEN;
const equal = (a, b) =>
  typeof a === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
app.use((req, res, next) => {
  if (sessionToken) {
    const supplied = req.get("X-Tongzhou-Session");
    const cookie = (req.get("cookie") || "")
      .split("; ")
      .find((v) => v.startsWith("tz_session="))
      ?.slice(11);
    if (equal(supplied, sessionToken))
      res.setHeader(
        "Set-Cookie",
        `tz_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`,
      );
    else if (!equal(cookie, sessionToken))
      return res.status(401).json({ error: "请从同舟 AI 桌面应用访问" });
  }
  if (!process.argv.includes("--dev"))
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
    );
  next();
});
app.use(express.json({ limit: "2mb" }));
app.use("/api", (req, res, next) => {
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.get("X-Tongzhou-Client") !== "workspace"
  )
    return res.status(403).json({ error: "请求来源校验失败" });
  next();
});
const cleanFile = ({ path: _, text, tables, sheets, ...f }) => ({
  ...f,
  textPreview: (text || "").slice(0, 12000),
});
const cleanProject = (p) => ({
  ...p,
  files: p.files.map(cleanFile),
  artifacts: p.artifacts.map(({ path: _, ...a }) => a),
});
const getJob = (id) => {
  const j = store.jobs.find((x) => x.id === id);
  if (!j) throw Object.assign(new Error("任务不存在"), { status: 404 });
  return j;
};
app.get("/api/bootstrap", (req, res) =>
  res.json({
    cloud: !!process.env.TONGZHOU_PUBLIC_ORIGIN,
    brand: store.brand,
    projects: store.projects.map(cleanProject),
    jobs: store.jobs,
    sessions: store.sessions,
    engine: codex.status,
    skills: SKILLS.map((name) => ({
      name,
      title: skillNames[name],
      description:
        fs
          .readFileSync(
            path.join(ROOT, ".agents/skills", name, "SKILL.md"),
            "utf8",
          )
          .split("\n\n")[2] || "",
      available: fs.existsSync(
        path.join(ROOT, ".agents/skills", name, "SKILL.md"),
      ),
    })),
  }),
);
app.post("/api/engine/connect", async (req, res) => {
  if (
    store.jobs.some((j) => ["running", "approval", "queued"].includes(j.status))
  )
    return res.status(409).json({ error: "请先停止运行中的任务" });
  codex.ready = null;
  codex.close();
  await new Promise((r) => setTimeout(r, 100));
  res.json(await codex.connect());
});
app.get("/api/diagnostics", async (req, res) => res.json(await diagnostics()));
app.get("/api/engine/models", async (req, res) => {
  if (providerStatus().provider === "mikoto")
    return res.json(await providerModels());
  await codex.connect();
  res.json(await codex.request("model/list", {}));
});
app.post("/api/engine/login", async (req, res) => {
  if (providerStatus().provider !== "openai")
    return res.status(400).json({ error: "请先在设置中切换到 ChatGPT 登录" });
  await codex.connect();
  res.json(await codex.request("account/login/start", { type: "chatgpt" }));
});
app.get("/api/engine/provider", (_req, res) => res.json(providerStatus()));
app.put("/api/engine/provider", async (req, res) => {
  if (providerChanging)
    return res.status(409).json({ error: "API 连接正在保存，请稍候" });
  if (
    store.jobs.some((j) => ["running", "approval", "queued"].includes(j.status))
  )
    return res.status(409).json({ error: "请先停止运行中的任务，再切换 API" });
  providerChanging = true;
  try {
    const status = await saveProvider(req.body);
    codex.close();
    codex.status = { connected: false, authenticated: false, ...status };
    try {
      await codex.connect();
    } catch (e) {
      codex.status.error = redact(e.message);
    }
    events.emit("change", {});
    res.json({ ...status, engine: codex.status });
  } finally {
    providerChanging = false;
  }
});
app.post("/api/engine/provider/check", async (_req, res) => {
  if (providerStatus().provider !== "mikoto")
    return res.status(400).json({ error: "当前不是 Mikoto API" });
  const models = await providerModels();
  res.json({
    ok: true,
    count: models.data.length,
    modelAvailable: models.data.some(
      (m) => m.id === providerStatus().defaultModel,
    ),
    message: "API 鉴权和模型列表通过；生成能力需实际运行任务验证。",
  });
});
app.post("/api/engine/login/cancel", async (req, res) => {
  res.json(
    await codex.request("account/login/cancel", {
      loginId: String(req.body.loginId || ""),
    }),
  );
});
codex.on("event", (msg) => {
  if (msg.method?.startsWith("account/")) events.emit("change", {});
});
app.post("/api/projects/:id/sessions", (req, res) =>
  res.json(newSession(req.params.id, req.body.mode, req.body.name)),
);
app.patch("/api/sessions/:id", (req, res) => {
  const s = getSession(req.params.id);
  if (typeof req.body.name !== "string" || !req.body.name.trim())
    throw new Error("请输入会话名称");
  s.name = req.body.name.trim().slice(0, 80);
  s.updatedAt = timestamp();
  save();
  res.json(s);
});
app.post("/api/jobs/:id/apply", (req, res) =>
  res.json(applyProposal(getJob(req.params.id))),
);
app.get("/api/engine", (req, res) => res.json(codex.status));
app.post("/api/projects", (req, res) => {
  if (
    typeof req.body.name !== "string" ||
    !req.body.name.trim() ||
    req.body.name.length > 100
  )
    return res.status(400).json({ error: "请输入项目名称（最多100字）" });
  res.json(cleanProject(newProject(req.body.name.trim())));
});
app.patch("/api/settings", (req, res) => {
  if (
    typeof req.body.brand !== "string" ||
    !req.body.brand.trim() ||
    req.body.brand.length > 30
  )
    return res.status(400).json({ error: "品牌名称需为1至30字" });
  store.brand = req.body.brand.trim();
  save();
  res.json({ brand: store.brand });
});
const upload = multer({
  dest: path.join(DATA, "uploads"),
  limits: { fileSize: 30 * 1024 * 1024, files: 12 },
});
app.post(
  "/api/projects/:id/files",
  upload.array("files", 12),
  async (req, res) => {
    const p = getProject(req.params.id);
    const added = [];
    for (const f of req.files || []) {
      try {
        const raw = Buffer.from(f.originalname, "latin1").toString("utf8");
        const name = path.basename(
          raw.includes("\uFFFD") ? f.originalname : raw,
        );
        if (!/\.(docx?|xlsx|dwg|dxf|pdf|txt|md|csv|png|jpe?g)$/i.test(name))
          throw new Error("暂不支持该文件类型");
        added.push(await ingest(p, f.path, name));
      } finally {
        fs.rmSync(f.path, { force: true });
      }
    }
    save();
    events.emit("change", { projectId: p.id });
    res.json(added.map(cleanFile));
  },
);
app.post("/api/projects/:id/tasks", (req, res) => {
  if (providerChanging)
    return res.status(409).json({ error: "API 连接正在保存，请稍候" });
  return res.json(
    startJob(
      req.params.id,
      req.body.skill,
      req.body.mode,
      typeof req.body.message === "string"
        ? req.body.message.slice(0, 6000)
        : "",
      {
        sessionId: req.body.sessionId,
        model: req.body.model,
        includeImages: req.body.includeImages,
        reviewChanges: req.body.reviewChanges,
      },
    ),
  );
});
app.post("/api/jobs/:id/cancel", async (req, res) => {
  const job = getJob(req.params.id);
  await cancelJob(job);
  res.json(job);
});
app.post("/api/jobs/:id/approval", (req, res) => {
  if (!["accept", "decline"].includes(req.body.decision))
    return res.status(400).json({ error: "无效授权选项" });
  const j = getJob(req.params.id);
  approveJob(j, req.body.decision);
  res.json(j);
});
app.patch("/api/projects/:id/results/:mode/:kind/:rowId", (req, res) => {
  const p = getProject(req.params.id);
  const { mode, kind, rowId } = req.params;
  const schemas = {
    requirements: requirement,
    materials: material,
    issues: issue,
    sections: section,
  };
  if (!["live", "demo"].includes(mode) || !schemas[kind])
    return res.status(400).json({ error: "无效数据类型" });
  const list = p.results[mode][kind];
  const index = list.findIndex((x) => x.id === rowId);
  const body = schemas[kind].parse({ ...list[index], ...req.body, id: rowId });
  body.manual = true;
  if (index < 0) list.push(body);
  else list[index] = body;
  p.updatedAt = timestamp();
  save();
  events.emit("change", { projectId: p.id });
  res.json(body);
});
app.post("/api/projects/:id/reset-demo", (req, res) => {
  const p = getProject(req.params.id);
  if (
    store.jobs.some(
      (j) =>
        j.projectId === p.id &&
        ["queued", "running", "approval"].includes(j.status),
    )
  )
    return res.status(409).json({ error: "请先停止运行中的任务" });
  p.results.demo = derive(p);
  p.results.demo.source = "演示数据 / 本地预解析";
  save();
  res.json(cleanProject(p));
});
app.post("/api/projects/:id/export", async (req, res) => {
  if (
    !["live", "demo"].includes(req.body.mode) ||
    !["xlsx", "docx"].includes(req.body.type)
  )
    return res.status(400).json({ error: "无效导出格式" });
  const p = getProject(req.params.id);
  const a = await exportProject(p, req.body.mode, req.body.type);
  events.emit("change", { projectId: p.id });
  const { path: _, ...safe } = a;
  res.json(safe);
});
app.get("/api/projects/:id/artifacts/:aid", (req, res) => {
  const p = getProject(req.params.id);
  const a = p.artifacts.find((x) => x.id === req.params.aid);
  if (!a) return res.sendStatus(404);
  res.download(a.path, a.name);
});
app.get("/api/projects/:id/files/:fid", (req, res) => {
  const p = getProject(req.params.id),
    f = p.files.find((x) => x.id === req.params.fid);
  if (!f) return res.sendStatus(404);
  res.download(f.path, f.name);
});
app.get("/api/projects/:id/preview/:fid", (req, res) => {
  const p = getProject(req.params.id),
    f = p.files.find((x) => x.id === req.params.fid);
  if (!f?.preview) return res.sendStatus(404);
  res.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
  );
  res.sendFile(f.preview);
});
app.post("/api/projects/:id/cad/:fid", async (req, res) => {
  const p = getProject(req.params.id),
    f = p.files.find((x) => x.id === req.params.fid);
  if (!f || ![".dwg", ".dxf"].includes(f.ext))
    throw new Error("不是有效 CAD 文件");
  const dir = path.join(projectDir(p.id), "cad", f.id);
  fs.mkdirSync(dir, { recursive: true });
  const result = await renderCad(f.path, dir);
  f.preview = result.preview;
  f.previewUpdatedAt = timestamp();
  f.cadNote = result.note;
  f.text = result.text;
  f.cadStats = result.stats;
  f.status = "preview";
  save();
  events.emit("change", { projectId: p.id });
  res.json(cleanFile(f));
});
app.get("/api/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write("event: ready\ndata: {}\n\n");
  const handler = (data) =>
    res.write(`event: change\ndata: ${JSON.stringify(data)}\n\n`);
  events.on("change", handler);
  const timer = setInterval(() => res.write(": heartbeat\n\n"), 20000);
  req.on("close", () => {
    clearInterval(timer);
    events.off("change", handler);
  });
});
if (process.argv.includes("--dev")) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(ROOT, "dist")));
  app.get("/{*path}", (req, res) =>
    res.sendFile(path.join(ROOT, "dist/index.html")),
  );
}
app.use((err, req, res, next) => {
  console.error(redact(err.message));
  res
    .status(err.status || 400)
    .json({ error: redact(err.message || "请求失败").slice(0, 800) });
});
const server = app.listen(port, "127.0.0.1", () => {
  const actual = server.address().port;
  console.log(`Tongzhou AI: http://127.0.0.1:${actual}`);
  process.parentPort?.postMessage({ type: "ready", port: actual });
});
if (!process.env.TONGZHOU_NO_AUTO_CONNECT)
  void (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await codex.connect();
        events.emit("change", {});
        return;
      } catch (e) {
        console.error("Codex:", redact(e.message));
        events.emit("change", {});
        if (!/timed out|超时/.test(e.message) || attempt === 2) return;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  })();
function shutdown() {
  codex.close();
  server.closeAllConnections();
  server.close(() => process.exit());
  setTimeout(() => process.exit(), 1500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.parentPort?.on("message", (event) => {
  if (event.data?.type === "shutdown") shutdown();
});
