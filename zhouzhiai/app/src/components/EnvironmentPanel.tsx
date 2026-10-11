import { useState } from "react";
import { api } from "../api";
import { Check, AlertCircle, ExternalLink, RefreshCw } from "lucide-react";
type Diagnostics = {
  platform: string;
  arch: string;
  version: string;
  desktop: boolean;
  checks: { id: string; name: string; status: string; detail: string }[];
};
export function EnvironmentPanel() {
  const [data, setData] = useState<Diagnostics>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [login, setLogin] = useState<{ loginId: string; authUrl: string }>();
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-card">
      <h2>安装环境与登录</h2>
      <p>
        桌面安装包内置 Codex 引擎。使用 Mikoto API 时无需 ChatGPT 登录。
        如需使用官方账号，请先在上方切换连接方式；登录凭据由官方 Codex 管理。
      </p>
      <div className="environment-actions">
        <button
          className="btn secondary"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              setData(await api("/diagnostics"));
            })
          }
        >
          <RefreshCw size={14} />
          检查运行环境
        </button>
        <button
          className="btn primary"
          disabled={busy || !!login}
          onClick={() =>
            void action(async () => {
              setLogin(await api("/engine/login", {}));
            })
          }
        >
          使用 ChatGPT 登录
        </button>
      </div>
      {login && (
        <div className="login-box">
          <a
            href={login.authUrl}
            target="_blank"
            rel="noreferrer"
            className="btn primary"
          >
            打开官方登录页面 <ExternalLink size={14} />
          </a>
          <button
            className="btn secondary"
            onClick={() =>
              void action(async () => {
                await api("/engine/login/cancel", { loginId: login.loginId });
                setLogin(undefined);
              })
            }
          >
            结束登录流程
          </button>
          <p>
            完成后点击“重新连接引擎”刷新状态。此操作可能更新本机 Codex
            共用的登录状态。
          </p>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      {data && (
        <>
          <p>
            {data.desktop ? "桌面应用" : "浏览器工作台"} · {data.platform} /{" "}
            {data.arch} · v{data.version}
          </p>
          {data.checks.map((c) => (
            <div key={c.id} className="diagnostic-row">
              {c.status === "ready" ? (
                <Check size={16} />
              ) : (
                <AlertCircle size={16} />
              )}
              <div>
                <strong>{c.name}</strong>
                <small>{c.detail}</small>
              </div>
              <span>{c.status === "ready" ? "就绪" : "待处理"}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
