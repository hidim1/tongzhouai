# 同舟 AI v0.2.2 — Agent 身份与历史会话兼容验收

日期：2026-10-07（Asia/Taipei）。当前更新只增加品牌身份与相关交互，不改变 Codex + Skills 执行架构。

- 新会话实测「你是谁？」「你叫什么名字？」均回答：**我是同舟 AI，同舟纵横的工程智能助手。**
- 英文 `Who are you?` 仍识别为 Tongzhou AI / 同舟 AI；追问底层技术时如实说明 Codex app-server 与 Mikoto API，不虚称基础模型自研。
- 实际模型调用：`data/qa/identity-real-v022.json`。不是前端截获关键词后伪造的实时模型回复；演示模式的本地回复明确标注演示。
- 初次旧会话回归发现仍使用历史「同州 AI」提示。失败记录保存在 `data/qa/identity-legacy-ui-v022.json`，未删改历史。
- 修复：使用官方 `thread/inject_items` 追加版本化 developer 身份策略。保留同一 threadId、不重建或清空历史、不改写模型回答。旧会话复测通过，证据 `data/qa/identity-legacy-fixed-v022.json`。
- 修复后再次重启服务，从 GUI 在同一旧会话发送「你叫什么名字？」；真实回复「我叫同舟 AI，是同舟纵横的工程智能助手。」且 threadId 不变。证据 `data/qa/identity-legacy-restart-v022.json`。最终界面截图：`docs/screenshots/tongzhou-identity-v022.png`。
- 身份问答不额外附带文件正文或图片，不自动推导工程问题、不覆盖现有成果；界面不再出现无意义的「0 条建议 / 采纳」控件。
- 品牌默认「同州」迁移为「同舟」，保留用户另行设置的名称。窗口标题、助手标签、菜单、安装包显示名统一。同名旧数据目录/加密服务内部标识保持兼容。
- `npm run build` 与 21/21 自动回归通过；详见 `data/qa/tests-v022.log`。Mac ARM64 DMG/ZIP 和 Windows x64 EXE 已构建；安装包源文件、身份策略、5 个 Skills、运行时清单与密钥排除由 `scripts/verify-packages.mjs` 验证，证据 `data/qa/packages-v022.json`。
- 仍为未签名内测包；不将打包成功等同 Windows 实机验收，Mac 原生界面锁屏限制仍适用。

接口依据：[官方 App Server 文档：Inject items into a thread](https://learn.chatgpt.com/docs/app-server#inject-items-into-a-thread)。同时核对了本机 Codex 0.160.1 生成的 JSON Schema。

---

# 同州 AI v0.2.1 — CROSSFLOW 品牌与 Mikoto API 验收

日期：2026-10-07（Asia/Taipei）。本节为当前增量验收，后附 v0.2 的原始记录。

## 本次结果

| 项目 | 结果与证据 |
|---|---|
| 原始 Logo | 原 PNG 无改绘复制到 `public/brand/crossflow-logo.png`；桌面图标取同一原图左侧标志等比缩放，白底圆角容器 |
| 编译 / 回归 | `npm run build` 通过；18/18 自动测试通过，`data/qa/tests-v021.log` |
| API 鉴权 | `GET https://api.mikoto.vip/v1/models` 成功返回 21 个模型；这项本身不代表所有模型可生成 |
| Codex + Mikoto + Skill | `gpt-6.1-sol` 实际任务返回 CROSSFLOW_OK，结构校验通过；`data/qa/mikoto-codex-recheck-v021.json` |
| 视觉理解 | 合成测试图：正确识别左侧蓝色竖直矩形、右侧橙色圆形。没有发送客户工程文件 |
| 持续会话 | 两轮真实任务使用同一 threadId；第二轮复述 CF4L9 与前轮图形；`data/qa/mikoto-vision-session-v021.json` |
| 重启续接 + GUI | 重启服务后从 GUI 发起第三轮，仍复述 CF4L9 和原图颜色；同一 threadId；点击人工采纳成功；`data/qa/mikoto-ui-restart-v021.json` |
| 密钥边界 | 参数仅传环境变量名，密钥不放 CLI 参数；HTTP 返回 hasKey 不返回密钥；错误信息脱敏；地址固定为用户授权的 Mikoto host；模型列表请求禁跟随重定向 |
| 存储 | 浏览器服务本机文件权限 0600；Mac Electron safeStorage 加密和解密往返通过，密文不含测试密钥，`data/qa/vault-os-v021.json` |
| 会话隔离 | 自定义 API 使用应用私有 CODEX_HOME；旧官方会话不能被直接转发到另一 provider，需新建会话；不改用户全局 Codex 配置/登录 |
| 系统图标 | Mac ICNS 与构建源一致；Windows EXE 内 16/32/48/64/128/256 六档 ICO 图像逐字节命中 |
| 包内容 | Mac / Windows ASAR 与源码逐项比对；5 个 Skills；排除工程资料和凭据；用户实际密钥全字节扫描未入包；`data/qa/packages-v021.json` |

### 如实保留的失败探测

最初直接向 Responses 端点发送极简请求，gpt-6.1-sol / gpt-5.4 / gpt-5.4-mini / gpt-6-luna 曾返回 502 Upstream access forbidden。首次经 Codex 调用 gpt-5.4 返回 429。随后通过真实 Codex 调用 **gpt-6.1-sol 连续成功**（结构化响应、图片、多轮会话），因此将其设为默认。没有把失败模型或全部 21 个列表模型标成已通过。

### 使用与未测范围

- 本机浏览器工作台已保存用户授权的 API 配置。安装包不内嵌密钥；桌面安装版首次使用需进入「设置与连接」填入密钥一次，之后由系统加密保存。浏览器版配置不会自动导入桌面版。
- Mac 的 safeStorage 实际测试通过；Windows DPAPI 存储路径实现了但还没有 Windows 实机测试。
- 尝试打开新版 Mac 原生应用验收时，系统处于锁屏，未绕过锁屏；本次 v0.2.1 原生界面全流程未重新验收。浏览器界面验收不等同于 Mac 安装验收。
- 本次真实 API 验收使用合成资料；未把现有客户的整套文件批量发给新 API 做重算，也未验证长文档吞吐、所有模型、长时间稳定性和高并发。
- 仍为未签名、未公证的内测包。Windows 安装、首次启动、CAD/导出等全流程仍需 Windows 实机验收。Mac 的 v0.2 工程流程证据保留在下文，不能等同于本次所有功能重新全量人工验收。
- 官方自定义 provider 配置依据：[OpenAI / ChatGPT 官方配置文档](https://learn.chatgpt.com/docs/config-file/config-advanced)。

---

# 同州 AI v0.2 验收记录

日期：2026-10-07（Asia/Taipei）。构建机器：macOS Darwin 25.3.0 / Apple Silicon。

结论：Codex 内核、持续会话、单机资料处理和成果导出已形成可运行 MVP。Mac 原生应用的核心流程实测通过；Windows 安装包已构建，但不能据此声称 Windows 原生运行通过。当前仍是内测版。

## 实际执行与证据

| 项目 | 结果 | 证据 / 方法 |
|---|---|---|
| TypeScript 与生产前端 | 通过 | `npm run build`；Vite 产出 dist |
| 自动测试 | 16/16 通过 | `data/qa/tests-v02.log`；临时目录隔离，不覆盖演示工作区 |
| 实际 Codex 图像输入 | 通过 | `data/qa/real-session-v02.json`，模型正确描述深青绿背景和三条浅白波浪 |
| 两轮真实会话 | 通过 | 两轮同一 threadId，第二轮复述“松涛A7”与前轮图片背景 |
| 服务重启后续接 | 通过 | 同一 threadId，重启后仍返回首轮短语 |
| Mac 原生启动 | 通过 | 打包 `.app`，测试 PATH 仅 `/usr/bin:/bin`，未使用宿主 Node/Homebrew 路径 |
| 内置环境诊断 | 通过 | 原生设置页显示 Codex 0.160.1、dwg2dxf 0.14、文档处理、字体和数据目录就绪 |
| 原生文件选择与导入 | 通过 | CUA 实际选择并导入 6 份 DOC/DOCX/XLSX/DWG |
| 内置 DWG 转换 | 通过 | 在打包 `.app` 中实际转换，生成 PNG 与 137 个可见文本对象 |
| Mac 包内真实 Codex + Skill | 通过（修复后） | `data/qa/desktop-clean/workspace/workspace.json`，job-003a0369，模型 gpt-6-astra，真实指出 300㎡ / 74㎡待核实 |
| 结果人工采纳 | 通过 | 原生界面“采纳到右侧成果”变为“已采纳到成果”，结果来源更新 |
| 原生 Word 保存 | 通过 | 实际打开系统保存对话框并保存到 Downloads，文件 `技术标初稿_20261006164432.docx` |
| Word / Excel 回读 | 通过 | 自动测试验证文本内容、未知数量空值、Excel 公式样式输入保持普通文本 |
| 导出文档版式 | 抽样与整页缩略检查通过 | `data/qa/portable-export/rendered`，16 页 Word 渲染；并非全部 Office 版本兼容验收 |
| 桌面 API 会话保护 | 通过 | 无令牌返回 401；启动授权设置 HttpOnly/SameSite Cookie；跨 Origin 与无 CSRF 请求返回 403 |
| 数据与模式隔离 | 通过 | 新安装不含客户资料；真实/演示结果分离；跨项目/模式会话请求被拒绝 |
| 人工修改保护与重复采纳 | 通过 | 第二轮不覆盖人工编辑；重复采纳不重复写入 |
| Windows x64 NSIS 构建 | 构建通过 | `data/qa/build-win-v02.log`；Mac 交叉构建，非 Windows 原生验收 |

### 测试中发现并修复

1. Electron ASAR 内 `fs.cpSync` 无法递归复制 Skill 目录，导致首次真实任务失败。改成 `readdir/readFile/writeFile` 逐文件部署并修复部分复制状态，随后包内真实任务成功。失败记录保留，没有改写历史为成功。
2. DXF 解析库忽略 INSERT 的 ATTRIB。补充从 ENTITIES 段提取已放置的可见属性；位号恢复，图层颜色保留。
3. DOC 需求从旧版 124 条变成 117 条。对照确认是修订删除内容被新解析器排除，并在文件预览说明解析口径。
4. 跨平台导出移除了对 Python、macOS textutil、外部 Office 的运行依赖。
5. CAD 重新转换时原图 URL 可能未更新，导致浏览器继续显示缓存。增加转换时间戳作为图片版本，实际界面回归通过。
6. 依赖审计中的 ExcelJS 间接 uuid 已固定到修复版本，并执行导出回归测试。

## 未完成或未验证

- **Windows 原生安装、首次启动、中文路径、DWG 转换、登录、真实模型执行、导出、卸载/重装**：需要 Windows 实机或虚拟机。当前未运行 Wine 验收，更不把交叉构建当作 Windows 实测。
- Intel Mac 与 Windows ARM 原生安装包：本次只交付 Mac arm64 和 Windows x64。
- 新账户完整 OAuth 登录：登录入口和协议已接入，但本机实测复用了既有 Codex 登录，没有退出用户账户做破坏性测试。
- Apple Developer 签名/公证、Windows Authenticode、自动更新、第三方下载后的系统信任检查：未配置。当前产物未签名/公证。
- 最新安装包在安装目录的重启和原生窗口最终复验：测试后 Mac 锁屏，需用户解锁后继续。浏览器 API 不受锁屏影响，已完成最终双栏/窄屏检查、重新转换与缓存版本更新，截图见 `docs/screenshots/workspace-v02.jpg`。
- 原尺寸独立预览窗口的最后一次 UI 回归：已实现，仅静态/构建检查，待解锁验证。
- 审批弹窗协议接入有代码，但模型发起的真实高权限操作批准/拒绝链路未完整实测。
- 超大/损坏文件、全部 DWG 版本、外部参照、复杂曲线和三维图元、图层冻结等组合未做完整矩阵测试。
- 扫描 PDF OCR、复杂 Word 修订/嵌套表格、各版 Office/WPS 排版、全量标书模板复刻未完成。
- ERP、NAS、报价库、多用户权限、备份恢复界面、自动更新与升级迁移测试未做。
- 依赖审计仍报告 **10 个 moderate 项**，主要来自同一 `sprintf-js` 精度参数 DoS 问题的传递依赖；上游当前最新版本未提供非破坏性升级解法。本应用不把上传文档内容作为该库格式字符串执行，但正式发行前仍需处理或完成专门风险验收。审计原文：`data/qa/npm-audit-v02.json`。
- GitHub Actions 双平台工作流仅写入本地，没有创建远程仓库、提交或执行 CI。

## 安装包静态检查

`node scripts/verify-packages.mjs` 检查两种平台 ASAR 中确有 5 个 Skill、版本为 0.2.0、关键程序与源码一致、未包含客户资料/认证文件，以及所有内置运行资源的 SHA-256。证据为 `data/qa/packages-v02.json`，安装文件摘要在 `release/SHA256SUMS.txt`。

## Windows 接手验收顺序

1. 在无 Node/Python/Office 的 Windows x64 用户环境安装 EXE，记录系统版本与安装目录。
2. 从桌面快捷方式启动；环境诊断确认内置 Codex、DWG 转换器和字体。
3. 使用测试账户完成官方登录，不改动生产账户；检查登录失败提示与重连。
4. 导入测试 Word、Excel、DWG 和图像；运行真实任务并勾选图像输入。
5. 继续追问；关闭应用后重开，再选历史会话追问，核对 threadId。
6. 预览建议并采纳，人工编辑后重跑，确认不被覆盖。
7. 导出 Word/Excel，在 Office 或 WPS 中打开检查；停止运行中任务，验证真正停止。
8. 卸载重装并选择原数据目录，确认资料和会话保留。
9. 全部结果、截图、启动日志单独保存；未通过项不标记为通过。
