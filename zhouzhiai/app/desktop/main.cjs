const {
  app,
  BrowserWindow,
  utilityProcess,
  shell,
  dialog,
  Menu,
  safeStorage,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { providerVault } = require("./provider-vault.cjs");
let child,
  window,
  quitting = false,
  origin;
const token = crypto.randomBytes(32).toString("hex");
// Keep the legacy internal identity so existing user data and macOS safeStorage keys remain readable.
// Window titles, menu labels, bundle display name and About panel use 舟知.
app.setName("同州 AI");
if (process.env.TONGZHOU_DESKTOP_USER_DATA)
  app.setPath("userData", path.resolve(process.env.TONGZHOU_DESKTOP_USER_DATA));
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(start)
    .catch((e) => {
      dialog.showErrorBox("舟知启动失败", e.message);
      app.quit();
    });
}
function safeExternal(url) {
  try {
    const u = new URL(url);
    if (
      u.protocol === "https:" &&
      ["auth.openai.com", "chatgpt.com", "platform.openai.com"].includes(
        u.hostname,
      )
    )
      void shell.openExternal(u.href);
  } catch {}
}
async function start() {
  app.setAboutPanelOptions({ applicationName: "舟知" });
  const root = path.resolve(__dirname, "..");
  const data = path.join(app.getPath("userData"), "workspace");
  fs.mkdirSync(data, { recursive: true });
  const log = fs.createWriteStream(
    path.join(app.getPath("userData"), "startup.log"),
    { flags: "a" },
  );
  log.write(
    `\n${new Date().toISOString()} 舟知 ${app.getVersion()} ${process.platform}/${process.arch}\n`,
  );
  child = utilityProcess.fork(path.join(root, "server/index.mjs"), [], {
    cwd: app.getPath("userData"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "0",
      TONGZHOU_DESKTOP: "1",
      TONGZHOU_DATA_DIR: data,
      TONGZHOU_SESSION_TOKEN: token,
      TONGZHOU_RESOURCES: app.isPackaged
        ? path.join(process.resourcesPath, "runtime")
        : path.join(
            __dirname,
            "resources",
            `${process.platform === "darwin" ? "mac" : "win"}-${process.arch}`,
          ),
    },
    stdio: "pipe",
    serviceName: "舟知工程引擎",
  });
  child.stdout?.on("data", (b) => log.write(b));
  child.stderr?.on("data", (b) => log.write(b));
  // Utility-process IPC only: no renderer IPC exposes the plaintext credential.
  child.on("message", (msg) => {
    if (msg.type !== "provider-vault") return;
    try {
      const vaultFile = path.join(app.getPath("userData"), "provider.enc");
      const value = providerVault(
        safeStorage,
        vaultFile,
        msg.action,
        msg.value,
      );
      child.postMessage({ type: "provider-vault-result", id: msg.id, value });
    } catch {
      child.postMessage({
        type: "provider-vault-result",
        id: msg.id,
        error: "本机系统加密凭据读写失败，请解锁系统后重试",
      });
    }
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("服务启动超过 60 秒，请查看本地 startup.log。")),
      60000,
    );
    child.on("message", (msg) => {
      if (msg.type === "ready") {
        clearTimeout(timer);
        resolve(msg.port);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("工程服务提前退出：" + code));
    });
  });
  origin = `http://127.0.0.1:${port}`;
  function createWindow() {
    window = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 920,
      minHeight: 680,
      title: "舟知",
      backgroundColor: "#f8faf9",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      const u = new URL(url);
      if (
        u.origin === origin &&
        /^\/api\/projects\/[^/]+\/preview\/[^/]+$/.test(u.pathname)
      )
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            title: "图纸原尺寸预览",
            width: 1100,
            height: 800,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
              webSecurity: true,
            },
          },
        };
      safeExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("did-create-window", (preview) => {
      preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      preview.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).origin !== origin) event.preventDefault();
      });
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (new URL(url).origin !== origin) {
        event.preventDefault();
        safeExternal(url);
      }
    });
    window.webContents.session.setPermissionRequestHandler(
      (webContents, permission, callback) => callback(false),
    );
    window.webContents.session.on("will-download", (_event, item) => {
      item.setSaveDialogOptions({
        title: "保存舟知成果",
        defaultPath: path.join(
          app.getPath("downloads"),
          path.basename(item.getFilename()),
        ),
      });
    });
    window.loadURL(origin, { extraHeaders: `X-Tongzhou-Session: ${token}\n` });
    window.on("closed", () => {
      window = null;
    });
  }
  const menu = [
    ...(process.platform === "darwin"
      ? [
          {
            label: "舟知",
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "文件",
      submenu: [
        { label: "打开本地数据文件夹", click: () => shell.openPath(data) },
        {
          label: "打开启动日志",
          click: () =>
            shell.openPath(path.join(app.getPath("userData"), "startup.log")),
        },
        { type: "separator" },
        { role: process.platform === "darwin" ? "close" : "quit" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  createWindow();
  app.on("activate", () => {
    if (!window) createWindow();
  });
  child.on("exit", (code) => {
    log.end();
    if (!quitting) {
      dialog.showErrorBox(
        "工程引擎已停止",
        `退出码 ${code}。请重新打开应用；历史资料仍保存在本机。`,
      );
      app.quit();
    }
  });
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (event) => {
  if (quitting || !child) return;
  event.preventDefault();
  quitting = true;
  child.postMessage({ type: "shutdown" });
  child.once("exit", () => app.quit());
  setTimeout(() => {
    child?.kill();
    app.quit();
  }, 2000);
});
