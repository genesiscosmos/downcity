# Downcity Model Protocol 设计

> 状态：已实施
>
> 适用范围：`@downcity/type`、`@downcity/federation`、`@downcity/agent`、Provider Adapter 与相关 HTTP 客户端
>
> 目标：使用 Downcity 自有模型协议与推理运行时，一次性替换 AI SDK 在核心领域、网络传输和 Provider 执行边界中的协议所有权

## 1. 结论

Downcity 应拥有从 Agent 推理到 Federation Provider 执行的完整模型协议。AI SDK、pi-ai 和厂商 SDK 只作为设计参考或可选边界 Adapter，不再定义 Downcity 的消息、工具、模型、流、usage、错误或 transport。

最终依赖方向：

```text
@downcity/type（Model Protocol）
        ↑
@downcity/federation（Model Client + Transport + AIService + Provider Adapter）
        ↑
@downcity/agent（Session + Model Runner + Tool Loop）
```

核心执行链：

```text
SessionUserContent
  → canonical SessionMessage
  → SessionModelMessages
  → ModelCall
  → ModelClient.stream()
  → Federation /v1/ai/stream
  → Model Router / Fallback / Reasoning
  → AIChannel
  → Provider Adapter
  → ModelStreamEvent
  → Agent ModelStepRunner
  ├→ StepEventCollector → ModelMessage（仅供 Tool Loop 的后续 step）
  └→ SessionAssistantOutput → canonical SessionMessage + SessionMutation
```

本次不提供旧 `LanguageModelV3` transport 的双栈兼容，不保留 AI SDK 作为核心执行后端，也不先对现有 Federation fallback 做局部修复。

## 2. 产品意图与领域职责

### 2.1 Model Protocol

Model Protocol 回答：一次模型调用包含什么，以及模型执行如何以稳定、可传输、与厂商无关的方式返回结果。

它拥有以下稳定概念：

- 模型消息与内容。
- 模型调用参数。
- 工具定义、工具调用与工具结果。
- 推理配置。
- 流事件。
- 完成原因、usage 与错误。

它不拥有：

- Session 持久化与 UI 时间线。
- Agent 的工具实现与工具执行生命周期。
- Federation 的模型目录、fallback、计费与鉴权。
- Provider 的私有请求字段。

### 2.2 Agent

Agent 拥有持续对话、上下文构造、模型 step、工具执行循环和 Session 输出投影。

Agent 负责：

- 将 `SessionMessage` 转换为 `ModelMessage`。
- 构造 `ModelCall`。
- 消费 `ModelStreamEvent`。
- 聚合 assistant 消息。
- 执行工具并追加 `tool_result`。
- 根据完成原因决定结束或进入下一 step。
- 将模型流直接写入 canonical Session Message，并发布 Session Mutation。

Agent 不负责：

- 根据媒体能力切换 Federation 模型。
- 解析 Provider 私有字段。
- 计费和服务端模型可用性判断。

### 2.3 Federation

Federation 拥有模型目录、模型选择、执行策略、服务端配置、计量与计费。

Federation 负责：

- 校验和解码 `ModelCall`。
- 解析初始模型。
- 根据最新用户消息执行 fallback。
- 校验目标模型和环境变量可用性。
- 解析最终模型的 reasoning。
- 调用目标 `AIChannel`。
- 记录 metering、usage、fallback metadata 和账单。
- 将 `ModelStreamEvent` 编码为 SSE。

Federation 不执行调用方工具，不维护 Agent step 循环。

### 2.4 Provider Adapter

Provider Adapter 负责在 Downcity Protocol 和单个上游协议之间转换。

```text
ModelCall → Provider Request
Provider Stream → ModelStreamEvent
```

Adapter 不负责 fallback、计费、Session 状态或工具执行。

## 3. 协议包与公开边界

协议类型统一放入 `@downcity/type`：

```text
packages/type/src/types/model/
├── ModelCall.ts
├── ModelContent.ts
├── ModelError.ts
├── ModelMessage.ts
├── ModelResult.ts
├── ModelStreamEvent.ts
├── ModelTool.ts
├── ModelUsage.ts
└── index.ts
```

所有协议字段使用 `snake_case`。所有类型及字段必须具有中文文档注释。

协议只使用可移植的 TypeScript/JSON 概念，不从 `ai`、`@ai-sdk/*` 或 Provider SDK 导入类型。

### 3.1 JSON 值

```ts
export type ModelJsonValue =
  | string
  | number
  | boolean
  | null
  | ModelJsonValue[]
  | { [key: string]: ModelJsonValue };
```

除进程内取消信号和流对象外，公开协议字段必须可直接序列化为 JSON。

## 4. 消息协议

### 4.1 ModelMessage

```ts
export interface ModelMessage {
  /** 消息在模型上下文中的角色。 */
  role: "system" | "user" | "assistant" | "tool";

  /** 按原始上下文顺序排列的消息内容。 */
  content: ModelContent[];
}
```

不变量：

- `content` 必须是数组且至少包含一个合法内容。
- `system` 只允许文本内容。
- `user` 允许文本和文件内容。
- `assistant` 允许文本、推理和工具调用内容。
- `tool` 只允许工具结果内容。
- 未知内容类型在 HTTP 边界被拒绝，不能静默透传。

### 4.2 文本内容

```ts
export interface ModelTextContent {
  /** 内容判别字段。 */
  type: "text";

  /** 非空文本内容。 */
  text: string;
}
```

### 4.3 文件内容

```ts
export interface ModelFileContent {
  /** 内容判别字段。 */
  type: "file";

  /** 文件的 IANA MIME 类型。 */
  media_type: string;

  /** 文件内容来源。 */
  source: ModelFileSource;

  /** 可选原始文件名。 */
  filename?: string;
}

export type ModelFileSource = ModelFileUrlSource | ModelFileBase64Source;

export interface ModelFileUrlSource {
  /** URL 来源判别字段。 */
  type: "url";

  /** 可由 Provider 读取的绝对 HTTP 或 HTTPS URL。 */
  url: string;
}

export interface ModelFileBase64Source {
  /** 内联数据来源判别字段。 */
  type: "base64";

  /** 不包含 Data URL 前缀的 Base64 内容。 */
  data: string;
}
```

不变量：

- `media_type` 必须是非空字符串。
- `url` 仅允许 `http:` 和 `https:`。
- Base64 不包含 `data:<mime>;base64,` 前缀，MIME 类型只存在于 `media_type`。
- 一个文件只能有一个 source，不能同时携带 URL 和内联数据。
- 本地文件读取与 Base64 化由 Agent 的附件映射器完成，不由 Federation 访问 Agent 文件系统。

### 4.4 推理内容

```ts
export interface ModelReasoningContent {
  /** 内容判别字段。 */
  type: "reasoning";

  /** Provider 允许返回给调用方的推理文本。 */
  text: string;

  /** Provider 用于后续对话续接的可选不透明签名。 */
  signature?: string;
}
```

`signature` 仅用于同一 Provider 的后续上下文恢复。其它 Provider 可以忽略无法理解的签名；Federation 不解析签名内容。

### 4.5 工具调用内容

```ts
export interface ModelToolCallContent {
  /** 内容判别字段。 */
  type: "tool_call";

  /** 单次模型上下文内稳定且唯一的工具调用 ID。 */
  tool_call_id: string;

  /** 工具名称。 */
  tool_name: string;

  /** 已完成 JSON 解析的工具输入。 */
  input: ModelJsonValue;
}
```

流式参数片段只存在于流事件。写入最终 `ModelMessage` 的工具调用必须已经形成完整合法 JSON。

### 4.6 工具结果内容

```ts
export interface ModelToolResultContent {
  /** 内容判别字段。 */
  type: "tool_result";

  /** 对应工具调用 ID。 */
  tool_call_id: string;

  /** 对应工具名称。 */
  tool_name: string;

  /** 工具执行结果。 */
  outcome: "succeeded" | "failed";

  /** 返回给模型的有序结果内容。 */
  content: ModelToolResultPart[];
}

export type ModelToolResultPart =
  | ModelTextContent
  | ModelFileContent
  | ModelJsonContent;

export interface ModelJsonContent {
  /** 内容判别字段。 */
  type: "json";

  /** 可传输的结构化 JSON 值。 */
  value: ModelJsonValue;
}
```

## 5. 工具协议

```ts
export interface ModelTool {
  /** 本次调用内唯一的工具名称。 */
  name: string;

  /** 面向模型的工具用途说明。 */
  description: string;

  /** 工具输入 JSON Schema。 */
  input_schema: Record<string, ModelJsonValue>;
}

export type ModelToolChoice =
  | { type: "auto" }
  | { type: "none" }
  | { type: "required" }
  | { type: "tool"; tool_name: string };
```

工具定义不携带 `execute` 函数。Agent 的工具注册表按名称持有运行时实现，`ModelCall` 只携带模型可见定义。

## 6. 模型调用

### 6.1 领域调用

```ts
export interface ModelCall {
  /** 按模型上下文顺序排列的完整消息。 */
  messages: ModelMessage[];

  /** 本轮可供模型调用的工具。 */
  tools?: ModelTool[];

  /** 本轮工具选择策略。 */
  tool_choice?: ModelToolChoice;

  /** 最大输出 token 数。 */
  max_output_tokens?: number;

  /** 采样温度。 */
  temperature?: number;

  /** nucleus sampling 参数。 */
  top_p?: number;

  /** 候选 token 数限制。 */
  top_k?: number;

  /** presence penalty。 */
  presence_penalty?: number;

  /** frequency penalty。 */
  frequency_penalty?: number;

  /** 按顺序匹配的停止序列。 */
  stop_sequences?: string[];

  /** 可选确定性采样种子。 */
  seed?: number;

  /** 用户可请求的推理设置。 */
  reasoning?: ModelReasoningRequest;
}

export interface ModelReasoningRequest {
  /** 是否启用模型推理。 */
  enabled: boolean;

  /** 用户选择的可选推理强度。 */
  effort?: string;
}
```

`model_id` 不属于领域 `ModelCall`，而属于一次对 Federation 模型目录的执行请求。这样同一调用可以由路由层选择不同模型，而不会修改消息协议。

### 6.2 HTTP 请求

```ts
export const MODEL_PROTOCOL_VERSION = 1 as const;

export interface ModelStreamRequest {
  /** Downcity Model Protocol 版本。 */
  protocol_version: typeof MODEL_PROTOCOL_VERSION;

  /** 用户选择的 Federation 模型 ID。 */
  model_id: string;

  /** 标准模型调用。 */
  call: ModelCall;
}
```

HTTP 路径继续使用：

```text
POST /v1/ai/stream
```

路径表达稳定业务能力，不携带底层实现版本。协议版本由 body 显式声明。

### 6.3 取消信号

`AbortSignal` 不进入 JSON 协议。Agent 取消 HTTP 请求后，Federation 将请求 signal 绑定到 Provider Adapter；Provider Adapter 必须尽力取消上游请求。

## 7. Fallback

Fallback 是 Federation Model Router 的内部策略，输入是 `ModelCall` 和初始模型。

```ts
export interface AIModelFallbackRule {
  /** 判断最新用户消息中的单个文件是否需要切换模型。 */
  match: (file: ModelFileContent) => boolean;

  /** fallback 目标 Federation 模型 ID。 */
  model_id: string;
}
```

执行顺序：

1. 从 `call.messages` 末尾向前查找第一条 `role === "user"` 的合法消息。
2. 不存在 user 消息时使用原模型。
3. 按模型配置顺序遍历 fallback rule。
4. 对每条 rule，按最新 user 的 content 顺序遍历 `file`。
5. `match(file)` 抛错视为不匹配。
6. 目标模型不存在、等于原模型、不支持语言流或环境不可用时继续查找。
7. 首个完整可用的匹配计划成为最终模型。
8. 完整 `ModelCall` 原样交给最终模型，不裁剪历史媒体。

命中时 metering metadata 保持：

```json
{
  "fallback_from": "deepseek-v4-flash",
  "fallback_reason": "input_requires_media",
  "fallback_media_type": "image/png"
}
```

未命中时不得写入上述字段。

## 8. 流协议

### 8.1 设计原则

- 事件表达 Downcity 语义，不透传 Provider chunk。
- 每个可增量内容使用稳定 `content_id`。
- 同一 `content_id` 必须遵循 start → delta* → finish。
- 工具输入可以增量传输，但 finish 时必须提供解析后的完整 JSON。
- usage 是独立事件，finish 必须携带最终完成原因。
- 流在 `finish` 后不得继续产生内容事件。
- 请求失败使用结构化 error 事件；HTTP 建立前的校验错误使用标准 HTTP JSON 错误。

### 8.2 事件类型

```ts
export type ModelStreamEvent =
  | ModelStartEvent
  | ModelTextStartEvent
  | ModelTextDeltaEvent
  | ModelTextFinishEvent
  | ModelReasoningStartEvent
  | ModelReasoningDeltaEvent
  | ModelReasoningFinishEvent
  | ModelToolCallStartEvent
  | ModelToolCallDeltaEvent
  | ModelToolCallFinishEvent
  | ModelUsageEvent
  | ModelFinishEvent
  | ModelErrorEvent;
```

```ts
export interface ModelStartEvent {
  /** 事件判别字段。 */
  type: "model_start";

  /** Federation 生成的稳定请求 ID。 */
  request_id: string;

  /** 实际执行的最终模型 ID。 */
  model_id: string;
}

export interface ModelTextStartEvent {
  /** 事件判别字段。 */
  type: "text_start";

  /** 当前文本块的稳定 ID。 */
  content_id: string;
}

export interface ModelTextDeltaEvent {
  /** 事件判别字段。 */
  type: "text_delta";

  /** 当前文本块的稳定 ID。 */
  content_id: string;

  /** 本次新增文本。 */
  delta: string;
}

export interface ModelTextFinishEvent {
  /** 事件判别字段。 */
  type: "text_finish";

  /** 当前文本块的稳定 ID。 */
  content_id: string;
}
```

reasoning 事件与 text 事件结构一致，额外允许 `reasoning_finish.signature`。

```ts
export interface ModelToolCallStartEvent {
  /** 事件判别字段。 */
  type: "tool_call_start";

  /** 当前工具调用内容块的稳定 ID。 */
  content_id: string;

  /** Provider 或 Adapter 生成的稳定工具调用 ID。 */
  tool_call_id: string;

  /** 工具名称。 */
  tool_name: string;
}

export interface ModelToolCallDeltaEvent {
  /** 事件判别字段。 */
  type: "tool_call_delta";

  /** 当前工具调用内容块的稳定 ID。 */
  content_id: string;

  /** Provider 返回的 JSON 文本增量。 */
  input_delta: string;
}

export interface ModelToolCallFinishEvent {
  /** 事件判别字段。 */
  type: "tool_call_finish";

  /** 当前工具调用内容块的稳定 ID。 */
  content_id: string;

  /** 完整且已解析的工具输入。 */
  input: ModelJsonValue;
}
```

### 8.3 完成原因

```ts
export type ModelFinishReason =
  | "stop"
  | "length"
  | "tool_call"
  | "content_filter"
  | "cancelled"
  | "error"
  | "unknown";
```

```ts
export interface ModelFinishEvent {
  /** 事件判别字段。 */
  type: "model_finish";

  /** 标准化完成原因。 */
  finish_reason: ModelFinishReason;
}
```

### 8.4 Usage

```ts
export interface ModelUsage {
  /** 输入 token 数量。 */
  input_tokens: number;

  /** 输出 token 数量。 */
  output_tokens: number;

  /** 输入与输出 token 总数。 */
  total_tokens: number;

  /** 输入缓存命中 token 数量。 */
  cached_input_tokens?: number;

  /** 输入缓存写入 token 数量。 */
  cache_write_tokens?: number;

  /** 输出中的推理 token 数量。 */
  reasoning_tokens?: number;
}

export interface ModelUsageEvent {
  /** 事件判别字段。 */
  type: "model_usage";

  /** Provider Adapter 标准化后的累计 usage。 */
  usage: ModelUsage;
}
```

usage 使用累计值，不使用 delta，避免 Provider 重试或多个原始 usage chunk 导致重复计数。一次成功计费的模型执行必须在 `model_finish` 前提供最终可信 usage；缺少可信 usage 时本次结算标记为失败，不能猜测 token。

## 9. 错误协议

```ts
export type ModelErrorCode =
  | "invalid_request"
  | "authentication_failed"
  | "permission_denied"
  | "model_unavailable"
  | "rate_limited"
  | "context_length_exceeded"
  | "content_rejected"
  | "provider_timeout"
  | "provider_error"
  | "transport_error"
  | "cancelled"
  | "internal_error";

export interface ModelError {
  /** Downcity 稳定错误代码。 */
  code: ModelErrorCode;

  /** 可安全展示给调用方的错误说明。 */
  message: string;

  /** 调用方是否可以安全重试。 */
  retryable: boolean;

  /** 可选上游 HTTP 状态码。 */
  status_code?: number;

  /** 可选上游请求 ID。 */
  provider_request_id?: string;
}

export interface ModelErrorEvent {
  /** 事件判别字段。 */
  type: "model_error";

  /** 标准化模型错误。 */
  error: ModelError;
}
```

Provider 原始错误、响应体和密钥相关信息只进入服务端受控日志，不能写入协议错误。

## 10. SSE Wire Format

每个 SSE event 只使用 `data:`，内容为单个 `ModelStreamEnvelope` JSON：

```ts
export interface ModelStreamEnvelope {
  /** Downcity Model Protocol 版本。 */
  protocol_version: typeof MODEL_PROTOCOL_VERSION;

  /** 当前标准流事件。 */
  event: ModelStreamEvent;
}
```

示例：

```text
data: {"protocol_version":1,"event":{"type":"model_start","request_id":"req_1","model_id":"gpt-5.6-luna"}}

data: {"protocol_version":1,"event":{"type":"text_start","content_id":"text_1"}}

data: {"protocol_version":1,"event":{"type":"text_delta","content_id":"text_1","delta":"这是一只猫"}}

data: {"protocol_version":1,"event":{"type":"text_finish","content_id":"text_1"}}

data: {"protocol_version":1,"event":{"type":"model_usage","usage":{"input_tokens":1200,"output_tokens":12,"total_tokens":1212}}}

data: {"protocol_version":1,"event":{"type":"model_finish","finish_reason":"stop"}}
```

客户端必须拒绝未知协议版本。对于已知版本中的未知事件类型，客户端将其视为协议错误，不能静默忽略影响状态机的事件。

## 11. Agent 推理运行时

### 11.1 组件

```text
SessionModelMessages
  SessionMessage → ModelMessage

ModelCallBuilder
  system + messages + tools + options → ModelCall

ModelClient
  stream(call, signal) → AsyncIterable<ModelStreamEvent>

StepEventCollector
  聚合 assistant ModelMessage，仅供当前 Tool Loop 构造后续 step

ToolLoop
  执行 tool_call，追加 tool_result，决定下一 step

SessionAssistantOutput
  ModelStreamEvent → canonical SessionMessage + SessionMutation

ModelStepResult
  assistant_message + usage + finish_reason + tool_calls
```

### 11.2 Step 状态机

```text
prepare
  → streaming
  → completed(stop/length/content_filter)
  → awaiting_tools(tool_call)
  → executing_tools
  → prepare next step

streaming
  → failed(model_error / protocol_error / transport_error)
  → cancelled
```

不变量：

- 一次 Provider 调用只对应一个 model step。
- Federation 不执行 Agent 工具。
- 工具调用先作为 assistant message 写入上下文，工具结果随后作为 tool message 写入。
- 工具执行顺序沿用当前产品语义；如支持并发，必须由 ToolLoop 显式声明并保持确定性落盘顺序。
- `model_finish: tool_call` 但没有完整工具调用属于协议错误。
- 收到工具调用但工具未注册时，Agent 生成失败的 `tool_result`，由下一 step 交给模型处理；不由 Federation 判定业务工具是否存在。
- 达到最大 step 数时 Agent 以明确错误结束，不能无限循环。

### 11.3 Session 与 Model 消息分离

`SessionMessage` 是持久化与 UI 时间线的唯一事实源，允许包含 action、interaction、错误等 Model Protocol 不需要的内容。

`SessionModelMessages` 是从 Session 历史进入模型上下文的唯一转换边界：

- 过滤不应发送给模型的 Session Message 与 Part。
- 将 User Context Part 的原始 `tag + context` 安全渲染为带标签的 `ModelTextContent`。
- 注入附件。
- 将本地文件读取并转为 `ModelFileContent`。
- 忽略或修复策略必须显式测试，不能依赖第三方转换器的隐式容错。

模型输出不存在反向 codec 或 UI 中间协议。同一组已校验的 `ModelStreamEvent` 有两个职责独立的消费者：

- `StepEventCollector` 聚合本 step 的 assistant `ModelMessage`，只用于工具循环继续构造进程内模型上下文。
- `SessionAssistantOutput` 按事件顺序直接创建或更新 canonical Assistant Part，经 `SessionMessages` 持久化并发布 `SessionMutation`。

这两个消费者共享标准事件，但不互相转换。`ModelMessage` 不会先投影成 UI chunk 再回写 Session，Session Message 也不会从最终文本猜测 identity。

## 12. Federation 执行状态机

```text
authenticate
  → validate request
  → resolve source model
  → resolve fallback
  → resolve reasoning
  → start metering
  → invoke AIChannel
  → validate/forward stream
  → settle usage and billing
```

失败语义：

- 建立 SSE 前失败：返回 HTTP JSON 错误。
- SSE 建立后 Provider 失败：发送 `model_error`，结束流并将结算标记为失败。
- 客户端取消：取消 Provider 请求，结算标记为 cancelled。
- `model_finish` 后 transport 断开：若最终 usage 已可信到达，可以成功结算；否则失败。

## 13. AIChannel 契约

```ts
export interface AIChannelStreamInput {
  /** 标准 Downcity 模型调用。 */
  readonly call: ModelCall;

  /** AIService 已解析的最终模型身份。 */
  readonly model: AIChannelModel;

  /** Federation 服务端环境变量读取器。 */
  readonly env: (key: string) => string | undefined;

  /** 最终模型已校验的推理设置。 */
  readonly reasoning?: AIResolvedReasoning;

  /** 当前 HTTP 请求的取消信号。 */
  readonly abort_signal?: AbortSignal;
}

export interface AIChannelStreamResult {
  /** 标准 Downcity 模型事件流。 */
  readonly stream: ReadableStream<ModelStreamEvent>;

  /** 可选上游请求审计信息。 */
  readonly request?: AIProviderRequestMetadata;
}
```

Provider 私有配置改为 Channel 自己拥有的类型或 `Record<string, ModelJsonValue>`，不再使用 AI SDK `providerOptions` 命名和结构。reasoning 由 Channel 显式映射到 Provider 请求。

## 14. OpenAI-compatible 与 SDK Text

### 14.1 OpenAI-compatible

`POST /v1/ai/chat/completions` 保留为外部兼容 Adapter：

```text
OpenAI Request
  → OpenAI Adapter
  → ModelStreamRequest
  → AIService
  → ModelStreamEvent
  → OpenAI Response / SSE
```

OpenAI 类型不得进入 Model Router、AIChannel 或 Agent。

### 14.2 `city.ai.stream()`

公开客户端直接接收 `ModelCall` 或更小的 Downcity SDK input，并返回 Downcity `ModelStreamEvent`。如产品仍需要 UI 流，由 UI/应用层 Adapter 将 Downcity 事件投影成界面消息。

### 14.3 `/v1/ai/text`

旧 UIMessage text action 与新的模型协议职责重叠。一次性迁移后删除 `/v1/ai/text` 及其 `language-model-text.ts` 包装；非语言 action（图片、视频、TTS、ASR）继续保留独立协议。

## 15. AI SDK 与 pi-ai 的位置

本设计参考两者的以下理念：

- 统一模型调用抽象。
- 判别联合消息内容。
- Provider Adapter。
- 标准流事件与完成原因。
- 工具定义和工具调用循环分离。

不采用：

- 将第三方版本化类型作为 Downcity 网络协议。
- 在核心领域中透传 Provider 私有参数。
- 由一个大而全的第三方 helper 同时拥有消息转换、工具循环、UI 流与 usage 聚合。

未来如需要兼容 AI SDK 或 pi-ai，只新增边界包：

```text
@downcity/ai-sdk-adapter
@downcity/pi-ai-adapter
```

这些包依赖 Downcity Protocol，核心包不依赖它们。

## 16. 一次性迁移范围

### 16.1 `@downcity/type`

- 新增完整 Model Protocol 类型。
- 将 `CityModel` 目录描述与可执行模型接口分离。
- 删除对 AI SDK `LanguageModel` 形状的隐式要求。

### 16.2 `@downcity/federation`

- 用 Downcity `ModelClient` 替换实现 `LanguageModelV3` 的 `CityModel`。
- 重写 `/v1/ai/stream` request/SSE codec。
- 用 `ModelCall` 重写 AIService language stream 路由。
- 用 `ModelFileContent` 重写 fallback。
- 用 `ModelStreamEvent` 重写 metering 收口与 Provider replay。
- 用 Downcity 类型重写 `AIChannel`。
- 将 OpenAI Chat Completions 降为纯边界 Adapter。
- 删除 `language-model-text.ts` 和旧 `/v1/ai/text`。
- 删除核心 `ai` 依赖。

### 16.3 `@downcity/agent`

- 新增 Model Runner、Step Event Collector、Tool Loop 和 canonical 输出端口。
- 使用 `SessionModelMessages` 作为 canonical Session Message 到 Model Message 的唯一输入转换。
- 重写 `CoreEngineRunner`，不再调用 `streamText()`。
- 重写标题生成、消息压缩、Group Dispatch 等 `generateText()` 旁路。
- 将所有 AI SDK `ModelMessage`、`Tool`、`StepResult`、UI Message 类型替换为 Downcity 类型。
- 删除核心 `ai` 依赖。

### 16.4 调用方与文档

- 更新 CLI、desktop、模板和示例中受影响的类型与流消费方式。
- 更新 homepage 的 Agent SDK、City SDK、AIService 和 Provider 文档。
- 更新 official 依赖后执行 edge-worker、local-node 全量验证。

## 17. 删除清单

迁移完成后不得残留以下核心概念：

- `LanguageModelV3CallOptions`
- `LanguageModelV3StreamPart`
- `LanguageModelV3StreamResult`
- `ModelMessage`（来自 `ai`）
- `UIMessage`（作为模型执行协议）
- `streamText()` / `generateText()`（Agent 核心执行）
- `convertToModelMessages()`
- AI SDK `Tool` / `ToolSet` / `StepResult`
- `providerOptions` 作为 Federation 核心配置结构
- `CityLanguageModelCodec` 中针对 AI SDK URL、二进制类型的 transport marker

UI 层若仍使用第三方 UI 类型，必须限制在 desktop/UI Adapter，不能重新进入 Agent Model Runner 或 Federation。

## 18. 测试策略

### 18.1 Protocol

- 每种 message/content/tool 类型的合法与非法输入。
- URL、Base64、MIME type 和 filename。
- JSON 序列化往返。
- 未知版本和未知事件拒绝。
- 流事件状态机。

### 18.2 Agent

- Session message 到 Model message 的转换。
- 文本、文件、reasoning、工具调用和工具结果。
- 单 step 文本生成。
- 多 step 工具循环。
- 未注册工具、工具失败和最大 step。
- 取消、Provider 错误和不合法事件流。
- usage、finish reason、Session 输出与持久化一致。
- 标题、压缩和 Dispatch 使用相同 Model Runner。

### 18.3 Federation

- 请求校验、鉴权和取消传播。
- fallback 只读取最新 user。
- fallback 规则顺序和目标不可用。
- reasoning 基于最终模型解析。
- metadata 与实际模型一致。
- usage、计费、失败和取消结算。
- OpenAI Adapter 双向转换。

### 18.4 Provider Adapter

- ModelCall 到上游请求快照。
- 上游文本、reasoning、工具、usage 和错误到 Downcity 事件。
- chunk 边界任意拆分时仍生成合法事件。
- Provider 缺少字段时的明确降级。

### 18.5 集成验收

- Agent → Federation → Provider 完整文本轮次。
- 最新图片触发 fallback。
- 历史图片、最新纯文本不触发 fallback。
- 工具调用跨两个以上 step 完成。
- OpenAI-compatible 非流与流请求。
- edge-worker 与 local-node。

## 19. 实施顺序

一次性替换指不保留长期双协议，但实现仍按可验证的依赖顺序推进：

1. 新增 `@downcity/type` Model Protocol 和协议测试。
2. 新增 Federation 内部 Model stream codec 与状态机测试。
3. 改造 `AIChannel` 和 Provider Adapter 契约。
4. 改造 AIService、fallback、reasoning、metering 与 billing。
5. 改造 Federation Model Client 和 OpenAI Adapter。
6. 在 Agent 新增 Model Runner、Collector、Tool Loop。
7. 替换 Agent CoreEngine 主执行链。
8. 替换标题、压缩、Dispatch 等旁路。
9. 删除旧 V3 transport、SDK text action 和 AI SDK 核心类型。
10. 更新所有调用方和用户文档。
11. 运行受影响 package 的 typecheck、lint、测试和构建。
12. 仅对公开能力实际变化的 package 执行 patch bump/build。

在代码合并点上，第 1 至 8 步属于同一个不可拆分的协议变更；旧协议删除和调用方切换必须在同一变更中完成。

## 20. 验收标准

- Agent 核心推理不导入 `ai` 或 `@ai-sdk/*`。
- Federation 核心协议、transport、路由和 AIChannel 不导入 `ai` 或 `@ai-sdk/*`。
- Agent 到 Federation 的请求只使用 Downcity Model Protocol。
- Federation 到 Provider Adapter 的输入输出只使用 Downcity Model Protocol。
- OpenAI 和其它第三方格式只存在于 Adapter 边界。
- fallback 只依据最新 user 的 `ModelFileContent`。
- 历史上下文完整传给最终模型。
- 工具循环由 Agent 明确拥有并通过完整测试。
- usage、finish reason、错误、取消、metering 和 billing 语义可解释且一致。
- 不存在旧 V3 transport 双栈或旁路补丁。
- federation、agent、cli、desktop、模板、edge-worker 和 local-node 的受影响测试全部通过。
