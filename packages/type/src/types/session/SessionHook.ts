/**
 * Session 检查点值协议。
 *
 * Agent 定义检查点，扩展能力在检查点上贡献内容。这里只描述「检查点看到什么值」，
 * 不描述处理器如何注册或调度：处理器是普通函数，由编译产物直接提供给 Agent。
 */

import type { SessionMessage } from "./SessionMessage.js";
import type { SessionSystemBlock } from "./SessionSystem.js";

/** Hook 在当前 Turn 中返回的一条低权限动态参考内容。 */
export interface SessionHookContextBlock {
  /** 产生当前内容块的 Power 稳定名称。 */
  source_power: string;
  /** Power 内稳定且非空的内容块名称。 */
  name: string;
  /** 需要追加到当前 User 模型消息副本的完整文本。 */
  content: string;
  /** 当前动态内容的信任等级；当前固定为历史参考数据。 */
  trust_level: "reference";
  /** 支撑当前内容的可选稳定逻辑引用。 */
  citations?: string[];
  /** 当前内容块的可选来源版本，用于审计和恢复。 */
  version?: string;
}

/** 当前 Turn 中一条 canonical User Message 的只读文本投影。 */
export interface SessionHookUserMessage {
  /** canonical User Message 的稳定标识。 */
  message_id: string;
  /** 从 canonical 文本 Part 中提取的原始用户文本。 */
  text: string;
}

/** `session.system_context` pipeline 的值。 */
export interface SessionSystemContextHookValue {
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Turn 的稳定标识；非 Turn system 查询时省略。 */
  turn_id?: string;
  /** Pipeline 当前累计的 Session system blocks。 */
  blocks: SessionSystemBlock[];
}

/** `session.turn_context` pipeline 的值。 */
export interface SessionTurnContextHookValue {
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Turn 的稳定标识。 */
  turn_id: string;
  /** 当前 Turn 已提交的 canonical User Message 文本投影。 */
  user_messages: SessionHookUserMessage[];
  /** Pipeline 当前累计的低权限动态内容块。 */
  blocks: SessionHookContextBlock[];
}

/** 一个 canonical Turn 完成后的稳定状态。 */
export type SessionCommittedTurnStatus = "completed" | "failed" | "stopped";

/** `session.turn_committed` effect 的值。 */
export interface SessionTurnCommittedHookValue {
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Turn 的稳定标识。 */
  turn_id: string;
  /** 当前 Turn 的最终提交状态。 */
  status: SessionCommittedTurnStatus;
  /** 当前 Turn 已经持久化完成的 canonical Message 快照。 */
  messages: SessionMessage[];
}
