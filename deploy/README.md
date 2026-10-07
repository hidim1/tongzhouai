# Ubuntu 服务端部署

同舟 AI 的服务端部署仍使用 **Codex app-server + 原生 Skills**，不是只发布静态前端。

## 布局与运行边界

- `/opt/tongzhou-ai/releases/<commit>/`：从 Git 提交导出的代码，根目录只读；`current` 指向当前版本。
- `/opt/tongzhou-runtime/`：独立 Node 24、Codex 的 npm 包、LibreDWG、Certbot；不替换其他业务的系统 Node。
- `/var/lib/tongzhou-ai/`：工作区与独立 Codex 会话，由 `tongzhou-ai` 非 root 用户管理。
- `/etc/tongzhou-ai.env`：0600，包含密码哈希和独立 Cookie 签名密钥，不含 SSH 密码。
- `/var/lib/tongzhou-ai/private/provider.json`：0600，独立部署的 API 凭据，不进入 Git 或安装包。
- Mihomo 仅监听 `127.0.0.1:17890`，不使用 TUN，不改系统路由；代理环境变量只给本应用和部署工具使用。
- Express 仅监听 `127.0.0.1:4318`，Nginx 提供 HTTPS；工作区需要登录。

## 发布

1. 运行 `cd app && npm ci && npm test && npm run build`，提交并推送代码。
2. 使用 `git archive HEAD` 通过 SSH 传输到对应 release。不要复制本机 `app/data`、客户资料、桌面 runtime 或 `node_modules`。
3. 在 release 的 `app` 下执行 `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --ignore-scripts`、`npm test`、`npm run build`。Codex Linux 原生可执行文件由官方 npm 可选平台包提供。
4. 单独部署 API 配置及 `server.env.example` 所列环境；使用 `hashPassword()` 生成工作区密码哈希，`randomBytes(32)` 生成签名密钥。
5. 安装 `tongzhou-ai.service`，切换 `current`，重启服务。验证错误密码、未登录 API、正确登录和真实模型回合。
6. 使用 `nginx.conf.template` 增加独立 HTTPS 站点；既有 HTTP 站点只增加 `/.well-known/acme-challenge/` 的 webroot 路由，保留原应用地址和端口。

IP 证书通过 Certbot 5.4+、`--preferred-profile shortlived --webroot --ip-address <IP>` 签发，并安装本目录的六小时续期 timer。参考：[Let's Encrypt 官方 IP 证书说明](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)。

## 运维

```sh
systemctl status tongzhou-ai tongzhou-proxy
journalctl -u tongzhou-ai -n 80 --no-pager
systemctl list-timers tongzhou-certificate-renew.timer
nginx -t
```

回滚：将 `current` 软链接指向上一 release 并重启 `tongzhou-ai`；不要覆盖或删除数据目录。更新前备份 `/var/lib/tongzhou-ai`。更换访问密码时同时更换 `TONGZHOU_AUTH_SECRET`，使既有 Cookie 失效。订阅文件与代理节点凭据仅在服务器权限受限目录保存，不提交到仓库。

## 范围

这是**受密码保护的共享工作区**：所有获准成员共用同一组项目，并非多租户平台，没有逐用户权限和租户隔离。登录 Cookie 为 Secure、HttpOnly、SameSite=Strict，12 小时过期；接口限制同源并保留写入请求头校验。共享工作区不意味着适合不受信任的任意公众注册。
