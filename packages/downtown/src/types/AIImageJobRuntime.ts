/**
 * AI 图片任务运行时内部装配类型。
 *
 * 图片任务运行时通过最小回调读取模型与写入路由结果，避免依赖或持有整个
 * AIService。
 */

import type { ActionFn } from "../service/action.js";
import type { Context } from "../service/service.js";
import type { AIModelDefinition } from "./AI.js";

/** 图片任务运行时解析出的模型 Action。 */
export interface AIImageResolvedAction {
  /** 最终匹配到的可选模型。 */
  model?: AIModelDefinition;
  /** 最终需要执行的模型 Action。 */
  action: ActionFn;
}

/** 图片任务运行时依赖的最小 AIService 能力。 */
export interface AIImageJobRuntimeOptions {
  /** 图片任务允许保持 queued/running 的最长时间；非法值使用内部默认值。 */
  image_max_pending_duration_ms?: number;
  /** 根据模型 ID、运行模式和环境解析最终模型 Action。 */
  resolve_action: (
    query: { model?: string; mode?: string },
    env?: (key: string) => string | undefined,
  ) => AIImageResolvedAction;
  /** 根据稳定模型 ID 读取已注册模型。 */
  resolve_model: (model_id: string) => AIModelDefinition | undefined;
  /** 将图片任务最终模型与运行模式投影到当前 Action Context。 */
  attach_resolved_model: (
    ctx: Context,
    model: AIModelDefinition | undefined,
    mode: string,
  ) => void;
}
