/**
 * Session 模型请求 Warning 投影模块。
 *
 * 本模块是内部模型请求失败与公开 Session Mutation 之间的唯一转换边界。
 */

import type { ModelRequestFailureNotice } from "@downcity/type";
import type { SessionModelRequestWarningMutation } from "@downcity/type";
import { generate_id } from "@/utils/Id.js";

/** 构造公开 Session 模型请求 Warning Mutation。 */
export function create_session_model_request_warning(input: {
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前模型请求所属 Turn；后台 Session 请求允许为空。 */
  turn_id?: string;
  /** 模型请求执行器产生的内部失败通知。 */
  notice: ModelRequestFailureNotice;
}): SessionModelRequestWarningMutation {
  return {
    mutation_id: generate_id(),
    variant: "warning",
    type: "model_request",
    session_id: input.session_id,
    created_at: Date.now(),
    ...(input.turn_id ? { turn_id: input.turn_id } : {}),
    ...input.notice,
  };
}
