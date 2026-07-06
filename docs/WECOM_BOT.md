# 企业微信机器人接入

本项目的新部署使用 `wecom-bot-id-secret`，通过企业微信智能机器人 WebSocket 通道认证和主动推送；不再把群机器人 Webhook 作为默认方案。

## 已实现链路

1. 桌面端接收 Bot ID、Bot Secret、目标会话 ID 与可选私有部署 WebSocket 地址。
2. Bot ID 与 Bot Secret 分别写入操作系统 Keychain，SQLite 只保存启用状态、目标会话 ID、WebSocket 地址和更新时间。
3. 用户点击“测试认证”或系统发送通知时，Rust Core 从 Keychain 读取凭证，启动一次性 Node Sidecar，并通过 stdin 发送私有 JSON-RPC 请求。
4. Sidecar 使用企业微信官方 `@wecom/aibot-node-sdk` 的 `WSClient`：以 `botId + secret` 建立 WebSocket 连接、等待 `authenticated` 事件、调用 `sendMessage(chatid, { msgtype: 'markdown', ... })` 主动推送，随后断开。
5. 审计日志只记录认证/发送结果、关联 ID、成功与拒绝数量；Bot ID、Secret、完整 Markdown 内容和原始会话 ID 不写入日志。

浏览器 Playwright Sidecar不持有企业微信凭证；通知 Sidecar 仅在单次请求的进程内保存凭证，并在发送结束后退出。

## 凭证模型

- `Bot ID`：OS Keychain account `wecom-bot-id`
- `Bot Secret`：OS Keychain account `wecom-bot-secret`
- Keychain service：`com.huqi.tender-screenshot-agent`

二者均不进入 Git、SQLite、`.env`、浏览器 Profile、任务导出包或日志正文。

## 目标会话

SDK 的 `sendMessage(chatid, body)` 支持向指定会话主动推送。标讯助手将目标值作为 `targetChatIds` 保存；每行一个，可按企业微信后台实际可用的群聊 `chatid` 或单聊 `userid` 配置。发送结果只返回脱敏后的尾部标识。

## 开发环境启动要求

```bash
npm install
npm run build:sidecar
```

桌面端开发模式默认执行：

```text
node packages/sidecar/dist/server.js
```

也可以设置：

```text
TENDER_NODE_BIN=/path/to/node
TENDER_SIDECAR_SCRIPT=/absolute/path/to/packages/sidecar/dist/server.js
```

发布包环境可设置 `TENDER_SIDECAR_BIN`，由打包后的独立 Sidecar 二进制代替本机 Node。未找到 Sidecar 时，桌面端会返回明确错误，不会伪造通知成功。

## 发送边界

- 只发送任务状态、命中数量、失败分类和本地证据包标识。
- 默认不发送截图、HTML、PDF、浏览器 Profile、Cookie、绝对本地路径或完整敏感公告内容。
- 任务失败、需要人工登录、验证码/CA/UKey 介入时才发送高优先级提醒。
- 旧 `wecom-group-webhook-legacy` 配置仅为已有部署迁移保留，默认禁用。

## 实现约束

Bot ID + Secret 的鉴权、发送接口和消息体均通过官方 Node SDK 实现，而非手写猜测 HTTP URL。SDK 和插件版本升级时，需要重新执行 `npm install`、`npm run typecheck` 与企业微信真实会话发送验收。