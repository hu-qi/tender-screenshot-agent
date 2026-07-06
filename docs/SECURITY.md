# Security and privacy

- Never commit API keys, browser profiles, cookies, evidence, ZIP exports, logs or local databases.
- Store provider keys, SMTP secrets and WeCom webhooks in the OS keychain; SQLite stores only a credential reference.
- The Sidecar never receives LLM/OCR credentials or a WeCom webhook.
- Do not bypass CAPTCHA, CA/UKey, SMS, QR code or access controls.
- Strict-local mode prohibits OCR/LLM network calls. Internal-enhanced mode permits only approved intranet providers after local redaction.
- Redact Authorization headers, cookies, webhooks, API keys, phone numbers, email addresses and local paths before logging.
- Treat Playwright persistent profiles as sensitive authentication material.
