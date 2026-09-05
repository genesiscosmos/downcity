/**
 * SessionTurnContext：一次 Session Turn 的统一执行上下文契约。
 *
 * 关键点（中文）
 * - 根对象统一承载一个 Turn 的身份、生命周期、Step、输入和输出协作能力。
 * - 分区用于表达领域职责，不引入多套彼此独立的 Context。
 * - 可变状态只能通过行为方法更新，消费者不能直接操作内部数组、lease 或 callback。
 */

import type { RuntimeToolEffect } from "@downcity/type";
import type { ShellApprovalGateway } from "@downcity/type";
import type { SessionUserMessage } from "@/types/session/SessionMessage.js";
import type { SessionAssistantResultPart } from "@/types/session/SessionContent.js";
import type { SessionAssistantOutput } from "@/types/executor/SessionAssistantOutput.js";
import type { SessionHookContext } from "@/types/session/SessionHook.js";
import type { SessionHookScope } from "@/session/SessionHooks.js";
import type {
  AgentSessionActionCallback,
  AgentSessionActionEvent,
  AgentSessionActionRecord,
} from "@/types/sdk/AgentSessionAction.js";
import type { SessionInteractionPort } from "@/types/session/SessionInteraction.js";
import type { SessionOrigin } from "@/types/session/SessionOrigin.js";
import type { SessionHookContextBlock } from "@/types/session/SessionHook.js";

/**
 * 创建一个 Session Turn 上下文所需的稳定输入。
 *
 * 该类型只服务 SDK 内部装配，不代表另一种运行上下文。
 */
export interface SessionTurnContextInit {
  /** 当前执行所属的 Session 标识。 */
  session_id: string;

  /** 当前执行所属 Session 的完整来源元数据。 */
  session_origin: SessionOrigin;

  /** 当前执行所属的非空 Turn 标识。 */
  turn_id: string;

  /** 当前 Agent 绑定的项目根目录。 */
  project_root?: string;

  /** 上游取消信号；上下文会把它转发到自身拥有的运行生命周期。 */
  abort_signal?: AbortSignal;

  /** 在 Step 检查点消费 Session 队列，并返回应并入模型上下文的 User 消息。 */
  merge_step_input?: () => Promise<SessionUserMessage[]>;

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

  /** 当前 Turn effects 追加后触发的实时观测回调，宿主可据此广播文件改动摘要。 */
  on_effects_changed?: (effects: readonly RuntimeToolEffect[]) => void;

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

    /** 当前执行所属 Session 的完整来源元数据。 */
    readonly origin: SessionOrigin;

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

    /** 当前 Step 持有的稳定 Hook 作用域。 */
    readonly hooks?: SessionHookScope;

    /** 当前 Turn 首次解析后冻结的 Plugin 动态上下文。 */
    readonly plugin_context_blocks: readonly SessionHookContextBlock[];

    /** 原子提交当前 Step 使用的 env 与 instruction 快照。 */
    commit(input: {
      /** 即将在当前 Step 生效的 Workspace env。 */
      workspace_env: Readonly<Record<string, string>>;

      /** 即将在当前 Step 生效的 Agent instruction。 */
      agent_systems: readonly string[];
    }): void;

    /** 切换当前 Step 的 Hook 作用域，并先关闭前一个作用域。 */
    replace_hooks(hooks?: SessionHookScope): Promise<void>;

    /** 首次调用时解析并冻结动态上下文，后续 Step 与重试复用同一快照。 */
    resolve_plugin_context_blocks(
      resolver: () => Promise<readonly SessionHookContextBlock[]>,
    ): Promise<readonly SessionHookContextBlock[]>;

    /** 释放当前 Step 持有的 Plugin Hook 作用域。 */
    release(): Promise<void>;

    /** 为 City Plugin 生成只包含稳定、只读运行快照的新对象。 */
    hook_context(call_id?: string): SessionHookContext;
  };

  /** 当前运行的动态 User 输入及延迟持久化输入。 */
  readonly input: {
    /** 在 Step 边界消费运行期注入消息与 Session 队列消息。 */
    checkpoint(): Promise<SessionUserMessage[]>;

    /** 判断是否有等待下一个 Step 消费的 Session prompt。 */
    has_pending(): boolean;

    /** 注入一条只影响当前运行、在下一 Step 生效的 User 消息。 */
    inject_user_message(message: SessionUserMessage): void;

    /** 延迟到 Assistant 结果落盘后再持久化一条 User 消息。 */
    defer_user_message(message: SessionUserMessage): void;

    /** 返回延迟持久化 User 消息的不可变快照。 */
    deferred_user_messages(): readonly SessionUserMessage[];

    /** 消费一次 canonical history 重载请求。 */
    consume_history_reload(): boolean;
  };

  /** 当前运行的 Assistant Message 与辅助 Action 输出能力。 */
  readonly output: {
    /** canonical Assistant Message 的唯一写入端口。 */
    readonly assistant?: SessionAssistantOutput;

    /** 把 Action 产生的 Assistant Parts 加入当前 Step 收口队列。 */
    enqueue_assistant_parts(parts: readonly SessionAssistantResultPart[]): void;

    /** 消费当前 Step 中等待写入 canonical Assistant Message 的 Parts。 */
    take_assistant_parts(): SessionAssistantResultPart[];

    /** 发布一条不进入 LLM 输入的 Session Action。 */
    publish_action(event: AgentSessionActionEvent): Promise<void>;
  };

  /** 当前 Turn 已经发生、等待在收口检查点投影的 Tool 副作用。 */
  readonly effects: {
    /** 按实际发生顺序追加 Tool 副作用。 */
    append(effects: readonly RuntimeToolEffect[]): void;

    /** 返回当前 Turn 已收集副作用的不可变快照。 */
    snapshot(): readonly RuntimeToolEffect[];
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
