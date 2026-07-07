# 标讯截图助手 / Tender Screenshot Agent

本地安装的标讯监控 Agent：输入项目名称后，系统在本机访问指定标讯平台、保留截图与 HTML/PDF/Text/Trace 证据，并可将脱敏任务状态推送给企业微信智能机器人。

> 截图、HTML、PDF、浏览器登录态、SQLite 数据库和凭证默认只存在本机。仓库不包含账号、Cookie、API Key、Bot ID、Bot Secret、Webhook 或邮件密码。

## Runtime

```text
Tauri desktop shell
  └─ local Pi Agent Host (127.0.0.1 + per-launch bearer token)
       ├─ Pi Agent Core: state, tools, lifecycle events
       ├─ Playwright: platform access and evidence capture
       ├─ SQLite: tasks, runs, append-only events, artifact index
       ├─ macOS Keychain: Bot ID / Bot Secret
       └─ WeCom AI Bot SDK: WebSocket authentication and notification
```

Tauri no longer owns task state, evidence persistence, notification state, credential logic, or a Node JSON-RPC Sidecar. It only starts the Host and renders the desktop UI.

## Execution modes

- **Deterministic default:** runs every `query × platform` pair in order. Tender collection must be exhaustive, so baseline execution does not depend on LLM planning.
- **Pi orchestration:** enabled only when both `TENDER_LLM_PROVIDER` and `TENDER_LLM_MODEL` are configured. Pi Agent Core receives the same real tools and the same policy gate for planning, relevance decisions and summarization.

## Tool boundary

`search_platform` is one shared tool used by both modes. Before any tool side effect, the access policy checks platform mode and lawful local profile availability.

- `public`: may be accessed without a local account profile.
- `manual-login`: requires a local persistent browser profile created through lawful interactive login.
- `ca-login`: routed to manual review; the application does not bypass CA/UKey, QR, SMS or CAPTCHA.

Every adapter is explicitly either:

- `unverified`: captures landing-page screenshot/HTML/trace, then returns `manual-review-required`.
- `verified`: has recorded selectors and may submit a real query and capture list/detail evidence.

This prevents generic selectors from being represented as a validated integration.

## Development

```bash
cp .env.example .env
cp config/platforms.example.json config/platforms.json
npm install
npm run playwright:install
npm run typecheck
npm run build:agent-host
npm run dev:desktop
```

`.env` only contains local runtime parameters such as a browser path, data location and log level. Do not put API keys, Bot credentials, browser cookies, passwords, SMTP passwords, CA/UKey material or a Webhook URL in `.env`.

On macOS, Bot ID and Bot Secret are stored through Keychain. The browser profile is local to the Agent Host data directory.

## Verification boundary

The repository contains a real Host, tool registry, evidence capture path, policy gate and WeCom SDK integration. It does **not** claim that all nine platforms have verified DOM selectors, lawful login flows, CAPTCHA handling, CA/UKey behavior or stable pagination. Those must be recorded and accepted one platform at a time in the authorized company environment.
