/**
 * LanguageModelV3 流结果聚合工具。
 *
 * 该模块只理解 AI SDK LanguageModelV3 的标准流事件，不了解 Federation transport
 * 或具体上游协议。CityModel 非流式调用和 AIChannel 通用 text action 复用这里，
 * 保证两条入口对 text、reasoning、tool、usage 和 metadata 的收口语义一致。
 */

import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from "../types/AI.js";

/** 将标准 LanguageModelV3 流聚合为一次非流式生成结果。 */
export async function collect_city_language_model_stream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
  request_body?: unknown,
): Promise<LanguageModelV3GenerateResult> {
  const reader = stream.getReader();
  const content: Array<Record<string, unknown>> = [];
  const text_blocks = new Map<string, Record<string, unknown>>();
  const reasoning_blocks = new Map<string, Record<string, unknown>>();
  let warnings: unknown[] = [];
  let response: Record<string, unknown> | undefined;
  let finish_reason: unknown;
  let usage: unknown;
  let provider_metadata: unknown;

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const part = chunk.value as unknown as Record<string, unknown>;
    const type = String(part.type ?? "");
    if (type === "error") throw part.error;
    if (type === "stream-start") {
      warnings = Array.isArray(part.warnings) ? part.warnings : [];
    } else if (type === "response-metadata") {
      const { type: _type, ...metadata } = part;
      response = metadata;
    } else if (type === "text-start" || type === "reasoning-start") {
      const block = {
        type: type === "text-start" ? "text" : "reasoning",
        text: "",
        ...(part.providerMetadata
          ? { providerMetadata: part.providerMetadata }
          : {}),
      };
      content.push(block);
      const blocks = type === "text-start" ? text_blocks : reasoning_blocks;
      blocks.set(String(part.id), block);
    } else if (type === "text-delta" || type === "reasoning-delta") {
      const blocks = type === "text-delta" ? text_blocks : reasoning_blocks;
      const block = blocks.get(String(part.id));
      if (block) {
        block.text = `${String(block.text ?? "")}${String(part.delta ?? "")}`;
      }
    } else if (
      ["file", "source", "tool-call", "tool-result", "tool-approval-request"]
        .includes(type)
    ) {
      content.push(part);
    } else if (type === "finish") {
      finish_reason = part.finishReason;
      usage = part.usage;
      provider_metadata = part.providerMetadata;
    }
  }

  if (!finish_reason || !usage) {
    throw new Error("Language model stream ended without finish usage");
  }
  return {
    content,
    finishReason: finish_reason,
    usage,
    warnings,
    ...(provider_metadata ? { providerMetadata: provider_metadata } : {}),
    ...(request_body !== undefined ? { request: { body: request_body } } : {}),
    ...(response ? { response } : {}),
  } as LanguageModelV3GenerateResult;
}
