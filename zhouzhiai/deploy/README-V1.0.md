# 舟知 V1.0 部署代码说明

本目录包含原工程应用依赖的 systemd、Nginx 和私有访问脚本。`README.md` 与 `ACCEPTANCE.md` 是继承的历史记录，不应作为新版功能和账号隔离状态的说明。当前应用代码以 `../app/` 为准。

## 独立发布目录

从团队仓库只导出新目录即可得到完整舟知源码，无需复制外层旧应用：

```sh
git archive HEAD:zhouzhiai
```

将归档内容解包到独立 release，使 `app/`、`membrane/`、`deploy/` 同级，再将现有 `current` 指向 release。继承的 `tongzhou-ai.service` 使用 `/opt/tongzhou-ai/current/app`，这种目录结构可以保留服务名兼容。不要直接解包覆盖生产目录，也不要混用外层旧 `app/`。

## 构建与数据边界

1. 在 `app/` 安装 Node 依赖，执行 `node scripts/test-source.mjs`、`npm run build` 和 `node scripts/build-member.mjs`；前者验证源码，后两者分别构建管理员和普通成员前端。
2. 安装 `membrane/requirements.txt` 所列 Python 依赖，配置 Python、Codex、LibreDWG 与授权的 PPT 运行时。
3. 将工作区、用户注册表、API 配置、生图密钥和业务数据库放在独立权限受限目录，不放入 release、Git 或客户端。至少配置 `ZHOUZHI_MEMBRANE_DATA` 和 `ZHOUZHI_PROVIDER_FILE`；普通成员注册表用 `ZHOUZHI_MEMBER_REGISTRY` 指定。
4. 管理员密码只保存哈希；普通成员账号和激活码按服务端注册表管理，维护脚本输出的明文发放文件由管理员私下保管。
5. 云端生图由 `membrane/preview_bridge.py` 直接调用，通过环境配置读取密钥；不依赖本机转发生图。VPN/代理网络由运维单独配置，节点信息不提交。
6. 生产更新需另行授权、备份、切换和验收；本次源码上传不触发部署。

## 追加环境配置（示例，不是凭据）

继承的 `server.env.example` 提供通用认证和代理字段。新版额外字段：

```ini
ZHOUZHI_MEMBRANE_DATA=/var/lib/tongzhou-ai/membrane-data
ZHOUZHI_PROVIDER_FILE=/var/lib/tongzhou-ai/private/provider.json
ZHOUZHI_MEMBER_REGISTRY=/var/lib/tongzhou-ai/private/members.json
ZHOUZHI_PYTHON=/path/to/python3
TONGZHOU_PYTHON=/path/to/python3
ZHOUZHI_PRESENTATION_RUNTIME=/path/to/authorized/presentation-runtime
ZHOUZHI_PRESENTATION_SKILL=/path/to/authorized/presentation-tools
ZHOUZHI_IMAGE_ENV=/path/to/private/image.env
```

生图私有配置文件包含 `IMAGE_API_KEY`、`IMAGE_API_BASE_URL`、`IMAGE_MODEL`；实际值不得提交。HTTP 内测不加密，界面提示隐藏不改变网络传输风险；应仅在可信网络/VPN 使用，具备条件后改为可信 HTTPS。

## 测试和维护

源码验证采用虚构样机库；真实数据库通过管理员另行导入。维护脚本可能修改注册表、激活状态或远程服务，不能作为普通 CI 步骤运行。`desktop/` 是原完整桌面封装，普通成员安装包须使用 `member-client/builder.yml`。
