/**
 * SessionTurnContext：一次 Session Turn 的统一执行上下文契约。
 *
 * 关键点（中文）
 * - 根对象统一承载一个 Turn 的身份、生命周期、Step、输入和输出协作能力。
 * - 分区用于表达领域职责，不引入多套彼此独立的 Context。
 * - 可变状态只能通过行为方法更新，消费者不能直接操作内部数组、lease 或 callback。
 */

import type { UIMessage } from "ai";
import type { ShellApprovalGateway } from "@downcity/workspace";
import type { SessionUserMessageV1 } from "@/executor/types/SessionRecords.js";
import type { SessionAssistantOutput } from "@/types/executor/SessionAssistantOutput.js";
import type { AgentPluginExecutionLease } from "@/types/plugin/PluginRuntime.js";
import type { PluginExecutionContext } from "@/types/plugin/PluginExecutionContext.js";
import type {
  AgentSessionActionCallback,
  AgentSessionActionEvent,
  AgentSessionActionRecord,
} from "@/types/sdk/AgentSessionAction.js";
import type { SessionInteractionPort } from "@/types/session/SessionInteraction.js";

/**
 * 创建一个 Session Turn 上下文所需的稳定输入。
 *
 * 该类型只服务 SDK 内部装配，不代表另一种运行上下文。
 */
export interface SessionTurnContextInit {
  /** 当前执行所属的 Session 标识。 */
  session_id: string;

  /** 当前执行所属的非空 Turn 标识。 */
  turn_id: string;

  /** 当前 Agent 绑定的项目根目录。 */
  project_root?: string;

  /** 上游取消信号；上下文会把它转发到自身拥有的运行生命周期。 */
  abort_signal?: AbortSignal;

  /** 在 Step 检查点消费 Session 队列，并返回应并入模型上下文的 User 消息。 */
  merge_step_input?: () => Promise<SessionUserMessageV1[]>;

  /** 判断是否仍有等待下一个 Step 消费的 User prompt。 */
  has_pending_step_input?: () => boolean;

  /** 消费一次 canonical history 重载请求。 */
  consume_history_reload?: () => boolean;

  /** Executor 写入 canonical Assistant Message 使用的唯一输出端口。 */
  assistant_output?: SessionAssistantOutput;

  /** 当前 Session 执行面创建用户异步交互的端口。 */
  interactions?: SessionInteractionPort;

  /** 当前 Session 拥有的 unrestricted Shell 审批网关。 */
  shell_approval_gateway?: ShellApprovalGateway;

  /** 把辅助 Action 持久化并发布为 Session 事件的回调。 */
  publish_action?: AgentSessionActionCallback;
}

/**
 * 一个 Session Turn 的执行上下文中台。
 */
export interface SessionTurnContext {
  /** 当前运行的稳定身份与项目归属。 */
  readonly session: {
    /** 当前执行所属的 Session 标识。 */
    readonly session_id: string;

    /** 当前执行所属的 Turn 标识。 */
    readonly turn_id: string;

    /** 当前 Agent 绑定的项目根目录。 */
    readonly project_root?: string;
  };

  /** 当前运行的取消与清理生命周期。 */
  readonly lifecycle: {
    /** 模型、Tool 与长耗时任务共同监听的取消信号。 */
    readonly abort_signal: AbortSignal;

    /** 请求停止当前运行；重复调用保持幂等。 */
    abort(reason?: unknown): void;

    /** 释放上游信号监听与当前 Step 资源；重复调用保持幂等。 */
    dispose(): Promise<void>;
  };

  /** 在明确 Step 检查点提交和读取的有效运行快照。 */
  readonly step: {
    /** 当前 Step 已提交生效的 Workspace env 快照。 */
    readonly workspace_env?: Readonly<Record<string, string>>;

    /** 当前 Step 已提交生效的 Agent instruction 快照。 */
    readonly agent_systems: readonly string[];

    /** 当前 Step 持有的 Plugin execution lease；仅供内核执行边界使用。 */
    readonly plugins?: AgentPluginExecutionLease;

    /** 原子提交当前 Step 使用的 env 与 instruction 快照。 */
    commit(input: {
      /** 即将在当前 Step 生效的 Workspace env。 */
      workspace_env: Readonly<Record<string, string>>;

      /** 即将在当前 Step 生效的 Agent instruction。 */
      agent_systems: readonly string[];
    }): void;

    /** 切换当前 Step 的 Plugin lease，并先释放前一个 lease。 */
    replace_plugins(plugins?: AgentPluginExecutionLease): Promise<void>;

    /** 释放当前 Step 持有的 Plugin lease。 */
    release(): Promise<void>;

    /** 为 Plugin 生成只包含稳定、只读运行快照的新对象。 */
    plugin_execution_context(call_id?: string): PluginExecutionContext;
  };

  /** 当前运行的动态 User 输入及延迟持久化输入。 */
  readonly input: {
    /** 在 Step 边界消费运行期注入消息与 Session 队列消息。 */
    checkpoint(): Promise<SessionUserMessageV1[]>;

    /** 判断是否有等待下一个 Step 消费的 Session prompt。 */
    has_pending(): boolean;

    /** 注入一条只影响当前运行、在下一 Step 生效的 User 消息。 */
    inject_user_message(message: SessionUserMessageV1): void;

    /** 延迟到 Assistant 结果落盘后再持久化一条 User 消息。 */
    defer_user_message(message: SessionUserMessageV1): void;

    /** 返回延迟持久化 User 消息的不可变快照。 */
    deferred_user_messages(): readonly SessionUserMessageV1[];

    /** 消费一次 canonical history 重载请求。 */
    consume_history_reload(): boolean;
  };

  /** 当前运行的 Assistant Message 与辅助 Action 输出能力。 */
  readonly output: {
    /** canonical Assistant Message 的唯一写入端口。 */
    readonly assistant?: SessionAssistantOutput;

    /** 把 Action 产生的 Assistant Parts 加入当前 Step 收口队列。 */
    enqueue_assistant_parts(parts: readonly UIMessage["parts"][number][]): void;

    /** 消费当前 Step 中等待写入 canonical Assistant Message 的 Parts。 */
    take_assistant_parts(): UIMessage["parts"];

    /** 发布一条不进入 LLM 输入的 Session Action。 */
    publish_action(event: AgentSessionActionEvent): Promise<void>;
  };

  /** 当前 Session 执行面创建用户异步交互的端口。 */
  readonly interactions?: SessionInteractionPort;

  /** 当前运行可使用的 Shell 协作能力。 */
  readonly shell: {
    /** 当前 Session 拥有的 unrestricted 审批网关。 */
    readonly approval_gateway?: ShellApprovalGateway;
  };
}

export type {
  AgentSessionActionCallback,
  AgentSessionActionEvent,
  AgentSessionActionRecord,
};
