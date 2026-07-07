# Pi 模型安全 Profile

模型不是普通的环境变量开关。它包含 API 凭证、网络出站边界、数据可见范围、模型调用次数和工具权限，因此和企业微信一样通过 `.env → local:config:apply → Keychain/SQLite` 初始化。

## 配置流

```text
.env
  ├─ TENDER_LLM_* bootstrap 值
  │
  └─ npm run local:config:apply
       ├─ macOS Keychain：llm-api-key:<profile>
       ├─ SQLite settings：非敏感模型 Profile
       └─ Pi ModelProfileRuntime：运行时读取 Keychain CredentialStore
```

API Key 不进入 SQLite、日志、运行事件、企业微信或 Git。Pi Agent 使用 `Models.streamSimple()` 和受限 CredentialStore 发起请求，不依赖把 Key 注入全局环境变量。

## 默认策略

```dotenv
TENDER_LLM_ENABLED=false
TENDER_LLM_MODE=disabled
TENDER_LLM_DATA_POLICY=metadata-only
```

默认完全不用模型，任务仍按所有 `query × platform` 组合确定性执行。

启用 `orchestrate` 后，模型只看到：

- 用户给定查询词；
- 平台 ID；
- 工具执行状态与脱敏摘要。

模型不会看到：

- 截图、HTML、PDF、Trace；
- 浏览器 Profile、Cookie、Storage、账号或密码；
- 本机绝对路径；
- 企业微信或模型 API Key；
- CA/UKey、二维码、短信、验证码内容。

## 两类 Provider

### 1. Pi 内置 Provider：外部服务

```dotenv
TENDER_LLM_ENABLED=true
TENDER_LLM_MODE=orchestrate
TENDER_LLM_PROFILE=deepseek-production
TENDER_LLM_PROVIDER_KIND=builtin
TENDER_LLM_PROVIDER=deepseek
TENDER_LLM_MODEL=<Pi 内置 catalog 支持的模型 ID>
TENDER_LLM_AUTH_MODE=keychain
TENDER_LLM_API_KEY=<仅本机 bootstrap 值>
TENDER_LLM_EGRESS_POLICY=external-approved
TENDER_LLM_DATA_POLICY=metadata-only
```

内置 Provider 使用 Pi 的内置 catalog；外部服务必须显式设置 `external-approved`，不能以 `local-only` 或 `internal-only` 伪装。

### 2. OpenAI-compatible：本机、内网或批准的网关

适用于 vLLM、Ollama、公司模型网关或符合 OpenAI Chat Completions 的服务。

#### 本机无鉴权服务

```dotenv
TENDER_LLM_ENABLED=true
TENDER_LLM_MODE=orchestrate
TENDER_LLM_PROFILE=local-vllm
TENDER_LLM_PROVIDER_KIND=openai-compatible
TENDER_LLM_PROVIDER=local-vllm
TENDER_LLM_MODEL=<服务端模型 ID>
TENDER_LLM_AUTH_MODE=none
TENDER_LLM_EGRESS_POLICY=local-only
TENDER_LLM_BASE_URL=http://127.0.0.1:8000/v1
TENDER_LLM_DATA_POLICY=metadata-only
```

#### 公司内网网关

```dotenv
TENDER_LLM_ENABLED=true
TENDER_LLM_MODE=orchestrate
TENDER_LLM_PROFILE=corp-gateway
TENDER_LLM_PROVIDER_KIND=openai-compatible
TENDER_LLM_PROVIDER=corp-gateway
TENDER_LLM_MODEL=<批准的模型 ID>
TENDER_LLM_AUTH_MODE=keychain
TENDER_LLM_API_KEY=<仅本机 bootstrap 值>
TENDER_LLM_EGRESS_POLICY=internal-only
TENDER_LLM_BASE_URL=https://llm-gateway.example.internal/v1
TENDER_LLM_ALLOWED_HOSTS=llm-gateway.example.internal
TENDER_LLM_DATA_POLICY=metadata-only
```

`internal-only` 要求 Base URL 的 hostname 精确出现在 `TENDER_LLM_ALLOWED_HOSTS`。`external-approved` 的非 loopback endpoint 必须使用 HTTPS。

## 应用与检查

```bash
npm run local:config:apply
npm run local:config:doctor
```

`apply` 不会调用任何模型，不会产生外发或计费。

## 显式连通性测试

```bash
npm run local:config -- test-model --confirm-model-egress
```

该命令只发送一个固定的非业务健康请求：要求模型回复 `OK`。它会受到当前 egress policy、Keychain 和 Profile 配置约束。输出不包含模型回复全文、API Key 或请求上下文。

## 运行时守卫

- 工具仅允许调用用户请求的 `platformId + query` 对；
- 重复 pair 被阻断；
- 未完成的 pair 由确定性执行器补齐；
- 模型调用轮次超过 `TENDER_LLM_MAX_REQUESTS_PER_RUN` 时中止模型编排并补齐；
- 传给模型的 pair 元数据超过 `TENDER_LLM_MAX_INPUT_CHARS` 时应跳过模型编排，不截断查询词；
- 未通过平台访问策略的工具调用仍被 `beforeToolCall` 阻断；
- CAPTCHA、SMS、QR、CA/UKey 与原生签名器仍是人工边界。

## 清除模型凭证与 Profile

```bash
npm run local:config -- clear-model --confirm-clear-model
```

该命令删除当前 Profile 对应的 Keychain API Key 与 SQLite 模型 Profile。它不修改 `.env`；若需彻底移除 bootstrap 值，请手工清空 `.env` 中的 `TENDER_LLM_*` 密钥字段。
