# 企业微信机器人接入

本项目的新部署使用 `wecom-bot-id-secret`，不再把群机器人 Webhook 作为默认方案。

## 凭证模型

企业微信机器人由两份独立凭证构成：

- `Bot ID`：对应 `keychain://tender-agent/wecom-bot-id`
- `Bot Secret`：对应 `keychain://tender-agent/wecom-bot-secret`

二者均按敏感凭证处理：不进入 Git、SQLite、`.env`、浏览器 Sidecar、任务导出包或日志正文。

## 当前仓库状态

当前提交已完成 **配置模型、迁移边界和日志脱敏规则**，但尚未包含可启用的企业微信 Bot 发送器或系统密钥链写入界面。因此不能把 `wecom-bot.enabled` 设为 `true` 后就期待消息一定发送成功。

在发送器实现前，运行时应返回 `provider-config-incomplete`，不允许回退到旧 Webhook 或伪造测试成功。

## 配置准备

1. 复制 `config/providers.example.json` 为本机 `config/providers.json`。
2. 保留 `wecom-bot` 的 `botIdCredentialRef` 与 `secretCredentialRef`，不要把真实值写进 JSON 或 `.env`。
3. 由后续凭证适配器将 Bot ID、Bot Secret 写入操作系统密钥链。
4. 由后续发送器依据企业微信机器人后台当前版本的官方文档完成鉴权、消息发送和连接测试。
5. 在企业微信后台授予机器人目标群/会话的消息发送权限。

## 发送边界

- 只发送任务状态、命中数量、失败分类和本地证据包标识。
- 默认不发送截图、HTML、PDF、浏览器 Profile、Cookie、绝对本地路径或完整敏感公告内容。
- 任务失败、需要人工登录、验证码/CA/UKey 介入时才发送高优先级提醒。
- 旧 `wecom-group-webhook-legacy` 配置仅为已有部署迁移保留，默认禁用。

## 实现约束

Bot ID + Secret 的鉴权、发送接口、请求体和权限范围必须以企业微信机器人后台当前版本的官方文档为准。由于该类接口存在版本和权限差异，运行时 Provider 不能根据猜测的 URL 或参数发送请求。
