/**
 * Session Hook 运行协议。
 *
 * Hook 检查点属于 Session。City 可以把 Plugin 实现接入这些检查点，但 Agent
 * 不感知 Plugin、City 或其他宿主概念。
 */

import type { JsonValue } from "@/types/common/Json.js";
import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import type { SessionOrigin } from "@/types/session/SessionOrigin.js";
import type { SessionMessage } from "@/types/session/SessionMessage.js";

/** Session 向 Hook 暴露的单次执行快照。 */
export interface SessionHookContext {
  /** 当前 Session 标识；非 Session 调用时为空。 */
  readonly session_id?: string;

  /** 当前 Session 来源；非 Session 调用时为空。 */
  readonly session_origin?: SessionOrigin;

  /** 当前 Turn 标识；非 Turn 调用时为空。 */
  readonly turn_id?: string;

  /** 当前 Workspace 的逻辑根路径。 */
  readonly project_root?: string;

  /** 当前 Step 已提交的 Workspace 环境快照。 */
  readonly workspace_env?: Readonly<Record<string, string>>;

  /** 当前 Step 已提交的 Agent 指令快照。 */
  readonly agent_systems?: readonly string[];

  /** 当前 Turn 的协作式取消信号。 */
  readonly abort_signal?: AbortSignal;

  /** 当前 Tool 或宿主调用的稳定标识。 */
  readonly call_id?: string;
}

/** SessionHooks 与 SessionHookScope 共用的具体处理函数。 */
export interface SessionHookHandlers {
  /** 解析当前执行视图中生效的 system blocks。 */
  readonly system_blocks?: (
    context?: SessionHookContext,
  ) => Promise<AgentSessionSystemBlock[]>;

  /** 按注册顺序运行一个可转换值的 Hook。 */
  readonly pipeline?: <TValue = JsonValue>(
    point_name: string,
    value: TValue,
  ) => Promise<TValue>;

  /** 按注册顺序运行一个只产生副作用的 Hook。 */
  readonly effect?: <TValue = JsonValue>(
    point_name: string,
    value: TValue,
  ) => Promise<void>;

  /** 幂等释放当前 Scope 捕获的长期资源占用。 */
  readonly close?: () => Promise<void>;

  /** 为下一个 Step 捕获一份稳定 Hook 作用域。 */
  readonly open?: () => SessionHookHandlers | Promise<SessionHookHandlers>;
}

/** Hook 在当前 Turn 中返回的一条低权限动态参考内容。 */
export interface SessionHookContextBlock {
  /** 产生当前内容块的 Plugin 稳定名称。 */
  source_plugin: string;

  /** Plugin 内稳定且非空的内容块名称。 */
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
  blocks: AgentSessionSystemBlock[];
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
