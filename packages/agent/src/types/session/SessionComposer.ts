/**
 * Session Composer 类型。
 *
 * Composer 是最终模型输入的唯一生成者：它组合运行快照、canonical history 与内部
 * Context Policy；不拥有 Message、Turn 或数据库连接生命周期。
 */

import type { ModelClient, ModelMessage, RuntimeTool as Tool } from "@downcity/type";
import type { SessionSystemMessage } from "@/executor/types/SessionPrompts.js";
import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import type { SessionHookContextBlock } from "@downcity/type";
import type { ModelRequestFailureReporter } from "@/types/executor/ModelRequest.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type {
  SessionContextRecoveryReason,
  SessionResolvedContextDiagnostics,
} from "@/types/session/SessionContextPolicy.js";

/** Composer 可读取的 Session 身份快照。 */
export interface SessionComposeIdentity {
  /** 当前 Agent 的稳定标识。 */
  agent_id: string;
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Workspace 的绝对根目录。 */
  project_root: string;
  /** 当前 Session 的创建时间戳。 */
  created_at: number;
  /** 当前 Session 使用的参考时区。 */
  timezone: string;
}

/** Composer 可读取的当前 Step 生效状态。 */
export interface SessionComposeState {
  /** 当前 Step 使用的模型实例。 */
  model?: ModelClient;
  /** 当前模型声明的上下文窗口。 */
  model_context_window?: number;
  /** 当前 Step 生效的 Workspace 环境变量。 */
  env: Readonly<Record<string, string>>;
  /** 当前 Step 生效的 Agent instruction 文本。 */
  systems: readonly string[];
  /** 当前 Step 可使用的工具集合。 */
  tools: Readonly<Record<string, Tool>>;
  /** 当前 Step 生效的 instruction system blocks。 */
  instruction_system_blocks: readonly AgentSessionSystemBlock[];
  /** 宿主注入的受托管 Plugin system blocks。 */
  managed_plugin_system_blocks: readonly AgentSessionSystemBlock[];
  /** 当前 Step 捕获的 Plugin system blocks。 */
  plugin_system_blocks: readonly AgentSessionSystemBlock[];
  /** 当前 Turn 冻结的 Plugin 动态上下文。 */
  plugin_context_blocks: readonly SessionHookContextBlock[];
}

/** Composer 可读取的当前 Turn 快照。 */
export interface SessionComposeTurn {
  /** 当前 Turn 标识；只读查询时允许为空。 */
  turn_id?: string;
  /** 当前执行已进行的上下文恢复次数。 */
  retry_count: number;
}

/** Composer 初始化输入。 */
export interface SessionComposerInitializeInput {
  /** 当前 Session 的统一持久化边界。 */
  storage: SessionStorage;
}

/** 单次模型输入组装参数。 */
export interface SessionComposeInput {
  /** 当前 Session 身份快照。 */
  session: SessionComposeIdentity;
  /** 当前 Step 已生效的运行状态。 */
  state: SessionComposeState;
  /** 当前 Session 的统一持久化边界。 */
  storage: SessionStorage;
  /** 当前 Turn 快照。 */
  turn: SessionComposeTurn;
}

/** 上下文超限后的恢复输入。 */
export interface SessionContextRecoveryInput {
  /** 当前 Session 身份快照。 */
  session: SessionComposeIdentity;
  /** 当前 Session 使用的模型。 */
  model?: ModelClient;
  /** 当前 Session 的统一持久化边界。 */
  storage: SessionStorage;
  /** 触发当前恢复的稳定领域原因。 */
  reason: SessionContextRecoveryReason;
  /** 模型请求逐次失败的可选观测入口。 */
  on_model_request_failure?: ModelRequestFailureReporter;
}

/** Composer 为一次模型 Step 生成的完整输入。 */
export interface SessionStepInput {
  /** 当前 Step 的 system messages。 */
  system: SessionSystemMessage[];
  /** 当前 Step 的可解释 system blocks。 */
  system_blocks?: AgentSessionSystemBlock[];
  /** 当前 Step 已转换完成的标准模型消息。 */
  messages: ModelMessage[];
  /** 当前 Step 可调用的工具集合。 */
  tools: Record<string, Tool>;
  /** 本次上下文策略诊断。 */
  context_diagnostics?: SessionResolvedContextDiagnostics;
}

/** Session 级可替换 Composer。 */
export interface SessionComposer {
  /** Composer 的稳定可读名称。 */
  readonly name: string;
  /** 初始化 Composer 及其内部 Policy。 */
  initialize(input: SessionComposerInitializeInput): Promise<void>;
  /** 组装一次模型 Step 使用的最终输入。 */
  compose(input: SessionComposeInput): Promise<SessionStepInput>;
  /** 尝试推进上下文派生状态；有效推进时返回 true。 */
  recover_context(input: SessionContextRecoveryInput): Promise<boolean>;
}
