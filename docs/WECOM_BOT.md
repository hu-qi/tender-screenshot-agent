# 企业微信智能机器人接入

新运行时使用 `wecom-bot-id-secret`：Pi Agent Host 直接调用企业微信官方 `@wecom/aibot-node-sdk` 建立 WebSocket 认证与主动 Markdown 推送。旧群机器人 Webhook 不是默认通道，也没有作为回退发送逻辑。

## 运行链路

1. 桌面端将 Bot ID、Bot Secret、目标会话 ID 提交给本机 Agent Host。
2. Agent Host 将 Bot ID 与 Bot Secret 分别写入 macOS Keychain；SQLite 只保存启用状态、目标会话 ID、可选 WebSocket 地址和更新时间。
3. 点击“测试认证”时，Host 从 Keychain 读取凭证，使用官方 SDK `WSClient({ botId, secret })` 建立 WebSocket，并等待 `authenticated` 事件。
4. 任务终态或手动测试通知时，Host 调用 `sendMessage(targetId, { msgtype: 'markdown', markdown: { content } })`，完成后断开连接。
5. append-only 运行事件只记录认证/发送状态、关联 ID 和成功/失败数量；不保存 Bot ID、Secret、完整消息正文或原始目标会话 ID。

浏览器执行和企业微信通知都在同一个本地 Agent Host 内，但属于不同工具。Playwright 工具不会读取 Bot 凭证。

## 凭证模型

- Keychain service：`com.huqi.tender-screenshot-agent`
- Bot ID account：`wecom-bot-id`
- Bot Secret account：`wecom-bot-secret`

Bot ID、Bot Secret 不进入 Git、SQLite、`.env`、浏览器 Profile、导出包或日志正文。

## 目标会话

目标会话每行一个。实际可用值取决于企业微信机器人后台授权范围，例如群聊 `chatid` 或单聊 `userid`。Agent Host 保存去重后的目标列表；发送结果仅记录成功/拒绝总数。

## 本地启动

```bash
npm install
npm run build:agent-host
npm run dev:desktop
```

开发桌面壳会启动：

```text
node packages/agent-host/dist/index.js --port <random> --token <per-launch-token>
```

发布版本可通过 `TENDER_AGENT_HOST_BIN` 指定打包后的 Host 二进制；开发调试可通过 `TENDER_AGENT_HOST_SCRIPT` 或 `TENDER_NODE_BIN` 覆盖启动位置。

## 发送边界

- 默认发送任务状态、成功数、人工复核数和失败数。
- 不发送截图、HTML、PDF、浏览器 Profile、Cookie、绝对本地路径或完整敏感公告内容。
- `strict-local` 模式禁止外发企业微信通知。
- 未配置 Bot 凭证、目标会话或 Host 网络异常时，事件流记录明确的跳过/失败原因，不会伪造发送成功。
