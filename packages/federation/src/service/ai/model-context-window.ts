/**
 * AI 模型上下文窗口校验模块。
 *
 * 关键点（中文）
 * - `context_window` 表示模型可接受的总 token 容量，而不是单次最大输出。
 * - 模型目录会把该值公开给 Agent 等调用方，因此注册阶段必须拒绝无效配置。
 */

import type { AIModelDefinition } from "../../types/AI.js";

/**
 * 校验模型上下文窗口配置。
 */
export function validate_model_context_window(model: AIModelDefinition): void {
  const context_window = model.context_window;
  if (context_window === undefined) return;
  if (!Number.isSafeInteger(context_window) || context_window <= 0) {
    throw new Error(
      `Model ${model.id} context_window must be a positive safe integer`,
    );
  }
}
