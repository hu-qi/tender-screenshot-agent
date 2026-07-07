# 适配器自主探索 Driver 设计

本文补充《平台适配器录制、回放与验收手册》，定义如何同时使用 Playwright 和 QWebBridge 进行**受控自主探索**，并将探索结果录入候选 fixture。

## 结论

可以自主探索，但只能自主生成 `candidate`，不能自主发布 `verified`。

```text
真实 Chrome / QWebBridge
  → 探索与录制候选状态
  → candidate fixture
  → Playwright 隔离 Profile 回放
  → replay-pass
  → 人工审批
  → verified
```

## Driver 分工

| Driver | 角色 | 最适合的场景 | 不作为什么 |
|---|---|---|---|
| QWebBridge | Explorer / Recorder | 用户真实 Chrome、真实公司网络、真实已登录会话、人工完成 QR/SMS/CA 后的页面观察 | 生产检索唯一执行器、自动登录器、凭证导出器 |
| Playwright | Replay / Evidence | 隔离 Profile、稳定回放、截图、HTML、PDF、Trace、失败归档、回归测试 | 绕过验证码、短信、CA/UKey 或复制其他人的会话 |

QWebBridge 的 snapshot `@eN` ref 是当前会话内元素引用，只用于探索期交互，绝不能写进 fixture。fixture 必须保留稳定的 role/label/placeholder/data-* / CSS locator，并由 Playwright 回放验证。

## 自主探索的三档权限

### 1. passive：默认

允许：

- 获取当前页面的 accessibility snapshot；
- 截图；
- 运行内部固定的脱敏 DOM 分析脚本；
- 记录 URL、标题、可交互元素、候选 locator、分页线索和人工边界；
- 仅获取网络请求摘要，不读取请求/响应头和响应体。

禁止：

- 导航、点击、填表、上传、下载、键盘输入；
- 读取 Cookie、localStorage、sessionStorage、密码、验证码或敏感正文；
- 任意 JavaScript evaluate。

### 2. search-probe：需明确用户操作

仅适用于公开平台或已经 `user-confirmed` 的本机授权会话。需要用户明确提供：

```text
测试查询词
允许搜索
允许点击第一条公开公告详情
允许验证一次分页
```

允许的动作仅限：

```text
进入该平台入口
填写用户给定的测试查询词
点击录制到的搜索按钮
打开第一条公开公告详情
点击一次下一页
```

每个动作前后都必须捕获截图、snapshot、脱敏 DOM 指纹和事件记录。

### 3. replay：自动验收

只使用已生成的 candidate fixture 和 Playwright 隔离 Profile。回放通过前不修改生产 registry；连续三次通过并经审批后才可以进入 `verified`。

## QWebBridge 调用白名单

Explorer 只能调用以下工具：

```text
list_tabs
find_tab
navigate             # 仅 search-probe，且入口 URL 必须等于平台注册入口
snapshot
screenshot
wait_for
network start/list/stop  # 仅摘要，禁止 detail
fill                 # 仅 search-probe，且值是用户输入的测试查询词
click                # 仅 search-probe，且 selector 来自当前 candidate
close_session
save_as_pdf          # 仅公开详情页
```

禁止调用：

```text
evaluate             # 除内部硬编码、脱敏的 DOM analyzer 外
key_type
send_keys
mouse_click
upload
network detail
```

尤其不能让 LLM 直接拼接 `evaluate` 脚本；Explorer 只能调用代码内固定、版本化、审计的页面分析函数。

## 探索算法

### Step 1：建立录制会话

- QWebBridge：创建 `tender-recorder-<recordingId>` session，在真实 Chrome 新开受控 tab；
- Playwright：打开平台隔离 persistent Profile；
- 记录 driver、版本、平台、操作者、网络环境标识和关联 ID。

### Step 2：采集入口状态

记录：

```text
URL / 标题
accessibility snapshot
全页截图
安全 DOM 摘要
登录状态 marker
CAPTCHA / QR / SMS / CA-UKey / 原生签名器 marker
候选搜索框 / 搜索按钮
```

### Step 3：生成候选 locator

按优先级输出候选：

```text
role + accessible name
→ label
→ placeholder
→ data-testid / data-* 
→ id / name / aria-label
→ 稳定 CSS class
→ XPath（仅人工确认后允许作为 fallback）
```

每个候选都要保存：

```json
{
  "locator": { "strategy": "placeholder", "value": "请输入项目名称" },
  "matches": 1,
  "visible": true,
  "confidence": 0.92,
  "source": "dom-analyzer"
}
```

### Step 4：搜索探测

仅在用户授权 `search-probe` 后执行。使用用户提供的测试词填写候选搜索框，提交后捕获：

```text
loading marker
结果容器
结果行
标题
发布时间
详情链接
无结果 marker
分页控件
首条结果稳定标识
```

若出现登录、验证码、扫码、短信、CA/UKey、频率限制或维护页，立即停止，记录 `manual-boundary`，不重试、不绕过。

### Step 5：详情与分页探测

- 只打开第一条公开公告详情；
- 只执行一次下一页或指定页面跳转；
- 通过“当前页变化 + 首条结果变化 + loading 结束”至少两个信号验证；
- 不下载受限附件，不触发任何投标、报价、签章或提交动作。

### Step 6：写入 Candidate Fixture

本机写入：

```text
evidence/recordings/<recordingId>/
  manifest.json
  stages/*.json
  screenshots/*.png
  dom-fingerprint.json
  candidate-fixture.json
```

Git 只能提交脱敏的：

```text
fixtures/<platform>.candidate.json
reports/<platform>/<version>.md
sanitized-dom-fingerprint.json
```

### Step 7：Playwright Replay

- 读取 candidate fixture；
- 在公共访问或 `user-confirmed` Profile 中重放；
- 连续三次跑 S1–S8；
- 保存 Trace、HTML、PDF、截图与结果；
- 通过后生成 `replay-pass`；
- 由技术、业务和审批人确认后才升级 `verified`。

## 固定 DOM Analyzer 输出范围

Analyzer 不返回页面正文、表单当前值、Cookie、localStorage、sessionStorage、网络 body 或请求头。只允许输出：

```text
元素 tag / role / aria-label / placeholder / name / type
稳定 data-*、id、class token
文本长度和前 40 个脱敏字符
候选 selector
匹配数
可见性
DOM 层级特征
分页 / 登录 / 人工边界关键词命中
```

以下词命中后应替换为 `[REDACTED]`：

```text
手机号、邮箱、身份证、银行卡、token、secret、cookie、authorization、password、验证码
```

## Candidate Fixture 发布规则

| 条件 | 允许状态 |
|---|---|
| 仅采集入口页 | `candidate` |
| 命中查询已采集，分页未验证 | `candidate` |
| S1–S8 回放一次通过 | `replay-pass`，不可生产启用 |
| S1–S8 连续三次通过 + 审批 | `verified` |
| 登录/验证码/CA 边界命中 | `manual-only` 或 `manual-review-required` |
| 页面改版 / selector 漂移 | `drifted`，立即取消生产自动检索 |

## 安全边界

- QWebBridge 仅连接 `127.0.0.1` / `localhost` 的本机 daemon；
- Explorer 不接受任意远程 bridge URL；
- 不读取、导出或提交真实 Chrome Cookie、Profile、密码、短信、二维码、CA/UKey；
- 不允许任意 `evaluate`、`network detail`、上传、下载受限附件或表单提交；
- 企业微信只能通知“录制完成 / 需要人工处理 / 回放失败”，不得发送录制原件；
- 录制的每个动作写入 append-only event stream，并绑定 recordingId 与 correlationId。
