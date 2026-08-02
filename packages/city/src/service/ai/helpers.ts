 /**
  * AIChannel 通用工具模块。
  *
  * 集中管理 AIChannel 子类常用的输入解析、消息构造、usage 归一化、
  * HTTP 响应读取等工具函数。
  */

 import type { DynamicToolUIPart, FileUIPart, ToolSet, UIMessage } from "ai";
 import { jsonSchema, tool } from "ai";
 import type {
   AIChannelActionInput,
   AICharge,
   AIChargedResult,
 } from "../../types/AI.js";
 import type { Context } from "../service.js";

 // ===========================================================================
 // 基础类型判断
 // ===========================================================================

 /**
  * 判断一个值是否为普通对象。
  */
 export function isRecord(value: unknown): value is Record<string, unknown> {
   return Boolean(value && typeof value === "object" && !Array.isArray(value));
 }

 /**
  * 将未知值转换为普通对象，失败返回 null。
  */
 export function toRecord(value: unknown): Record<string, unknown> | null {
   return isRecord(value) ? value : null;
 }

 /**
  * 读取字符串字段，非字符串返回空字符串。
  */
 export function readString(value: unknown): string {
   return typeof value === "string" ? value.trim() : "";
 }

 /**
  * 过滤掉对象中的 undefined 值。
  */
 export function stripUndefined<T extends Record<string, unknown>>(record: T): T {
   return Object.fromEntries(
     Object.entries(record).filter(([, item]) => item !== undefined),
   ) as T;
 }

 // ===========================================================================
 // 环境变量与 URL
 // ===========================================================================

 /**
  * 移除 URL 尾部斜杠。
  */
 export function trimTrailingSlash(value: string): string {
   return value.replace(/\/+$/, "");
 }

 /**
  * 读取必填环境变量。
  */
 export function read_required_env(
   source: { env(key: string): string | undefined },
   key: string,
 ): string {
   const value = source.env(key);
   if (!value) throw new Error(`${key} is required`);
   return value;
 }

 // ===========================================================================
 // HTTP 响应读取
 // ===========================================================================

 /**
  * 读取 JSON 响应，非 2xx 时抛出错误。
  */
 export async function readJsonResponse(response: Response): Promise<unknown> {
   const text = await response.text();
   const data = text ? JSON.parse(text) as unknown : {};
   if (!response.ok) {
     const message = readErrorMessage(data) || response.statusText || `HTTP ${response.status}`;
     throw new Error(message);
   }
   return data;
 }

 /**
  * 从上游错误响应中提取可读错误信息。
  */
 export function readErrorMessage(data: unknown): string {
   const record = toRecord(data);
   const nested = toRecord(record?.data) ?? toRecord(record?.job) ?? toRecord(record?.result);
   const error = toRecord(record?.error);
   const nested_error = toRecord(nested?.error);
   const detail = toRecord(error?.detail);
   const nested_detail = toRecord(nested_error?.detail);
   const message =
     readString(error?.message) ||
     readString(detail?.message) ||
     readString(nested_error?.message) ||
     readString(nested_detail?.message) ||
     readString(record?.message) ||
     readString(nested?.message) ||
     readString(record?.error) ||
     readString(nested?.error);
   const code =
     readString(error?.code) ||
     readString(detail?.code) ||
     readString(nested_error?.code) ||
     readString(nested_detail?.code);
   if (!message) return "";
   return code && !message.includes(code) ? `${message} (${code})` : message;
 }

 // ===========================================================================
 // 消息构造
 // ===========================================================================

 /**
  * generateText / streamText tool call 的临时形状。
  */
 export interface ToolCallShape {
   /** tool call 唯一 ID。 */
   toolCallId: string;
   /** tool 名称。 */
   toolName: string;
   /** tool 输入。 */
   input: unknown;
 }

 /**
  * buildAssistantMessage 的结果参数。
  */
 export interface BuildAssistantMessageResult {
   /** 结束原因。 */
   finishReason: string;
   /** 上游 usage。 */
   usage?: unknown;
   /** tool calls。 */
   toolCalls?: ToolCallShape[];
 }

 /**
  * 构造标准 assistant UIMessage。
  */
 export function buildAssistantMessage(
   text: string,
   ctx: Context,
   result: BuildAssistantMessageResult,
   charge?: AICharge,
 ): AIChargedResult<UIMessage> {
   const parts: UIMessage["parts"] = [{ type: "text", text }];

   if (result.toolCalls) {
     for (const toolCall of result.toolCalls) {
       const part: DynamicToolUIPart = {
         type: "dynamic-tool",
         toolCallId: toolCall.toolCallId,
         toolName: toolCall.toolName,
         state: "input-available",
         input: toolCall.input as Record<string, unknown>,
       };
       parts.push(part);
     }
   }

   return {
     output: {
       id: `msg_${crypto.randomUUID()}`,
       role: "assistant",
       parts,
       metadata: {
         model: ctx.variant?.id,
         bureau_id: ctx.bureau?.bureau_id,
         user_id: ctx.user?.user_id,
         finishReason: result.finishReason,
         usage: result.usage,
       },
     },
     charge,
   };
 }

 /**
  * 提取后的图片信息。
  */
 export interface ExtractedImage {
   /** 图片 URL 或 data URL。 */
   url: string;
   /** 图片 MIME 类型。 */
   media_type: string;
   /** 文件名。 */
   filename?: string;
 }

 /**
  * 构造标准图片 file-parts UIMessage。
  */
 export function buildImageMessage(
   input: AIChannelActionInput,
   images: ExtractedImage[],
   metadata: Record<string, unknown>,
 ): UIMessage {
   if (images.length === 0) {
     throw new Error("Image provider returned no images");
   }
   const parts: FileUIPart[] = images.map((image) => ({
     type: "file",
     mediaType: image.media_type,
     url: image.url,
     ...(image.filename ? { filename: image.filename } : {}),
   }));

   return {
     id: `msg_${crypto.randomUUID()}`,
     role: "assistant",
     parts,
     metadata: stripUndefined({
       model: input.model.id,
       bureau_id: input.bureau_id,
       user_id: input.user_id,
       ...metadata,
     }),
   };
 }

 // ===========================================================================
 // Tool 解析
 // ===========================================================================

 /**
  * OpenAI function tools → ai-sdk ToolSet。
  */
 export function buildToolSet(items: Record<string, unknown>[] | undefined): ToolSet | undefined {
   if (!items?.length) return undefined;

   return Object.fromEntries(
     items
       .filter((item): item is {
         type: "function";
         function: { name: string; description?: string; parameters?: unknown };
       } =>
         item.type === "function" && typeof (item as { function?: { name?: unknown } }).function?.name === "string")
       .map((item) => [
         item.function.name,
         tool({
           description: item.function.description ?? "",
           inputSchema: jsonSchema(item.function.parameters ?? {}),
         }),
       ]),
   );
 }

 // ===========================================================================
 // Usage 归一化
 // ===========================================================================

 type UsageRecord = Record<string, unknown>;

 /**
  * 兼容常见 provider usage 字段，归一化为 input_tokens / output_tokens / cached_tokens。
  */
 export function normalizeAIUsage(usage: unknown): {
   input_tokens?: number;
   output_tokens?: number;
   cached_tokens?: number;
   reasoning_tokens?: number;
 } {
   if (!isRecord(usage)) return {};
   const v3_input_tokens = isRecord(usage.inputTokens) ? usage.inputTokens : undefined;
   const v3_output_tokens = isRecord(usage.outputTokens) ? usage.outputTokens : undefined;
   const input_token_details = isRecord(usage.inputTokenDetails) ? usage.inputTokenDetails : undefined;
   const cached_tokens = readNumberFieldValue(usage, [
     "cached_input_tokens",
     "cachedTokens",
     "cached_tokens",
     "prompt_cache_hit_tokens",
   ]) ?? (v3_input_tokens ? readNumberFieldValue(v3_input_tokens, ["cacheRead"]) : undefined)
     ?? readNestedNumberFieldValue(usage, "inputTokenDetails", [
       "cacheReadTokens",
       "cachedTokens",
     ]) ?? readNestedNumberFieldValue(usage, "prompt_tokens_details", [
     "cached_tokens",
     "cachedTokens",
   ]) ?? readNumberFieldValue(usage, [
     "cachedInputTokens",
   ]);
   const total_input_tokens = readNumberFieldValue(usage, [
     "promptTokens",
     "prompt_tokens",
     "inputTokens",
     "input_tokens",
     "promptTokenCount",
     "prompt_token_count",
   ]) ?? (v3_input_tokens ? readNumberFieldValue(v3_input_tokens, ["total"]) : undefined);
   const input_tokens = readNumberFieldValue(usage, ["prompt_cache_miss_tokens"])
     ?? (v3_input_tokens ? readNumberFieldValue(v3_input_tokens, ["noCache"]) : undefined)
     ?? (input_token_details ? readNumberFieldValue(input_token_details, [
       "noCacheTokens",
       "inputTokens",
     ]) : undefined)
     ?? readNestedNumberFieldValue(usage, "prompt_tokens_details", [
       "no_cache_tokens",
       "noCacheTokens",
     ])
     ?? (total_input_tokens !== undefined && cached_tokens !== undefined
       ? Math.max(total_input_tokens - cached_tokens, 0)
       : total_input_tokens);

   return {
     ...(input_tokens !== undefined ? { input_tokens } : {}),
     ...(v3_output_tokens
       ? readNumberField(v3_output_tokens, ["total"], "output_tokens")
       : readNumberField(usage, [
         "outputTokens",
         "output_tokens",
         "completionTokens",
         "completion_tokens",
         "candidatesTokenCount",
         "candidates_token_count",
       ], "output_tokens")),
     ...(cached_tokens !== undefined ? { cached_tokens } : {}),
     ...(v3_output_tokens
       ? readNumberField(v3_output_tokens, ["reasoning"], "reasoning_tokens")
       : {}),
   };
 }

 function readNumberField(
   record: UsageRecord,
   keys: string[],
   output_key: "input_tokens" | "output_tokens" | "cached_tokens" | "reasoning_tokens",
 ): Partial<Record<"input_tokens" | "output_tokens" | "cached_tokens" | "reasoning_tokens", number>> {
   const value = readNumberFieldValue(record, keys);
   return value !== undefined ? { [output_key]: value } : {};
 }

 function readNumberFieldValue(record: UsageRecord, keys: string[]): number | undefined {
   for (const key of keys) {
     const value = record[key];
     const normalized = Number(value);
     if (Number.isFinite(normalized) && normalized >= 0) {
       return normalized;
     }
   }
   return undefined;
 }

 function readNestedNumberFieldValue(record: UsageRecord, parent: string, keys: string[]): number | undefined {
   const nested = record[parent];
   return isRecord(nested) ? readNumberFieldValue(nested, keys) : undefined;
 }
