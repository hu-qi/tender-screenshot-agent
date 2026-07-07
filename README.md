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
       ├─ macOS Keychain: Bot ID / Bot Secret / Model API key
       └─ WeCom AI Bot SDK: WebSocket authentication and notification
```

Tauri no longer owns task state, evidence persistence, notification state, credential logic, or a Node JSON-RPC Sidecar. It only starts the Host and renders the desktop UI.

## Execution modes

- **Deterministic default:** runs every `query × platform` pair in order. Tender collection must be exhaustive, so baseline execution does not depend on LLM planning.
- **Pi orchestration:** requires an enabled, applied model Profile. It receives only query/platform metadata and tool summaries. It cannot request raw evidence or bypass policy. Any requested pair it does not complete is returned to the deterministic runner.

## Tool boundary

`search_platform` is one shared tool used by both modes. Before any tool side effect, the access policy checks platform mode and lawful local profile availability.

- `public`: may be accessed without a local account profile.
- `manual-login`: requires a local persistent browser profile created through lawful interactive login.
- `ca-login`: routed to manual review; the application does not bypass CA/UKey, QR, SMS or CAPTCHA.

Every adapter is explicitly either:

- `unverified`: captures landing-page screenshot/HTML/trace, then returns `manual-review-required`.
- `verified`: has recorded selectors and may submit a real query and capture list/detail evidence.

This prevents generic selectors from being represented as a validated integration.

## Local configuration

All local values are maintained in `.env`. A one-command bootstrap validates the file, forces local-only permissions, writes WeCom and model API secrets to macOS Keychain, writes non-secret profiles to SQLite, and validates QWebBridge and model egress boundaries.

```bash
npm install
npm run local:config:init
# 编辑 .env
npm run local:config:apply
npm run local:config:doctor
```

See [本地安全配置：`.env` 单一入口](docs/LOCAL_SECURITY_CONFIG.md) and [Pi 模型安全 Profile](docs/MODEL_SECURITY_PROFILE.md) for complete variables, Keychain behavior, egress policy, model health tests and safe cleanup commands.

## Platform adapter recording

Nine platforms must be recorded and accepted one at a time in an authorized company environment. The full workflow, fixture contract, selector strategy, pagination validation, lawful login lifecycle, CAPTCHA/CA/UKey boundaries, replay gates, drift handling and acceptance-report template are in:

- [平台适配器录制、回放与验收手册](docs/PLATFORM_ADAPTER_RECORDING.md)
- [Playwright / QWebBridge 探索 Driver 设计](docs/ADAPTER_EXPLORATION_DRIVERS.md)
- [QWebBridge Candidate Explorer 使用说明](docs/QWEBBRIDGE_EXPLORER.md)

QWebBridge can inspect the user’s real Chrome session and produce a local candidate fixture. It is opt-in, loopback-only, and never upgrades a platform to `verified`; Playwright replay and approval remain mandatory.

## Development

```bash
npm install
npm run local:config:init
npm run playwright:install
npm run typecheck
npm run build:agent-host
npm run dev:desktop
```

On its first start, the Agent Host creates `platforms.json` in the local configuration directory. Record and review selector changes there only after a lawful platform acceptance run.

The `.env` file is Git-ignored and defaults to `0600`. It may hold local bootstrap values for the configuration command; at runtime Bot ID, Bot Secret and model API keys are read from macOS Keychain, not SQLite or logs.

## Verification boundary

The repository contains a real Host, tool registry, evidence capture path, policy gate and WeCom SDK integration. It does **not** claim that all nine platforms have verified DOM selectors, lawful login flows, CAPTCHA handling, CA/UKey behavior or stable pagination. Those must be recorded and accepted one platform at a time in the authorized company environment.
