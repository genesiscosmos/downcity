/**
 * Session Composer 类型。
 *
 * Composer 是唯一回答「这一步模型看到什么」的组件：它把运行快照、canonical history
 * 快照与自己的派生状态组装成一次模型 Step 输入，并在上下文压力出现时推进派生状态。
 *
 * 关键点（中文）
 * - canonical history 与派生存储都由调用方传入，Composer 不主动访问 Session 存储。
 * - 「压缩」不是独立概念，只是 `advance_context()` 的一种实现；不做任何推进也是合法实现。
 * - Composer 不拥有 Message、Turn 或数据库连接生命周期，也不修改 canonical history。
 */

import type { ModelClient, ModelMessage, AgentTool } from "@downcity/type";
import type { SessionSystemMessage } from "@/types/session/SessionPrompts.js";
import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import type { SessionHookContextBlock, SessionMessage } from "@downcity/type";
import type { ModelRequestFailureReporter } from "@/types/model/ModelRequest.js";
import type { SessionDerivedStore } from "@/types/store/SessionStorage.js";

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
  tools: Readonly<Record<string, AgentTool>>;
  /** 当前 Step 生效的 instruction system blocks。 */
  instruction_system_blocks: readonly AgentSessionSystemBlock[];
  /** 当前 Step 捕获的扩展 system blocks。 */
  power_system_blocks: readonly AgentSessionSystemBlock[];
  /** 当前 Turn 冻结的 Power 动态上下文。 */
  power_context_blocks: readonly SessionHookContextBlock[];
}

/** Composer 可读取的当前 Turn 快照。 */
export interface SessionComposeTurn {
  /** 当前 Turn 标识；只读查询时允许为空。 */
  turn_id?: string;
  /** 当前执行已进行的上下文推进次数。 */
  advance_count: number;
}

/** Composer 初始化输入。 */
export interface SessionComposerInitializeInput {
  /** 当前 Composer 命名空间内的派生表事务。 */
  derived: SessionDerivedStore;
}

/** 单次模型输入组装参数。 */
export interface SessionComposeInput {
  /** 当前 Session 身份快照。 */
  session: SessionComposeIdentity;
  /** 当前 Step 已生效的运行状态。 */
  state: SessionComposeState;
  /** 调用方读取的 canonical history 只读快照，按 sequence 升序。 */
  history: readonly SessionMessage[];
  /** 当前 Composer 命名空间内的派生表事务。 */
  derived: SessionDerivedStore;
  /** 当前 Turn 快照。 */
  turn: SessionComposeTurn;
}

/** 触发一次派生上下文推进的稳定领域原因。 */
export type SessionContextAdvanceTrigger =
  /** Provider 明确拒绝超出上下文窗口的请求。 */
  | "provider_context_limit"
  /** Provider usage 已达到主动推进阈值。 */
  | "usage_pressure";

/** 上下文推进输入。 */
export interface SessionContextAdvanceInput {
  /** 当前 Session 身份快照。 */
  session: SessionComposeIdentity;
  /** 调用方读取的 canonical history 只读快照，按 sequence 升序。 */
  history: readonly SessionMessage[];
  /** 当前 Composer 命名空间内的派生表事务。 */
  derived: SessionDerivedStore;
  /** 触发本次推进的稳定领域原因。 */
  trigger: SessionContextAdvanceTrigger;
  /** 用于生成派生摘要的当前模型。 */
  model?: ModelClient;
  /** 模型请求逐次失败的可选观测入口。 */
  on_model_request_failure?: ModelRequestFailureReporter;
}

/** Composer 对本次模型上下文的只读诊断。 */
export interface SessionContextDiagnostics {
  /** 生成当前上下文的 Composer 名称。 */
  composer_name: string;
  /** 当前上下文覆盖到的最新 canonical Message sequence。 */
  through_sequence?: number;
  /** 当前派生边界在 Message 内覆盖到的 Part sequence。 */
  through_part_sequence?: number;
  /** 当前上下文是否使用了派生摘要。 */
  derived: boolean;
  /** 当前使用的可选派生记录标识。 */
  derivation_id?: string;
}

/** Composer 为一次模型 Step 生成的完整输入。 */
export interface SessionStepInput {
  /** 当前 Step 的 system messages。 */
  system: SessionSystemMessage[];
  /** 当前 Step 的可解释 system blocks。 */
  system_blocks?: AgentSessionSystemBlock[];
  /** 当前 Step 已转换完成的标准模型消息。 */
  messages: ModelMessage[];
  /** 当前 Step 可调用的工具集合；执行前由 StepInput 绑定调用环境。 */
  tools: Record<string, AgentTool>;
  /** 本次上下文组装诊断。 */
  context_diagnostics?: SessionContextDiagnostics;
}

/** Session 级可替换 Composer。 */
export interface SessionComposer {
  /**
   * Composer 稳定名称。
   *
   * 关键点（中文）：该值同时作为派生表命名空间，派生表前缀固定为 `composer_<name>_`。
   */
  readonly name: string;
  /** 初始化当前 Composer 的派生 schema；没有派生状态时可以是空实现。 */
  initialize(input: SessionComposerInitializeInput): Promise<void>;
  /** 组装一次模型 Step 使用的最终输入。 */
  compose(input: SessionComposeInput): Promise<SessionStepInput>;
  /** 尝试推进派生上下文状态；发生有效推进时返回 true。 */
  advance_context(input: SessionContextAdvanceInput): Promise<boolean>;
}
