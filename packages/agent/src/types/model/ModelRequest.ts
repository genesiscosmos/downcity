/**
 * Agent 内部模型请求执行类型。
 *
 * 这些类型描述模型请求恢复过程，不依赖 Session 的公开 Mutation 协议。
 */

import type { ModelRequestFailureNotice } from "@downcity/type";

/** 模型请求失败通知回调。 */
export type ModelRequestFailureReporter = (
  notice: ModelRequestFailureNotice,
  /** 保留完整内部错误对象，仅供执行恢复决策使用。 */
  error: unknown,
) => void | Promise<void>;
