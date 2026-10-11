# 舟知 V1.0 完整源码

舟知是同舟纵横的全量工作助手，包含智能工作助理和膜预算平台。本目录保存当前版本的完整应用源码，与仓库原有 `app/`、`deploy/` 等内容相互独立，原有内容不覆盖。

## 代码结构

- `app/src/`：管理员网页、普通成员网页、智能工作助理、膜预算四步流程、成员工作区与回收站。
- `app/server/`：AI 对话、联网检索、文件生成、方案估算、清单重组、详细预算、成果导出、用户隔离、激活授权与管理员查看。
- `app/.agents/skills/`：原工程工作台的资料整理、招标解析、清单整理、技术标编制和一致性审查技能及结果规范。
- `app/scripts/`、`app/tests/`：构建、导出、维护脚本、自动测试和隔离验收脚本。
- `app/member-client/`：Windows 普通成员客户端、安装器配置、图标和安全凭据存储代码。
- `app/desktop/`：原完整桌面应用的运行与打包代码，保留兼容；普通成员安装包使用 `member-client/`。
- `app/public/`：同舟 Logo、成员登录及激活页面资源。
- `membrane/`：膜设备预算原模块、访问控制、云端直接生图及桥接代码。
- `deploy/`：继承的部署、Nginx、systemd、私有访问脚本；新版说明见 `deploy/README-V1.0.md`。
- `.github/workflows/`：原桌面构建流程的新版路径模板；位于本子目录中，不会自动运行或改变仓库现有流水线。

原 `tongzhouai` 的应用依赖代码已经包含在本目录，不需要从仓库外层的旧 `app/` 借用代码。内部 `tongzhou-ai` 服务名和 `TONGZHOU_*` 环境变量保留，以兼容现有配置，不代表缺少舟知代码。

智能工作助理按任务需要联网核实，默认给出自然整合的正文，不列搜索流水账或自动生成附件。实际使用的公开来源保存在当前账号、当前会话的后台任务记录；用户明确追问依据或原文时再提供。后台来源不进入公开任务接口。接收层兼容正文附带来源的结果，格式异常最多自动纠正一次，纠正时不重复联网；普通用户内部信息保护和明确文件交付规则继续生效。此逻辑不改变膜预算四步流程。

## 不包含的内容

本仓库不保存生产密钥、密码、激活码发放清单、用户注册表、历史项目、图纸、历史样机 BOM、全量物料库和采购价目表。第三方 `node_modules`、Python 虚拟环境、外部运行时、安装包及编译产物也不提交。

`app/src/membrane-catalog.json` 是行业和需求的程序配置，不是客户或采购数据库。测试用例中的账号、密码、密钥字符串及 `app/tests/fixtures/` 数据为虚构测试数据，不能用于生产。

## 安装、验证与本地运行

使用 Node.js 24 和 Python 3；完整功能还需要下文所列外部工具。

```sh
cd zhouzhiai/app
npm ci
node scripts/test-source.mjs
npm run build
node scripts/build-member.mjs
node scripts/init-empty-data.mjs
ZHOUZHI_LOCAL_PREVIEW=1 npm start
```

访问 `http://127.0.0.1:4318/`。初始化脚本只在文件不存在时创建空库，不复制历史记录、不覆盖已有数据。新环境尚未配置 AI 凭据、业务数据库和外部工具，不能据此认定所有功能已就绪。

`node scripts/test-source.mjs` 使用虚构样机库和独立临时工作区，不连接生产账号服务。部分外部工具或私有参考资料相关测试可能跳过或需单独配置。原 `npm test` 保留，默认读取部署所配置的膜数据目录。

`scripts/verify-assistant-search.mjs` 是独立真实联网验收，不属于默认单元测试；仅接受 `/tmp/zhouzhi-search-evidence-canary-` 前缀的临时数据目录，需要另行配置有效 AI 连接，可能产生服务调用费用，禁止使用真实账号工作区。

## 外部依赖与业务资料

- Node 依赖由 `app/package-lock.json` 安装；Python 生图/CAD 依赖由 `membrane/requirements.txt` 安装。
- AI 执行使用 npm 提供的 Codex 原生程序及单独配置的登录/API 凭据；业务代码和 Skills 已包含，第三方程序无需从旧 `tongzhouai` 目录复制。
- PPT 生成使用授权的外部演示文稿运行时和校验工具；需配置 `ZHOUZHI_PRESENTATION_RUNTIME`、`ZHOUZHI_PRESENTATION_SKILL`，以及中文字体。它们不是本项目源码，不能用 `npm ci` 代替。代码中保留原默认路径作为兼容设置，其他机器须配置自己的路径。
- DWG 预览需要 LibreDWG；原膜模块中 AutoCAD 原生制图入口尚未启用，仍需有效模型和对应工具，不能将概念图视为工程施工图。
- 历史样机与价格数据由管理员单独导入，通过 `ZHOUZHI_MEMBRANE_DATA` 指定目录；至少包含 `history_templates.json`（数组）和 `procurement_price_book.json`（含 `prices` 数组的对象）。缺少数据时不能做历史组件匹配和真实采购价核算。
- 设计团队提供全量物料库、2D/3D 图纸、计算依据和招投标模板；运营管理团队提供更新采购价和自制标准件制造成本，均独立于源码管理。

## Windows 普通成员安装包

先在 `app/member-client/main.cjs` 核对目标服务地址，当前源码保留现有服务地址。客户端只携带代码、Logo 和服务地址，不携带历史项目、账号密码或激活码。

在 Windows x64 构建机的 `zhouzhiai/app/` 下执行：

```sh
npm ci
npx electron-builder --config member-client/builder.yml --projectDir member-client --win --x64
```

输出目录为 `app/member-release/`。普通用户的权限、技术信息隐藏、激活状态和独立工作区由服务端共同保障。不要用原 `package:win` 命令代替普通成员安装包，它构建的是完整桌面应用。

## 维护注意

`member-provision.mjs` 等维护脚本会修改指定账号注册表；`member-issue-test-account.mjs` 保留了原部署维护流程，可能停止远程服务，禁止当作普通测试执行。先检查脚本、目标、备份和环境，生产操作必须另行授权。

历史验收文档与继承的部署文档仅保留供追溯；以本 README 和 `deploy/README-V1.0.md` 的新版目录和运行边界为准。本次上传不发布安装包、不改变云端服务和现有账号。
