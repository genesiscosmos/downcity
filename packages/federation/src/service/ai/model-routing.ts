/**
 * AI 模型媒体 fallback 路由模块。
 *
 * 路由只读取 Downcity ModelCall 最新用户消息中的文件，不修改完整调用上下文。
 */

import type { ModelCall, ModelFileContent, ModelMessage } from "@downcity/type";
import type {
  AIModelFallbackRule,
  AIModelRoutingAdapter,
  AIResolvedAction,
  AIResolvedRoutingPlan,
} from "../../types/AI.js";

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
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index];
  }
  return undefined;
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
