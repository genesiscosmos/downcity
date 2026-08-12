/**
 * Downcity 平台 Agent Host 的公开类型。
 *
 * Host 只把共享持久化配置解析为一个 native Agent，不拥有 CLI daemon、RPC、HTTP
 * 或 Desktop 窗口生命周期。
 */

import type { Agent } from "@downcity/agent";

/** 创建一个平台 native Agent 的输入。 */
export interface CreatePlatformAgentInput {
  /** Agent Registry 中的稳定 Agent ID。 */
  agent_id: string;

  /** Workspace Registry 中本次运行使用的项目路径。 */
  workspace_path: string;

  /** 需要 HTTP 能力的宿主监听地址；Desktop 可省略。 */
  host?: string;

  /** 需要 HTTP 能力的宿主监听端口；Desktop 可省略。 */
  port?: number;
}

/** 已从共享配置完整装配的 native Agent。 */
export interface PlatformAgentRuntime {
  /** 当前 native Agent 实例，生命周期转移给调用方。 */
  agent: Agent;

  /** 本次运行实际使用的 Workspace 绝对路径。 */
  workspace_path: string;

  /** 为 Session 临时切换模型时创建模型实例。 */
  create_session_model(model_id: string): Promise<NonNullable<Agent["model"]>>;

  /** 从全局与 Workspace 环境文件重新加载并写入当前 Workspace。 */
  reload_workspace_env(): Record<string, string>;
}
