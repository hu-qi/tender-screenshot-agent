# Verification status

## Implemented and locally testable

- Tauri desktop task creation and local SQLite persistence.
- NDJSON JSON-RPC contract for the Playwright Sidecar.
- Persistent profile path support, interactive browser login route, evidence paths and error classification.
- Generic public-page search flow, screenshot, HTML/text/PDF artifact handling and SHA-256 generation.
- 9 platform registry, privacy/provider configuration templates and local secret exclusions.

## Requires company-authorized acceptance

The following are intentionally not claimed as verified in this repository:

- Live portal DOM selectors, pagination and search filters for all 9 platforms.
- Legal login, SMS, QR, CAPTCHA and CA/UKey flows.
- Login-session lifetime and reuse behavior.
- Actual intranet LLM, OCR, DotsOCR and WeCom webhook connectivity.
- Final Windows/macOS signing and installer packaging.

Each platform must be recorded and accepted in the authorized network. Save selector fixtures and Playwright traces without committing cookies or sensitive evidence.
