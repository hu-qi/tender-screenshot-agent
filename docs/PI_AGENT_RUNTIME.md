# Pi Agent Host runtime

## One local core

The application now has one business runtime: `packages/agent-host`.

```text
Tauri window
  -> per-launch token
  -> localhost Agent Host
       -> Pi Agent Core
       -> Playwright evidence tool
       -> SQLite state/event store
       -> macOS Keychain credential adapter
       -> WeCom Bot tool
```

Tauri does not store tasks, evidence, provider credentials, Bot credentials, task logs, or business policy. It starts the Host, supplies the local base URL and token to the WebView, and terminates the Host on exit.

## Pi Agent mapping

- `search_platform` is an `AgentTool` and is also used by the deterministic runner.
- `beforeToolCall` checks access policy before browser access.
- `afterToolCall` appends structured outcomes to the run event stream.
- Pi lifecycle events are persisted as `pi.*` events.
- Raw evidence remains on disk; model context receives compact tool outcomes, not full screenshots or local paths.

## Deterministic and model-assisted execution

The default runner enumerates every requested query/platform pair. This prevents an LLM from skipping a platform.

When both `TENDER_LLM_PROVIDER` and `TENDER_LLM_MODEL` are configured, Pi may orchestrate the same tools for planning and review. It does not gain extra permissions or bypass the policy gate.

## Platform adapter status

- `unverified`: capture entry-page evidence and return `manual-review-required`.
- `verified`: requires recorded search/result selectors and then may execute a real search.

No adapter is marked verified merely because a generic selector appears to work.
