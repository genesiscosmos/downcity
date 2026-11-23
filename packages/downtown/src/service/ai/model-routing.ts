/**
 * AI 模型媒体 fallback 路由模块。
 *
 * 路由只读取最新用户消息；最终模型确定后，再为不支持历史媒体的模型生成执行视图。
 */

import type { ModelCall, ModelFileContent, ModelMessage } from "@downcity/type";
import type {
  AIModelDefinition,
  AIModelFallbackRule,
  AIModelRoutingAdapter,
  AIResolvedAction,
  AIResolvedRoutingPlan,
} from "../../types/AI.js";

/**
 * 为最终模型生成本次执行使用的 ModelCall。
 *
 * 最新 user 始终保持原样。其它 user 消息里会触发最终模型 fallback 的文件，
 * 降级为 filename、原始 URL 或 MIME type 文本，避免纯文本 Provider 再次读取历史媒体。
 */
export function project_model_call_for_execution(
  call: ModelCall,
  model: AIModelDefinition,
): ModelCall {
  const rules = model.fallback;
  if (!rules?.length) return call;
  const latest_user_index = find_latest_user_message_index(call.messages);
  if (latest_user_index < 0) return call;

  let changed = false;
  const messages = call.messages.map((message, message_index) => {
    if (message.role !== "user" || message_index === latest_user_index) return message;
    const content = message.content.map((part) => {
      if (part.type !== "file" || !rules.some((rule) => safe_match(rule, part))) return part;
      changed = true;
      return {
        type: "text" as const,
        text: read_historical_file_reference(part),
      };
    });
    return content.some((part, part_index) => part !== message.content[part_index])
      ? { ...message, content }
      : message;
  });

  return changed ? { ...call, messages } : call;
}

/** 按最新用户消息中的文件和模型级规则决定最终模型。 */
export function resolve_text_routing_plan(
  resolved: AIResolvedAction,
  call: ModelCall,
  mode: string,
  adapter: AIModelRoutingAdapter,
): AIResolvedRoutingPlan {
  const model = resolved.model;
  if (!model?.fallback?.length) return { resolved };
  const user_message = find_latest_user_message(call.messages);
  if (!user_message) return { resolved };
  const files = user_message.content.filter(
    (content): content is ModelFileContent => content.type === "file",
  );
  for (const rule of model.fallback) {
    for (const file of files) {
      const plan = resolve_file_fallback_plan(model.id, rule, file, mode, adapter);
      if (plan) return plan;
    }
  }
  return { resolved };
}

/** 从末尾定位本轮最新的用户消息。 */
function find_latest_user_message(messages: ModelMessage[]): ModelMessage | undefined {
  const index = find_latest_user_message_index(messages);
  return index >= 0 ? messages[index] : undefined;
}

/** 从末尾定位最新用户消息的数组下标。 */
function find_latest_user_message_index(messages: ModelMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

/** 根据单条规则和文件生成 fallback 计划。 */
function resolve_file_fallback_plan(
  source_model_id: string,
  rule: AIModelFallbackRule,
  file: ModelFileContent,
  mode: string,
  adapter: AIModelRoutingAdapter,
): AIResolvedRoutingPlan | undefined {
  if (!safe_match(rule, file)) return undefined;
  const fallback_model = adapter.resolve_model(rule.model_id);
  if (!fallback_model || fallback_model.id === source_model_id) return undefined;
  const action = adapter.resolve_action(fallback_model, mode);
  if (!action || !adapter.is_available(fallback_model)) return undefined;
  return {
    resolved: { model: fallback_model, action },
    fallback_from: source_model_id,
    fallback_reason: "input_requires_media",
    fallback_media_type: file.media_type,
  };
}

/** 安全执行用户提供的 fallback 匹配函数。 */
function safe_match(rule: AIModelFallbackRule, file: ModelFileContent): boolean {
  try {
    return rule.match(file);
  } catch {
    return false;
  }
}

/** 读取历史文件降级为纯文本时使用的稳定引用。 */
function read_historical_file_reference(file: ModelFileContent): string {
  const filename = file.filename?.trim();
  if (filename) return filename;
  if (file.source.type === "url") return file.source.url;
  return file.media_type;
}
