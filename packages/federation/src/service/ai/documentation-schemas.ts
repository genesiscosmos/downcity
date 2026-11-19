/**
 * AI HTTP 文档中的稳定协议 schema。
 *
 * 与 @downcity/type 的消息和调用协议对应；模型专属输入由 Channel 决定，
 * 文档只声明公共字段并明确允许扩展，不把它们当成统一的服务端校验规则。
 */
import type { ApiSchema } from "../../types/ServiceDiscovery.js";

/** 构造对象文档；扩展字段由具体协议决定。 */
export function object_schema(properties: Record<string, ApiSchema>, required: string[] = [], additional_properties = true): ApiSchema {
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: additional_properties };
}
const text_schema = { type: "string" };
const text_part = object_schema({ type: { const: "text" }, text: text_schema }, ["type", "text"], false);
const file_part = object_schema({
  type: { const: "file" }, media_type: text_schema, filename: text_schema,
  source: { oneOf: [
    object_schema({ type: { const: "url" }, url: { type: "string", format: "uri", pattern: "^https?://" } }, ["type", "url"], false),
    object_schema({ type: { const: "base64" }, data: { type: "string", contentEncoding: "base64" } }, ["type", "data"], false),
  ] },
}, ["type", "media_type", "source"], false);
const json_part = object_schema({ type: { const: "json" }, value: { description: "任意 JSON 值。" } }, ["type", "value"], false);
const content_schema = { oneOf: [
  text_part, file_part,
  object_schema({ type: { const: "reasoning" }, text: text_schema, signature: text_schema }, ["type", "text"], false),
  object_schema({ type: { const: "tool_call" }, tool_call_id: text_schema, tool_name: text_schema, input: { description: "工具输入 JSON 值。" } }, ["type", "tool_call_id", "tool_name", "input"], false),
  object_schema({
    type: { const: "tool_result" }, tool_call_id: text_schema, tool_name: text_schema,
    outcome: { enum: ["succeeded", "failed"] }, content: { type: "array", items: { oneOf: [text_part, file_part, json_part] } },
  }, ["type", "tool_call_id", "tool_name", "outcome", "content"], false),
] };

/** Downcity 模型流的请求协议，输入只接受这三个顶层字段。 */
export const model_stream_request_schema = object_schema({
  protocol_version: { type: "integer", const: 1 }, model_id: { type: "string", minLength: 1 },
  call: object_schema({
    messages: { type: "array", items: object_schema({ role: { enum: ["system", "user", "assistant", "tool"] }, content: { type: "array", items: content_schema } }, ["role", "content"], false) },
    tools: { type: "array", items: object_schema({ name: text_schema, description: text_schema, input_schema: { type: "object", description: "工具输入的 JSON Schema。" } }, ["name", "description", "input_schema"], false) },
    tool_choice: { oneOf: [object_schema({ type: { enum: ["auto", "none", "required"] } }, ["type"], false), object_schema({ type: { const: "tool" }, tool_name: text_schema }, ["type", "tool_name"], false)] },
    max_output_tokens: { type: "number" }, temperature: { type: "number" }, top_p: { type: "number" }, top_k: { type: "number" },
    presence_penalty: { type: "number" }, frequency_penalty: { type: "number" }, seed: { type: "number" },
    stop_sequences: { type: "array", items: text_schema },
    reasoning: object_schema({ enabled: { type: "boolean" }, effort: text_schema }, ["enabled"], false),
    response_format: { oneOf: [object_schema({ type: { enum: ["text", "json"] } }, ["type"], false), object_schema({ type: { const: "json_schema" }, name: text_schema, description: text_schema, schema: { type: "object", description: "输出 JSON Schema。" } }, ["type", "name", "schema"], false)] },
  }, ["messages"], false),
}, ["protocol_version", "model_id", "call"], false);

/** 非语言 AI Action 统一结果；具体 Channel 可以直接返回其他协议响应。 */
export const action_message_schema = object_schema({
  id: text_schema, role: { const: "assistant" },
  parts: { type: "array", items: { oneOf: [text_part, object_schema({ type: { const: "file" }, media_type: text_schema, url: text_schema, filename: text_schema }, ["type", "media_type", "url"])] } },
  metadata: { type: "object", additionalProperties: true },
}, ["id", "role", "parts"]);

/** 图片任务的创建和查询共享结果；成功时携带 result。 */
export const image_job_schema = object_schema({
  job_id: text_schema, status: { enum: ["queued", "running", "succeeded", "failed"] },
  message: text_schema, error: text_schema, poll_after_ms: { type: "number" },
  metadata: { type: "object", additionalProperties: true }, result: action_message_schema,
}, ["job_id", "status"]);

/** OpenAI 兼容入口支持的公共请求字段，扩展字段不会直接透传至 Channel。 */
export const chat_request_schema = object_schema({
  model: { type: "string", minLength: 1 },
  messages: { type: "array", items: object_schema({
    role: { enum: ["system", "developer", "user", "assistant", "tool"] },
    content: { description: "文本或 OpenAI 多模态 content parts，支持文本、image_url 与 file。", type: ["string", "array", "null"], items: { type: "object", description: "OpenAI content part；模型适配器校验支持范围。" } },
    tool_call_id: text_schema, name: text_schema,
    tool_calls: { type: "array", items: object_schema({ id: text_schema, type: { const: "function" }, function: object_schema({ name: text_schema, arguments: text_schema }, ["name", "arguments"]) }, ["id", "type", "function"]) },
  }, ["role"]) },
  stream: { type: "boolean", default: false }, max_completion_tokens: { type: "number" }, max_tokens: { type: "number" },
  temperature: { type: "number" }, top_p: { type: "number" }, stop: { oneOf: [text_schema, { type: "array", items: text_schema }] },
  presence_penalty: { type: "number" }, frequency_penalty: { type: "number" }, seed: { type: "number" }, reasoning_effort: text_schema,
  tools: { type: "array", items: object_schema({ type: { const: "function" }, function: object_schema({ name: text_schema, description: text_schema, parameters: { type: "object", description: "工具输入 JSON Schema。" } }, ["name"]) }, ["type", "function"]) },
  tool_choice: { oneOf: [{ enum: ["auto", "none", "required"] }, object_schema({ type: { const: "function" }, function: object_schema({ name: text_schema }, ["name"]) }, ["type", "function"])] },
  response_format: { type: "object", description: "OpenAI text、json_object 或 json_schema 格式配置。", properties: { type: { enum: ["text", "json_object", "json_schema"] }, json_schema: { type: "object" } }, required: ["type"] },
}, ["model", "messages"]);
