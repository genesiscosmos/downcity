/**
 * AI 模型推理强度解析模块。
 *
 * AIService 在最终模型路由完成后调用本模块进行校验和默认值解析。
 * Provider 只能读取这里写入 Context.locals 的可信结果，再映射厂商参数。
 */

import type { Context } from "../service.js";
import type { AIResolvedReasoning } from "../../types/AI.js";
import { httpError } from "../../utils/helpers.js";
import type { AIModelDefinition } from "../../types/AI.js";

/** Context.locals 中保存已解析推理强度的固定字段名。 */
const AI_REASONING_LOCAL_KEY = "ai_reasoning";

/**
 * 在模型注册阶段校验推理能力配置。
 */
export function validate_model_reasoning(model: AIModelDefinition): void {
  const reasoning = model.reasoning;
  if (!reasoning) return;
  if (!Array.isArray(reasoning.efforts) || reasoning.efforts.length === 0) {
    throw new Error(`Model ${model.id} reasoning.efforts must not be empty`);
  }

  const effort_ids = new Set<string>();
  for (const effort of reasoning.efforts) {
    const effort_id = effort.id.trim();
    if (!effort_id) {
      throw new Error(`Model ${model.id} reasoning effort id is required`);
    }
    if (effort.id !== effort_id) {
      throw new Error(`Model ${model.id} reasoning effort id must not contain surrounding whitespace`);
    }
    if (!effort.name.trim()) {
      throw new Error(`Model ${model.id} reasoning effort ${effort_id} name is required`);
    }
    if (effort_ids.has(effort_id)) {
      throw new Error(`Model ${model.id} has duplicate reasoning effort: ${effort_id}`);
    }
    effort_ids.add(effort_id);
  }

  const default_effort = reasoning.default_effort?.trim();
  if (reasoning.default_effort !== undefined && reasoning.default_effort !== default_effort) {
    throw new Error(`Model ${model.id} default reasoning effort must not contain surrounding whitespace`);
  }
  if (reasoning.default_effort !== undefined && !default_effort) {
    throw new Error(`Model ${model.id} default reasoning effort must not be empty`);
  }
  if (default_effort && !effort_ids.has(default_effort)) {
    throw new Error(`Model ${model.id} has unknown default reasoning effort: ${default_effort}`);
  }
}

/**
 * 按最终执行模型解析一次请求的推理强度。
 */
export function resolve_model_reasoning(
  model: AIModelDefinition,
  input: Record<string, unknown>,
): AIResolvedReasoning | undefined {
  if (input.effort_id !== undefined) {
    throw httpError(422, "effort_id is not supported; use reasoning_effort");
  }

  const requested_value = input.reasoning_effort;
  const has_requested_effort = requested_value !== undefined;
  if (has_requested_effort && typeof requested_value !== "string") {
    throw httpError(422, "reasoning_effort must be a string");
  }

  const requested_effort = typeof requested_value === "string"
    ? requested_value.trim()
    : undefined;
  if (has_requested_effort && !requested_effort) {
    throw httpError(422, "reasoning_effort must not be empty");
  }

  const reasoning = model.reasoning;
  if (!reasoning) {
    if (requested_effort) {
      throw httpError(422, `Model ${model.id} does not support reasoning_effort`);
    }
    return undefined;
  }

  const effort = requested_effort ?? reasoning.default_effort?.trim();
  if (!effort) return undefined;
  if (!reasoning.efforts.some((item) => item.id === effort)) {
    throw httpError(422, `Model ${model.id} does not support reasoning_effort: ${effort}`);
  }

  return {
    effort,
    source: requested_effort ? "request" : "default",
  };
}

/**
 * 将已解析推理强度写入 Provider 上下文、请求体和计量元数据。
 */
export function attach_resolved_reasoning(
  ctx: Context,
  reasoning: AIResolvedReasoning | undefined,
): void {
  if (!reasoning) return;
  ctx.locals[AI_REASONING_LOCAL_KEY] = reasoning;
  ctx.input.reasoning_effort = reasoning.effort;
  ctx.metering = {
    ...ctx.metering,
    metadata: {
      ...(ctx.metering?.metadata ?? {}),
      reasoning_effort: reasoning.effort,
      reasoning_effort_source: reasoning.source,
    },
  };
}

/**
 * 读取 AIService 已校验的推理强度。
 */
export function read_resolved_reasoning(ctx: Context): AIResolvedReasoning | undefined {
  const value = ctx.locals[AI_REASONING_LOCAL_KEY];
  if (!value || typeof value !== "object") return undefined;
  const record = value as { effort?: unknown; source?: unknown };
  if (typeof record.effort !== "string") return undefined;
  if (record.source !== "request" && record.source !== "default") return undefined;
  return {
    effort: record.effort,
    source: record.source,
  };
}
