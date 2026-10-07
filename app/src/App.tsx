import { useCallback, useEffect, useRef, useState } from "react";
import {
  Waves,
  LayoutGrid,
  FolderOpen,
  Files,
  Boxes,
  Settings,
  ChevronDown,
  ChevronRight,
  Plus,
  Upload,
  Download,
  Search,
  Bell,
  ArrowUpRight,
  ArrowRight,
  FileText,
  FileSpreadsheet,
  DraftingCompass,
  MoreHorizontal,
  Check,
  AlertTriangle,
  Sparkles,
  ScanLine,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Loader2,
  RefreshCw,
  Link2,
  ShieldCheck,
  CircleHelp,
  Cpu,
  Play,
  BookOpen,
} from "lucide-react";
import type {
  Bootstrap,
  Mode,
  Project,
  Result,
  ProjectFile,
  Material,
  Job,
} from "./types";
import { api, bytes, date, active } from "./api";
import {
  Requirements,
  Materials,
  Issues,
  Bid,
  Cad,
  Empty,
} from "./components/Results";
import { Editor, FileViewer } from "./components/Editor";
import type { Editing } from "./components/Editor";
import { Conversation } from "./components/Conversation";
import { EnvironmentPanel } from "./components/EnvironmentPanel";
import { ProviderPanel } from "./components/ProviderPanel";
import type { Session } from "./types";
type Tab =
  | "files"
  | "overview"
  | "requirements"
  | "materials"
  | "bid"
  | "cad"
  | "issues";
const navigation = [
  { id: "projects", label: "项目空间", icon: LayoutGrid },
  { id: "workspace", label: "工程工作台", icon: DraftingCompass },
  { id: "artifacts", label: "成果中心", icon: Files },
  { id: "skills", label: "技能中心", icon: Boxes },
];
const tasks = [
  {
    skill: "urs-analysis",
    title: "解析招标要求",
    description: "读懂 URS，提取参数与交付要求",
    icon: FileText,
    tag: "需求分析",
    tab: "requirements",
  },
  {
    skill: "bom-draft",
    title: "整理材料清单",
    description: "关联设计资料，保留位号和来源",
    icon: LayersIcon,
    tag: "工程物料",
    tab: "materials",
  },
  {
    skill: "bid-draft",
    title: "生成技术标",
    description: "按模板编排，可预览、修改与导出",
    icon: BookOpen,
    tag: "文档编制",
    tab: "bid",
  },
];
function LayersIcon({ size = 18 }: { size?: number }) {
  return <Boxes size={size} />;
}
function FileIcon({ ext, size = 16 }: { ext: string; size?: number }) {
  return ext.includes("xls") ? (
    <FileSpreadsheet size={size} />
  ) : ext === ".dwg" || ext === ".dxf" ? (
    <DraftingCompass size={size} />
  ) : (
    <FileText size={size} />
  );
}
export function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [projectId, setProjectId] = useState(
    localStorage.getItem("tz-project") || "",
  );
  const [nav, setNav] = useState("workspace");
  const [tab, setTab] = useState<Tab>("files");
  const [sessionId, setSessionId] = useState(
    localStorage.getItem("tz-session") || "",
  );
  const [models, setModels] = useState<{ id: string; displayName: string }[]>(
    [],
  );
  useEffect(() => {
    localStorage.setItem("tz-session", sessionId);
  }, [sessionId]);
  const [mode, setMode] = useState<Mode>(
    (localStorage.getItem("tz-mode") as Mode) === "demo" ? "demo" : "live",
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const [viewFile, setViewFile] = useState<ProjectFile | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [newDialog, setNewDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [exportMenu, setExportMenu] = useState(false);
  const [fileSearch, setFileSearch] = useState("");
  const [help, setHelp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [brandDraft, setBrandDraft] = useState("");
  const refresh = useCallback(async () => {
    const d = await api<Bootstrap>("/bootstrap");
    setData(d);
    setError("");
    setProjectId((id) =>
      d.projects.some((p) => p.id === id) ? id : d.projects[0]?.id || "",
    );
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const es = new EventSource("/api/events");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          void refresh().catch(() => {});
        }, 800);
    };
    es.addEventListener("change", sync);
    es.addEventListener("ready", sync);
    return () => {
      es.close();
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    localStorage.setItem("tz-project", projectId);
  }, [projectId]);
  useEffect(() => {
    localStorage.setItem("tz-mode", mode);
  }, [mode]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  async function perform(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      setToast((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    let valid = true;
    setModels([]);
    if (data?.engine.connected)
      void api<{ data: { id: string; displayName: string; model: string }[] }>(
        "/engine/models",
      )
        .then((r) => {
          if (valid)
            setModels(
              r.data.map((m) => ({ id: m.model, displayName: m.displayName })),
            );
        })
        .catch(() => {});
    return () => {
      valid = false;
    };
  }, [data?.engine.connected, data?.engine.provider, data?.engine.revision]);
  const sessions =
    data?.sessions.filter(
      (s) => s.projectId === projectId && s.mode === mode,
    ) || [];
  const session = sessions.find((s) => s.id === sessionId);
  async function createSession() {
    await perform("session", async () => {
      const s = await api<Session>(`/projects/${projectId}/sessions`, { mode });
      setSessionId(s.id);
    });
  }
  const project = data?.projects.find((p) => p.id === projectId);
  const result = project?.results[mode];
  const jobs = data?.jobs.filter((j) => j.projectId === projectId) || [];
  const running = jobs.find((j) => active(j.status));
  const pending =
    result?.issues.filter((i) => i.status !== "已确认").length || 0;
  async function run(
    skill: string,
    message?: string,
    options?: { model: string; includeImages: boolean },
  ) {
    if (!project || running) return false;
    return perform("task", async () => {
      const j = await api<Job>(`/projects/${project.id}/tasks`, {
        mode,
        skill,
        message,
        sessionId: session?.id,
        reviewChanges: true,
        ...options,
      });
      setSessionId(j.sessionId);
      setToast(
        mode === "live"
          ? "同舟 AI 正在处理，结果将在会话中返回。"
          : "正在运行演示流程。",
      );
    });
  }
  async function exportFile(type: "xlsx" | "docx") {
    if (!project) return;
    setExportMenu(false);
    await perform("export", async () => {
      const a = await api<{ id: string }>(`/projects/${project.id}/export`, {
        mode,
        type,
      });
      const aTag = document.createElement("a");
      aTag.href = `/api/projects/${project.id}/artifacts/${a.id}`;
      aTag.click();
      setToast("文件已生成并保存到成果中心。");
    });
  }
  async function uploadFiles(files: FileList | null) {
    if (!files?.length || !project) return;
    await perform("upload", async () => {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("files", f);
      const res = await fetch(`/api/projects/${project.id}/files`, {
        method: "POST",
        headers: { "X-Tongzhou-Client": "workspace" },
        body: form,
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setToast("资料已导入，可以重新运行分析。");
    });
    if (inputRef.current) inputRef.current.value = "";
  }
  async function convert(file: ProjectFile) {
    if (!project) return;
    await perform("cad", async () => {
      await api(`/projects/${project.id}/cad/${file.id}`, {});
      setToast("图纸预览与文字提取已完成。");
    });
  }
  function addMaterial() {
    setEditing({
      kind: "materials",
      row: {
        id: "manual-" + crypto.randomUUID().slice(0, 8),
        name: "",
        spec: "",
        material: "",
        unit: "台",
        brand: "",
        quantity: null,
        tag: "",
        price: null,
        status: "待确认",
        source: "工程师手动输入",
        fileId: "",
        note: "",
      },
    });
  }
  if (!data || !project || !result)
    return (
      <div className="loading-screen">
        <img
          className="loading-logo"
          src="/brand/crossflow-logo.png"
          alt="CROSSFLOW 同舟纵横"
        />
        <h2>同舟 AI</h2>
        <p>{error || "正在打开工程工作区…"}</p>
        {error ? (
          <button className="btn primary" onClick={() => void refresh()}>
            重新连接
          </button>
        ) : (
          <Loader2 className="spin" />
        )}
      </div>
    );
  const selectProject = (id: string) => {
    setProjectId(id);
    setTab("files");
    setSessionId("");
    setNav("workspace");
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand crossflow-brand">
          <img
            src="/brand/crossflow-logo.png"
            alt="CROSSFLOW 同舟纵横 FLUID TECHNOLOGY"
          />
          <div className="brand-product">
            <strong>{data.brand}</strong>
            <span>工程智能工作台</span>
          </div>
        </div>
        <div className="org-switch">
          <div className="org-avatar">舟</div>
          <div>
            <strong>同舟纵横</strong>
            <small>流体技术 · 企业工作区</small>
          </div>
          <ChevronDown size={13} />
        </div>
        <div className="nav-label">工作空间</div>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.id}
              aria-label={n.label}
              className={nav === n.id ? "selected" : ""}
              onClick={() => setNav(n.id)}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.id === "workspace" && <span className="nav-pill">AI</span>}
            </button>
          ))}
        </nav>
        <div className="project-nav-label">
          <span>最近项目</span>
          <button aria-label="新建项目" onClick={() => setNewDialog(true)}>
            <Plus size={14} />
          </button>
        </div>
        <div className="recent-projects">
          {data.projects.slice(-5).map((p) => (
            <button
              className={p.id === projectId ? "current" : ""}
              key={p.id}
              onClick={() => selectProject(p.id)}
            >
              <span className="project-dot" />
              <span>{p.name}</span>
            </button>
          ))}
        </div>
        <div className="project-nav-label">
          <span>项目会话 · {mode === "live" ? "真实" : "演示"}</span>
          <button
            title="新建会话"
            onClick={() => {
              setSessionId("");
              setNav("workspace");
            }}
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="session-list">
          {[...sessions].reverse().map((s) => (
            <button
              key={s.id}
              title={s.name}
              className={s.id === session?.id ? "current" : ""}
              onClick={() => {
                setSessionId(s.id);
                setNav("workspace");
              }}
            >
              <span>{s.name}</span>
              <small>{date(s.updatedAt)}</small>
            </button>
          ))}
          {!sessions.length && <small>开始一段新的工程对话</small>}
        </div>
        <div className="sidebar-bottom">
          <div className="engine-card">
            <Cpu size={17} />
            <div>
              <strong>专业工程引擎</strong>
              <small>
                <i
                  className={
                    data.engine.connected && data.engine.authenticated
                      ? "connected"
                      : ""
                  }
                />
                {data.engine.connected && data.engine.authenticated
                  ? "工程引擎已连接"
                  : "工程引擎未就绪"}
              </small>
            </div>
          </div>
          <button
            onClick={() => setNav("settings")}
            className={nav === "settings" ? "selected" : ""}
          >
            <Settings size={17} />
            设置与连接
          </button>
          <button onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
            演示指南
          </button>
          <div className="profile">
            <div>舟</div>
            <span>
              工程工作区<small>{data.server ? "服务器保存" : "本地保存"}</small>
            </span>
            <MoreHorizontal size={18} />
          </div>
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>工作空间</span>
            <ChevronRight size={13} />
            <strong>
              {nav === "settings"
                ? "设置与连接"
                : navigation.find((n) => n.id === nav)?.label}
            </strong>
          </div>
          <div className="topbar-right">
            {data.cloud && (
              <form method="post" action="/logout">
                <button className="btn" type="submit">
                  退出登录
                </button>
              </form>
            )}
            <div className="mode-switch">
              <button
                className={mode === "live" ? "selected" : ""}
                onClick={() => setMode("live")}
              >
                <span className="tiny-dot" />
                真实模式
              </button>
              <button
                className={mode === "demo" ? "selected" : ""}
                onClick={() => setMode("demo")}
              >
                演示模式
              </button>
            </div>
            <button
              className="icon-button notification"
              aria-label="查看待确认事项"
              onClick={() => {
                setNav("workspace");
                setTab("issues");
              }}
            >
              <Bell size={18} />
              {pending > 0 && <i />}
            </button>
            <div className="top-avatar">舟</div>
          </div>
        </header>
        {nav === "workspace" ? (
          <>
            <div className="project-header">
              <div>
                <div className="eyebrow">
                  <span>{project.code}</span>
                  <i />
                  工程投标
                </div>
                <h1>
                  {project.name}
                  <span className="project-state">进行中</span>
                </h1>
                <p>
                  {project.description} <span> / </span> {project.files.length}{" "}
                  份资料 <span> / </span> 更新于 {date(project.updatedAt)}
                </p>
              </div>
              <div className="header-actions">
                <button
                  className="btn secondary"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy === "upload"}
                >
                  <Upload size={15} />
                  {busy === "upload" ? "导入中…" : "导入资料"}
                </button>
                <div className="export-dropdown">
                  <button
                    className="btn primary"
                    disabled={busy === "export"}
                    onClick={() => setExportMenu(!exportMenu)}
                  >
                    {busy === "export" ? (
                      <Loader2 size={15} className="spin" />
                    ) : (
                      <Download size={15} />
                    )}
                    导出成果
                    <ChevronDown size={13} />
                  </button>
                  {exportMenu && (
                    <div className="dropdown-menu">
                      <button onClick={() => void exportFile("xlsx")}>
                        <FileSpreadsheet size={16} />
                        材料清单 Excel
                      </button>
                      <button onClick={() => void exportFile("docx")}>
                        <FileText size={16} />
                        技术标初稿 Word
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {mode === "demo" && (
              <div className="demo-banner">
                <Play size={13} />
                当前为演示模式，展示操作流程，不调用云端模型。
                <button
                  onClick={() =>
                    void perform("reset", async () => {
                      await api(`/projects/${project.id}/reset-demo`, {});
                      setToast("演示数据已重置");
                    })
                  }
                >
                  <RefreshCw size={12} />
                  重置演示
                </button>
              </div>
            )}
            <div className="mobile-workspace-tools">
              <select
                aria-label="切换项目会话"
                value={session?.id || ""}
                onChange={(e) => setSessionId(e.target.value)}
              >
                <option value="">新会话</option>
                {[...sessions].reverse().map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                aria-label="设置与连接"
                onClick={() => setNav("settings")}
              >
                <Settings size={16} />
              </button>
            </div>
            <div className="workspace-grid conversation-layout">
              <Conversation
                providerName={
                  data.engine.provider === "mikoto" ? "Mikoto API" : "OpenAI"
                }
                defaultModel={
                  data.engine.provider === "mikoto"
                    ? data.engine.defaultModel
                    : undefined
                }
                session={session}
                jobs={jobs.filter(
                  (j) => j.sessionId === session?.id && j.mode === mode,
                )}
                mode={mode}
                skills={data.skills}
                project={project}
                models={models}
                busy={!!busy || !!running}
                onRun={run}
                onNew={() => {
                  setSessionId("");
                }}
                onFiles={() => setTab("files")}
                onCancel={(j) =>
                  void perform("cancel", async () => {
                    await api(`/jobs/${j.id}/cancel`, {});
                  })
                }
                onApproval={(j, decision) =>
                  void perform("approval", async () => {
                    await api(`/jobs/${j.id}/approval`, { decision });
                  })
                }
                onApply={(j) =>
                  void perform("apply", async () => {
                    await api(`/jobs/${j.id}/apply`, {});
                    setTab(
                      j.skill === "bid-draft"
                        ? "bid"
                        : j.skill === "bom-draft"
                          ? "materials"
                          : j.skill === "urs-analysis"
                            ? "requirements"
                            : "issues",
                    );
                    setToast("已采纳，人工修改的条目会保留。");
                  })
                }
              />
              <section className="result-panel">
                <div className="result-tabs">
                  {collapsed && (
                    <button
                      aria-label="展开资料栏"
                      className="expand-files"
                      onClick={() => setCollapsed(false)}
                    >
                      <PanelLeftOpen size={16} />
                    </button>
                  )}
                  {(
                    [
                      { id: "files", label: "资料" },
                      { id: "overview", label: "总览" },
                      { id: "requirements", label: "需求响应" },
                      { id: "materials", label: "材料清单" },
                      { id: "bid", label: "技术标书" },
                      { id: "cad", label: "工艺图纸" },
                    ] as const
                  ).map((t) => (
                    <button
                      className={tab === t.id ? "active" : ""}
                      key={t.id}
                      onClick={() => setTab(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                  <button
                    className={`issue-tab ${tab === "issues" ? "active" : ""}`}
                    onClick={() => setTab("issues")}
                    title="审查问题"
                  >
                    <AlertTriangle size={14} />
                    {pending}
                  </button>
                </div>
                <div className="result-scroll">
                  {tab === "files" && (
                    <aside className="file-panel embedded-files">
                      <div className="file-panel-title">
                        <strong>
                          项目资料 <span>{project.files.length}</span>
                        </strong>
                        <button
                          aria-label="折叠资料栏"
                          onClick={() => setCollapsed(true)}
                        >
                          <PanelLeftClose size={16} />
                        </button>
                      </div>
                      <div className="file-search">
                        <Search size={13} />
                        <input
                          aria-label="搜索项目资料"
                          placeholder="查找文件…"
                          value={fileSearch}
                          onChange={(e) => setFileSearch(e.target.value)}
                        />
                      </div>
                      <div className="file-list">
                        {[
                          "招标要求",
                          "设计输入",
                          "工艺图纸",
                          "材料清单",
                          "投标资料",
                        ].map((c) => {
                          const files = project.files.filter(
                            (f) =>
                              f.category === c && f.name.includes(fileSearch),
                          );
                          return files.length ? (
                            <div className="file-group" key={c}>
                              <div>
                                <ChevronDown size={11} />
                                {c}
                                <span>{files.length}</span>
                              </div>
                              {files.map((f) => (
                                <button
                                  key={f.id}
                                  onClick={() => {
                                    if (f.ext === ".dwg" || f.ext === ".dxf") {
                                      setTab("cad");
                                    } else setViewFile(f);
                                  }}
                                  className="file-item"
                                >
                                  <div
                                    className={`file-type ${f.ext.slice(1)}`}
                                  >
                                    <FileIcon ext={f.ext} />
                                  </div>
                                  <span>
                                    <strong title={f.name}>
                                      {f.name.replace(/^\d\./, "")}
                                    </strong>
                                    <small>
                                      {f.ext.slice(1).toUpperCase()} ·{" "}
                                      {bytes(f.size)}
                                    </small>
                                  </span>
                                  {["parsed", "preview"].includes(f.status) ? (
                                    <Check className="file-check" size={12} />
                                  ) : (
                                    <span className="file-pending" />
                                  )}
                                </button>
                              ))}
                            </div>
                          ) : null;
                        })}
                      </div>
                      <button
                        className="drop-zone"
                        onClick={() => inputRef.current?.click()}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          void uploadFiles(e.dataTransfer.files);
                        }}
                      >
                        <Upload size={20} />
                        <strong>添加项目资料</strong>
                        <span>点击选择或拖拽文件至此</span>
                        <small>Word · Excel · PDF · DWG</small>
                      </button>
                      <div className="local-note">
                        <ShieldCheck size={12} />
                        原始文件保留，输出单独保存
                      </div>
                    </aside>
                  )}
                  {tab === "overview" && (
                    <Overview
                      project={project}
                      result={result}
                      mode={mode}
                      onTab={setTab}
                      onRun={run}
                      disabled={!!running || busy === "task"}
                    />
                  )}
                  {tab === "requirements" && (
                    <Requirements
                      result={result}
                      onEdit={(row) =>
                        setEditing({ kind: "requirements", row })
                      }
                    />
                  )}
                  {tab === "materials" && (
                    <Materials
                      result={result}
                      onAdd={addMaterial}
                      onEdit={(row) => setEditing({ kind: "materials", row })}
                    />
                  )}
                  {tab === "issues" && (
                    <>
                      <div className="section-intro">
                        <h2>需要工程师确认的事项</h2>
                        <p>保留原始参数，核实版本、范围与设计依据。</p>
                      </div>
                      <Issues
                        issues={result.issues}
                        onEdit={(row) => setEditing({ kind: "issues", row })}
                      />
                    </>
                  )}
                  {tab === "bid" && (
                    <Bid
                      project={project}
                      result={result}
                      mode={mode}
                      onEdit={(row) => setEditing({ kind: "sections", row })}
                      onGenerate={() => void run("bid-draft")}
                    />
                  )}
                  {tab === "cad" && (
                    <Cad
                      project={project}
                      onConvert={convert}
                      busy={busy === "cad"}
                    />
                  )}
                </div>
                <div className="result-statusbar">
                  <span>
                    <span className="tiny-dot" /> {result.source}
                  </span>
                  <span>
                    {mode === "live"
                      ? data.server
                        ? "资料服务器保存 · 模型云端推理"
                        : "资料本地保存 · 模型云端推理"
                      : "演示数据 · 非正式交付"}
                  </span>
                </div>
              </section>
            </div>
          </>
        ) : (
          <div className="page-container">
            {nav === "projects" && (
              <>
                <div className="page-title">
                  <div>
                    <div className="eyebrow">PROJECT SPACE</div>
                    <h1>项目空间</h1>
                    <p>从资料到交付，让每个项目有迹可循。</p>
                  </div>
                  <button
                    className="btn primary"
                    onClick={() => setNewDialog(true)}
                  >
                    <Plus size={16} />
                    新建项目
                  </button>
                </div>
                <div className="project-cards">
                  {data.projects.map((p) => (
                    <button
                      className="project-card"
                      key={p.id}
                      onClick={() => selectProject(p.id)}
                    >
                      <div className="project-card-top">
                        <div>
                          <FolderOpen size={22} />
                        </div>
                        <span className="project-state">进行中</span>
                      </div>
                      <small>{p.code}</small>
                      <h2>{p.name}</h2>
                      <p>{p.description}</p>
                      <div className="project-card-counts">
                        <span>
                          <Files size={14} />
                          {p.files.length} 份资料
                        </span>
                        <span>
                          <AlertTriangle size={14} />
                          {
                            p.results[mode].issues.filter(
                              (x) => x.status !== "已确认",
                            ).length
                          }{" "}
                          项待确认
                        </span>
                      </div>
                      <footer>
                        <span>{date(p.updatedAt)}</span>
                        <ArrowUpRight size={16} />
                      </footer>
                    </button>
                  ))}
                  <button
                    className="project-card new-card"
                    onClick={() => setNewDialog(true)}
                  >
                    <Plus size={26} />
                    <h3>开始一个新项目</h3>
                    <p>导入资料，让 AI 协助工程投标</p>
                  </button>
                </div>
              </>
            )}
            {nav === "artifacts" && (
              <>
                <div className="page-title">
                  <div>
                    <div className="eyebrow">DELIVERABLES</div>
                    <h1>成果中心</h1>
                    <p>所有导出文件均保留生成模式、来源与时间。</p>
                  </div>
                </div>
                <div className="artifact-grid">
                  {data.projects.flatMap((p) =>
                    p.artifacts.map((a) => (
                      <div className="artifact-card" key={a.id}>
                        <div className={`artifact-icon ${a.type}`}>
                          <FileIcon ext={"." + a.type} size={25} />
                        </div>
                        <div>
                          <h3>{a.name}</h3>
                          <p>{p.name}</p>
                          <small>
                            {a.mode === "demo" ? "演示数据" : "真实项目"} ·{" "}
                            {bytes(a.size)} · {date(a.createdAt)}
                          </small>
                        </div>
                        <a
                          className="btn secondary small"
                          href={`/api/projects/${p.id}/artifacts/${a.id}`}
                        >
                          <Download size={14} />
                          下载
                        </a>
                      </div>
                    )),
                  )}
                </div>
                {!data.projects.some((p) => p.artifacts.length) && (
                  <Empty
                    title="成果将在这里汇集"
                    subtitle="在工程工作台导出材料清单或技术标，生成可下载的文件。"
                    action={
                      <button
                        className="btn primary"
                        onClick={() => setNav("workspace")}
                      >
                        进入工作台
                        <ArrowRight size={15} />
                      </button>
                    }
                  />
                )}
              </>
            )}
            {nav === "skills" && (
              <>
                <div className="page-title">
                  <div>
                    <div className="eyebrow">ENGINEERING SKILLS</div>
                    <h1>专业技能中心</h1>
                    <p>将工程经验整理成可重复执行的工作流程。</p>
                  </div>
                  <span className="count-chip">
                    {data.skills.length} 个本地 Skills
                  </span>
                </div>
                <div className="skill-grid">
                  {data.skills.map((s, i) => (
                    <article className="skill-card" key={s.name}>
                      <div className="skill-card-head">
                        <div className="skill-symbol">
                          <Boxes size={22} />
                        </div>
                        <span className="status success">
                          <Check size={11} />
                          已安装
                        </span>
                      </div>
                      <small>SKILL {String(i + 1).padStart(2, "0")}</small>
                      <h2>{s.title}</h2>
                      <p>{s.description.replace(/^#.*\n/, "").slice(0, 180)}</p>
                      <footer>
                        <code>{s.name}</code>
                        <button
                          className="btn secondary small"
                          disabled={!!running}
                          onClick={() => {
                            setNav("workspace");
                            void run(s.name);
                          }}
                        >
                          <Play size={12} />
                          运行
                        </button>
                      </footer>
                    </article>
                  ))}
                </div>
              </>
            )}
            {nav === "settings" && (
              <>
                <div className="page-title">
                  <div>
                    <div className="eyebrow">WORKSPACE SETTINGS</div>
                    <h1>设置与连接</h1>
                    <p>品牌和引擎配置，仅作用于当前应用。</p>
                  </div>
                </div>
                <div className="settings-card">
                  <div className="settings-heading">
                    <Cpu size={22} />
                    <div>
                      <h2>Codex 引擎</h2>
                      <p>
                        通过 Codex app-server 执行 Skills；支持 Mikoto API 或
                        ChatGPT 登录。
                      </p>
                    </div>
                    <span
                      className={`status ${data.engine.connected && data.engine.authenticated ? "success" : "pending"}`}
                    >
                      {data.engine.connected && data.engine.authenticated
                        ? "引擎就绪"
                        : "未就绪"}
                    </span>
                  </div>
                  <div className="settings-detail">
                    <span>当前模型</span>
                    <strong>
                      {data.engine.model ||
                        (data.engine.provider === "mikoto"
                          ? data.engine.defaultModel
                          : "跟随本机 Codex 默认配置")}
                    </strong>
                  </div>
                  <div className="settings-detail">
                    <span>执行方式</span>
                    <strong>本地应用 + 云端推理</strong>
                  </div>
                  {data.engine.error && (
                    <p className="error-text">{data.engine.error}</p>
                  )}
                  <button
                    className="btn secondary"
                    disabled={busy === "connect" || !!running}
                    onClick={() =>
                      void perform("connect", async () => {
                        await api("/engine/connect", {});
                        setToast("引擎已重新连接");
                      })
                    }
                  >
                    <Link2 size={15} />
                    重新连接引擎
                  </button>
                </div>
                <ProviderPanel onChanged={refresh} />
                <div className="settings-card">
                  <h2>产品品牌</h2>
                  <p>界面名称集中配置，不修改原始文档中的公司名称。</p>
                  <form
                    className="brand-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void perform("brand", async () => {
                        await api(
                          "/settings",
                          { brand: brandDraft || data.brand },
                          "PATCH",
                        );
                        setToast("品牌名称已更新");
                      });
                    }}
                  >
                    <input
                      aria-label="品牌名称"
                      placeholder={data.brand}
                      value={brandDraft}
                      onChange={(e) => setBrandDraft(e.target.value)}
                    />
                    <button className="btn primary">保存名称</button>
                  </form>
                </div>
                <EnvironmentPanel />
                <div className="settings-card muted">
                  <h2>关于此版本</h2>
                  <p>
                    同舟 AI MVP 0.2.2 · 独立工程桌面工作台，通过官方 Codex
                    app-server 连接模型与
                    Skills。支持持续会话、结果采纳与工程成果导出。
                  </p>
                  <p>
                    DWG 预览由 LibreDWG、DXF 解析与 SVG
                    渲染生成。文字排版与复杂图元近似处理，不能替代完整工程算量。
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </main>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept=".doc,.docx,.xlsx,.dwg,.dxf,.pdf,.txt,.md,.csv,.png,.jpg,.jpeg"
        onChange={(e) => void uploadFiles(e.target.files)}
      />
      {editing && (
        <Editor
          key={editing.row.id}
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            await api(
              `/projects/${project.id}/results/${mode}/${editing.kind}/${editing.row.id}`,
              body,
              "PATCH",
            );
            await refresh();
            setToast("修改已保存");
          }}
        />
      )}
      {viewFile && (
        <FileViewer
          file={viewFile}
          project={project}
          onClose={() => setViewFile(null)}
        />
      )}
      {newDialog && (
        <div className="modal-backdrop">
          <section
            className="modal compact"
            role="dialog"
            aria-modal="true"
            aria-label="新建项目"
          >
            <header>
              <h2>新建工程项目</h2>
              <button
                aria-label="关闭新建项目"
                onClick={() => setNewDialog(false)}
              >
                <X size={20} />
              </button>
            </header>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform("new", async () => {
                  const p = await api<Project>("/projects", { name: newName });
                  setProjectId(p.id);
                  setNav("workspace");
                  setTab("overview");
                  setNewName("");
                  setNewDialog(false);
                });
              }}
            >
              <label className="field">
                <span>项目名称</span>
                <input
                  autoFocus
                  value={newName}
                  maxLength={100}
                  required
                  placeholder="例如：超滤设备采购投标"
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
              <footer>
                <span>创建后可导入项目资料</span>
                <button className="btn primary" disabled={busy === "new"}>
                  创建项目
                  <ArrowRight size={15} />
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {help && (
        <div className="modal-backdrop">
          <section
            className="modal compact"
            role="dialog"
            aria-modal="true"
            aria-label="演示指南"
          >
            <header>
              <h2>5 分钟演示路线</h2>
              <button aria-label="关闭指南" onClick={() => setHelp(false)}>
                <X size={20} />
              </button>
            </header>
            <ol className="demo-guide">
              <li>选择预置项目，查看六份真实工程资料。</li>
              <li>打开「需求响应」，查看条目及原文来源。</li>
              <li>查看审查问题，演示膜面积范围差异。</li>
              <li>打开「工艺图纸」，查看 DWG 转换预览。</li>
              <li>运行材料整理或技术标编制，修改并保存。</li>
              <li>导出 Excel / Word，在成果中心下载。</li>
            </ol>
            <p className="guide-note">
              真实模式调用 Codex；演示模式使用标注的样例数据。两者结果独立保存。
            </p>
            <footer>
              <button className="btn primary" onClick={() => setHelp(false)}>
                开始演示
                <ArrowRight size={15} />
              </button>
            </footer>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function Overview({
  project,
  result,
  mode,
  onTab,
  onRun,
  disabled,
}: {
  project: Project;
  result: Result;
  mode: Mode;
  onTab: (t: Tab) => void;
  onRun: (s: string) => void;
  disabled: boolean;
}) {
  const pending = result.issues.filter((x) => x.status !== "已确认");
  return (
    <div className="overview">
      <div className="overview-hero">
        <div className="hero-tag">
          <Sparkles size={12} />
          工程投标智能协作
        </div>
        <h2>从项目资料，到专业交付。</h2>
        <p>读懂需求，核对设计，生成可审核的工程成果。</p>
        <div className="workflow-visual">
          {[
            {
              icon: Files,
              label: "项目资料",
              sub: project.files.length + " 份文件",
            },
            { icon: ScanLine, label: "需求与设计", sub: "结构化分析" },
            { icon: Boxes, label: "材料清单", sub: "保留来源" },
            { icon: FileText, label: "技术标书", sub: "可编辑导出" },
          ].map((x, i) => (
            <div className="workflow-segment" key={x.label}>
              <div className="workflow-node">
                <x.icon size={21} />
                <strong>{x.label}</strong>
                <small>{x.sub}</small>
              </div>
              {i < 3 && (
                <div className="workflow-link">
                  <span />
                  <ChevronRight size={12} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="metrics">
        <button onClick={() => onTab("requirements")}>
          <span>
            已整理需求 <FileText size={14} />
          </span>
          <strong>
            {result.requirements.length}
            <small>条</small>
          </strong>
          <p>本地提取，待人工响应</p>
        </button>
        <button onClick={() => onTab("materials")}>
          <span>
            材料记录 <Boxes size={14} />
          </span>
          <strong>
            {result.materials.length}
            <small>项</small>
          </strong>
          <p>含来源与确认状态</p>
        </button>
        <button onClick={() => onTab("issues")} className="attention-metric">
          <span>
            待确认事项 <AlertTriangle size={14} />
          </span>
          <strong>
            {pending.length}
            <small>项</small>
          </strong>
          <p>核实口径，避免遗漏</p>
        </button>
      </div>
      <div className="section-label">
        <h3>开始一个专业任务</h3>
        <span>同舟 AI · 工程智能工作台</span>
      </div>
      <div className="action-cards">
        {tasks.map((t) => (
          <button
            className="action-card"
            key={t.skill}
            disabled={disabled}
            onClick={() => {
              onTab(t.tab as Tab);
              onRun(t.skill);
            }}
          >
            <div className="action-icon">
              <t.icon size={20} />
            </div>
            <h3>{t.title}</h3>
            <p>{t.description}</p>
            <footer>
              <span>{t.tag}</span>
              <ArrowUpRight size={15} />
            </footer>
          </button>
        ))}
      </div>
      <div className="section-label">
        <h3>项目审查</h3>
        <button onClick={() => onTab("issues")}>
          查看全部
          <ArrowRight size={13} />
        </button>
      </div>
      <div className="overview-review">
        {pending.slice(0, 2).map((i) => (
          <button key={i.id} onClick={() => onTab("issues")}>
            <div className={`review-level ${i.severity}`}>
              <AlertTriangle size={16} />
            </div>
            <div>
              <strong>{i.title}</strong>
              <p>{i.detail}</p>
            </div>
            <ChevronRight size={15} />
          </button>
        ))}
        {!pending.length && (
          <p className="review-empty">
            当前没有登记待确认事项，可运行一致性审查。
          </p>
        )}
      </div>
      <div className="overview-bottom">
        <ShieldCheck size={14} />
        <span>
          {mode === "demo"
            ? "演示结果独立保存，不覆盖真实项目。"
            : "所有输出保留来源，工程师审核后再用于正式交付。"}
        </span>
        <button disabled={disabled} onClick={() => onRun("consistency-review")}>
          开始审查
          <ArrowRight size={13} />
        </button>
      </div>
    </div>
  );
}
