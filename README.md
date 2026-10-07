# 同舟 AI 工程工作台 v0.2.2

以 Codex 为真实执行内核的工程投标 MVP：**同舟 AI GUI → 本地业务服务 → 官方 Codex app-server → 原生 Skills**。界面参考 Codex 的会话式组织方式；不是官方桌面 GUI 源码换皮。

## 直接使用

服务器版本已部署非 root 后台服务、服务器会话持久化与仅本机开放的出站代理。**当前通过 SSH 私有隧道访问，公网 HTTPS 尚未打通**；启动器见 [deploy/private-access](deploy/private-access/README.md)，部署与验收见 [deploy/README.md](deploy/README.md)。云端为共享工作区，不是多租户平台；不自动上传本机客户资料。可选 HTTPS 独立密码登录能力与部署模板已提供，但不能据此认为公网入口已经可用。

- Mac Apple Silicon：`app/release/Tongzhou-AI-0.2.2-mac-arm64.dmg`，或同目录 ZIP 中的「同舟 AI.app」。
- Windows x64：`app/release/Tongzhou-AI-0.2.2-win-x64.exe`，可选安装位置，创建开始菜单/桌面快捷方式。
- 本机浏览器版：<http://127.0.0.1:4318>；原 `启动同州AI.command` 仍可用。

桌面安装包内置 Electron/Node、Codex CLI 0.160.1、LibreDWG 0.14、文档解析和导出组件。**运行不需要自行安装 Node、Python、Office 或 Homebrew。** 真实推理需要可用网络和 API 凭据（或 ChatGPT 登录）。默认接入 Mikoto Responses API，在「设置与连接」输入自己的 API 密钥；本机浏览器版已按用户授权配置。桌面版用系统 safeStorage 加密保存，安装包不携带密钥；桌面版首次需填一次，浏览器版配置不自动导入桌面版。切换到 ChatGPT 后可复用本机 Codex 登录。

安装包不含本次项目资料、历史对话和账户凭据。首次启动创建空项目，由使用者导入资料。数据保存在操作系统用户数据目录，应用「文件」菜单可打开目录；卸载默认保留数据。

**当前为未签名/未公证的内测包，不是已完成双平台正式发行验收的版本。** Mac 已实测启动、资料导入、内置 CAD 转换、真实 Codex 执行及 Word 保存；Windows 目前完成交叉构建，尚未在 Windows 实机安装运行。完整证据和未测项见 [验收报告](app/DESKTOP-ACCEPTANCE.md)。

## v0.2.2 更新

- 产品与 Agent 身份统一为「同舟 AI」，自我介绍为「我是同舟 AI，同舟纵横的工程智能助手」。
- 新建会话使用产品身份指令；历史会话通过官方 `thread/inject_items` 追加版本化应用策略，保留原 threadId 与历史，不靠改写模型输出伪装身份。
- 纯身份问答不额外发送项目资料、不改写工程成果、无需人工采纳；混合工程请求仍按正常任务处理。
- 普通对话采用同舟品牌；技术设置保留真实 Codex / Mikoto 信息，明确追问技术来源时如实说明。
- 桌面显示名更新为「同舟 AI」，内部凭据服务名保持旧标识以兼容已有数据与加密存储。

## v0.2.1 更新

- 使用用户提供的 CROSSFLOW 同舟纵横原始 Logo，更新界面、favicon、macOS/Windows 应用图标。
- `https://api.mikoto.vip/v1` → 官方 Codex app-server → Skills；默认模型 `gpt-6.1-sol`。实际结构化结果、图像理解和同一会话追问已通过。
- API 密钥仅在本机保存；不回传前端、不写入命令行参数或安装包，不修改全局 Codex 配置。自定义 API 使用独立 CODEX_HOME。
- 增加密钥替换/清除、模型列表检查、连接切换与会话来源隔离。
- 18 项自动测试通过。详细的失败探测、成功实测与未测范围见验收报告。

## 已实现

- 会话式工作台：项目/历史会话在左，持续对话居中，文件与工程成果在右。
- 原生 `thread/start` / `thread/resume`：多轮追问、服务重启后的历史续接。
- 5 个 Skills：资料整理、招标需求解析、材料清单整理、技术标编制、一致性审查。
- 实际模型列表；默认跟随 Codex 配置。运行步骤、错误、停止、工具授权入口。
- AI 结构化结果先预览，再由用户采纳；人工修改条目保留。
- DOC、DOCX、XLSX、文本型 PDF 本地解析；扫描 PDF 的 OCR 尚未实现。
- DWG → DXF → PNG / SVG 预览；提取文本和块属性。勾选后可把最多 4 张预览作为原生 `localImage` 交给模型。
- 需求响应、BOM、审查事项和标书章节可编辑；实际 XLSX/DOCX 导出。
- 真实与演示数据分离；演示模式不调用模型。
- 桌面启动器、单实例、原生文件选择/保存、登录入口、环境诊断。

## 样例与数据口径

原 Web 工作区保留 v0.1 的 124 条需求及真实分析结果。旧 CAD 的 159 个文字对象预览已备份，新版预览通过界面实际重新转换；原图文件未修改。v0.2 新导入同一 DOC 得到 **117 条当前正文需求**：新解析器排除了文档中修订删除的内容；已通过保留修订删除文字的对照解析核实差异。旧编号不能直接与新提取结果逐项等同。

新 CAD 渲染器得到 **137 个可见文字对象、1,036 个遍历图元**，口径与旧 ezdxf 管线不同。这些计数不是设备数量。图层颜色保留，但文字定位和部分复杂图元仍是近似预览，不能替代原图复核。

## 开发与构建

```sh
cd /Users/hongwen/vibe4/tongzhou/app
npm ci
npm run dev
npm run build
npm start
npm test

npm run desktop:prepare:mac  # 构建机需 Apple Silicon + LibreDWG 0.14
npm run desktop             # 使用 Electron 开发壳
npm run package:mac         # Mac arm64 DMG / ZIP
npm run package:win         # Windows x64 NSIS 安装器
```

构建依赖与最终用户运行依赖不同：打包机需要 Node 和相应构建工具，最终桌面用户不需要它们。`desktop/prepare-runtime.mjs` 准备官方 Codex 平台二进制、DWG 转换器及许可证/对应源码归档，并输出 SHA-256 清单。Windows 可在当前 Mac 交叉构建；原生 Windows CI 路径已配置但尚未运行。

### 目录

- `app/src/`：React GUI；`components/Conversation.tsx`：会话与建议采纳。
- `app/server/codex.mjs`：官方 stdio JSON-RPC 适配器。
- `app/server/jobs.mjs`：会话续接、任务状态、schema 校验、采纳保护。
- `app/server/documents.mjs` / `cad.mjs`：跨平台文件处理。
- `app/.agents/skills/`：5 个原生 Skill 和结构化结果 schema。
- `app/desktop/`：Electron 主进程、打包配置与运行资源准备脚本。
- `app/data/`：Web 工作区及本次 QA 证据；不进入安装包。
- `app/data/workspace.v01-backup.json`：升级前工作区备份。
- `app/data/qa/real-session-v02.json`：真实视觉、多轮与重启续接验证。
- `app/data/qa/tests-v02.log`：16 项自动测试记录。
- `.github/workflows/desktop.yml`：已提交的手动触发双平台构建工作流，尚未运行。

### 配置

`PORT`（默认 4318，仅本机）、`TONGZHOU_DATA_DIR`、`CODEX_BIN`、`TONGZHOU_DWG_BIN`、`TONGZHOU_FONT`、`TONGZHOU_NO_AUTO_CONNECT`。桌面模式由主进程传入随机端口、用户数据路径和会话令牌，不在前端暴露令牌。旧 Python 工具仅保留用于历史比较/QA，不是 v0.2 应用运行链路。

## 边界

这是**单机工程投标 MVP**，不是已完成正式商用验收的整套工程系统。尚无完整 CAD 管线拓扑/自动算量、价格与供应商库、ERP/NAS 对接、多用户权限、签名/公证、自动升级与数据迁移安装验收。标书是结构化技术初稿，尚未完整复刻招标文件的全部商务附件、资格资料、签章页和最终报价。

真实模式将提取的项目文字发给模型，每份文字最多 20,000 字符；截断标记会传入模型。图纸预览需勾选后附带。原文件与成果保存在当前部署的数据目录。Mikoto 连接使用应用独立凭据和 Codex 会话目录；切换到官方连接时可复用本机 Codex 登录。公网部署的工作区访问密码仅保存 scrypt 哈希，不使用服务器 SSH 密码作为应用密码。

原始 v0.1 技术记录、协议快照、客户样例和本机 QA 文件仅保留在本机，不随 Git 发布。当前结构与运维入口以本 README、验收报告和部署文档为准。
