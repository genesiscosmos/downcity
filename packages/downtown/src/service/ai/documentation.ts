/**
 * AI 服务 action 的公开说明与示例。
 *
 * 固定协议由共享 schema 描述；video/tts/asr 的扩展字段和响应由 Channel 定义，
 * 明确保留这种差异，不暗示任意模型都接受同一套输入或返回同一种 MIME 类型。
 */
import type { ApiDocumentation } from "../../types/ServiceDiscovery.js";
import { chat_request_schema, image_job_schema, model_stream_request_schema, object_schema } from "./documentation-schemas.js";

const model_schema = { type: "string", minLength: 1, description: "GET /v1/ai/models 返回的模型 ID。" };
const job_request_schema = object_schema({ job_id: { type: "string", minLength: 1 } }, ["job_id"]);
const model_errors = [
  { status: 422, description: "模型不存在、不支持该模态、缺少配置，或请求不符合协议。" },
  { status: 500, description: "Channel 执行或持久化失败；上游已产生费用时仍会记录用量并结算。" },
];

/** 为 Channel 自定义的模态保留明确的扩展边界。 */
function channel_documentation(modality: string, description: string, example_input: Record<string, unknown>): ApiDocumentation {
  return {
    description: `${description} 必须指定 model，其余输入与成功响应由选定模型的 Channel 定义；下列输入只是通用示例，使用前须核对该模型的参数要求。`,
    protocol: "channel-defined",
    request_schema: { ...object_schema({ model: model_schema }, ["model"]), description: "公共路由输入；额外字段原样交给 Channel，此 schema 只覆盖公共字段。", "x-schema-scope": "routing-fields-only" },
    requirements: [`模型必须提供 ${modality} action，并已配置该模型声明的全部环境变量。`, "执行结果需要 AI 用量与结算存储；费用检查取决于所配置的 Credits 桥接。"],
    errors: model_errors,
    examples: [{ name: "Channel 输入示例（请核对模型要求）", request: { model: "example-model", ...example_input } }],
  };
}

/** 各 AI action 的文档，在注册时附加本地就绪检查。 */
export const ai_api_documentation: Record<string, ApiDocumentation> = {
  video: channel_documentation("video", "调用视频生成模型。", { prompt: "海浪拍打岸边" }),
  tts: channel_documentation("tts", "将文本合成为语音。响应可能是文件消息、音频或 Channel 自定义结果。", { text: "你好" }),
  asr: channel_documentation("asr", "识别音频中的语音。音频字段、格式和大小限制由 Channel 定义。", { audio_url: "https://example.com/audio.wav" }),
  decision: {
    description: "基于文本或 JSON 状态回答一组闭合问题。问题 ID 唯一，支持 boolean/choice/score；choice 候选不可重复且最多255个，score 默认0到1且min必须小于max。每个问题恰好有一个答案。",
    request_schema: object_schema({
      model: model_schema,
      state: { oneOf: [object_schema({ type: { const: "text" }, text: { type: "string", minLength: 1 } }, ["type", "text"]), object_schema({ type: { const: "json" }, data: { description: "任意 JSON 值。" } }, ["type", "data"])] },
      questions: { type: "array", minItems: 1, items: { oneOf: [
        object_schema({ id: { type: "string", minLength: 1 }, type: { const: "boolean" }, instructions: { type: "string", minLength: 1 } }, ["id", "type", "instructions"], false),
        object_schema({ id: { type: "string", minLength: 1 }, type: { const: "choice" }, instructions: { type: "string", minLength: 1 }, options: { type: "array", minItems: 1, maxItems: 255, uniqueItems: true, items: { type: "string", minLength: 1 } } }, ["id", "type", "instructions", "options"], false),
        object_schema({ id: { type: "string", minLength: 1 }, type: { const: "score" }, instructions: { type: "string", minLength: 1 }, min: { type: "number", default: 0 }, max: { type: "number", default: 1 } }, ["id", "type", "instructions"], false),
      ] } },
    }, ["model", "state", "questions"]),
    response_schema: object_schema({ answers: { type: "array", items: object_schema({ question_id: { type: "string" }, value: { type: ["boolean", "string", "number"] }, probability: { type: "number", minimum: 0, maximum: 1 }, distribution: { type: "object", description: "choice候选的完整概率分布。", additionalProperties: { type: "number", minimum: 0, maximum: 1 } } }, ["question_id", "value"]) }, usage: { type: "object", description: "Channel 返回的可选用量。" } }, ["answers"]),
    errors: model_errors,
    examples: [{ name: "布尔决策", request: { model: "example-decision", state: { type: "text", text: "用户询问订单退款" }, questions: [{ id: "refund", type: "boolean", instructions: "是否涉及退款？" }] }, response: { answers: [{ question_id: "refund", value: true }] } }],
  },
  stream: {
    description: "执行 Downcity Model Protocol v1 请求并返回 SSE。每个 data 帧为模型事件，包含开始、内容增量、工具调用和最终 model_finish/model_error；连接建立后的错误通过事件表达。",
    protocol: "sse", request_schema: model_stream_request_schema,
    response_content_type: "text/event-stream", response_schema: { type: "string", description: "SSE data 帧中的 JSON 对应 @downcity/type ModelStreamEvent；必须读取至 model_finish 或 model_error。" },
    errors: model_errors,
    examples: [{ name: "文本模型流", request: { protocol_version: 1, model_id: "example-model", call: { messages: [{ role: "user", content: [{ type: "text", text: "你好" }] }] } } }],
  },
  "chat/completions": {
    description: "OpenAI Chat Completions 兼容入口。stream=false返回JSON，stream=true返回OpenAI SSE并以data: [DONE]结束。也可使用/v1/chat/completions。未支持的扩展字段不会直接进入Channel。",
    protocol: "openai-chat-completions", request_schema: chat_request_schema,
    response_schema: { ...object_schema({
      id: { type: "string" }, object: { const: "chat.completion" }, created: { type: "integer" }, model: { type: "string" },
      choices: { type: "array", items: object_schema({ index: { type: "integer" }, message: object_schema({ role: { const: "assistant" }, content: { type: ["string", "null"] }, tool_calls: { type: "array", items: { type: "object", description: "OpenAI function tool call。" } } }, ["role"]), finish_reason: { type: ["string", "null"] } }, ["index", "message", "finish_reason"]) },
      usage: object_schema({ prompt_tokens: { type: "integer" }, completion_tokens: { type: "integer" }, total_tokens: { type: "integer" } }),
    }, ["id", "object", "created", "model", "choices"]), description: "stream=false时的JSON结构；stream=true时响应为text/event-stream，使用OpenAI chat.completion.chunk协议。" },
    errors: model_errors,
    examples: [{ name: "普通对话", request: { model: "example-model", messages: [{ role: "user", content: "你好" }], stream: false }, response: { id: "chatcmpl_example", object: "chat.completion", created: 0, model: "example-model", choices: [{ index: 0, message: { role: "assistant", content: "你好！" }, finish_reason: "stop" }] } }],
  },
  "image/create": {
    description: "创建图片异步任务并保存本地记录。model必填，prompt/content等生成字段由模型Channel定义。返回job_id后按建议间隔调用image/result读取状态；此调用会实际创建上游任务并可能计费。",
    request_schema: { ...object_schema({ model: model_schema }, ["model"]), description: "仅定义公共路由字段；生成参数需遵循所选Channel。", "x-schema-scope": "routing-fields-only" },
    response_schema: image_job_schema,
    requirements: ["持久化async_jobs表。", "可用的Downtown Queue。", "模型同时提供image_create和image_fetch。"],
    errors: [...model_errors, { status: 503, description: "未配置图片任务后台调度能力。" }],
    examples: [{ name: "创建任务（生成参数取决于模型）", request: { model: "example-image", prompt: "山间湖泊" }, response: { job_id: "job_example", status: "queued", poll_after_ms: 2000 } }],
  },
  "image/result": {
    description: "只读取本地图片任务，不触发上游请求。普通用户只可读取自己的任务；管理员可读取全部任务。成功时result包含文本或文件parts。",
    request_schema: job_request_schema, response_schema: image_job_schema,
    errors: [{ status: 422, description: "缺少job_id。" }, { status: 404, description: "任务不存在或不属于当前用户。" }, { status: 500, description: "任务存储未初始化或读取失败。" }],
    examples: [{ name: "查询任务", request: { job_id: "job_example" }, response: { job_id: "job_example", status: "running", poll_after_ms: 2000 } }],
  },
  "image/fetch": {
    description: "管理员或可信后台领取并轮询图片任务，更新持久化状态和用量结算；未完成时继续调度，终态直接返回现有结果。该入口可能调用上游，应由后台任务驱动。",
    request_schema: job_request_schema, response_schema: image_job_schema,
    errors: [...model_errors, { status: 404, description: "任务不存在。" }],
    examples: [{ name: "后台轮询", request: { job_id: "job_example" }, response: { job_id: "job_example", status: "running" } }],
  },
  "settlement/process": {
    description: "处理一条持久化AI结算任务。usage_id由AI执行产生；可重试错误由后台安排再次唤醒，账务幂等由用量结算存储保证。仅管理员调用。",
    request_schema: object_schema({ usage_id: { type: "string", minLength: 1 } }, ["usage_id"]),
    response_schema: object_schema({ status: { enum: ["pending", "processing", "retryable", "completed", "rejected"] }, next_attempt_at: { type: "string", description: "可重试任务下次允许处理的时间。" } }, ["status"]),
    errors: [{ status: 422, description: "缺少usage_id。" }, { status: 500, description: "结算存储未初始化或执行失败。" }],
    examples: [{ name: "处理结算", request: { usage_id: "aiu_example" }, response: { status: "completed" } }],
  },
  models: {
    description: "列出当前身份可见的模型。普通用户仅看到环境配置满足的模型；管理员可查看完整目录和环境要求。Relay模式还会应用用户/调用凭据可见范围。可使用/v1/models获取OpenAI格式目录。",
    request_schema: object_schema({}, [], false),
    response_schema: object_schema({ items: { type: "array", items: object_schema({ id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, model_type: { type: "string" }, modalities: { type: "array", items: { type: "string" } }, tags: { type: "array", items: { type: "string" } }, meta: { type: "object" }, pricing: { type: "array", items: { type: "object", description: "结构化模型价格，含currency/unit/rates等。" } }, context_window: { type: "number", description: "模型上下文token容量。" }, env_requirements: { type: "array", items: { type: "object" }, description: "仅管理员目录包含。" } }, ["id", "name", "description", "model_type", "modalities", "tags", "meta"]) } }, ["items"]),
    examples: [{ name: "空模型目录", request: {}, response: { items: [] } }],
  },
};

// 对话在同一成功状态下有两种响应，OpenAPI按MIME类型分别描述。
ai_api_documentation["chat/completions"]!.response_content = {
  "application/json": ai_api_documentation["chat/completions"]!.response_schema!,
  "text/event-stream": { type: "string", description: "OpenAI chat.completion.chunk SSE，最终data: [DONE]。" },
};
ai_api_documentation.models!.aliases = {
  "/v1/models": {
    description: "OpenAI兼容模型目录；用户只能看到当前身份允许且已配置的模型。",
    request_schema: object_schema({}, [], false),
    response_schema: object_schema({ object: { const: "list" }, data: { type: "array", items: object_schema({ id: { type: "string" }, object: { const: "model" }, created: { type: "number" }, owned_by: { type: "string" } }, ["id", "object", "created", "owned_by"]) } }, ["object", "data"]),
    examples: [{ name: "空目录", request: {}, response: { object: "list", data: [] } }],
  },
};

/** 服务详情的完整使用说明，公开内容不包含任何实际凭据。 */
export const ai_service_instruction = [
  "AI服务提供模型目录、Downcity模型流、OpenAI兼容对话、图片异步任务及Channel自定义语音/视频/决策能力。",
  "通过AIService.use注册模型及其Channel，配置每个模型声明的环境变量；模型流需要runtime.stream，其他能力需要对应runtime.actions。",
  "业务入口接受user或admin的Bearer凭据。image/fetch和settlement/process只接受admin。Relay调用凭据只适用于models、chat/completions和stream三个白名单入口。",
  "先GET /v1/ai/models选择具有所需modalities的模型。文本使用POST /v1/ai/stream（Downcity Model Protocol v1 SSE）或POST /v1/ai/chat/completions（OpenAI JSON/SSE）。",
  "图片使用POST /v1/ai/image/create创建任务，再POST /v1/ai/image/result读取本地状态。创建任务要求Queue；普通用户只能查询自己的任务。后台image/fetch负责实际轮询。",
  "video/tts/asr将model以外的输入交给Channel，字段及响应格式须遵守所选模型的契约；公共schema仅覆盖路由字段。decision另有固定state/questions协议。",
  "模型调用会产生真实上游费用；Credits桥接可执行余额预检和幂等扣费。所有执行使用AI用量及结算持久化存储，模型价格在目录中展示。",
  "ready只说明本地依赖满足；目录查询不探测上游，不判断当前用户余额，Relay路由无法由本地注册表确定时返回unknown。",
  "启用Relay后还提供用户调用凭据、路由目录、部署冷却记录和请求/上游尝试日志。keys/create仅在创建时返回一次明文token；用户日志限定本人，relay/admin入口跨用户且仅管理员可用。",
  "详细请求、响应、错误、占位示例见GET /v1/services/ai；机器可读定义见GET /openapi.json。",
].join("\n\n");
