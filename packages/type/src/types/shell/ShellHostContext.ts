/**
 * Shell 宿主上下文类型。
 *
 * 关键点（中文）
 * - 这里只描述 shell / sandbox 需要的最小宿主能力。
 * - 不引用 agent 的 ShellHostContext，避免 shell 包反向绑定 agent session/runtime。
 */

import type { SessionApprovalPort } from "../session/SessionInteraction.js";
import type { WorkspaceSandbox } from "./Sandbox.js";

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
  session_id?: string;
  /**
   * 当前 turn id。
   */
  turn_id?: string;
};

export type ShellHostIntegration = {
  /**
   * 获取当前 Agent / Session Turn 的 Shell 执行上下文。
   */
  get_run_context?(): ShellRunContext | null | undefined;
};

export type ShellHostContext = {
  /** 当前 Workspace 独享的持久 Sandbox。 */
  sandbox: WorkspaceSandbox;
  /**
   * 当前项目根目录。
   */
  root_path: string;
  /** 当前 Agent private runtime directory 的内部数据根目录。 */
  data_path: string;
  /**
   * 传给 shell 的显式环境变量。
   */
  env?: Record<string, string | undefined>;
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
  /** 当前调用注入的统一审批端口；缺失时 host 执行按拒绝处理。 */
  approval_gateway?: SessionApprovalPort;
  /**
   * 宿主注入的 shell 集成能力。
   */
  shell_integration?: ShellHostIntegration;
};
