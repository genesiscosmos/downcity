/**
 * SessionLocalState：本地 Session 运行态快照。
 *
 * 关键点（中文）
 * - 这里承载本地 Session 在内存中的可变运行态。
 * - `SessionState` 与 `Session` 共享该对象，避免重复维护配置状态。
 * - 这里只保存运行态，不承载行为逻辑。
 */

import type { AgentSessionConfigSnapshot } from "@/types/agent/SessionTypes.js";

/**
 * 本地 Session 内存状态。
 */
export interface SessionLocalState {
  /**
   * 当前 session 配置快照。
   */
  session_config: AgentSessionConfigSnapshot;

  /**
   * 当前 Session step 实际使用的 Session 配置。
   *
   * 关键点（中文）
   * - `session_config` 是配置 API 最近一次成功写入的 configured state。
   * - 该字段只在 Session step 检查点由队列 mutation 更新。
   */
  effective_session_config: AgentSessionConfigSnapshot;

  /**
   * 当前 session 创建时间（毫秒时间戳）。
   */
  created_at: number;

  /**
   * 当前 session 参考时区。
   */
  timezone: string;

  /**
   * initialize() 过程中的并发复用 Promise。
   */
  initialize_promise: Promise<void> | null;

  /**
   * ensure_ready_for_execution() 过程中的并发复用 Promise。
   */
  ensure_configured_promise: Promise<void> | null;
}
