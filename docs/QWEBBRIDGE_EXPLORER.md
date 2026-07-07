# QWebBridge Candidate Explorer

这是标讯截图助手的 **QWebBridge 候选录制器 MVP**。它不修改生产 `platforms.json`，不把任何平台自动设为 `verified`，只在本机生成 `candidate-fixture.json` 和录制证据。

## 它做什么

- 连接本机 QWebBridge daemon；
- 读取当前真实 Chrome 页面的 accessibility snapshot；
- 生成全页截图；
- 运行固定、脱敏的 DOM analyzer；
- 识别候选搜索框、搜索按钮、详情链接、分页控件和人工边界；
- 将候选 fixture、snapshot、DOM 摘要、网络请求摘要保存到本机证据目录；
- 可在显式授权后，用用户提供的测试词执行一次搜索 probe。

## 它不做什么

- 不读取或导出 Cookie、localStorage、sessionStorage、密码、短信、二维码、CA/UKey；
- 不允许任意 `evaluate`；
- 不调用 `network detail`，不会读取请求/响应头或 body；
- 不处理验证码、短信、扫码、CA/UKey、原生签名器；
- 不自动点击详情、翻页、下载、上传、报价、投标、签章或提交；
- 不直接更新生产 adapter registry。

## 前置条件

1. 安装并启动 QWebBridge daemon 与 Chrome 扩展。
2. 确保扩展已连接：

```bash
qweb-bridge status
```

3. 在标讯截图助手仓库根目录写入：

```bash
cp .env.example .env
```

并设置：

```dotenv
TENDER_QWEBBRIDGE_ENABLED=true
TENDER_QWEBBRIDGE_URL=http://127.0.0.1:10086
```

只允许 `localhost`、`127.0.0.1` 或 `[::1]`。Explorer 会拒绝远程 bridge URL。

4. 用真实 Chrome 打开目标平台。受限平台由账号持有人手工完成正常登录；不要向 CLI、Agent、日志或 Git 提供任何凭证。

## 命令

### 检查 Bridge 状态

```bash
npm --workspace @tender/agent-host run explore:qwebbridge -- status
```

### 采集入口页

当前 Chrome 激活页应为对应平台入口：

```bash
npm --workspace @tender/agent-host run explore:qwebbridge -- \
  capture \
  --platform cebpubservice \
  --stage entry
```

输出中的 `recordingId` 是后续录制的唯一标识。

### 采集登录后状态

账号持有人在 Chrome 中手动完成登录后：

```bash
npm --workspace @tender/agent-host run explore:qwebbridge -- \
  capture \
  --platform cmcc \
  --recording <recordingId> \
  --stage authenticated
```

### 显式授权一次搜索 probe

`probe` 只会：

1. 从当前 candidate fixture 取候选搜索框和搜索按钮；
2. 填入你传入的测试查询词；
3. 点击一次候选搜索按钮；
4. 采集 `search-hit` 状态和脱敏网络摘要。

公共平台：

```bash
npm --workspace @tender/agent-host run explore:qwebbridge -- \
  probe \
  --platform gd-govprocurement \
  --recording <recordingId> \
  --query "公开历史公告编号" \
  --allow-search-probe
```

需要账号的平台，还必须由账号持有人明确确认当前真实 Chrome 会话合法、已登录且可用于该次测试：

```bash
npm --workspace @tender/agent-host run explore:qwebbridge -- \
  probe \
  --platform cmcc \
  --recording <recordingId> \
  --query "公开历史公告编号" \
  --allow-search-probe \
  --confirm-authorized-session
```

CA/UKey 平台会直接拒绝 `probe`，保留人工录制边界。

### 采集其他页面状态

在 Chrome 中手动进入对应状态后执行：

```bash
# 无结果
npm --workspace @tender/agent-host run explore:qwebbridge -- \
  capture --platform gd-govprocurement --recording <recordingId> --stage no-result

# 第二页
npm --workspace @tender/agent-host run explore:qwebbridge -- \
  capture --platform gd-govprocurement --recording <recordingId> --stage page-2

# 详情页
npm --workspace @tender/agent-host run explore:qwebbridge -- \
  capture --platform gd-govprocurement --recording <recordingId> --stage detail

# CAPTCHA / CA/UKey / SMS 等人工边界
npm --workspace @tender/agent-host run explore:qwebbridge -- \
  capture --platform tower-eprocurement --recording <recordingId> --stage manual-boundary
```

## 本机输出

```text
<evidenceDir>/recordings/<recordingId>/
  manifest.json
  candidate-fixture.json
  stages/
    entry.png
    entry.snapshot.json
    entry.discovery.json
    search-hit.png
    search-hit.snapshot.json
    search-hit.discovery.json
    search-hit.network.json
```

`candidate-fixture.json` 只是建议，不可直接复制到生产 `platforms.json`。其中的 `status` 固定为 `candidate`，并包含 `requiredAcceptance: S1–S8`。

## 后续验收

1. 技术人员审核候选 locator 的匹配数与稳定性；
2. 将需要的 selector 人工整理进 fixture；
3. 用 Playwright 隔离 Profile 执行 S1–S8 回放；
4. 连续三次通过；
5. 业务复核和审批人确认；
6. 才能将 adapter 改为 `verified`。

完整治理流程见：

```text
docs/PLATFORM_ADAPTER_RECORDING.md
docs/ADAPTER_EXPLORATION_DRIVERS.md
```
