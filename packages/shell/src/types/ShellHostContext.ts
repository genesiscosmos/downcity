/**
 * Shell 宿主上下文类型。
 *
 * 关键点（中文）
 * - 这里只描述 shell / sandbox 需要的最小宿主能力。
 * - 不引用 agent 的 ShellHostContext，避免 shell 包反向绑定 agent session/runtime。
 */

import type { ShellApprovalGateway } from "@/types/ShellApproval.js";
import type { ShellSandboxAdapter } from "@/types/Sandbox.js";

export type ShellLogger = {
  /**
   * 输出 warning 日志。
   */
  warn(message: string, meta?: Record<string, unknown>): void;
};

export type ShellRunContext = {
  /**
   * 当前 session id。
   */
  sessionId?: string;
  /**
   * 当前 turn id。
   */
  turnId?: string;
};

export type ShellHostIntegration = {
  /**
   * 获取当前 Agent / Session Turn 的 Shell 执行上下文。
   */
  getRunContext?(): ShellRunContext | null | undefined;
};

export type ShellHostContext = {
  /** 当前 Shell 强制注入的平台 Sandbox Adapter。 */
  sandbox: ShellSandboxAdapter;
  /**
   * 当前项目根目录。
   */
  rootPath: string;
  /** 当前 AgentWorkspace 的内部数据根目录。 */
  dataPath: string;
  /**
   * 传给 shell 的显式环境变量。
   */
  env?: Record<string, string | undefined>;
  /**
   * 宿主批准给 Safe Sandbox 的额外只读目录。
   *
   * 关键点（中文）
   * - 该能力只能由 Shell 宿主配置，不能来自模型 tool input。
   * - 目录不会获得写权限，且会在启动前完成 realpath 与权限校验。
   */
  safe_read_only_paths?: readonly string[];
  /**
   * Agent 配置的最小视图。
   */
  config?: {
    /**
     * Agent id。
     */
    id?: string;
  };
  /**
   * 可选日志器。
   */
  logger?: ShellLogger;
  /** 当前 Tool 执行上下文注入的 unrestricted 审批网关。 */
  approval_gateway?: ShellApprovalGateway;
  /**
   * 宿主注入的 shell 集成能力。
   */
  shellIntegration?: ShellHostIntegration;
};
