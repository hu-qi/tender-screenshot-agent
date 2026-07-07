# 本地安全配置：`.env` 单一入口

本项目的本地配置采用“**只手工编辑 `.env`，其余由脚本同步**”的方式。

```text
.env
  ├─ 非敏感运行参数：Host 数据目录、浏览器、QWebBridge 开关
  ├─ 企业微信 bootstrap 值：Bot ID、Bot Secret、目标会话
  │
  └─ npm run local:config -- apply
        ├─ macOS Keychain：Bot ID / Bot Secret
        ├─ SQLite：企业微信 enabled / targetIds / websocket URL
        ├─ 本地目录：data、config、profiles、evidence、platform registry
        └─ 校验：.env 权限、loopback QWebBridge、凭证成对性
```

运行时 Pi Agent Host 仍从 macOS Keychain 读取 Bot ID 与 Bot Secret；SQLite、日志、企业微信通知和 Git 都不会保存或输出密钥。

## 一次性初始化

```bash
npm install
npm run local:config:init
```

该命令会在 `.env` 不存在时复制 `.env.example`，并将文件权限设为 `0600`。如果 `.env` 已存在，只会修复权限，不会覆盖任何值。

## 只需要编辑 `.env`

最常用配置：

```dotenv
# .env 文件权限由脚本强制为 0600
TENDER_SECURITY_ENFORCE_ENV_PERMISSIONS=true

# QWebBridge 必须是本机地址
TENDER_QWEBBRIDGE_ENABLED=true
TENDER_QWEBBRIDGE_URL=http://127.0.0.1:10086

# 企业微信智能机器人
TENDER_WECOM_ENABLED=true
TENDER_WECOM_BOT_ID=你的BotID
TENDER_WECOM_BOT_SECRET=你的BotSecret
TENDER_WECOM_TARGET_IDS=chatid-1,userid-1
# 通常留空，使用官方 SDK 默认地址
TENDER_WECOM_WEBSOCKET_URL=

# 可选：本机数据位置
TENDER_DATA_DIR=
TENDER_CONFIG_DIR=
TENDER_PLATFORM_CONFIG=
```

`TENDER_WECOM_TARGET_IDS` 可用逗号、分号或换行分隔。Bot ID 与 Bot Secret 必须同时存在；只填其中一个会被拒绝。

## 应用配置

每次修改 `.env` 后执行：

```bash
npm run local:config:apply
```

此命令会：

1. 检查并在默认情况下将 `.env` 修正为 `0600`；
2. 检查 QWebBridge 开启时是否严格指向 `127.0.0.1`、`localhost` 或 `[::1]`；
3. 将 `TENDER_WECOM_BOT_ID` 与 `TENDER_WECOM_BOT_SECRET` 写入 macOS Keychain；
4. 将企业微信启用状态、目标会话和可选 WebSocket 地址写入本机 SQLite；
5. 创建本机配置目录和初始平台 registry；
6. 输出脱敏状态 JSON，只显示布尔值、数量和路径，不回显任何凭证。

`apply` 必须在最终运行桌面应用的 macOS 工作站执行，因为 Keychain 同步依赖 macOS 的 `security` 命令。

## 自检

```bash
npm run local:config:doctor
```

检查项：

- `.env` 是否存在；
- `.env` 权限是否为 `0600`；
- Node 版本和当前系统；
- QWebBridge 是否使用 loopback 地址；
- 企业微信 Keychain 是否同时存在 Bot ID 和 Bot Secret；
- 本地 SQLite 中是否已写入通知目标；
- 企业微信启用但没有目标会话时给出警告。

`doctor` 不读取、更不会输出 Bot ID 或 Bot Secret。

## 清除企业微信配置

```bash
npm run local:config:clear-wecom -- --confirm-clear-wecom
```

这会删除：

- macOS Keychain 中的 Bot ID；
- macOS Keychain 中的 Bot Secret；
- 本地 SQLite 中的企业微信通知设置。

它不会修改 `.env`，便于你在之后再次执行 `apply` 恢复配置。若要彻底移除 bootstrap 值，请手工清空 `.env` 中对应变量后再次运行 `doctor`。

## 安全边界

- `.env` 已在 `.gitignore` 中，仍不得复制到聊天、工单、截图、压缩包或 Git 提交中；
- Profile、Cookie、Trace、证据文件、SQLite 和平台配置同样不提交 Git；
- QWebBridge 只能配置成本机 loopback；
- 企业微信凭证不会进入 SQLite；
- `TENDER_WECOM_ENABLED=true` 但缺少完整 Bot 凭证时，`apply` 会失败；
- CA/UKey、短信、扫码、验证码不会由此脚本保存、读取或自动化。

## 命令汇总

```bash
npm run local:config:init
npm run local:config:apply
npm run local:config:doctor
npm run local:config:clear-wecom -- --confirm-clear-wecom
```
