import { useState } from "react";
import {
  Sparkles,
  ArrowUp,
  Square,
  Check,
  Loader2,
  AlertCircle,
  ChevronDown,
  Circle,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";
import type { Job, Mode, Skill } from "../types";
import { active, date } from "../api";
export function TaskRail({
  jobs,
  mode,
  skills,
  onRun,
  onCancel,
  onApproval,
}: {
  jobs: Job[];
  mode: Mode;
  skills: Skill[];
  onRun: (skill: string, message?: string) => void;
  onCancel: (job: Job) => void;
  onApproval: (job: Job, decision: string) => void;
}) {
  const [skill, setSkill] = useState("consistency-review");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState(false);
  const current = jobs.filter((j) => j.mode === mode).at(-1);
  const running = jobs.find((j) => active(j.status));
  const options = skills.filter((s) => s.name !== "project-intake");
  return (
    <aside className="task-rail">
      <header>
        <div className="agent-icon">
          <Sparkles size={17} />
        </div>
        <div>
          <strong>工程智能助手</strong>
          <small>Codex × 专业 Skills</small>
        </div>
        <span className="live-dot" />
      </header>
      <div className="rail-scroll">
        {current ? (
          <>
            <div className="task-caption">
              <span>当前任务</span>
              <span>{date(current.createdAt)}</span>
            </div>
            <div className="task-title">
              <strong>{current.title}</strong>
              <span
                className={`status ${current.status === "completed" ? "success" : current.status === "failed" ? "danger" : "pending"}`}
              >
                {
                  (
                    {
                      queued: "排队中",
                      running: "执行中",
                      approval: "待授权",
                      completed: "已完成",
                      failed: "失败",
                      cancelled: "已取消",
                    } as Record<string, string>
                  )[current.status]
                }
              </span>
            </div>
            {current.message && (
              <div className="user-message">{current.message}</div>
            )}
            <div className="timeline">
              {current.events.map((e, i) => (
                <div className="timeline-event" key={i}>
                  <div
                    className={`timeline-marker ${e.kind === "failed" ? "error" : ""}`}
                  >
                    {i === current.events.length - 1 &&
                    active(current.status) ? (
                      <Loader2 size={13} className="spin" />
                    ) : e.kind === "failed" ? (
                      <AlertCircle size={13} />
                    ) : (
                      <Check size={12} />
                    )}
                  </div>
                  <div>
                    <strong>{e.label}</strong>
                    {e.detail && <p>{e.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
            {current.status === "running" && (
              <div className="working">
                <span className="pulse-dot" />
                正在分析项目资料
                {current.outputText.length > 0 && (
                  <small>
                    {" "}
                    · 已接收 {current.outputText.length.toLocaleString()} 字符
                  </small>
                )}
              </div>
            )}
            {current.error && (
              <div className="task-error">
                <AlertCircle size={16} />
                <p>{current.error}</p>
              </div>
            )}
            {current.approval && (
              <div className="approval-box">
                <ShieldCheck size={18} />
                <strong>工具需要你的授权</strong>
                <pre>{current.approval.command}</pre>
                <div>
                  <button
                    className="btn secondary small"
                    onClick={() => onApproval(current, "decline")}
                  >
                    拒绝
                  </button>
                  <button
                    className="btn primary small"
                    onClick={() => onApproval(current, "accept")}
                  >
                    允许本次
                  </button>
                </div>
              </div>
            )}
            {active(current.status) ? (
              <button
                className="btn secondary stop"
                onClick={() => onCancel(current)}
              >
                <Square size={12} />
                停止任务
              </button>
            ) : (
              <button
                className="retry-btn"
                onClick={() => onRun(current.skill, current.message)}
              >
                <RotateCcw size={12} />
                重新运行
              </button>
            )}
            {current.threadId && (
              <details className="trace">
                <summary>
                  执行记录 <ChevronDown size={11} />
                </summary>
                <p>模型：{current.model}</p>
                <p>Thread：{current.threadId}</p>
                <p>Turn：{current.turnId}</p>
                <p>Skill：{current.skill}</p>
              </details>
            )}
          </>
        ) : (
          <div className="rail-welcome">
            <div className="sparkle-orbit">
              <Sparkles size={30} />
            </div>
            <h3>准备好，开始协作</h3>
            <p>
              选择一个任务，助手将结合项目资料与专业技能，整理可审核的成果。
            </p>
            <div className="rail-suggestions">
              <button onClick={() => onRun("urs-analysis")}>
                提取招标文件的重点要求 <ArrowUp size={13} />
              </button>
              <button onClick={() => onRun("consistency-review")}>
                检查设计参数与需求差异 <ArrowUp size={13} />
              </button>
            </div>
          </div>
        )}
        {jobs.length > 1 && (
          <div className="task-history">
            <button onClick={() => setHistory(!history)}>
              历史任务 <span>{jobs.length}</span>
              <ChevronDown size={13} />
            </button>
            {history &&
              jobs
                .slice()
                .reverse()
                .map((j) => (
                  <div key={j.id}>
                    <Circle size={7} />
                    <span>
                      {j.title}
                      <small>
                        {j.mode === "live" ? "真实执行" : "演示模式"} ·{" "}
                        {date(j.createdAt)}
                      </small>
                    </span>
                    <span>
                      {j.status === "completed"
                        ? "完成"
                        : j.status === "failed"
                          ? "失败"
                          : j.status === "cancelled"
                            ? "取消"
                            : "进行中"}
                    </span>
                  </div>
                ))}
          </div>
        )}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          onRun(skill, message);
          setMessage("");
        }}
      >
        <div>
          <Sparkles size={13} />
          <select
            aria-label="选择执行技能"
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
          >
            {options.map((s) => (
              <option key={s.name} value={s.name}>
                {s.title}
              </option>
            ))}
          </select>
        </div>
        <textarea
          aria-label="补充任务要求"
          placeholder="补充你的要求，例如：重点核对膜面积…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <footer>
          <span>
            {mode === "live" ? "真实 Codex 执行" : "演示模式 · 不调用模型"}
          </span>
          <button
            aria-label="发送任务"
            disabled={!!running}
            className="send-button"
          >
            <ArrowUp size={19} />
          </button>
        </footer>
      </form>
      <p className="rail-footnote">AI 整理初稿，工程师确认交付。</p>
    </aside>
  );
}
