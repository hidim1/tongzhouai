# 舟知 · SSH 私有内测入口

这是可选的 **SSH-only 模式**启动器，要求服务器 `TONGZHOU_PUBLIC_ORIGIN` 为空。服务器切换到 18082 直连内测后，不再用这套旧入口；当前方式与放行状态见上级目录 `ACCEPTANCE.md`。

这套启动器连接已部署的云端服务，不是另装一个本机 AI。GUI → 本机回环端口 → SSH 加密隧道 → 服务器 Codex + Skills；项目与会话均在服务器。

## Mac

1. 保持本目录文件放在一起，双击 `启动同舟AI.command`，输入原服务器 SSH 密码。脚本不保存密码。
2. 连接成功后自动打开 <http://127.0.0.1:14318>。**保持启动连接的终端窗口开启**；窗口会监测隧道，连接丢失时提示重新启动。
3. 不使用时按 Ctrl+C、关闭连接窗口，或双击 `停止同舟AI隧道.command`。只停止自己的隧道，不停止云端应用。重复启动会复用已有隧道，原连接窗口仍需保持开启。

从 Git 检出时执行位已保留；若传输文件导致执行位丢失，可在本目录运行 `chmod +x *.command`。脚本不会绕过 macOS 安全提示。

## Windows

双击 `Start-TongzhouAI.cmd`，需要系统已有 OpenSSH Client 和 Windows PowerShell。输入服务器 SSH 密码后自动打开浏览器，**保持 SSH 控制台开启**；按 Ctrl+C 或关闭窗口断开。若 PowerShell 执行策略阻止脚本，窗口会给出原生 `ssh` 命令；不修改系统执行策略。

Windows 启动器目前未在 Windows 实机执行，不把脚本提供等同于实机验收。它也不是 Windows 桌面安装包。

## 连接边界

- 本地与服务器应用均只监听 `127.0.0.1`。公网没有开放 4318/14318，也没有新增安全组规则。
- 浏览器到本机端口使用 HTTP，但跨公网的实际链路由 SSH 加密；这里不声称已经有公网 HTTPS 网站。
- 访问鉴权由 SSH 完成，私有模式不显示应用 HTTPS 密码页；拥有这台电脑本地访问权限的进程也能访问已打开的隧道。
- 使用现有管理员 `root` 账号只用于本次持有服务器凭据者内测，不应把它或密码分发给普通成员。多人交付需要独立、仅转发权限的账号与各自密钥，尚未配置。
- 已固定服务器 ED25519 公钥，指纹 `SHA256:LhjdBVSRrx1RQMpkggpb+haf7+7g5O42meByksjTHpE`，与已认证服务器上的主机公钥一致。换机/重装后须重新核对；启动器不忽略主机身份校验。
- 无密码、API Key 或 SSH 私钥写入启动器。共享目录中的 `ssh-known-hosts` 仅为服务器**公钥**。
- Mac 重复启动复用自身隧道，端口冲突不杀其他程序；Windows 端口冲突会停止启动。
- 电脑重启或网络断开后重新启动即可；服务器上的后台服务和数据不会随隧道断开而停止。

## 手动连接

在本目录终端中运行（Windows 将 `/dev/null` 换成 `NUL`）：

```sh
ssh -F /dev/null -N -o UserKnownHostsFile=ssh-known-hosts \
  -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ssh-ed25519 \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:14318:127.0.0.1:4318 root@36.140.247.61
```

认证成功后保持终端开启，访问 <http://127.0.0.1:14318>。按 Ctrl+C 断开。
