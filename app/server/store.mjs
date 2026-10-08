import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA } from "./config.mjs";
import { PRODUCT_NAME, migrateProjectBranding, migrateWorkspaceBranding } from "./branding.mjs";
fs.mkdirSync(DATA, { recursive: true });
const dbPath = path.join(DATA, "workspace.json");
export const store = fs.existsSync(dbPath)
  ? JSON.parse(fs.readFileSync(dbPath, "utf8"))
  : { version: 1, projects: [], jobs: [], brand: PRODUCT_NAME };
const brandChanged = migrateWorkspaceBranding(store);
store.sessions ||= [];
for (const job of store.jobs) {
  if (!job.sessionId) {
    job.sessionId = "session-" + job.id.replace("job-", "");
    store.sessions.push({
      id: job.sessionId,
      projectId: job.projectId,
      mode: job.mode,
      name: job.title,
      threadId: job.threadId || null,
      model: job.model || null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
    if (job.status === "completed") job.applied = true;
  }
}
store.version = 2;
for (const job of store.jobs)
  if (["running", "queued", "approval"].includes(job.status)) {
    job.status = "failed";
    job.error = "服务已重启，请重新运行任务。";
  }
export function save() {
  const temp = dbPath + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(store, null, 2));
  fs.renameSync(temp, dbPath);
}
const projectBrandingChanged = migrateProjectBranding(store.projects);
if (brandChanged || projectBrandingChanged) save();
export const uid = (prefix = "id") => prefix + "-" + randomUUID().slice(0, 8);
export const timestamp = () => new Date().toISOString();
export function getProject(id) {
  const p = store.projects.find((p) => p.id === id);
  if (!p) throw Object.assign(new Error("项目不存在"), { status: 404 });
  return p;
}
export function projectDir(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("无效项目");
  return path.join(DATA, "projects", id);
}
export function emptyResult() {
  return {
    requirements: [],
    materials: [],
    issues: [],
    sections: [],
    summary: "导入项目资料后，开始解析招标要求。",
    source: "未分析",
    updatedAt: timestamp(),
  };
}
export function newProject(name) {
  const p = {
    id: uid("project"),
    name,
    code:
      "TZ-" +
      new Date().getFullYear() +
      "-" +
      String(store.projects.length + 1).padStart(3, "0"),
    description: "工程投标项目",
    createdAt: timestamp(),
    updatedAt: timestamp(),
    files: [],
    results: { live: emptyResult(), demo: emptyResult() },
    artifacts: [],
  };
  store.projects.push(p);
  fs.mkdirSync(path.join(projectDir(p.id), "inputs"), { recursive: true });
  fs.mkdirSync(path.join(projectDir(p.id), "outputs"), { recursive: true });
  save();
  return p;
}

export function newSession(projectId, mode, name = "新会话") {
  getProject(projectId);
  if (!["live", "demo"].includes(mode))
    throw Object.assign(new Error("无效模式"), { status: 400 });
  const session = {
    id: uid("session"),
    projectId,
    mode,
    name: String(name).trim().slice(0, 80) || "新会话",
    threadId: null,
    model: null,
    createdAt: timestamp(),
    updatedAt: timestamp(),
  };
  store.sessions.push(session);
  save();
  return session;
}
export function getSession(id) {
  const session = store.sessions.find((s) => s.id === id);
  if (!session) throw Object.assign(new Error("会话不存在"), { status: 404 });
  return session;
}
