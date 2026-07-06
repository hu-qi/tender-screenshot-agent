# 企业微信机器人接入

本项目的新部署使用 `wecom-bot-id-secret`，不再把群机器人 Webhook 作为默认方案。

## 凭证模型

企业微信机器人由两份独立凭证构成：

- `Bot ID`：保存到 `keychain://tender-agent/wecom-bot-id`
- `Bot Secret`：保存到 `keychain://tender-agent/wecom-bot-secret`

二者均按敏感凭证处理：不进入 Git、SQLite、`.env`、浏览器 Sidecar、任务导出包或日志正文。

## 配置步骤

1. 复制 `config/providers.example.json` 为本机 `config/providers.json`。
2. 将 `wecom-bot.enabled` 设为 `true`。
3. 通过桌面端的凭证管理页将 Bot ID 与 Bot Secret 写入系统密钥链；配置文件中只保留 `botIdCredentialRef` 与 `secretCredentialRef`。
4. 使用企业微信后台为该机器人授予目标群/会话的消息发送权限。
5. 在桌面端执行“通知连接测试”；测试请求和结果写入本地审计日志，但不记录凭证和完整消息正文。

## 发送边界

- 只发送任务状态、命中数量、失败分类和本地证据包标识。
- 默认不发送截图、HTML、PDF、浏览器 Profile、Cookie、绝对本地路径或完整敏感公告内容。
- 任务失败、需要人工登录、验证码/CA/UKey 介入时才发送高优先级提醒。
- 旧 `wecom-group-webhook-legacy` 配置仅为已有部署迁移保留，默认禁用。

## 实现约束

Bot ID + Secret 的换取凭证、发送接口、请求体和权限范围必须以企业微信机器人后台当前版本的官方文档为准。由于该类接口存在版本和权限差异，运行时 Provider 不能根据猜测的 URL 或参数发送请求；未完成官方接口配置时，连接测试必须返回 `provider-config-incomplete`，而不是伪造成功。
