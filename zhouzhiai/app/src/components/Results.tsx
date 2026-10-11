import { useState } from "react";
import {
  Search,
  Plus,
  ArrowUpRight,
  FileText,
  Layers,
  ScanLine,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Check,
  Pencil,
} from "lucide-react";
import type {
  Project,
  Result,
  Requirement,
  Material,
  Issue,
  Section,
  Mode,
  ProjectFile,
} from "../types";
export function Status({ value }: { value: string }) {
  return (
    <span
      className={`status ${value === "已确认" ? "success" : value === "偏离" ? "danger" : "pending"}`}
    >
      {value === "已确认" ? <Check size={11} /> : <span className="tiny-dot" />}
      {value}
    </span>
  );
}
export function Requirements({
  result,
  onEdit,
}: {
  result: Result;
  onEdit: (r: Requirement) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部类别");
  const [page, setPage] = useState(0);
  const rows = result.requirements.filter(
    (x) =>
      (category === "全部类别" || x.category === category) &&
      `${x.id} ${x.content} ${x.source}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(rows.length / 8));
  const safePage = Math.min(page, pages - 1);
  return (
    <>
      <div className="panel-toolbar">
        <div className="search">
          <Search size={15} />
          <input
            aria-label="搜索需求"
            placeholder="搜索需求、参数、条款…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <select
          aria-label="需求类别"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(0);
          }}
        >
          {[
            "全部类别",
            ...new Set(result.requirements.map((r) => r.category)),
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </div>
      <div className="table-wrap">
        <table className="data-table requirements">
          <thead>
            <tr>
              <th>需求条目</th>
              <th>类别 / 属性</th>
              <th>响应状态</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(safePage * 8, safePage * 8 + 8).map((r) => (
              <tr
                key={r.id}
                onClick={() => onEdit(r)}
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onEdit(r)}
              >
                <td>
                  <span className="row-code">{r.id}</span>
                  <p className="clamp-3">{r.content}</p>
                  <small className="source-line" title={r.source}>
                    <FileText size={10} />
                    {r.source.split(" · ").slice(1).join(" · ")}
                  </small>
                </td>
                <td>
                  <span>{r.category}</span>
                  <small className="attribute">{r.expected}</small>
                </td>
                <td>
                  <Status value={r.status} />
                </td>
                <td>
                  <Pencil size={13} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <Empty
            title="还没有需求条目"
            subtitle="导入 URS 后点击「解析招标要求」。"
          />
        )}
      </div>
      <div className="table-footer">
        <span>共 {rows.length} 条 · 来源可追溯</span>
        <div>
          <button
            aria-label="上一页"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {safePage + 1} / {pages}
          </span>
          <button
            aria-label="下一页"
            disabled={safePage >= pages - 1}
            onClick={() => setPage(safePage + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </>
  );
}
export function Materials({
  result,
  onEdit,
  onAdd,
}: {
  result: Result;
  onEdit: (r: Material) => void;
  onAdd: () => void;
}) {
  const [search, setSearch] = useState("");
  const rows = result.materials.filter((r) =>
    `${r.name} ${r.spec} ${r.tag}`.includes(search),
  );
  return (
    <>
      <div className="panel-toolbar">
        <div className="search">
          <Search size={15} />
          <input
            aria-label="搜索材料"
            placeholder="搜索名称、规格或位号…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn secondary small" onClick={onAdd}>
          <Plus size={14} />
          添加物料
        </button>
      </div>
      <div className="notice subtle">
        <AlertTriangle size={14} />
        未知数量、价格留空，待工程师选型和询价。
      </div>
      <div className="table-wrap">
        <table className="data-table materials">
          <thead>
            <tr>
              <th>设备 / 物料</th>
              <th>材质 / 品牌</th>
              <th>数量</th>
              <th>单价</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.id}
                onClick={() => onEdit(r)}
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onEdit(r)}
              >
                <td>
                  <span className="row-code">
                    {r.tag || String(i + 1).padStart(2, "0")}
                  </span>
                  <p>{r.name}</p>
                  <small>{r.spec || "规格待确认"}</small>
                </td>
                <td>
                  {r.material || "—"}
                  <small className="attribute">{r.brand || "品牌待确认"}</small>
                </td>
                <td>
                  {r.quantity ?? "—"}
                  <small className="attribute">{r.unit}</small>
                </td>
                <td>
                  {r.price === null ? "待询价" : "¥" + r.price.toLocaleString()}
                </td>
                <td>
                  <Status value={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <Empty
            title="材料清单等待整理"
            subtitle="点击「整理材料清单」或手动添加物料。"
          />
        )}
      </div>
      <div className="table-footer">
        <span>{rows.length} 条物料</span>
        <span>点击物料可编辑与确认</span>
      </div>
    </>
  );
}
export function Issues({
  issues,
  onEdit,
}: {
  issues: Issue[];
  onEdit: (r: Issue) => void;
}) {
  return (
    <div className="issues-list">
      {issues.map((r) => (
        <button
          className={`issue-card ${r.status === "已确认" ? "resolved" : ""}`}
          key={r.id}
          onClick={() => onEdit(r)}
        >
          <div className={`issue-icon ${r.severity}`}>
            <AlertTriangle size={17} />
          </div>
          <div className="issue-copy">
            <div>
              <strong>{r.title}</strong>
              <Status value={r.status} />
            </div>
            <p>{r.detail}</p>
            <small>{r.source}</small>
            {r.note && <p className="review-note">审核备注：{r.note}</p>}
          </div>
          <ArrowUpRight size={15} />
        </button>
      ))}
      {!issues.length && (
        <Empty
          title="尚未登记审查问题"
          subtitle="运行一致性审查，核对资料间的参数与口径。"
        />
      )}
    </div>
  );
}
export function Bid({
  project,
  result,
  mode,
  onEdit,
  onGenerate,
}: {
  project: Project;
  result: Result;
  mode: Mode;
  onEdit: (r: Section) => void;
  onGenerate: () => void;
}) {
  return result.sections.length ? (
    <div className="document-preview">
      <div className="document-sheet">
        <div className="doc-letterhead">
          CROSSFLOW <span>同舟纵横流体技术</span>
        </div>
        <div className="doc-kicker">TECHNICAL PROPOSAL · DRAFT</div>
        <h1>技术标初稿</h1>
        <p className="doc-project">{project.name}</p>
        <div className="doc-state">
          {mode === "demo" ? "演示数据 · " : ""}待工程师审核 ·{" "}
          {result.requirements.length} 条需求
        </div>
        {result.sections.map((s) => (
          <section className="doc-section" key={s.id}>
            <h2>
              {s.title}
              <button aria-label={`编辑${s.title}`} onClick={() => onEdit(s)}>
                <Pencil size={13} />
              </button>
            </h2>
            {s.content
              .split("\n")
              .filter(Boolean)
              .map((t, i) => (
                <p key={i}>{t}</p>
              ))}
          </section>
        ))}
        <div className="doc-foot">
          导出 Word 时会附加完整需求响应表和设备配置草稿。
        </div>
      </div>
    </div>
  ) : (
    <Empty
      title="把工程资料，整理成技术标初稿"
      subtitle="按招标文件格式组织章节，保留来源与待确认事项。"
      action={
        <button className="btn primary" onClick={onGenerate}>
          <FileText size={16} />
          生成技术标
        </button>
      }
    />
  );
}
export function Cad({
  project,
  onConvert,
  busy,
}: {
  project: Project;
  onConvert: (f: ProjectFile) => void;
  busy: boolean;
}) {
  const file = project.files.find((x) => [".dwg", ".dxf"].includes(x.ext));
  return file ? (
    <div className="cad-panel">
      <div className="cad-toolbar">
        <span>
          <ScanLine size={16} />
          {file.name}
        </span>
        <button
          className="btn secondary small"
          disabled={busy}
          onClick={() => onConvert(file)}
        >
          {busy ? "转换中…" : file.preview ? "重新转换" : "转换图纸预览"}
        </button>
      </div>
      {file.preview ? (
        <>
          <a
            className="cad-image"
            href={`/api/projects/${project.id}/preview/${file.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <img
              src={`/api/projects/${project.id}/preview/${file.id}?v=${encodeURIComponent(file.previewUpdatedAt || String(file.textPreview.length))}`}
              alt="由原始 DWG 转换的工艺流程图"
            />
          </a>
          <div className="cad-info">
            <span>{file.cadStats?.entities.toLocaleString()} 个展开图元</span>
            <span>{file.cadStats?.textItems} 个文字对象</span>
            <a
              href={`/api/projects/${project.id}/preview/${file.id}`}
              target="_blank"
              rel="noreferrer"
            >
              打开原尺寸 <ArrowUpRight size={12} />
            </a>
          </div>
          <div className="notice subtle">{file.cadNote}</div>
          <details className="cad-text">
            <summary>查看提取的图中文字</summary>
            <pre>{file.textPreview}</pre>
          </details>
        </>
      ) : (
        <Empty
          title="让图纸成为可阅读的资料"
          subtitle="将 DWG 转为 DXF 并渲染图片，同时提取图中文字。不自动推断设备数量。"
          action={
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => onConvert(file)}
            >
              <ScanLine size={16} />
              {busy ? "正在转换图纸…" : "转换并查看图纸"}
            </button>
          }
        />
      )}
    </div>
  ) : (
    <Empty
      title="尚未导入工艺图纸"
      subtitle="添加 DWG 或 DXF 文件后，可在这里查看。"
    />
  );
}
export function Empty({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Layers size={28} />
      </div>
      <h3>{title}</h3>
      <p>{subtitle}</p>
      {action}
    </div>
  );
}
