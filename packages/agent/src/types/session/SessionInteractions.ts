/**
 * SessionInteractions 运行时状态类型。
 *
 * 这里只描述内存中的等待句柄；Interaction 的权威状态始终保存在
 * SessionMessages 的 Assistant Interaction Part 中。
 */

import type {
  SessionInteractionRequest,
  SessionInteractionResult,
} from "@/types/session/SessionInteraction.js";

/** 单个等待用户响应的运行时 Interaction。 */
export interface SessionPendingInteractionRuntime {
  /** 已经持久化的完整 Interaction 请求。 */
  request: SessionInteractionRequest;
  /** 兑现原执行等待 Promise 的回调。 */
  resolve: (result: SessionInteractionResult) => void;
  /** 自动过期计时器；没有 expires_at 时省略。 */
  timer?: ReturnType<typeof setTimeout>;
}
