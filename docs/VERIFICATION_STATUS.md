# Verification status

## Covered by CI

The refactored runtime is verified by the repository CI on Ubuntu and macOS:

- Pi Agent Host TypeScript typecheck and build.
- Policy and SQLite lifecycle tests: restricted access requires a user-confirmed Profile; tasks, runs, append-only events and Profile state persist locally.
- Secret scan.
- macOS Tauri shell `cargo check`, including Host launch lifecycle and the compile-time application icon path.

## Implemented runtime paths

- One local Pi Agent Host with an authenticated localhost API.
- Deterministic `query × platform` execution and optional Pi tool orchestration.
- A shared `search_platform` tool with policy enforcement before browser actions.
- Playwright landing/detail evidence capture, hashes, screenshots, HTML/text/PDF and failure traces.
- User-confirmed per-platform persistent browser Profiles.
- SQLite task/run/event/artifact state and desktop run-log view.
- WeCom Bot ID + Secret storage in macOS Keychain and direct official SDK delivery path.

## Not claimed as live-verified

The following require an authorized company environment and are intentionally not represented as complete merely because the runtime path exists:

- Recorded DOM selectors, pagination and query semantics for all nine portals.
- Legal platform login behavior, session expiry/reuse, SMS/QR/CAPTCHA and CA/UKey flows.
- A successful real WeCom Bot authentication and target-session delivery using current company credentials.
- Intranet LLM/OCR/provider connectivity and approved data-egress policy.
- Signed macOS/Windows application bundles and a packaged standalone Agent Host binary.

Every platform must move from `unverified` to `verified` only after an authorized acceptance run records the selector set and evidence trace without committing cookies or sensitive documents.
