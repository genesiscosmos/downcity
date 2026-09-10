/**
 * Session Composer 的上下文策略协议。
 *
 * Policy 只读取 canonical Message，并在自己的命名空间维护可删除、可重建的派生数据；
 * 它不修改 Session Message、State 或 Turn 生命周期。
 */

import type { ModelClient, ModelMessage, SessionSystemBlock } from "@downcity/type";
import type { ModelRequestFailureReporter } from "@/types/executor/ModelRequest.js";
import type { SessionComposerStorage } from "@/types/store/SessionStorage.js";

/** Composer 可以处理的上下文恢复原因。 */
export type SessionContextRecoveryReason =
  /** Provider 明确拒绝超出上下文窗口的请求。 */
  | "provider_context_limit"
  /** Provider usage 已达到主动压缩阈值。 */
  | "usage_pressure";

/** Policy 初始化输入。 */
export interface SessionContextPolicyInitializeInput {
  /** 当前 Policy 已限定命名空间的派生存储。 */
  storage: SessionComposerStorage;
}

/** Policy 正常解析上下文的输入。 */
export interface SessionContextPolicyInput {
  /** 当前 Policy 已限定命名空间的派生存储。 */
  storage: SessionComposerStorage;
  /** 解析文件 Part 时使用的 Workspace 根目录。 */
  project_root: string;
}

/** 上下文恢复输入。 */
export interface SessionContextPolicyRecoveryInput extends SessionContextPolicyInput {
  /** 触发当前恢复的稳定领域原因。 */
  reason: SessionContextRecoveryReason;
  /** 用于生成派生摘要的当前模型。 */
  model?: ModelClient;
  /** 模型请求逐次失败的可选观测入口。 */
  on_model_request_failure?: ModelRequestFailureReporter;
}

/** Policy 对本次模型上下文的只读诊断。 */
export interface SessionResolvedContextDiagnostics {
  /** 生成当前上下文的 Policy 名称。 */
  policy_name: string;
  /** 当前上下文覆盖到的最新 canonical Message sequence。 */
  through_sequence?: number;
  /** 当前派生边界在 Message 内覆盖到的 Part sequence。 */
  through_part_sequence?: number;
  /** 当前上下文是否使用了派生摘要或检索结果。 */
  derived: boolean;
  /** 当前使用的可选派生记录标识。 */
  derivation_id?: string;
}

/** Policy 已确定顺序的最终模型历史。 */
export interface SessionResolvedContext {
  /** 送入模型的标准历史消息。 */
  messages: ModelMessage[];
  /** 由 Policy 生成、且不伪装成普通历史消息的显式 system 上下文。 */
  system_blocks?: SessionSystemBlock[];
  /** 不进入 canonical history 的策略诊断。 */
  diagnostics: SessionResolvedContextDiagnostics;
}

/** Session Composer 内部可替换的上下文策略。 */
export interface SessionContextPolicy {
  /** Policy 稳定名称，同时作为派生表命名空间。 */
  readonly name: string;
  /** 初始化当前 Policy 的派生 schema。 */
  initialize(input: SessionContextPolicyInitializeInput): Promise<void>;
  /** 从 canonical history 与派生数据生成模型历史。 */
  resolve(input: SessionContextPolicyInput): Promise<SessionResolvedContext>;
  /** 模型上下文失败后尝试推进派生状态；发生有效变化时返回 true。 */
  recover(input: SessionContextPolicyRecoveryInput): Promise<boolean>;
}
