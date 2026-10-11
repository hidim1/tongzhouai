import { useState } from "react";
import { X, Save, ExternalLink } from "lucide-react";
import type {
  Requirement,
  Material,
  Issue,
  Section,
  ProjectFile,
  Project,
} from "../types";
export type Editing =
  | { kind: "requirements"; row: Requirement }
  | { kind: "materials"; row: Material }
  | { kind: "issues"; row: Issue }
  | { kind: "sections"; row: Section };
export function Editor({
  editing,
  onSave,
  onClose,
}: {
  editing: Editing;
  onSave: (data: unknown) => Promise<void>;
  onClose: () => void;
}) {
  const [data, setData] = useState<Record<string, unknown>>({ ...editing.row });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string, v: unknown) => setData((d) => ({ ...d, [k]: v }));
  const input = (key: string, label: string, area = false) => (
    <label className={area ? "field wide" : "field"} key={key}>
      <span>{label}</span>
      {area ? (
        <textarea
          rows={key === "content" ? 9 : 3}
          value={String(data[key] ?? "")}
          onChange={(e) => set(key, e.target.value)}
        />
      ) : (
        <input
          value={String(data[key] ?? "")}
          onChange={(e) => set(key, e.target.value)}
        />
      )}
    </label>
  );
  const title = {
    requirements: "审核需求响应",
    materials: "编辑材料记录",
    issues: "确认审查问题",
    sections: "编辑标书章节",
  }[editing.kind];
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="modal editor"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <small>{editing.row.id}</small>
            <h2>{title}</h2>
          </div>
          <button aria-label="关闭编辑" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onSave(data);
              onClose();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="editor-body">
            {editing.kind === "requirements" && (
              <>
                <div className="source-box">
                  {editing.row.content}
                  <small>来源：{editing.row.source}</small>
                </div>
                {input("response", "供方具体响应 / 审核意见", true)}
              </>
            )}
            {editing.kind === "materials" && (
              <div className="form-grid">
                {[
                  ["name", "产品名称"],
                  ["spec", "规格型号"],
                  ["material", "材质"],
                  ["brand", "厂家 / 品牌"],
                  ["unit", "单位"],
                  ["tag", "工艺位号"],
                ].map(([k, l]) => input(k, l))}
                {[
                  ["quantity", "数量"],
                  ["price", "单价（元）"],
                ].map(([k, l]) => (
                  <label className="field" key={k}>
                    <span>{l}（未知请留空）</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={data[k] === null ? "" : String(data[k] ?? "")}
                      onChange={(e) =>
                        set(
                          k,
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                    />
                  </label>
                ))}
                {input("note", "备注", true)}
                <div className="source-box wide">
                  来源：{String(data.source)}
                </div>
              </div>
            )}
            {editing.kind === "issues" && (
              <>
                <div className="source-box">
                  <strong>{editing.row.title}</strong>
                  <p>{editing.row.detail}</p>
                  <small>来源：{editing.row.source}</small>
                </div>
                {input("note", "工程师确认意见", true)}
              </>
            )}
            {editing.kind === "sections" && (
              <>
                {input("title", "章节标题")}
                {input("content", "正文", true)}
              </>
            )}
            {editing.kind !== "sections" && (
              <label className="field">
                <span>确认状态</span>
                <select
                  value={String(data.status)}
                  onChange={(e) => set("status", e.target.value)}
                >
                  <option>待确认</option>
                  <option>已确认</option>
                  <option>偏离</option>
                </select>
              </label>
            )}
            {error && <p className="error-text">{error}</p>}
          </div>
          <footer>
            <span>保存后将保留人工修改，不被后续分析覆盖</span>
            <button className="btn primary" disabled={busy}>
              <Save size={15} />
              {busy ? "保存中…" : "保存修改"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
export function FileViewer({
  file,
  project,
  onClose,
}: {
  file: ProjectFile;
  project: Project;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="modal file-modal"
        role="dialog"
        aria-modal="true"
        aria-label="文件预览"
      >
        <header>
          <div>
            <small>项目原始资料</small>
            <h2>{file.name}</h2>
          </div>
          <button aria-label="关闭预览" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="file-preview-body">
          {file.parseNote && <p className="notice subtle">{file.parseNote}</p>}
          {file.preview ? (
            <img
              src={`/api/projects/${project.id}/preview/${file.id}`}
              alt={file.name}
            />
          ) : (
            <pre>
              {file.textPreview ||
                "暂无可提取正文。CAD 文件可在「工艺图纸」页面转换预览。"}
            </pre>
          )}
        </div>
        <footer>
          <span>文字预览最多显示 12,000 字符，原文件完整保留</span>
          <a
            className="btn secondary small"
            href={`/api/projects/${project.id}/files/${file.id}`}
          >
            <ExternalLink size={14} />
            下载原文件
          </a>
        </footer>
      </section>
    </div>
  );
}
