/**
 * AgentModel：Agent 与 Session 统一使用的运行时模型协议。
 *
 * 关键点（中文）
 * - Agent 与 Session 对外统一接收 AgentModel，executor 内部只处理 AI SDK LanguageModel。
 * - CityModel 自身实现 LanguageModelV3，executor 可以直接调用。
 * - 这里不依赖 @downcity/agent，只依赖 @downcity/type 的共享协议。
 */

import {
  isCityModel,
} from "@downcity/type";
import type { LanguageModel } from "ai";

/**
 * Agent SDK 可接受的模型输入。
 */
export type AgentModel = LanguageModel;

/**
 * 将 Agent 可接受的模型输入归一为 AI SDK LanguageModel。
 */
export function normalize_agent_model(model: AgentModel): LanguageModel {
  return model;
}

/**
 * 从 Agent 模型输入读取已声明的上下文窗口。
 *
 * 只有 CityModel 携带可信的模型目录元数据；普通 AI SDK LanguageModel 未声明时返回空。
 */
export function read_agent_model_context_window(
  model: AgentModel | undefined,
): number | undefined {
  if (!model || !isCityModel(model)) return undefined;
  const context_window = model.context_window;
  return Number.isSafeInteger(context_window) && Number(context_window) > 0
    ? Number(context_window)
    : undefined;
}

/**
 * 从 Agent 模型输入推导展示标签。
 */
export function infer_agent_model_label(model: AgentModel | undefined): string | undefined {
  if (!model) return undefined;
  if (isCityModel(model)) return model.name || model.id;
  if (typeof model !== "object") return undefined;
  const record = model as Record<string, unknown>;
  const candidates = [
    record.modelId,
    record.model,
    record.id,
    record.name,
    record.label,
  ];
  for (const candidate of candidates) {
    const label = typeof candidate === "string" ? candidate.trim() : "";
    if (label) return label;
  }
  const constructorName =
    model.constructor && typeof model.constructor.name === "string"
      ? model.constructor.name.trim()
      : "";
  return constructorName || "configured-model";
}
