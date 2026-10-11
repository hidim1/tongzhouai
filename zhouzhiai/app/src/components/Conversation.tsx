import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Square,
  Plus,
  Check,
  Sparkles,
  ChevronDown,
  Paperclip,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { Job, Mode, Skill, Session, Project } from "../types";
import { active, date } from "../api";
type Props = {
  providerName?: string;
  defaultModel?: string;
  session?: Session;
  jobs: Job[];
  mode: Mode;
  skills: Skill[];
  project: Project;
  busy: boolean;
  models: { id: string; displayName: string }[];
  onRun: (
    skill: string,
    message: string,
    options: { model: string; includeImages: boolean },
  ) => Promise<boolean>;
  onNew: () => void;
  onCancel: (job: Job) => void;
  onApproval: (job: Job, decision: string) => void;
  onApply: (job: Job) => void;
  onFiles: () => void;
};
export function Conversation({
  providerName = "Codex 模型",
  defaultModel,
  session,
  jobs,
  mode,
  skills,
  project,
  busy,
  models,
  onRun,
  onNew,
  onCancel,
  onApproval,
  onApply,
  onFiles,
}: Props) {
  const [message, setMessage] = useState("");
  const [skill, setSkill] = useState("consistency-review");
  const [model, setModel] = useState("");
  const [images, setImages] = useState(false);
  const [sending, setSending] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const nearEnd = useRef(true);
  const running = jobs.find((j) => active(j.status));
  const last = jobs.at(-1);
  useEffect(() => {
    nearEnd.current = true;
    setMessage("");
  }, [session?.id]);
  useEffect(() => {
    if (nearEnd.current)
      scroll.current?.scrollTo({
        top: scroll.current.scrollHeight,
        behavior: "instant",
      });
  }, [session?.id, last?.status, last?.events.length, last?.outputText.length]);
  async function send(text = message, s = skill) {
    if (sending || busy || !text.trim()) return;
    setSending(true);
    try {
      const selectedModel = models.some((m) => m.id === model) ? model : "";
      const success = await onRun(s, text, {
        model: selectedModel,
        includeImages: images,
      });
      if (success) setMessage("");
    } finally {
      setSending(false);
    }
  }
  return (
    <section className="conversation">
      <header className="conversation-head">
        <div>
          <strong>{session?.name || "新会话"}</strong>
          <small>
            {mode === "live" ? "舟知 · 工程助手" : "本地演示 · 不调用模型"}
            {session?.model ? ` · ${session.model}` : ""}
          </small>
        </div>
        <button title="新建会话" aria-label="新建会话" onClick={onNew}>
          <Plus size={18} />
        </button>
      </header>
      <div
        className="conversation-scroll"
        ref={scroll}
        onScroll={() => {
          const el = scroll.current!;
          nearEnd.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        }}
      >
        {!jobs.length && (
          <div className="chat-welcome">
            <div className="welcome-symbol">
              <Sparkles size={30} />
            </div>
            <span className="eyebrow">YOUR ENGINEERING COPILOT</span>
            <h2>
              从一份资料，
              <br />
              开始下一步工程工作。
            </h2>
            <p>
              把招标文件、设计输入和图纸放进项目。
              <br />
              描述你的任务，AI 会调用专业技能，给出有来源的初稿。
            </p>
            <div className="chat-starters">
              {[
                ["urs-analysis", "提取招标文件中的关键要求"],
                ["bom-draft", "从图纸与设计输入整理材料清单"],
                ["consistency-review", "检查设计参数与招标要求的差异"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  disabled={busy}
                  onClick={() => {
                    setSkill(id);
                    setMessage(label);
                  }}
                >
                  {label}
                  <ArrowUp size={14} />
                </button>
              ))}
            </div>
          </div>
        )}
        {jobs.map((j) => (
          <article className="chat-turn" key={j.id}>
            <div className="user-message">
              <span>你 · {date(j.createdAt)}</span>
              <p>{j.message || j.title}</p>
            </div>
            <div className="assistant-message">
              <div className="assistant-label">
                <Sparkles size={15} />
                <strong>舟知</strong>
                <span>{j.title}</span>
                {active(j.status) && <Loader2 size={13} className="spin" />}
              </div>
              <details
                className="execution-details"
                open={active(j.status) || undefined}
              >
                <summary>
                  {j.status === "completed"
                    ? "执行完成"
                    : j.status === "cancelled"
                      ? "已停止"
                      : j.status === "failed"
                        ? "执行失败"
                        : "正在执行"}{" "}
                  · {j.events.length} 条记录 <ChevronDown size={12} />
                </summary>
                <ol>
                  {j.events.map((e, i) => (
                    <li key={i}>
                      <Check size={11} />
                      <div>
                        {e.label}
                        {e.detail && <small>{e.detail}</small>}
                      </div>
                    </li>
                  ))}
                </ol>
                {j.threadId && (
                  <code title={j.threadId}>
                    Codex 会话 {j.threadId.slice(0, 18)}…
                  </code>
                )}
              </details>
              {j.error && (
                <div className="chat-error">
                  <AlertCircle size={15} />
                  {j.error}
                </div>
              )}
              {j.proposal && (
                <>
                  <p className="assistant-answer">{j.proposal.summary}</p>
                  {!j.conversationOnly && (
                    <>
                      <details className="proposal-preview">
                        <summary>
                          查看建议内容{" "}
                          <span>
                            {j.proposal.requirements.length} 条需求 ·{" "}
                            {j.proposal.materials.length} 项物料 ·{" "}
                            {j.proposal.issues.length} 个问题 ·{" "}
                            {j.proposal.sections.length} 个章节
                          </span>
                        </summary>
                        <div>
                          {j.proposal.issues.map((x) => (
                            <p key={x.id}>
                              <strong>{x.title}</strong>
                              <br />
                              {x.detail}
                            </p>
                          ))}
                          {j.proposal.materials.map((x) => (
                            <p key={x.id}>
                              <strong>{x.name}</strong> ·{" "}
                              {x.spec || "规格待确认"} · 数量{" "}
                              {x.quantity ?? "待确认"}
                              <small>{x.source}</small>
                            </p>
                          ))}
                          {j.proposal.requirements.map((x) => (
                            <p key={x.id}>
                              {x.content}
                              <small>{x.source}</small>
                            </p>
                          ))}
                          {j.proposal.sections.map((x) => (
                            <p key={x.id}>
                              <strong>{x.title}</strong>
                              <br />
                              {x.content}
                            </p>
                          ))}
                        </div>
                      </details>
                      <button
                        className={`btn small ${j.applied ? "secondary" : "primary"}`}
                        disabled={j.applied || busy}
                        onClick={() => onApply(j)}
                      >
                        <Check size={13} />
                        {j.applied ? "已采纳到成果" : "采纳到右侧成果"}
                      </button>
                    </>
                  )}
                </>
              )}
              {j.status === "completed" && !j.proposal && (
                <p className="assistant-answer">
                  这条历史任务已完成，结果保留在右侧工程成果中。
                </p>
              )}
              {j.approval && j.status === "approval" && (
                <div className="approval-card">
                  <p>{j.approval.command}</p>
                  <button
                    className="btn secondary"
                    onClick={() => onApproval(j, "decline")}
                  >
                    拒绝
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => onApproval(j, "accept")}
                  >
                    批准这次操作
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="向舟知发送消息"
          placeholder="描述任务，或继续追问…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="composer-options">
          <label>
            <span className="sr-only">专业技能</span>
            <select
              aria-label="专业技能"
              value={skill}
              onChange={(e) => setSkill(e.target.value)}
            >
              {skills.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <select
            aria-label="选择模型"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="">
              {defaultModel
                ? `默认 · ${defaultModel}`
                : session?.model || "Codex 默认模型"}
            </option>
            {models.map((m) => (
              <option value={m.id} key={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>
        <footer>
          <button type="button" className="attached-files" onClick={onFiles}>
            <Paperclip size={14} />
            {project.files.length} 份项目资料
          </button>
          <label className="image-consent">
            <input
              type="checkbox"
              checked={images}
              onChange={(e) => setImages(e.target.checked)}
            />
            附带图纸预览
          </label>
          {running ? (
            <button
              type="button"
              aria-label="停止生成"
              className="send-message"
              onClick={() => onCancel(running)}
            >
              <Square size={15} />
            </button>
          ) : (
            <button
              className="send-message"
              aria-label="发送消息"
              disabled={busy || sending || !message.trim()}
            >
              <ArrowUp size={19} />
            </button>
          )}
        </footer>
      </form>
      <p className="chat-footnote">
        {mode === "live"
          ? `文字资料将发送至 ${providerName}；勾选后最多附带 4 张预览。结果需人工采纳。`
          : "演示模式不调用云端 API。演示与真实成果分开保存。"}{" "}
      </p>
    </section>
  );
}
