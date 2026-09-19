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
import type {
  SessionModelUserContent,
  SessionUserMessage,
} from "@downcity/type";
import type { SessionAgentContent } from "@downcity/type";
import type { SessionAssistantOutput } from "@/types/turn/SessionAssistantOutput.js";
import type { SessionHookContext } from "@downcity/type";
import type { SessionHookScopeRuntime } from "@downcity/type";
import type {
  AgentSessionActionCallback,
  AgentSessionActionEvent,
} from "@/types/sdk/AgentSessionAction.js";
import type { SessionInteractionPort } from "@downcity/type";
import type { SessionOrigin } from "@downcity/type";
import type { SessionHookContextBlock } from "@downcity/type";
import type { ModelRequestFailureNotice } from "@downcity/type";

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

  /** 在 Step 检查点提交 Session 输入队列；持久化消息由 Composer 重新读取。 */
  commit_step_input?: () => Promise<void>;

  /** 将 Executor 产生的内部模型输入持久化为当前 Turn 的 canonical User Message。 */
  append_internal_user_message?: (
    parts: readonly SessionModelUserContent[],
  ) => Promise<SessionUserMessage>;

  /** 判断是否仍有等待下一个 Step 消费的 User prompt。 */
  has_pending_step_input?: () => boolean;

  /** Executor 写入 canonical Assistant Message 使用的唯一输出端口。 */
  assistant_output?: SessionAssistantOutput;

  /** 当前 Session 执行面创建用户异步交互的端口。 */
  interactions?: SessionInteractionPort;

  /** 当前 Session 提供的 host Shell 审批网关。 */
  shell_approval_gateway?: ShellApprovalGateway;

  /**
   * 当前 Session 提供的统一审批入口。
   *
   * 关键点（中文）
   * - 工具层与 Shell 共用同一实例，因此审批模式只有一处事实源。
   * - 未提供时工具审批回退到直接创建 Interaction（仅限有 interactions 的场景）。
   */
  approval?: SessionApprovalPort;

  /** 当前 Turn effects 追加后触发的实时观测回调，宿主可据此广播文件改动摘要。 */
  on_effects_changed?: (effects: readonly RuntimeToolEffect[]) => void;

  /** 把辅助 Action 持久化并发布为 Session 事件的回调。 */
  publish_action?: AgentSessionActionCallback;

  /** 把内部模型请求失败交给 Session 边界投影。 */
  report_model_request_failure?: (notice: ModelRequestFailureNotice) => void;
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
    readonly hooks?: SessionHookScopeRuntime;

    /** 当前 Turn 首次解析后冻结的 Power 动态上下文。 */
    readonly power_context_blocks: readonly SessionHookContextBlock[];

    /** 原子提交当前 Step 使用的 env 与 instruction 快照。 */
    commit(input: {
      /** 即将在当前 Step 生效的 Workspace env。 */
      workspace_env: Readonly<Record<string, string>>;

      /** 即将在当前 Step 生效的 Agent instruction。 */
      agent_systems: readonly string[];
    }): void;

    /** 切换当前 Step 的 Hook 作用域，并先关闭前一个作用域。 */
    replace_hooks(hooks?: SessionHookScopeRuntime): Promise<void>;

    /** 首次调用时解析并冻结动态上下文，后续 Step 与重试复用同一快照。 */
    resolve_power_context_blocks(
      resolver: () => Promise<readonly SessionHookContextBlock[]>,
    ): Promise<readonly SessionHookContextBlock[]>;

    /** 释放当前 Step 持有的 Power Hook 作用域。 */
    release(): Promise<void>;

    /** 为 City Power 生成只包含稳定、只读运行快照的新对象。 */
    hook_context(call_id?: string): SessionHookContext;
  };

  /** 当前运行的动态 User 输入。 */
  readonly input: {
    /** 登记已经持久化、属于本 Turn 的 canonical User Message。 */
    observe_user_message(message: SessionUserMessage): void;

    /** 返回本 Turn 已登记 User Message 的不可变快照。 */
    user_messages(): readonly SessionUserMessage[];

    /** 提交输入队列；下一 Step 由 Composer 重新读取 canonical history。 */
    checkpoint(): Promise<void>;

    /** 判断是否有等待下一个 Step 消费的 Session prompt。 */
    has_pending(): boolean;

    /** 持久化一条只供模型消费的内部 canonical User Message。 */
    append_internal(parts: readonly SessionModelUserContent[]): Promise<SessionUserMessage>;

  };

  /** 当前运行的 Assistant Message 与辅助 Action 输出能力。 */
  readonly output: {
    /** canonical Assistant Message 的唯一写入端口。 */
    readonly assistant?: SessionAssistantOutput;

    /** 把 Action 产生的 Assistant Parts 加入当前 Step 收口队列。 */
    enqueue_assistant_parts(parts: readonly SessionAgentContent[]): void;

    /** 消费当前 Step 中等待写入 canonical Assistant Message 的 Parts。 */
    take_assistant_parts(): SessionAgentContent[];

    /** 发布一条不进入 LLM 输入的 Session Action。 */
    publish_action(event: AgentSessionActionEvent): Promise<void>;

    /** 把当前 Turn 的内部模型请求失败交给 Session 边界。 */
    report_model_request_failure(
      notice: ModelRequestFailureNotice,
    ): void;
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
    /** 当前 Session 提供的 host 执行审批网关。 */
    readonly approval_gateway?: ShellApprovalGateway;
  };

  /** 当前 Session 的统一审批入口；工具层与 Shell 共用同一实例。 */
  readonly approval?: SessionApprovalPort;
}

/** 工具向当前 Session 提交的一次审批请求。 */
export interface SessionApprovalRequest {
  /** 当前请求所属 Session。 */
  readonly session_id: string;
  /** 当前请求所属 Turn。 */
  readonly turn_id: string;
  /** 当前请求关联的 Tool Call。 */
  readonly tool_call_id: string;
  /** 发起审批的工具名。 */
  readonly tool_name: string;
  /** 已校验的工具输入，原样进入审批 payload。 */
  readonly input: unknown;
  /** 工具用途说明；未声明时省略。 */
  readonly tool_description?: string;
}

/** 一次审批请求的等待句柄。 */
export interface SessionApprovalHandle {
  /** 当前审批请求的稳定标识。 */
  readonly approval_id: string;
  /** 是否真正进入人工审批队列；always-allow 时为 false。 */
  readonly requires_user_decision: boolean;
  /** 最终决定；调用方必须等待该 Promise 后才能继续。 */
  readonly decision: Promise<"approved" | "denied">;
}

/** 当前 Session 的统一审批入口。 */
export interface SessionApprovalPort {
  /**
   * 创建一次工具审批请求，并返回可等待的决定句柄。
   *
   * 关键点（中文）
   * - 审批模式（ask / always-allow）在这里统一生效，调用方不需要自己判断。
   * - 方法名与 Shell 的 `request` 区分：两者请求形状不同，不能共用一个签名。
   */
  request_tool(input: SessionApprovalRequest): Promise<SessionApprovalHandle>;
}

export type {
  AgentSessionActionCallback,
  AgentSessionActionEvent,
};
