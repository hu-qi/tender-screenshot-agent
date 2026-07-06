# 标讯截图助手 / Tender Screenshot Agent

本地可安装的标讯监控 Agent：用户输入项目名称后，工具在本机访问 9 个平台、保存公告截图和 HTML/PDF/Text/Trace 证据，并可将脱敏任务状态推送到企业微信机器人。

> 原始截图、HTML、PDF、浏览器登录态、任务数据库和模型密钥默认仅保存在本机。仓库不包含账号、Cookie、API Key、Bot ID、Bot Secret、Webhook 或邮件密码。

## Architecture

- **Desktop:** Tauri 2 + Rust + React
- **Browser engine:** Node.js + Playwright Sidecar，通过 NDJSON JSON-RPC 通信
- **Local state:** SQLite / 本地证据目录 / OS Keychain
- **AI providers:** OpenAI-compatible LLM、OCR-VL 与可选文件网关
- **Notification:** 企业微信机器人 Bot ID + Bot Secret；旧群机器人 Webhook 仅作默认禁用的迁移兼容

## Included runtime paths

- 每个授权账号使用独立 Playwright persistent profile。
- 交互式登录、会话验证、登录失效、验证码和人工复核状态。
- 浏览器打开、搜索、列表/详情截图、DOM 文本、HTML、PDF、失败截图和 Playwright Trace。
- 严格本地、内网增强和混合隐私模式。
- Provider 配置、调用审计、日志关联 ID 和企业微信 Bot 凭证模型。
- 9 个平台的配置化入口、访问策略和 selector 录制位置。

## Development

```bash
cp .env.example .env
cp config/providers.example.json config/providers.json
cp config/platforms.example.json config/platforms.json
npm install
npm run playwright:install
npm run typecheck
npm run build:sidecar
npm run test
npm run secret-scan
```

`.env.example` 仅包含非敏感本地运行参数，例如 Playwright 浏览器路径、日志级别和开发目录。不要将 API Key、企业微信 Bot ID、Bot Secret、旧 Webhook、Cookie、账号密码、SMTP 密码、CA/UKey 或浏览器 Profile 写入 `.env`；这些凭证必须仅保存到系统密钥链。

企业微信 Bot 接入说明见 [docs/WECOM_BOT.md](docs/WECOM_BOT.md)。Bot ID + Secret 的认证与发送接口必须以企业微信机器人后台当前版本的官方文档为准；在未完成官方接口配置前，Provider 不得伪造发送成功。

在公司授权网络中，先在桌面端为每个需要账号的平台完成一次人工登录；工具仅复用本机 Profile，不会保存密码、绕过验证码、CA/UKey、短信或扫码流程。

## Important acceptance boundary

公开入口、平台结构和登录机制会变化。真实 selector、分页、检索条件、验证码和 CA/UKey 流程必须在公司授权网络与合法账号下逐平台录制验收；本仓库不会伪造“已完成真实平台验证”。详见 [docs/VERIFICATION_STATUS.md](docs/VERIFICATION_STATUS.md)。
