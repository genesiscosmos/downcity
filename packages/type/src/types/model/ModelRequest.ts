/** 模型请求诊断公共协议。 */

import type { ModelError } from "./ModelError.js";

/** Downcity 可识别的模型请求用途。 */
export type ModelRequestKind =
  | "turn"
  | "session_title"
  | "history_compaction"
  | "group_dispatch";

/** 单次模型请求失败的可序列化通知。 */
export interface ModelRequestFailureNotice extends ModelError {
  /** 当前模型请求的用途。 */
  request_kind: ModelRequestKind;
  /** 当前失败是本次请求的第几次调用，从 1 开始。 */
  attempt: number;
  /** 包含首次调用与自动重试在内的最大调用次数。 */
  max_attempts: number;
  /** 当前失败后是否还会自动重试。 */
  will_retry: boolean;
}
