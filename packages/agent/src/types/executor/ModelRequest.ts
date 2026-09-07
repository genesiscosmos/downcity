/**
 * Agent 内部模型请求执行类型。
 *
 * 这些类型描述模型请求恢复过程，不依赖 Session 的公开 Mutation 协议。
 */

import type { ModelErrorCode } from "@downcity/type";

/** Agent 内部可识别的模型请求用途。 */
export type ModelRequestKind =
  | "turn"
  | "session_title"
  | "history_compaction"
  | "group_dispatch";

/** 单次模型请求失败的内部通知。 */
export interface ModelRequestFailureNotice {
  /** 当前模型请求的用途。 */
  request_kind: ModelRequestKind;
  /** Downcity 稳定模型错误码。 */
  code: ModelErrorCode;
  /** 可安全展示给调用方的错误说明。 */
  message: string;
  /** Provider 是否声明该错误允许安全重试。 */
  retryable: boolean;
  /** 当前失败是本次请求的第几次调用，从 1 开始。 */
  attempt: number;
  /** 包含首次调用与自动重试在内的最大调用次数。 */
  max_attempts: number;
  /** 当前失败后模型请求执行器是否继续自动重试。 */
  will_retry: boolean;
  /** Provider 返回的可选请求标识。 */
  provider_request_id?: string;
}

/** 模型请求失败通知回调。 */
export type ModelRequestFailureReporter = (
  notice: ModelRequestFailureNotice,
  /** 保留完整内部错误对象，仅供执行恢复决策使用。 */
  error: unknown,
) => void | Promise<void>;
