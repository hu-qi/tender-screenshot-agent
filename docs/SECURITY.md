# Security and privacy

- Never commit API keys, browser profiles, cookies, evidence, ZIP exports, logs or local databases.
- Store provider credentials, SMTP secrets and **both WeCom Bot ID and Bot Secret** in the OS keychain; SQLite stores only credential references.
- The Sidecar never receives LLM/OCR credentials, WeCom Bot ID, WeCom Bot Secret or legacy group-webhook credentials.
- Do not put Bot ID, Bot Secret, Webhook URL, account passwords, Cookie, CA/UKey material or SMS/QR session data in `.env`.
- The desktop core resolves credential references immediately before a notification request, redacts the values from error messages, and writes only the provider ID plus delivery result to the audit log.
- The legacy group Webhook transport is disabled by default and exists only for migration. New deployments use `wecom-bot-id-secret`.
- Do not bypass CAPTCHA, CA/UKey, SMS, QR code or access controls.
- Strict-local mode prohibits OCR/LLM network calls. Internal-enhanced mode permits only approved intranet providers after local redaction.
- Redact Authorization headers, cookies, bot credentials, webhooks, API keys, phone numbers, email addresses and local paths before logging.
- Treat Playwright persistent profiles as sensitive authentication material.
