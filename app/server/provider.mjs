import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA } from "./config.mjs";

export const MIKOTO_URL = "https://api.mikoto.vip/v1";
const defaults = {
  provider: "mikoto",
  baseUrl: MIKOTO_URL,
  model: "gpt-6.1-sol",
  apiKey: "",
};
let config = { ...defaults },
  initialized,
  revision = 0;
const file = path.join(DATA, "private/provider.json");
const desktop = !!process.parentPort && process.env.TONGZHOU_DESKTOP === "1";
function vault(action, value) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const cleanup = () => {
      clearTimeout(timer);
      process.parentPort.off("message", listener);
    };
    const listener = ({ data }) => {
      if (data?.type !== "provider-vault-result" || data.id !== id) return;
      cleanup();
      data.error ? reject(new Error(data.error)) : resolve(data.value);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("本机凭据存储未响应"));
    }, 10000);
    process.parentPort.on("message", listener);
    process.parentPort.postMessage({
      type: "provider-vault",
      id,
      action,
      value,
    });
  });
}
export function initializeProvider() {
  return (initialized ||= (async () => {
    const saved = desktop
      ? await vault("read")
      : fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, "utf8"))
        : null;
    if (saved) config = normalizeProvider(saved, defaults);
    return providerStatus();
  })());
}
export function normalizeProvider(input, previous = defaults) {
  if (!input || !["mikoto", "openai"].includes(input.provider))
    throw new Error("请选择 Mikoto API 或 ChatGPT 登录");
  // Pin credentials to the user-authorized host. Never follow a submitted URL.
  if (
    input.baseUrl &&
    input.baseUrl.replace(/\/$/, "") !== MIKOTO_URL &&
    input.baseUrl !== "https://api.mikoto.vip"
  )
    throw new Error("此连接仅支持 https://api.mikoto.vip/v1");
  const model = String(input.model || previous.model || defaults.model).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(model))
    throw new Error("模型 ID 格式不正确");
  const apiKey =
    input.clearKey === true
      ? ""
      : input.apiKey === undefined || input.apiKey === ""
        ? previous.apiKey
        : String(input.apiKey).trim();
  if (apiKey && !/^[\x21-\x7E]{8,512}$/.test(apiKey))
    throw new Error("API 密钥格式不正确");
  return { provider: input.provider, baseUrl: MIKOTO_URL, model, apiKey };
}
export async function saveProvider(input) {
  await initializeProvider();
  const next = normalizeProvider(input, config);
  if (desktop) await vault("write", next);
  else {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file + ".tmp", JSON.stringify(next), { mode: 0o600 });
    fs.chmodSync(file + ".tmp", 0o600);
    fs.renameSync(file + ".tmp", file);
  }
  config = next;
  revision++;
  return providerStatus();
}
export function providerStatus() {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    defaultModel: config.model,
    hasKey: !!config.apiKey,
    credentialStorage: desktop ? "系统加密存储" : "本机权限受限文件（0600）",
    revision,
  };
}
export function providerIdentity() {
  return config.provider === "mikoto" ? `mikoto:${MIKOTO_URL}` : "openai";
}
export function assertSessionProvider(session) {
  if (
    session.threadId &&
    (session.providerIdentity || "openai") !== providerIdentity()
  )
    throw Object.assign(
      new Error("此会话使用另一 API 连接。请新建会话，历史记录仍会保留。"),
      { status: 409 },
    );
}
export function redact(value) {
  const text = String(value);
  return (
    config.apiKey ? text.split(config.apiKey).join("[REDACTED]") : text
  ).replace(/sk-[a-zA-Z0-9_-]{8,}/g, "[REDACTED]");
}
export function codexProviderRuntime() {
  if (config.provider === "openai") return { args: [], env: {} };
  if (!config.apiKey) throw new Error("请在设置中保存 Mikoto API 密钥");
  const home = path.join(DATA, "private/codex-mikoto");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const overrides = {
    model_provider: "mikoto",
    model: config.model,
    "model_providers.mikoto.name": "Mikoto API",
    "model_providers.mikoto.base_url": MIKOTO_URL,
    "model_providers.mikoto.env_key": "TONGZHOU_PROVIDER_API_KEY",
    "model_providers.mikoto.wire_api": "responses",
    "model_providers.mikoto.requires_openai_auth": false,
    "model_providers.mikoto.supports_websockets": false,
    "model_providers.mikoto.request_max_retries": 1,
    "model_providers.mikoto.stream_max_retries": 1,
    web_search: "disabled",
  };
  return {
    args: Object.entries(overrides).flatMap(([k, v]) => [
      "-c",
      `${k}=${JSON.stringify(v)}`,
    ]),
    env: { CODEX_HOME: home, TONGZHOU_PROVIDER_API_KEY: config.apiKey },
  };
}
export async function providerModels(fetchImpl = fetch) {
  await initializeProvider();
  if (!config.apiKey) throw new Error("请先保存 API 密钥");
  let r;
  try {
    r = await fetchImpl(MIKOTO_URL + "/models", {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("Mikoto API 连接失败或超时，请检查网络；未跟随重定向");
  }
  if (!r.ok) throw new Error(`Mikoto 模型列表请求失败（HTTP ${r.status}）`);
  const body = await r.json();
  const data = (Array.isArray(body.data) ? body.data : [])
    .filter(
      (m) =>
        typeof m.id === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(m.id),
    )
    .map((m) => ({ id: m.id, model: m.id, displayName: m.id }));
  return { data, nextCursor: null };
}
