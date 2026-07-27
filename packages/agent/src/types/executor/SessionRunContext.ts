/**
 * SessionRunContext：单次 session run 的显式运行上下文。
 *
 * 关键点（中文）
 * - 这里承载本轮执行过程中需要在多个组件间透传的运行期数据。
 * - 业务侧上下文优先通过该对象显式传递，避免分散读取隐式全局状态。
 * - tool 回调通过单次 tool execution context 显式读取该对象。
 */

import type {
  AgentSessionActionCallback,
  AgentSessionActionEvent,
  AgentSessionActionRecord,
} from "@/types/sdk/AgentSessionAction.js";
import type { SessionUserMessageV1 } from "@/executor/types/SessionRecords.js";
import type { FileUIPart } from "ai";
import type { AgentPluginExecutionLease } from "@/types/plugin/PluginRuntime.js";
import type { ShellApprovalGateway } from "@downcity/shell";
import type { SessionAssistantOutput } from "@/types/executor/SessionAssistantOutput.js";

/**
 * 单次 session run 的运行上下文。
 */
export interface SessionRunContext {
  /**
   * 当前执行所属的 turn 标识。
   *
   * 关键点（中文）
   * - session 是长期对话容器，turn 是单次用户输入触发的执行轮次。
   * - 工具运行时发布 session event 时应优先使用该字段，避免把 session_id 误当 turn_id。
   */
  turn_id?: string;

  /**
   * 当前执行所属的 session 标识。
   */
  session_id: string;

  /**
   * 当前执行所属的项目根目录。
   *
   * 关键点（中文）
   * - 用于 tool/plugin 运行期把二进制资源写入项目级 `.downcity/resources`。
   * - 未提供时，底层资源写入逻辑会回退到当前进程工作目录，兼容旧入口。
   */
  project_root?: string;

  /**
   * step 边界合并回调。
   *
   * 关键点（中文）
   * - 由 Session actor 在 turn 运行期间注入。
   * - 用于把运行中追加的 user 消息并入下一 step。
   */
  on_step_callback?: () => Promise<SessionUserMessageV1[]>;

  /**
   * 判断是否仍有等待并入下一 Session step 的 steer prompt。
   *
   * 关键点（中文）
   * - 只检查 prompt，不把单独的 command 当成继续调用模型的理由。
   * - 真正的队列消费统一发生在 `on_step_callback`。
   */
  has_pending_step_input?: () => boolean;

  /**
   * 消费一次 canonical history 重载请求。
   *
   * 关键点（中文）
   * - QueueCommand 重写持久化历史后返回 true。
   * - CoreEngine 必须在下一次 provider 调用前重新读取 records，并且每次请求只能消费一次。
   */
  consume_history_reload?: () => boolean;

  /**
   * 当前 Session step 实际使用的 Workspace env。
   *
   * 关键点（中文）
   * - 由 Session 统一输入队列在 step 检查点更新。
   * - tool/plugin 调用通过显式 run_context 读取，避免看到刚写入但尚未生效的 env。
   */
  workspace_env?: Readonly<Record<string, string>>;

  /** 当前 Session step 已提交生效的 Agent instruction 文本。 */
  agent_systems?: readonly string[];

  /** 当前 Session step 持有的 Plugin 执行 lease。 */
  agent_plugins?: AgentPluginExecutionLease;

  /** Executor 写入 canonical Assistant Message 使用的唯一输出端口。 */
  assistant_output?: SessionAssistantOutput;

  /** 当前 Session 拥有的 unrestricted 审批网关。 */
  shell_approval_gateway?: ShellApprovalGateway;

  /**
   * action 发布回调。
   *
   * 关键点（中文）
   * - 用于把 compaction 等辅助动作转成 session event 与 action record。
   * - action 不代表 assistant 正文，也不会进入 LLM 输入。
   */
  on_action_callback?: AgentSessionActionCallback;

  /**
   * 当前 turn 的取消信号。
   *
   * 关键点（中文）
   * - `session.stop()` 会触发该 signal。
   * - 模型流、tool-loop 与长耗时 composer 应优先监听它，尽快结束当前 turn。
   */
  abort_signal?: AbortSignal;

  /**
   * 本轮运行中待并入下一 step 的 user 消息。
   *
   * 关键点（中文）
   * - 主要由 tool runtime 在当前 turn 内动态注入。
   * - 这些消息只影响当前执行，不会自动持久化。
   */
  injected_user_messages: SessionUserMessageV1[];

  /**
   * 本轮运行结束后待写入长期历史的 user 消息。
   *
   * 关键点（中文）
   * - 为保证时间线顺序稳定，这些消息会在 assistant 结果落盘之后统一持久化。
   */
  deferred_persisted_user_messages: SessionUserMessageV1[];

  /**
   * 本轮运行结束前待并入最终 assistant 消息的 file parts。
   *
   * 关键点（中文）
   * - 用于 tool/plugin 在执行期产生图片、文件等最终输出。
   * - 这些 part 不依赖模型把 tool result 再复述一遍，直接落入 assistant UIMessage。
   */
  pending_assistant_file_parts: FileUIPart[];
}

export type {
  AgentSessionActionCallback,
  AgentSessionActionEvent,
  AgentSessionActionRecord,
};
