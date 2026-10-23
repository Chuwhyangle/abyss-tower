# 安全策略

## 报告漏洞

- 请使用 GitHub 的私密漏洞报告：仓库 **Security → Report a vulnerability**（Security Advisory）。
- 不要在公开 Issue / PR 中粘贴漏洞细节、账号数据或任何密钥。
- 我们会在确认后尽快修复，并在公告中致谢（如你愿意）。

## 支持范围

- 仅维护 `main` 分支的最新代码；历史 tag 仅作存档，不再单独回补安全修复。

## 密钥与数据边界

- **仓库不含任何密钥**：`.gitignore` 覆盖 `.env*`、`*.pem/*.key/*.crt`、`.cloudflared/`、`auth.json`、`.github_token`、数据库与备份。
- 部署密钥（Cloudflare Tunnel 凭据、SSH 私钥、PAT）只保存在服务器本地，权限 `600/400`。
- 运行时数据库 `server/data/game.db*` 含账号、密码哈希、会话哈希与 IP 哈希：
  - 目录权限 `700`，文件 `600`，systemd 服务设置 `UMask=0077`；
  - 永不入库，备份同样只留在服务器。
- 公开代码意味着**不能依赖代码里的默认值当秘密**：如 `AUTH_IP_SALT` 未配置，进程启动时随机生成。

## 安全模型摘要

- **账号**：scrypt（N=16384）密码哈希；恢复码只存哈希；会话 token 为 32 字节随机值，数据库只存 SHA-256。
- **会话**：`HttpOnly` + `SameSite=Lax`，HTTPS 下使用 `__Host-` 前缀；写请求校验 `Origin` / `Sec-Fetch-Site`。
- **限流**：登录失败按账号与 IP 双维度、注册/领取按 IP 限流；IP 只存 HMAC-SHA256 哈希。
- **权威边界**：地图、波次、遗物抽取、结算分数/星核、排行榜由服务端决定；实时战斗在客户端模拟（单机、低对抗），服务端只做包络校验。
- **已知取舍**：客户端战斗结果可被本机篡改，只影响个人单机体验；排行榜依赖服务端结算与数值钳制。

## 自托管加固清单

1. 只通过 TLS 反向代理或 Cloudflare Tunnel 暴露服务；建议 `HOST=127.0.0.1`。
2. 配置随机 `AUTH_IP_SALT`（例如 `openssl rand -hex 32`）。
3. 朋友注册完成后可设 `REGISTRATION_MODE=closed`。
4. SSH 仅允许密钥登录并禁用 root 密码登录；开启主机防火墙，只放行必要端口。
5. 定期备份 `server/data/`，并保持 `700/600` 权限；备份不要提交或上传到公开位置。

## 依赖与 CI

- 运行时零第三方依赖（Node 内置 `http` + `node:sqlite`）。
- CI 仅使用 `actions/checkout` 与 `actions/setup-node`，工作流权限为 `contents: read`。
- 公开仓库建议在 **Settings → Code security** 开启 Secret scanning 与 Push protection。
