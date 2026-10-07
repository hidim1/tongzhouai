# Ubuntu 服务端部署

同舟 AI 的服务端部署仍使用 **Codex app-server + 原生 Skills**，不是只发布静态前端。

## 布局与运行边界

- `/opt/tongzhou-ai/releases/<commit>/`：从 Git 提交导出的代码，根目录只读；`current` 指向当前版本。
- `/opt/tongzhou-runtime/`：独立 Node 24、LibreDWG、Certbot；Codex 位于每个 release 的官方 npm 平台包中。不替换其他业务的系统 Node。
- `/var/lib/tongzhou-ai/`：工作区与独立 Codex 会话，由 `tongzhou-ai` 非 root 用户管理。
- `/etc/tongzhou-ai.env`：0600，包含密码哈希和独立 Cookie 签名密钥，不含 SSH 密码。
- `/var/lib/tongzhou-ai/private/provider.json`：0600，独立部署的 API 凭据，不进入 Git 或安装包。
- Mihomo 仅监听 `127.0.0.1:17890`，不使用 TUN，不改系统路由；代理环境变量只给本应用和部署工具使用。
- Express 仅监听 `127.0.0.1:4318`。可配置 SSH 私有入口、团队 IP 白名单高位端口 HTTP 内测入口或可信 HTTPS 入口；实际放行进度以 [验收记录](ACCEPTANCE.md) 为准。

## 高位端口直连内测

### 当前选择：不限制 IP，使用账号密码

经用户明确要求，使用 `nginx-account-http.conf.template`，不配置 Nginx 来源 IP 限制；云安全组仅开放 TCP 18082，80 和其他规则不变。应用配置：

```ini
TONGZHOU_PUBLIC_ORIGIN=http://服务器IP:18082
TONGZHOU_ALLOW_HTTP_INTERNAL_TEST=1
TONGZHOU_HTTP_TEST_ALLOW_ANY_IP=1
TONGZHOU_HTTP_TEST_ALLOWED_IPS=
TONGZHOU_WORKSPACE_USERNAME=tongzhou
```

还须设置独立密码哈希和会话签名密钥。无 IP 限制模式必须显式开启并配置非空账号，否则拒绝启动；所有项目 API、文件下载、事件流均需登录。错误账号与错误密码使用统一提示，仍按来源限制登录尝试。修改账号会使旧登录签名失效，修改密码时也应更新签名密钥。

这是 HTTP 内测入口，登录页明确标注未加密，不冒充 HTTPS。`tongzhou` 是共享工作区账号，不是 Linux/root 账号；不是多用户权限系统。密码仅保留在私有交付文件中，不进入 Git。

### 可选：限制团队出口 IP

用户要求不占用 80，团队直接访问 `http://服务器IP:18082` 时，使用 `nginx-internal-http.conf.template` 增加独立站点。默认只允许回环地址，并 `deny all`；收到并确认团队公网出口 IP 后，再在 Nginx、应用配置和云安全组三处同步放行，不修改旧站点。

```ini
TONGZHOU_DEPLOYMENT=server
TONGZHOU_PUBLIC_ORIGIN=http://服务器IP:18082
TONGZHOU_ALLOW_HTTP_INTERNAL_TEST=1
TONGZHOU_HTTP_TEST_ALLOWED_IPS=127.0.0.1,团队公网IP1,团队公网IP2
```

同时配置独立 `TONGZHOU_PASSWORD_HASH`、`TONGZHOU_AUTH_SECRET`，保持 `TONGZHOU_HTTP_TEST_ALLOW_ANY_IP=0`。这是受登录密码和来源 IP 限制的 **HTTP 内测**，不是 HTTPS；登录页明确标注未加密，不复用 SSH 密码。HTTP 模式默认关闭；未显式开启、未满足所选认证模式要求或端口低于 1024 时启动失败；未登录 API 返回 401。Nginx 保留 Host 中的端口并覆盖转发来源地址；不要把应用直接绑定公网，此白名单模式不省略 `deny all`。

公网放行前先在服务器经 Nginx 验证登录、会话、上传、导出和 Host/Origin 校验；放行后再从实际团队网络验证浏览器全流程。办公出口变动时须更新三处白名单。

## 可选 SSH 私有入口

使用 [private-access](private-access/README.md) 中的 Mac / Windows 启动器：连接后访问本机 <http://127.0.0.1:14318>，经 SSH 加密隧道访问服务器应用。文件不包含密码或 API Key。Mac 已做真实连接测试，Windows 启动器仍待实机验收。

环境设置 `TONGZHOU_DEPLOYMENT=server`、`TONGZHOU_PUBLIC_ORIGIN=`（留空）。前者让界面标注“服务器保存”，并确保全新服务器只创建空项目；后者保留 localhost Host/Origin 限制，不提供公网 HTTP 服务。原 HTTPS 访问密码哈希可保留但在此模式不参与认证。

此入口只供已有服务器管理员凭据的持有人内测；尚未配置普通成员专用 SSH 账号或多用户权限。公网 HTTPS 的当前限制见 [验收记录](ACCEPTANCE.md)。

## 发布

1. 运行 `cd app && npm ci && npm test && npm run build`，提交并推送代码。
2. 使用 `git archive HEAD` 通过 SSH 传输到对应 release。不要复制本机 `app/data`、客户资料、桌面 runtime 或 `node_modules`。
3. 在 release 的 `app` 下执行 `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --ignore-scripts`、`npm test`、`npm run build`。Codex Linux 原生可执行文件由官方 npm 可选平台包提供。
4. 单独部署 API 配置及 `server.env.example` 所列环境；SSH 模式保持 `TONGZHOU_PUBLIC_ORIGIN` 为空。
5. 安装 `tongzhou-ai.service`，切换 `current`，重启服务。验证 SSH 隧道、Host/Origin 拒绝规则及真实模型回合。
6. **未来可选 HTTPS 模式（当前未启用）**：先获得可用的可信 HTTPS 入口，再设置 `TONGZHOU_PUBLIC_ORIGIN`；使用 `hashPassword()` 生成工作区密码哈希、`randomBytes(32)` 生成签名密钥。用 `nginx.conf.template` 配置独立站点，保留原业务地址和端口，验证错误密码、未登录 API、正确登录。

IP 证书可通过 Certbot 5.4+、`--preferred-profile shortlived --webroot --ip-address <IP>` 签发，前提是证书验证端口能被 CA 访问。成功签发后再安装本目录的六小时续期 timer；本次公网验证超时，**未启用站点或续期 timer**。参考：[Let's Encrypt 官方 IP 证书说明](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)。

## 运维

```sh
systemctl status tongzhou-ai tongzhou-proxy
journalctl -u tongzhou-ai -n 80 --no-pager
systemctl list-timers tongzhou-certificate-renew.timer
nginx -t
```

回滚：将 `current` 软链接指向上一 release 并重启 `tongzhou-ai`；不要覆盖或删除数据目录。更新前备份 `/var/lib/tongzhou-ai`。更换访问密码时同时更换 `TONGZHOU_AUTH_SECRET`，使既有 Cookie 失效。订阅文件与代理节点凭据仅在服务器权限受限目录保存，不提交到仓库。

## 范围

这是**共享工作区**：获准成员共用同一组项目，并非多租户平台，没有逐用户权限和租户隔离。SSH 模式由 SSH 认证保护连接；直连模式另用独立工作区密码。HTTPS Cookie 为 Secure、HttpOnly、SameSite=Strict，12 小时过期；显式 HTTP 内测模式使用非 Secure 的独立 Cookie，可选来源 IP 白名单或经明确开启的不限 IP 账号登录。所有模式均限制 Host/Origin 并保留写入请求头校验。
