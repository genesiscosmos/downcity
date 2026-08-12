/**
 * AIChannel LanguageModelV3 流的通用 text action。
 *
 * AIChannel.model() 把显式 `stream(input)` 适配成内部 AIModelStream；本模块再把
 * 该运行时包装成一个本地 LanguageModelV3，并复用 AI SDK `generateText()` 完成
 * UIMessage、tools 和 usage 的非流式收口。这里不创建上游客户端或注入私有配置。
 */

import { convertToModelMessages, generateText } from "ai";
import type { UIMessage } from "ai";
import type {
  AIChargedResult,
  AIModelStream,
  LanguageModelV3,
} from "../../types/AI.js";
import type { Context } from "../service.js";
import {
  buildAssistantMessage,
  buildToolSet,
  type ToolCallShape,
} from "./helpers.js";
import { collect_city_language_model_stream } from "../../utils/CityLanguageModelResult.js";
import type {
  AIResolvedTextInput,
  AITextInput,
} from "../../types/AITransport.js";

/**
 * 从 AIChannel 标准流执行一次通用 `city.ai.text()` 调用。
 */
export async function execute_language_model_text(
  ctx: Context,
  stream: AIModelStream,
  channel_id: string,
): Promise<AIChargedResult<UIMessage>> {
  const input = await resolve_text_input(ctx.input as AITextInput);
  const model = create_runtime_language_model(ctx, stream, channel_id);
  const result = "messages" in input
    ? await generateText({
        model,
        messages: input.messages,
        ...(input.tools ? { tools: input.tools } : {}),
      })
    : await generateText({
        model,
        prompt: input.prompt,
        ...(input.tools ? { tools: input.tools } : {}),
      });

  return buildAssistantMessage(result.text, ctx, {
      finishReason: result.finishReason,
      usage: result.usage,
      ...(result.toolCalls.length > 0
        ? { toolCalls: result.toolCalls as ToolCallShape[] }
        : {}),
    });
}

/** 把 AIChannel stream runtime 包装成完整的本地 LanguageModelV3。 */
function create_runtime_language_model(
  ctx: Context,
  stream: AIModelStream,
  channel_id: string,
): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: channel_id,
    modelId: ctx.variant?.id || channel_id,
    supportedUrls: {},
    doStream: (call) => stream(ctx, call),
    doGenerate: async (call) => {
      const result = await stream(ctx, call);
      return collect_city_language_model_stream(
        result.stream,
        result.request?.body,
      );
    },
  };
}

/** 把公开 prompt/messages/tools 输入转换成 AI SDK generateText 参数。 */
async function resolve_text_input(
  input: AITextInput,
): Promise<AIResolvedTextInput> {
  const tools = buildToolSet(input.tools);
  if (Array.isArray(input.messages) && input.messages.length > 0) {
    const messages = tools
      ? await convertToModelMessages(input.messages, { tools })
      : await convertToModelMessages(input.messages);
    return {
      messages,
      ...(tools ? { tools } : {}),
    };
  }
  return {
    prompt: typeof input.prompt === "string" ? input.prompt : "",
    ...(tools ? { tools } : {}),
  };
}
