/**
 * 最终请求的文本与原生图片分别估算。仅按 ModelContent 的明确结构识别图片，
 * 普通正文、工具参数和 JSON 中的编码串不得获得媒体减免；不修改实际发送载荷。
 */
import type { ModelCall, ModelContent, ModelMessage, ModelToolResultPart } from "@downcity/type";
import { estimate_image_tokens, read_image_dimensions, image_header_bytes, type ImageDimensions } from "@downcity/type/workspace";
import { estimate_context_tokens } from "@/session/input/composer/ContextTokenBudget.js";

import type { RequestTokenEstimate } from "@/types/model/RequestTokenEstimate.js";

/** 最终调用的预算计量；文本估算副本只替换协议图片来源，不修改原调用。 */
export function estimate_request_tokens(call: ModelCall): RequestTokenEstimate {
  const totals = { image_estimated_tokens: 0, image_count: 0, media_encoded_bytes: 0 };
  const messages = call.messages.map(message => project_message(message, totals));
  return { ...totals, text_estimated_tokens: estimate_context_tokens(JSON.stringify({ ...call, messages })) + call.messages.length * 16 };
}

/** 最大输入项定位复用完全相同的图片识别和估算。 */
export function estimate_message_tokens(message: ModelMessage): number {
  const totals = { image_estimated_tokens: 0, image_count: 0, media_encoded_bytes: 0 };
  const projected = project_message(message, totals);
  return estimate_context_tokens(JSON.stringify(projected)) + totals.image_estimated_tokens;
}

/** 工具调用参数与结果 JSON 保持原样，不能递归按字段名猜测图片。 */
export function estimate_content_tokens(part: ModelContent): number {
  const totals = { image_estimated_tokens: 0, image_count: 0, media_encoded_bytes: 0 };
  const projected = project_content(part, totals);
  return estimate_context_tokens(JSON.stringify(projected)) + totals.image_estimated_tokens;
}

/** 投影标准消息内容，避免把业务 JSON 中的 type:file 当成原生文件。 */
function project_message(message: ModelMessage, totals: Omit<RequestTokenEstimate, "text_estimated_tokens">): ModelMessage {
  return { ...message, content: message.content.map(part => project_content(part, totals)) };
}

/** 只有明确工具结果协议允许继续检查下一层内容。 */
function project_content(part: ModelContent, totals: Omit<RequestTokenEstimate, "text_estimated_tokens">): ModelContent {
  if (part.type === "tool_result") return { ...part, content: part.content.map(item => project_media(item, totals)) };
  return project_media(part, totals);
}

/** 将图片源替换为固定大小估算占位符，二进制大小继续单独计量。 */
function project_media<T extends ModelContent | ModelToolResultPart>(part: T, totals: Omit<RequestTokenEstimate, "text_estimated_tokens">): T {
  if (part.type !== "file") return part;
  if (part.source.type === "base64") totals.media_encoded_bytes += Buffer.byteLength(part.source.data);
  if (!part.media_type.toLowerCase().startsWith("image/")) return part;
  let dimensions: ImageDimensions | undefined;
  if (part.source.type === "base64") {
    // Base64 只解码头部，不对每次估算反复分配整个图片。
    const encoded_header = part.source.data.slice(0, Math.ceil(image_header_bytes / 3) * 4);
    dimensions = read_image_dimensions(Buffer.from(encoded_header, "base64"));
  }
  totals.image_count++;
  totals.image_estimated_tokens = Math.min(Number.MAX_SAFE_INTEGER,
    totals.image_estimated_tokens + estimate_image_tokens(dimensions));
  return { ...part, source: { type: "base64", data: "<image payload measured separately>" } };
}
