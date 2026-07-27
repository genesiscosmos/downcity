/**
 * SessionState 构造与配置变更类型。
 *
 * 这些类型只描述 Session 配置和 Metadata 状态，不承载 Message 行为。
 */

import type { LanguageModel } from "ai";
import type { SessionMessages } from "@/session/SessionMessages.js";
import type { AgentSessionConfigSnapshot } from "@/types/agent/SessionTypes.js";
import type { SessionLocalState } from "@/types/session/SessionLocalState.js";
import type { SessionMutation } from "@/types/session/SessionMutation.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { SessionStore } from "@/types/store/SessionStore.js";

/** SessionState 构造参数。 */
export interface SessionStateOptions {
  /** 当前 Agent 的稳定标识。 */
  agent_id: string;
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Session 独享的领域持久化视图。 */
  store: SessionStore;
  /** 当前 Session 的 canonical Message 入口。 */
  messages: SessionMessages;
  /** 当前 Session 的可变内存状态。 */
  state: SessionLocalState;
  /** 当前 Session 的运行日志器。 */
  logger: Logger;
  /** 在执行前补齐宿主级配置的异步钩子。 */
  ensure_configured_hook?: () => Promise<void>;
  /** 按 Session 优先、Agent 兜底规则读取当前模型。 */
  get_model: () => LanguageModel | undefined;
  /** 发布 Session Mutation 的函数。 */
  publish_event: (mutation: SessionMutation) => void;
}

/** Session 配置写入选项。 */
export interface SessionSetOptions {
  /** 是否为本次配置变化生成 Model Switching Action。 */
  emit_action?: boolean;
}

/** 等待在 Session Step 检查点提交的模型变化。 */
export interface SessionConfiguredModelChange {
  /** 下一 Session Step 使用的完整配置快照。 */
  config: AgentSessionConfigSnapshot;
  /** 配置提交后需要写入的可选 Action 标识。 */
  action_id?: string;
  /** 配置提交后需要写入的可选 Action 标题。 */
  action_title?: string;
}

/** Session 配置成功写入后的领域结果。 */
export interface SessionConfiguredStateResult {
  /** 需要由 Session 创建 Command 的模型变化。 */
  model_change?: SessionConfiguredModelChange;
}
