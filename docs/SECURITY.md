# Security and privacy

## Trust boundary

- The **Pi Agent Host** is the only business runtime. It owns task state, browser profiles, evidence metadata, policy checks, notifications and local logs.
- The Tauri desktop shell starts the Host on `127.0.0.1`, gives the WebView a fresh bearer token for that launch, and does not persist business credentials or task state.
- The Host never binds to a public network interface and rejects every request without the per-launch bearer token.

## Secrets and local state

- Never commit API keys, Bot credentials, browser profiles, cookies, evidence, ZIP exports, logs or local SQLite databases.
- On macOS, WeCom Bot ID and Bot Secret are stored as separate Keychain entries under `com.huqi.tender-screenshot-agent`.
- SQLite stores only non-secret settings, task/run state, profile lifecycle status, append-only events and evidence hashes/relative paths.
- Do not put Bot ID, Bot Secret, account passwords, Cookie, Webhook URL, SMTP password, CA/UKey material or SMS/QR data in `.env`.
- Persistent Playwright profiles are local authentication material. Each platform is isolated under its own Profile directory.

## Browser access

- Restricted platforms require a user-confirmed local Profile before the `search_platform` tool may run.
- Opening a login page only creates a headed local browser session. The user completes login normally and explicitly confirms completion.
- Cancelled re-login preserves the previously confirmed Profile state; clearing a Profile is an explicit per-platform destructive action.
- The application does not bypass CAPTCHA, CA/UKey, SMS, QR code, account restrictions or access controls.

## Network and notification

- `strict-local` mode blocks outbound WeCom notification delivery.
- The WeCom tool reads Bot credentials only immediately before an authenticated SDK connection and disconnects after the operation.
- Notifications contain task status/counts by default; they do not contain screenshots, HTML, PDFs, browser profiles, Cookies, absolute local paths or full sensitive notice text.
- Agent Host logs and API errors must redact credentials. Do not use an LLM or notification tool to transport raw evidence by default.

## Audit

- Every task run gets a correlation ID.
- Tool lifecycle, policy blocks, browser outcomes and notification outcomes are stored as append-only run events.
- Evidence is indexed by relative path and SHA-256; raw files remain in the Host data directory.
