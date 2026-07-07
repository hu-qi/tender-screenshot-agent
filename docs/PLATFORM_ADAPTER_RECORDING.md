# 平台适配器录制、回放与验收手册

> 适用范围：标讯截图助手的九个目标平台，以及后续新增的公开招投标、运营商采购、政采和公共资源交易平台。
>
> 本文定义“怎样把一个真实网站从 `unverified` 验收到 `verified`”。它不是绕过登录、验证码、CA/UKey、短信或 QR 登录的方案；所有受限步骤均由账号持有人在本机正常完成。

---

## 1. 目标与原则

### 1.1 为什么不能只手写几个 selector

一个平台能否稳定自动检索，不只取决于搜索框和详情链接。至少还依赖：

- 搜索提交后如何判断页面加载完成；
- 结果列表、无结果页和异常页怎样区分；
- 翻页如何确认真正进入下一页；
- 详情页跳转是否使用新窗口、单页应用路由或下载文件；
- 登录态、会话失效、验证码、扫码、短信、CA/UKey 如何识别；
- 页面改版后如何发现 selector 漂移，而不是误报“没有结果”。

因此每个平台必须形成一份**可回放页面行为契约**（fixture），并经过固定场景验收后才允许被标记为 `verified`。

### 1.2 核心原则

1. **先录制，后自动化。** 未验收的页面不能凭经验填写泛化 selector。
2. **先证据，后结论。** 每次验收和生产运行都保留可审计截图、HTML、Trace 和结构化事件。
3. **人工登录不可替代。** 账号、短信、二维码、验证码、CA/UKey、原生签章全部保留给授权用户处理。
4. **默认穷尽。** 生产任务默认执行每个 `query × platform` 组合，不让 LLM 自行跳过平台。
5. **最小化提交。** Git 只保存脱敏 fixture、DOM 指纹和验收报告；Cookie、Profile、Trace 原件、HTML 原件、截图原件都保留在本机。
6. **失败比误判重要。** selector 不确定、会话异常、页面改版、网络受限时，应返回 `manual-review-required` 或 `failed`，不能伪造“无结果”或“已完成”。

---

## 2. 当前实现状态与本文约定

### 2.1 当前仓库已经具备的能力

当前 `PlatformAdapterConfig` 已支持基础入口、访问模式、适配器状态以及四类 selector：

```ts
interface PlatformAdapterConfig {
  id: PlatformId;
  name: string;
  entryUrl: string;
  accessMode: 'public' | 'manual-login' | 'ca-login';
  adapterStatus: 'verified' | 'unverified';
  selectors?: {
    searchInput?: string;
    searchSubmit?: string;
    resultLink?: string;
    detailBody?: string;
  };
}
```

当前行为如下：

- `unverified`：打开入口页，保存入口页截图、HTML 和 Playwright Trace，返回 `manual-review-required`；
- `verified`：使用已配置 selector 执行查询、抓取结果页、详情页、HTML/Text/PDF 和失败 Trace；
- `manual-login`：必须先由用户在本机可见浏览器完成登录，并显式确认本地 Profile；
- `ca-login`：保留为人工边界，不尝试绕过 CA/UKey；
- 每次运行保存任务、运行、事件和证据索引到本机 SQLite。

### 2.2 当前尚未实现的能力

以下内容是本文定义的**下一阶段 Recorder / Replay / Acceptance Harness 设计**，不是当前仓库已经提供的命令或 UI：

- 可视化 selector 录制器；
- 自动生成多候选 locator 并评分；
- 分页行为录制与回放；
- 登录失效、验证码、CA/UKey 的结构化边界录制；
- 自动回放验收和漂移检测；
- 站点验收报告自动生成；
- `adapter:record`、`adapter:replay`、`adapter:accept`、`adapter:drift-check` CLI。

在这些能力落地前，平台录制应由技术人员在本机使用 Playwright Inspector、Trace Viewer、DOM 检查工具完成，并将验收结果以 fixture 和报告形式固化。

---

## 3. 名词定义

| 名词 | 定义 |
|---|---|
| **平台** | 一个独立站点或采购/交易系统，例如 `gd-govprocurement`。 |
| **Adapter** | 平台的可执行检索规则，包括访问模式、页面 locator、分页、详情、登录状态和人工边界。 |
| **Fixture** | 脱敏的页面行为契约 JSON；可提交 Git。 |
| **录制会话** | 在授权环境中由账号持有人操作、技术人员记录页面行为的一次过程。 |
| **回放** | 使用同一 Profile 或公共访问路径，根据 fixture 自动重复录制场景。 |
| **验收运行** | 对标准场景集执行录制和回放，并形成结论的运行。 |
| **Profile** | 某个平台独立的 Playwright persistent profile；包含本地浏览器会话，不可提交 Git。 |
| **人工边界** | CAPTCHA、短信、QR、CA/UKey、原生签名器、账号确认等必须由用户处理的状态。 |
| **漂移** | 页面结构、文本、访问路径、分页或登录标志变化，导致 fixture 不再可靠。 |
| **DOM 指纹** | 去除敏感值后，描述关键页面结构与 locator 命中情况的摘要。 |

---

## 4. 角色、职责与前置条件

### 4.1 建议角色

| 角色 | 责任 |
|---|---|
| 平台账号持有人 | 在本机完成正常账号登录、短信、扫码、CA/UKey、原生签名等操作；确认业务页面正确。 |
| 技术验收人 | 录制 selector、检查 Trace、设置等待条件、回放场景、维护 fixture。 |
| 业务复核人 | 确认搜索结果、公告详情、分页语义和关键字段与平台业务规则一致。 |
| 审批人 | 批准 `verified`、降级 `drifted` 或 `manual-only`，确认风险边界。 |

一个人可以兼任多个角色，但**账号持有人确认**与**技术验收结论**应留下独立记录。

### 4.2 录制前置检查

开始某个平台前，必须确认：

- 使用公司授权账号，且账号权限仅覆盖合法业务范围；
- 录制设备在允许访问该平台的网络环境中；
- 平台对自动化访问、查询频率、下载行为没有被业务方禁止；
- 已创建该平台独立 Profile，不与其他平台共用；
- 已明确测试查询词：一个应命中、一个应无结果、一个可覆盖分页；
- 已确认不将真实账号密码、Cookie、短信、二维码、CA/UKey 文件、证书或内部标书上传 Git、发企业微信或传给模型；
- 已知晓当前验收只验证公告检索与证据留存，不承担投标、下载受限文件、签章或提交操作。

### 4.3 录制环境建议

```text
macOS / Windows 授权办公设备
├─ 标讯截图助手桌面端
├─ Playwright Chromium 或企业认可浏览器
├─ 单一公司网络出口 / 已批准 VPN
├─ 平台账号持有人在场
└─ 本机安全目录
   ├─ profiles/<platform>/default/
   ├─ evidence/acceptance/<platform>/<timestamp>/
   └─ reports/<platform>/<timestamp>/
```

不要在 GitHub Actions、云桌面、共享浏览器或未授权的外部网络中录制受限平台。

---

## 5. 平台生命周期

平台不应只用 `verified / unverified` 两个状态。Recorder 落地后建议使用以下流程状态；其中 Git 中最终仍可映射为 `verified` 或 `unverified`。

```text
unverified
  │
  ├── 建立录制会话 ──> recording
  │                       │
  │                       ├── 生成候选 fixture ──> candidate
  │                       │                           │
  │                       │                           ├── 回放失败 ──> recording
  │                       │                           └── 回放通过 ──> replay-pass
  │                       │                                                   │
  │                       └───────────────────────────────────────────────────┤
  │                                                                           ▼
  └────────────────────────────────────────────────────────────────────> accepted / verified
                                                                              │
                                                 定期漂移检查失败             │
                                                                              ▼
                                                                        drifted / manual-review
```

### 5.1 状态定义

| 状态 | 含义 | 是否允许生产自动检索 |
|---|---|---|
| `unverified` | 尚未录制或尚未完成验收 | 否，仅入口取证 |
| `recording` | 正在人工录制页面行为 | 否 |
| `candidate` | 已生成候选 fixture，未回放验证 | 否 |
| `replay-pass` | 标准场景回放通过，待审批 | 否 |
| `verified` | 已审批，可按 fixture 自动检索 | 是 |
| `drifted` | 漂移检查失败或页面变更 | 否，降级人工复核 |
| `manual-only` | 平台的关键动作受 CA/UKey 等限制 | 仅允许边界前自动化 |
| `retired` | 平台关闭、入口迁移或不再使用 | 否 |

---

## 6. Fixture：页面行为契约

### 6.1 文件位置

建议将提交 Git 的 fixture 放在：

```text
packages/agent-host/fixtures/
  cmcc.json
  unicom.json
  telecom.json
  tower-online-commerce.json
  tower-eprocurement.json
  cebpubservice.json
  miit.json
  gd-govprocurement.json
  gd-public-resources.json
```

本机运行时将 fixture 合并或复制到用户配置目录中的 `platforms.json`。不要让生产 Profile、凭证或证据原件进入 fixture。

### 6.2 推荐 schema

以下是建议的 v3 fixture 结构。字段可按实际平台增减，但不得删除身份边界、录制元数据和验收信息。

```json
{
  "schemaVersion": 3,
  "platformId": "gd-govprocurement",
  "name": "广东省政府采购网",
  "adapterVersion": "2026.07.07.1",
  "status": "candidate",
  "entryUrl": "https://gdgpo.czt.gd.gov.cn/",
  "access": {
    "mode": "public",
    "requiresLogin": false,
    "profileRequired": false,
    "sessionReuseRequired": false,
    "allowedAutomation": "search-and-evidence"
  },
  "search": {
    "input": {
      "primary": {
        "strategy": "role",
        "role": "textbox",
        "name": "项目名称"
      },
      "fallbacks": [
        { "strategy": "placeholder", "value": "请输入项目名称" },
        { "strategy": "css", "value": "input[name='keyword']" }
      ]
    },
    "submit": {
      "primary": {
        "strategy": "role",
        "role": "button",
        "name": "搜索"
      }
    },
    "loading": {
      "appear": [
        { "strategy": "css", "value": ".loading-mask" }
      ],
      "disappear": [
        { "strategy": "css", "value": ".loading-mask" }
      ],
      "timeoutMs": 15000
    }
  },
  "results": {
    "container": { "strategy": "css", "value": ".notice-list" },
    "row": { "strategy": "css", "value": ".notice-list > .notice-item" },
    "title": { "strategy": "css", "value": ".notice-title" },
    "publishedAt": { "strategy": "css", "value": ".publish-time" },
    "detailLink": { "strategy": "css", "value": "a.notice-title" },
    "noResult": [
      { "strategy": "text", "value": "暂无数据" },
      { "strategy": "css", "value": ".empty-state" }
    ]
  },
  "pagination": {
    "mode": "next-button",
    "currentPage": { "strategy": "css", "value": ".pagination .active" },
    "nextButton": { "strategy": "role", "role": "button", "name": "下一页" },
    "nextDisabled": [
      { "strategy": "css", "value": ".pagination .next.disabled" },
      { "strategy": "attribute", "selector": ".pagination .next", "name": "aria-disabled", "value": "true" }
    ],
    "resultIdentity": { "strategy": "css", "value": ".notice-list > .notice-item:first-child a" },
    "readyConditions": [
      "loading-disappeared",
      "current-page-changed",
      "first-result-changed"
    ]
  },
  "detail": {
    "container": { "strategy": "css", "value": ".notice-detail" },
    "title": { "strategy": "css", "value": "h1" },
    "publishedAt": { "strategy": "css", "value": ".publish-date" },
    "body": { "strategy": "css", "value": ".notice-content" }
  },
  "auth": {
    "authenticated": [],
    "loginPage": [],
    "sessionExpired": []
  },
  "manualBoundaries": [],
  "acceptance": {
    "recordedAt": "2026-07-07T10:00:00+08:00",
    "recordedBy": "internal-operator-id",
    "approvedBy": null,
    "scenarios": [],
    "domFingerprintVersion": 1
  }
}
```

### 6.3 Locator 表达方式

建议使用结构化 locator，而不是将所有内容塞进单一 CSS 字符串：

```ts
type LocatorSpec =
  | { strategy: 'role'; role: string; name?: string; exact?: boolean }
  | { strategy: 'label'; value: string; exact?: boolean }
  | { strategy: 'placeholder'; value: string; exact?: boolean }
  | { strategy: 'text'; value: string; exact?: boolean }
  | { strategy: 'test-id'; value: string }
  | { strategy: 'css'; value: string }
  | { strategy: 'attribute'; selector: string; name: string; value?: string }
  | { strategy: 'xpath'; value: string };
```

优先级必须固定：

```text
role + accessible name
→ label
→ placeholder
→ data-testid / 稳定 data-* 属性
→ 稳定 CSS
→ XPath（最后手段）
```

禁止把易变位置 selector 当 primary，例如：

```text
div:nth-child(4) > div:nth-child(2) > button:nth-child(1)
```

也不要把包含随机 hash、动态时间戳、用户 ID、查询词或分页序号的 class/name 作为唯一 selector。

---

## 7. Recorder 的产品与技术设计

### 7.1 桌面端验收向导

建议新增“平台验收”工作台，每个平台提供以下动作：

```text
[创建录制会话]
[打开平台入口]
[我已完成登录]
[录制搜索框]
[录制搜索按钮]
[录制结果列表]
[录制无结果状态]
[录制分页]
[录制详情页]
[录制登录失效状态]
[标记 CAPTCHA / SMS / QR / CA-UKey 边界]
[执行回放验收]
[生成验收报告]
[提交为 verified]
```

每一步都应显示：当前 URL、当前页面标题、最近截图、候选 locator、唯一命中结果、保存位置和风险提示。

### 7.2 Recorder 内部模块建议

```text
packages/agent-host/src/adapters/
  fixture-schema.ts       # fixture 验证
  locator-resolver.ts     # LocatorSpec → Playwright locator
  recorder.ts             # 录制页面与候选 selector
  replay.ts               # 固定场景回放
  pagination.ts           # 分页等待与终止条件
  auth-state.ts           # 登录态与失效检测
  manual-boundary.ts      # CAPTCHA / QR / SMS / CA/UKey
  dom-fingerprint.ts      # 脱敏结构指纹
  drift-check.ts          # 定期漂移检查
  acceptance-report.ts    # Markdown / JSON 报告
```

### 7.3 每次录制必须保存什么

本机证据目录建议：

```text
evidence/acceptance/<platformId>/<timestamp>/
  manifest.json
  01-entry.png
  01-entry.html
  01-entry-trace.zip
  02-search-hit.png
  02-search-hit.html
  03-page-2.png
  04-no-result.png
  05-detail.png
  05-detail.html
  06-session-expired.png
  manual-boundary.png
  recorder-events.jsonl
  sanitized-dom-fingerprint.json
  acceptance-report.md
```

记录至少包括：

- 当前 URL、页面标题、时间、操作者标识；
- 截图、HTML、Trace；
- locator 候选与最终选定 locator；
- 每个 locator 的命中数量、可见性和稳定性评分；
- 网络/导航摘要，仅保留 URL 域名、HTTP 状态、耗时和错误类别；
- 结果条数、第一页第一条标识、当前页码；
- 是否检测到登录页、会话失效、验证码、CA/UKey 或原生签名器；
- 所有人工确认点。

### 7.4 不允许保存或提交什么

以下内容只能留在系统安全存储或完全不保存：

- 账号密码；
- Cookie、localStorage、sessionStorage、storageState；
- 手机短信验证码、二维码内容；
- Bot ID、Bot Secret、Webhook；
- CA/UKey 驱动、证书、私钥、签名请求、原生插件数据；
- 完整受限招标文件、内部附件、身份证、银行卡、电话和邮箱等敏感内容；
- 绝对本机路径；
- 浏览器下载目录内的原始文件。

提交 Git 的内容只能是：

```text
fixtures/<platform>.json
reports/<platform>/<adapterVersion>.md
sanitized-dom-fingerprint.json
脱敏后的场景结论与统计
```

---

## 8. 逐站录制标准流程

### 阶段 A：准备测试样本

对每个平台准备至少三组查询：

| 查询类型 | 目的 | 要求 |
|---|---|---|
| 命中查询 | 验证搜索、结果页、详情页 | 至少有 3 条结果更佳 |
| 无结果查询 | 验证空状态 | 使用不存在或过期项目编号 |
| 分页查询 | 验证分页行为 | 至少 2 页结果 |

不要使用敏感项目名称、未公开投标文件关键词或真实个人信息作为固定测试样本。建议优先使用公开历史公告编号。

### 阶段 B：建立隔离 Profile

1. 在“平台账号与访问”页选择目标平台。
2. 点击“打开登录”。
3. 由账号持有人在打开的本机浏览器中完成正常登录。
4. 不要把验证码、二维码、短信内容告诉 Recorder、LLM 或外部服务。
5. 登录后确认已进入预期业务页面。
6. 点击“确认登录完成”。
7. Host 将该 Profile 标记为 `user-confirmed`；仅这个显式状态可以解锁受限平台的自动检索。

若只是检查页面、未完成登录或登录失败，应点击“取消”，不得确认。

### 阶段 C：录制入口与登录状态

录制以下页面状态：

| 状态 | 必录内容 |
|---|---|
| 未登录入口 | URL、截图、HTML、登录 marker |
| 已登录入口 | URL、截图、HTML、authenticated marker |
| 会话失效 | 登录过期提示、跳转页面或弹窗 marker |
| 人工边界 | CAPTCHA、QR、SMS、CA/UKey、原生签名器 marker |

对于公共平台，不需要录账号登录，但仍需录制“正常入口”和“访问被拦截/维护中”状态。

### 阶段 D：录制搜索

1. 使用命中查询进入检索页面。
2. 标记搜索框。
3. 标记搜索按钮；若是按 Enter 查询，则记录 Enter 行为。
4. 触发一次搜索。
5. 录制 loading 出现与消失，或其他可靠的页面稳定信号。
6. 录制结果容器、结果行、标题、发布时间、详情链接。
7. 录制至少一条结果的稳定标识，例如详情 href 或公告编号。
8. 另用无结果查询，录制空状态 marker。

录制器应优先提出多个候选 locator。验收人必须确认：

- 命中数为 1 的搜索框和按钮；
- 结果行 selector 可命中多个行；
- 标题与详情链接属于同一行；
- 空状态不与正常结果容器混淆；
- loading 条件不是固定 sleep。

### 阶段 E：录制分页

分页录制至少覆盖：

```text
第一页 → 第二页 → 最后一页 → 无结果
```

必须确认以下事实：

1. 点击下一页后，当前页码发生变化；
2. 首条结果标识变化，或 URL 的 page 参数变化；
3. loading 结束后再读取结果；
4. 最后一页的下一页按钮禁用、隐藏或无法触发；
5. 页码跳转、URL query、无限滚动等实现方式被准确记录。

不要使用固定 `waitForTimeout(1200)` 作为唯一等待方式。应通过以下至少两个信号判定分页完成：

```text
loading 消失
当前页码改变
首条结果 href / 公告编号改变
结果容器重新渲染
URL page 参数改变
```

### 阶段 F：录制详情页

至少打开 3 条不同公告，确认：

- 点击详情是否同页跳转、新窗口、iframe 或下载；
- 详情标题、发布时间、正文容器的 selector；
- 详情页 HTML、Text、截图、PDF 是否能正确生成；
- 详情 URL 是否稳定；
- 回退到列表页后是否仍保留查询上下文。

若详情通过附件、下载按钮或在线预览呈现，必须明确区分：

```text
公告详情文本：可抓取
公开 PDF：可保存并 hash
受限附件：仅记录入口与人工边界，不自动下载
需要登录/CA 的附件：manual-review-required
```

### 阶段 G：录制人工边界

任何以下场景出现时，Recorder 必须停止继续自动化，并保存边界证据：

```text
CAPTCHA / 滑块 / 图形验证码
短信 OTP
扫码登录
CA/UKey
原生签名器
账号风险确认
频率限制 / IP 限制
需人工同意的隐私或授权提示
```

记录方式：

```json
{
  "type": "ca-ukey",
  "markers": [
    { "strategy": "text", "value": "请插入CA证书" },
    { "strategy": "text", "value": "UKey" }
  ],
  "action": "stop-and-request-user",
  "message": "该平台需要账号持有人完成 CA/UKey 操作后才可继续。"
}
```

禁止：

- 自动识别、填写或绕过验证码；
- 自动读取短信；
- 自动扫码；
- 自动调用 UKey、证书、原生签章程序；
- 注入 Cookie 或复制其他人的浏览器会话；
- 把人工边界伪装为普通网络错误。

### 阶段 H：回放验收

每个候选 fixture 至少在同一授权环境中连续回放 3 次。每次运行都必须记录：

```text
fixture 版本
Profile 状态
测试查询
入口是否打开
搜索是否成功
命中数
无结果识别
分页结果
详情结果
登录状态
人工边界结果
证据路径
Trace 路径
失败分类
```

只有满足第 11 节的门槛，平台才能进入 `replay-pass`。

### 阶段 I：审批与发布

1. 技术验收人生成 fixture、脱敏 DOM 指纹和验收报告。
2. 业务复核人核对结果标题、详情、分页和公告语义。
3. 审批人确认访问范围、账号边界和证据保留方式。
4. 提交 fixture 与报告到 Git。
5. 将平台 registry 改为 `verified`。
6. 增加定期漂移检查任务。

---

## 9. 登录态、会话复用与失效处理

### 9.1 Profile 的正确使用方式

每个平台只能使用自己的本地 Profile：

```text
profiles/
  cmcc/default/
  unicom/default/
  telecom/default/
  tower-online-commerce/default/
  tower-eprocurement/default/
  cebpubservice/default/
  miit/default/
  gd-govprocurement/default/
  gd-public-resources/default/
```

Profile 状态必须由 Host 数据库记录，而不是仅根据目录是否存在判断：

```text
not-configured
login-open
user-confirmed
expired
```

生产执行前应进行以下校验：

```text
public 平台：允许访问
manual-login 平台：Profile 必须是 user-confirmed，且 authenticated marker 命中
ca-login 平台：按 fixture 定义，只允许自动执行 CA/UKey 前的页面步骤
```

### 9.2 登录态 marker

每个需要登录的平台至少定义三类 marker：

```json
{
  "auth": {
    "authenticated": [
      { "strategy": "text", "value": "退出登录" },
      { "strategy": "css", "value": ".user-avatar" }
    ],
    "loginPage": [
      { "strategy": "css", "value": ".login-form" }
    ],
    "sessionExpired": [
      { "strategy": "text", "value": "登录已失效" },
      { "strategy": "css", "value": ".session-expired-modal" }
    ]
  }
}
```

判定规则建议：

| 条件 | 结果 |
|---|---|
| authenticated 任一 marker 命中，且 loginPage 未命中 | 可继续 |
| loginPage 或 sessionExpired 任一 marker 命中 | 标记 Profile `expired`，停止任务并请求人工登录 |
| 两类都不命中 | 返回 `manual-review-required`，不要假设仍登录 |
| CAPTCHA/CA/UKey marker 命中 | 返回对应人工边界 |

### 9.3 会话失效的处置

```text
检测到失效
  → 保存当前页面截图 / HTML / Trace
  → 更新 Profile 为 expired
  → 当前平台结果标记 manual-review-required
  → 其他平台继续执行
  → 企业微信只发送“平台需要重新登录”的脱敏提醒
```

不得自动尝试密码登录、短信登录、扫码登录或反复刷新页面。

---

## 10. 分页、加载与结果校验细则

### 10.1 支持的分页类型

| 类型 | 录制字段 | 验收重点 |
|---|---|---|
| `next-button` | 下一页、当前页、禁用状态 | 1→2、末页禁用、首条变化 |
| `page-number` | 页码按钮、当前页、页码范围 | 指定页跳转、当前页变化 |
| `url-query` | page 参数、结果列表 | URL 与列表同时变化 |
| `infinite-scroll` | 滚动容器、加载 marker、列表长度 | 列表增长且无重复 |
| `load-more` | 加载更多按钮、列表长度 | 点击后列表增长或终止 |

### 10.2 分页不能只用 sleep

错误示例：

```ts
await nextButton.click();
await page.waitForTimeout(1200);
```

正确思路：在点击前保存页面特征，点击后等待至少两个独立变化：

```ts
const oldPage = await currentPage.textContent();
const oldFirst = await firstResult.getAttribute('href');

await Promise.all([
  waitForLoadingToDisappear(),
  nextButton.click()
]);

await page.waitForFunction(
  ({ oldPage, oldFirst }) => {
    const pageText = document.querySelector('.pagination .active')?.textContent?.trim();
    const firstHref = document.querySelector('.result-row:first-child a')?.getAttribute('href');
    return pageText !== oldPage && firstHref !== oldFirst;
  },
  { oldPage, oldFirst }
);
```

### 10.3 “无结果”与“失败”必须区分

| 页面情况 | 正确状态 |
|---|---|
| 空状态 marker 命中且没有结果行 | `no-result` |
| 请求超时、DNS 错误、页面崩溃 | `failed` |
| 登录页、会话失效、验证码、CA/UKey | `manual-review-required` |
| 结果容器变化但 selector 不再命中 | `drifted` / `manual-review-required` |
| 平台维护、频率限制、访问被拒绝 | `manual-review-required` 或 `failed`，保留原因 |

不要因为 `resultLink.count() === 0` 就直接判定 `no-result`；必须先确认 no-result marker，或确认页面没有错误/登录/验证码状态。

---

## 11. 验收场景与通过门槛

### 11.1 每站最低场景集

| 编号 | 场景 | 通过标准 |
|---|---|---|
| S1 | 入口页 | 页面可打开，入口截图/HTML/Trace 已保存 |
| S2 | 命中检索 | 搜索框、提交、结果行和详情链接均正确 |
| S3 | 无结果检索 | 明确识别空状态，不误判页面错误 |
| S4 | 分页 | 至少验证 1→2→末页或等价行为 |
| S5 | 详情页 | 至少 3 条不同公告，标题/正文/证据正确 |
| S6 | 会话检查 | 公共平台验证匿名；受限平台验证登录、失效或边界 |
| S7 | 人工边界 | CAPTCHA / SMS / QR / CA/UKey / 频率限制有明确停止行为 |
| S8 | 重启回放 | 重启浏览器或 Host 后按平台规则验证会话复用 |

### 11.2 通过阈值

建议最低要求：

```text
关键 locator 唯一命中率：100%
搜索命中回放：连续 3 次成功
无结果回放：连续 3 次正确识别
分页：至少 3 次完整验证
详情页：至少 3 条不同公告成功
登录复用：至少 1 次 Host/浏览器重启验证
失效识别：至少 1 次人工触发或可控模拟
未预期异常：0 个未分类
敏感信息提交 Git：0 项
```

### 11.3 验收结论

| 结论 | 适用条件 |
|---|---|
| `verified` | 全部标准场景通过，审批完成 |
| `manual-only` | 搜索或详情关键路径必须由 CA/UKey 或其他人工步骤完成 |
| `candidate` | selector 已录制，但回放次数不足或业务未复核 |
| `rejected` | 页面不稳定、规则不允许、风险不可接受或无法可靠区分结果状态 |
| `drifted` | 曾验证但当前回放/漂移检查失败 |

---

## 12. 漂移检测与版本管理

### 12.1 触发条件

以下任一情况触发漂移检查：

- 生产任务连续两次 `manual-review-required`；
- locator 命中数异常；
- 搜索成功但结果页为空且 no-result marker 不命中；
- 当前页码、首条结果、详情 URL 等稳定标识无法读取；
- 登录 marker 与历史行为冲突；
- 平台公告、维护提示或访问频率策略改变；
- 用户主动报告页面改版。

### 12.2 漂移检查最小动作

```text
打开入口
→ 截图 + HTML + Trace
→ 检查登录 / 人工边界 marker
→ 检查搜索 input / submit 唯一性
→ 使用脱敏测试查询执行一次
→ 检查结果容器、首条结果、分页、详情入口
→ 生成 DOM 指纹差异
→ 标记 verified / drifted
```

### 12.3 版本规则

建议 adapter 版本使用：

```text
YYYY.MM.DD.N
```

例如：

```text
2026.07.07.1  首次验收
2026.07.20.1  页面改版后 selector 修复
2026.08.03.1  分页逻辑更新
```

每次 fixture 变更必须更新：

- `adapterVersion`；
- 录制日期；
- 变更原因；
- 回放结果；
- 审批记录；
- DOM 指纹版本或差异摘要。

---

## 13. 九个平台的推荐推进顺序

不要一开始处理 CA/UKey 平台。先用公共平台把 Recorder、分页和详情取证打磨成熟。

### 第一批：公共平台

| 平台 ID | 平台 | 访问方式 | 首批验收重点 |
|---|---|---|---|
| `cebpubservice` | 中国招标投标公共服务平台 | public | 列表、详情、分页、公告时间 |
| `gd-govprocurement` | 广东省政府采购网 | public | 搜索、空状态、详情、分页 |
| `gd-public-resources` | 广东省公共资源交易平台 | public | 页面跳转、公告类型、详情入口 |

目标：完成 Recorder 基础、结果页、无结果、分页、详情证据和漂移检查样板。

### 第二批：普通账号平台

| 平台 ID | 平台 | 访问方式 | 首批验收重点 |
|---|---|---|---|
| `cmcc` | 中国移动电子采购与招投标系统 | manual-login | 人工登录、会话复用、搜索、详情 |
| `unicom` | 中国联通合作方门户 | manual-login | 登录态、列表分页、结果字段 |
| `telecom` | 中国电信电子采购平台 | manual-login | 会话失效、跳转、详情 |
| `miit` | 工信部通信工程建设项目招标投标管理信息平台 | manual-login | 登录/权限边界、公告检索 |
| `tower-online-commerce` | 中国铁塔在线商务平台 | manual-login | 登录与业务页面定位 |

目标：完成 Profile 生命周期、登录态 marker、会话失效和人工重新登录提醒。

### 第三批：CA/UKey 平台

| 平台 ID | 平台 | 访问方式 | 首批验收重点 |
|---|---|---|---|
| `tower-eprocurement` | 中国铁塔电子采购平台 | ca-login | CA/UKey marker、人工边界、边界前取证 |

目标：明确哪些页面可以自动访问，哪些页面必须停在人工边界，不尝试自动签名或自动绕过证书验证。

---

## 14. 建议的 CLI / API 设计（待实现）

以下接口是建议设计，避免未来 Recorder 能力散落进 UI 逻辑。当前仓库尚未实现。

### 14.1 CLI

```bash
# 开启可见浏览器并建立录制会话
npm run adapter:record -- gd-govprocurement

# 对候选 fixture 执行标准场景回放
npm run adapter:replay -- gd-govprocurement --fixture packages/agent-host/fixtures/gd-govprocurement.json

# 生成报告并检查是否达到 accepted 门槛
npm run adapter:accept -- gd-govprocurement --run <acceptance-run-id>

# 无账号变更情况下执行漂移检查
npm run adapter:drift-check -- gd-govprocurement
```

### 14.2 本地 Host API

```text
POST /api/platforms/:platformId/recordings
GET  /api/platform-recordings/:recordingId
POST /api/platform-recordings/:recordingId/steps/:stepId/capture
POST /api/platform-recordings/:recordingId/manual-boundaries
POST /api/platform-recordings/:recordingId/replay
POST /api/platform-recordings/:recordingId/accept
GET  /api/platforms/:platformId/drift
POST /api/platforms/:platformId/drift-check
```

所有接口必须沿用 Host 的 localhost bearer token，不允许开放到局域网或公网。

### 14.3 Pi Agent 的职责边界

Pi Agent 可以帮助：

- 将页面文本归纳为候选字段；
- 比较两次 DOM 指纹差异；
- 解释失败日志；
- 建议 locator 优先级；
- 生成验收报告摘要。

Pi Agent 不可以：

- 代替用户完成登录；
- 决定绕过 CAPTCHA、短信、QR 或 CA/UKey；
- 在没有可验证证据时把 adapter 标记为 `verified`；
- 将 Profile、Cookie、截图原件或 HTML 原件发送到外部模型；
- 自行修改生产 fixture 并直接发布。

---

## 15. 安全、隐私与数据分级

### 15.1 数据分级

| 等级 | 示例 | 默认处理 |
|---|---|---|
| L0 | 平台名称、公开入口 URL、adapter 版本 | 可提交 Git |
| L1 | 脱敏 selector、DOM 指纹、验收统计 | 可提交 Git，经审核 |
| L2 | 公告 HTML、截图、公开 PDF、Trace | 默认仅本机保留 |
| L3 | Cookie、账号、短信、二维码、CA/UKey、受限文件 | 禁止提交、禁止外发、仅系统安全存储或不保存 |

### 15.2 企业微信通知边界

企业微信只发送：

```text
平台名称
任务状态
命中数 / 人工复核数 / 失败数
需要重新登录或页面漂移的提示
本机证据包标识
```

不发送：

```text
截图原件
HTML 原件
Cookie
完整敏感公告内容
Profile 路径
账号信息
验证码
CA/UKey 信息
```

---

## 16. 常见问题与处置

### Q1：selector 能命中，但结果一直是空，应该标记 no-result 吗？

不能。先检查：

1. 是否跳转到登录页；
2. 是否出现验证码、频率限制或维护提示；
3. 是否仍在 loading；
4. 是否有 no-result marker；
5. 查询条件是否被页面自动清空或改写；
6. 是否需要选择公告类型、时间范围或区域。

只有明确命中 no-result marker 且没有异常状态时，才返回 `no-result`。

### Q2：页面是 React/Vue 单页应用，URL 不变怎么办？

使用结果容器重渲染、loading 结束、首条结果变化、当前页变化等 DOM 条件；不要依赖 URL 改变。

### Q3：平台结果页在 iframe 中怎么办？

fixture 必须录制 iframe 定位规则，例如 iframe URL、name 或稳定容器；回放时通过 Playwright `frameLocator` 进入。若 iframe 来自不受信任域或页面跨域策略导致不能稳定访问，降级为人工复核。

### Q4：详情点击会新开窗口怎么办？

录制时标记 `detail.navigation = popup`，回放用 `context.waitForEvent('page')` 等待新页面；不要假设始终在同一 tab。

### Q5：搜索需要复杂筛选条件怎么办？

将筛选项明确建模为固定字段，例如公告类型、时间范围、区域、采购方式。不要让 LLM 临时猜测筛选条件，也不要默认扩大查询范围。

### Q6：CA/UKey 之后的页面还能自动抓取吗？

可以，但前提是：账号持有人已手工完成 CA/UKey 操作，页面进入可读取状态；fixture 必须把 CA/UKey 前后的边界明确记录。系统不执行签名、不触发证书选择、不复制 UKey 会话。

### Q7：页面改版后应该直接修改生产 fixture 吗？

不能。先创建新录制会话，形成新 adapter version，完成回放和审批，再替换旧 fixture。原版本与报告必须保留以便审计。

---

## 17. 平台验收报告模板

每个平台每个版本至少提交一份脱敏验收报告。

```markdown
# 平台适配器验收报告

- 平台：
- Platform ID：
- Adapter Version：
- 验收日期：
- 录制环境：公司授权网络 / 测试设备标识
- 技术验收人：
- 账号持有人：
- 业务复核人：
- 审批人：

## 访问边界

- Access mode：public / manual-login / ca-login
- 是否需要登录：
- 是否支持 Profile 复用：
- CAPTCHA / QR / SMS 边界：
- CA/UKey / 原生签名器边界：
- 自动化允许范围：

## 场景结果

| 场景 | 查询样本 | 结果 | 证据目录 | 备注 |
|---|---|---|---|---|
| S1 入口页 | - | pass/fail | | |
| S2 命中检索 | | pass/fail | | |
| S3 无结果 | | pass/fail | | |
| S4 分页 | | pass/fail | | |
| S5 详情页 | | pass/fail | | |
| S6 会话检查 | | pass/fail | | |
| S7 人工边界 | | pass/fail | | |
| S8 重启回放 | | pass/fail | | |

## Locator 摘要

- 搜索框：
- 搜索按钮：
- 结果行：
- 详情链接：
- 当前页：
- 下一页：
- 无结果 marker：
- authenticated marker：
- login / expired marker：

## 证据与安全检查

- Trace 已保留在本机：是 / 否
- 截图/HTML 已保留在本机：是 / 否
- Git 提交仅包含脱敏 fixture 与报告：是 / 否
- 未提交 Cookie、账号、验证码、CA/UKey 或受限文件：是 / 否

## 结论

- [ ] verified
- [ ] manual-only
- [ ] candidate
- [ ] rejected
- [ ] drifted

原因与后续动作：
```

---

## 18. 首站落地建议

第一站建议使用 `cebpubservice`、`gd-govprocurement` 或 `gd-public-resources` 之一，而不是先处理运营商账号或 CA/UKey 平台。

推荐顺序：

```text
1. 建立公共平台 Profile-free 的录制流程
2. 跑通入口 → 搜索命中 → 无结果 → 分页 → 详情
3. 生成第一份 fixture 与验收报告
4. 增加回放和漂移检查
5. 再进入 manual-login 平台
6. 最后处理 CA/UKey 平台
```

首站验收完成后，应把录制流程中的实际问题反写到本文和 Recorder 代码中，再复制给其余八站。这样比一次性编写九套未验证 selector 更可靠，也更便于长期维护。
