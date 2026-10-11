import { useEffect, useState } from "react";
import { KeyRound, Save, RefreshCw } from "lucide-react";
import { api } from "../api";
type Provider = {
  provider: "mikoto" | "openai";
  baseUrl: string;
  defaultModel: string;
  hasKey: boolean;
  credentialStorage: string;
};
export function ProviderPanel({
  onChanged,
}: {
  onChanged: () => Promise<void>;
}) {
  const [saved, setSaved] = useState<Provider>();
  const [provider, setProvider] = useState("mikoto");
  const [model, setModel] = useState("gpt-6.1-sol");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void api<Provider>("/engine/provider")
      .then((p) => {
        if (active) {
          setSaved(p);
          setProvider(p.provider);
          setModel(p.defaultModel);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-card provider-card">
      <div className="settings-heading">
        <KeyRound size={22} />
        <div>
          <h2>模型 API 连接</h2>
          <p>Codex 保持为执行内核，API 负责云端推理。</p>
        </div>
        <span className={`status ${saved?.hasKey ? "success" : "pending"}`}>
          {saved?.hasKey ? "密钥已保存" : "待配置"}
        </span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            const next = await api<Provider & { engine: { error?: string } }>(
              "/engine/provider",
              { provider, model, ...(key ? { apiKey: key } : {}) },
              "PUT",
            );
            setKey("");
            setSaved(next);
            await onChanged();
            setMessage(
              next.engine.error
                ? `配置已保存；${next.engine.error}`
                : "配置已保存，Codex 已重新连接。请新建会话开始验证生成。",
            );
          });
        }}
      >
        <label>
          连接方式
          <select
            aria-label="连接方式"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={busy}
          >
            <option value="mikoto">Mikoto API · Responses</option>
            <option value="openai">ChatGPT 官方登录</option>
          </select>
        </label>
        {provider === "mikoto" && (
          <>
            <label>
              API 地址
              <input
                value="https://api.mikoto.vip/v1"
                readOnly
                aria-label="API 地址"
              />
            </label>
            <label>
              默认模型
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                aria-label="默认模型"
                required
                maxLength={100}
                disabled={busy}
              />
            </label>
            <label>
              API 密钥
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                aria-label="API 密钥"
                autoComplete="new-password"
                spellCheck={false}
                placeholder={
                  saved?.hasKey
                    ? "已保存，留空保留；输入新密钥可替换"
                    : "粘贴 API 密钥"
                }
                maxLength={512}
                disabled={busy}
              />
            </label>
          </>
        )}
        <p className="credential-note">
          {saved?.credentialStorage || "仅保存在本机"} ·
          不写入源码、导出文件或安装包。切换连接后请新建会话。
        </p>
        <div className="environment-actions">
          <button
            className="btn primary"
            type="submit"
            disabled={busy || !saved}
          >
            <Save size={14} />
            保存并连接
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={busy || saved?.provider !== "mikoto" || !saved?.hasKey}
            onClick={() =>
              void act(async () => {
                const result = await api<{
                  count: number;
                  modelAvailable: boolean;
                  message: string;
                }>("/engine/provider/check", {});
                setMessage(
                  `${result.message} 共 ${result.count} 个模型${result.modelAvailable ? "。" : "；默认模型未在列表中，请检查模型 ID。"}`,
                );
              })
            }
          >
            <RefreshCw size={14} />
            检查已保存的 API
          </button>
          {saved?.hasKey && (
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const next = await api<Provider>(
                    "/engine/provider",
                    { provider, model, clearKey: true },
                    "PUT",
                  );
                  setSaved(next);
                  setKey("");
                  await onChanged();
                  setMessage("本机 API 密钥已清除。");
                })
              }
            >
              清除本机密钥
            </button>
          )}
        </div>
      </form>
      {message && (
        <p role="status" className="provider-message">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </div>
  );
}
