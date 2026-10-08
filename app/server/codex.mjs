// JSON-RPC transport pattern reviewed against Codexia (MIT); this implementation is independent.
import { codexBinary } from "./platform.mjs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import {
  initializeProvider,
  providerStatus,
  codexProviderRuntime,
  redact,
} from "./provider.mjs";
export class CodexAdapter extends EventEmitter {
  constructor() {
    super();
    this.seq = 0;
    this.pending = new Map();
    this.process = null;
    this.ready = null;
    this.status = { connected: false, authenticated: false, model: null };
  }
  async connect() {
    if (this.ready) return this.ready;
    this.close();
    this.ready = this.initialize().catch((e) => {
      this.ready = null;
      this.status = {
        connected: false,
        authenticated: false,
        ...providerStatus(),
        error: redact(e.message),
      };
      throw e;
    });
    return this.ready;
  }
  async initialize() {
    await initializeProvider();
    const runtime = codexProviderRuntime();
    const binary = codexBinary();
    // This is a standalone app, not a child task of the desktop conversation.
    // Do not inherit its transient workspace-routing pipe/identity variables.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("CODEX_") || key === "CODEX_HOME",
      ),
    );
    const child = spawn(
      binary,
      [...runtime.args, "app-server", "--listen", "stdio://"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...env, ...runtime.env },
        windowsHide: true,
      },
    );
    this.process = child;
    child.on("error", (e) => {
      if (this.process === child) this.fail(e);
    });
    child.on("exit", () => {
      if (this.process !== child) return;
      this.fail(new Error("Codex app-server 已断开"));
      this.ready = null;
      this.status.connected = false;
    });
    createInterface({ input: this.process.stdout }).on("line", (line) => {
      try {
        this.receive(JSON.parse(line));
      } catch {}
    });
    this.process.stderr.on("data", () => {});
    await this.request("initialize", {
      clientInfo: { name: "tongzhou_ai", title: "舟知", version: "0.2.3" },
    }).catch((e) => {
      throw new Error("初始化连接失败：" + e.message);
    });
    this.send({ method: "initialized", params: {} });
    const account = await this.request("account/read", {
      refreshToken: false,
    }).catch((e) => {
      throw new Error("读取登录状态失败：" + e.message);
    });
    this.status = {
      connected: true,
      authenticated:
        providerStatus().provider === "mikoto"
          ? providerStatus().hasKey
          : !!account.account,
      accountType:
        providerStatus().provider === "mikoto"
          ? "apiKey"
          : account.account?.type || null,
      ...providerStatus(),
    };
    return this.status;
  }
  send(data) {
    if (!this.process?.stdin.writable) throw new Error("Codex 连接不可用");
    this.process.stdin.write(JSON.stringify(data) + "\n");
  }
  request(method, params = {}, timeout = 45000) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 请求超时`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  receive(msg) {
    // Neither model errors nor echoed server responses may expose credentials.
    msg = JSON.parse(redact(JSON.stringify(msg)));
    if (msg.id !== undefined && !msg.method) {
      const p = this.pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        msg.error
          ? p.reject(new Error(msg.error.message))
          : p.resolve(msg.result);
      }
      return;
    }
    if (msg.method && msg.id !== undefined) {
      this.emit("approval", msg);
      return;
    }
    if (
      msg.method?.startsWith("item/reasoning") ||
      msg.params?.item?.type === "reasoning"
    )
      return;
    if (
      msg.method === "account/updated" &&
      providerStatus().provider !== "mikoto"
    ) {
      this.status.authenticated = !!msg.params?.authMode;
      this.status.accountType = msg.params?.authMode || null;
    }
    if (msg.method === "account/login/completed")
      this.status.loginError = msg.params?.success
        ? null
        : msg.params?.error || "登录未完成";
    this.emit("event", msg);
  }
  respond(id, result) {
    this.send({ id, result });
  }
  fail(e) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
    this.emit("disconnected", e);
  }
  async interrupt(threadId, turnId) {
    // turn/start may respond just before the worker registers its active turn.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.request("turn/interrupt", { threadId, turnId });
      } catch (error) {
        if (
          !error.message.includes("no active turn to interrupt") ||
          attempt === 3
        )
          throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, 150 * (attempt + 1)),
        );
      }
    }
  }
  close() {
    const old = this.process;
    this.process = null;
    this.ready = null;
    this.status.connected = false;
    if (old) {
      this.fail(new Error("Codex 连接已重置"));
      old.kill();
    }
  }
}
export const codex = new CodexAdapter();
