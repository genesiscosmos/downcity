/**
 * 工具与 Hook 调用环境协议。
 *
 * AgentTool 与 Power Hook 在执行时统一获得这份上下文。它只承载「当前执行身份」，
 * 由 Agent 在每个执行检查点构造并注入；City 侧句柄（storage、config、logger、
 * Workspace 文件端口）不在这里，由 City 在调用时按 Power 补齐。
 *
 * 关键点（中文）
 * - 这是一个值快照，不是运行时对象；工具实现无法借它回查 Agent、Session 或 City。
 * - Workspace 文件、Shell、Power 与自定义工具共享同一份契约，不区分来源。
 */

import type { ModelMessage } from "../model/ModelMessage.js";
import type { SessionOrigin } from "./SessionOrigin.js";
import type { SessionInteractionPort } from "./SessionInteraction.js";
import type { WorkspaceRuntime } from "../workspace/WorkspaceRuntime.js";

/** 调用环境中一条 User 消息的只读文本投影。 */
export interface ToolCallUserMessage {
  /** canonical User Message 的稳定标识。 */
  readonly message_id: string;
  /** 从 canonical 文本 Part 中提取的原始用户文本。 */
  readonly text: string;
}

/** 工具与 Hook 执行时获得的调用环境。 */
export interface ToolCallContext {
  /** 当前 Agent 稳定标识。 */
  readonly agent_id: string;
  /** 当前 Agent 用户可见名称。 */
  readonly agent_name: string;
  /** 当前 Agent 一句话能力描述。 */
  readonly agent_description: string;
  /** 当前 Agent 静态指令快照。 */
  readonly agent_instructions: readonly string[];
  /** 当前 Session 稳定标识。 */
  readonly session_id: string;
  /** 当前 Session 来源，同时也是持久化分区。 */
  readonly session_origin: SessionOrigin;
  /** 当前 Session 绑定的 Workspace 实例；未绑定 Workspace 时为空。 */
  readonly workspace?: WorkspaceRuntime;
  /** 当前 Turn 稳定标识；非 Turn 调用时为空。 */
  readonly turn_id?: string;
  /** 当前调用的协作式取消信号；没有取消来源时为空。 */
  readonly abort_signal?: AbortSignal;
  /** 当前模型工具调用标识；Hook 调用时为空。 */
  readonly tool_call_id?: string;
  /** 当前模型 Step 的完整消息快照；Hook 调用时为空。 */
  readonly messages?: readonly ModelMessage[];
  /** 当前 Turn 的用户消息文本投影。 */
  readonly user_messages?: readonly ToolCallUserMessage[];
  /** 当前 Step 已提交的 Workspace 环境快照。 */
  readonly workspace_env?: Readonly<Record<string, string>>;
  /**
   * 当前 Session 的交互端口。
   *
   * 关键点（中文）：需要用户参与的工具自己发起交互，内核不预判；审批走
   * `interactions.approval`，提问直接走 `interactions.request`。
   */
  readonly interactions?: SessionInteractionPort;
}
