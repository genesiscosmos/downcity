/**
 * Shell 对象运行时类型。
 *
 * 关键点（中文）
 * - 这里定义 `new Shell(...)` 对外可见的最小构造参数。
 * - Shell 自己拥有 tools、sessions 与 sandbox；审批状态由宿主 Gateway 管理。
 */

import type { Tool } from "ai";
import type {
  ShellActionResponse,
} from "@/shell/types/ShellAction.js";
import type { ShellApprovalGateway } from "@/shell/types/ShellApproval.js";
import type { ShellSandboxAdapter } from "@/shell/types/Sandbox.js";

/**
 * Shell 运行时日志器。
 */
export interface ShellRuntimeLogger {
  /**
   * 输出 warning 日志。
   */
  warn(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Shell tool 执行时需要的宿主运行上下文。
 *
 * 关键点（中文）
 * - 显式把 session/turn 上下文传给 Shell action。
 * - 由 Agent 在 tool.execute 入口提供，Shell 内部不再读取隐式全局状态。
 */
export interface ShellToolRunContext {
  /**
   * 当前 tool 调用所属的 agent session id。
   */
  ownerContextId?: string;
  /**
   * 当前 tool 调用所属的 turn id。
   */
  turnId?: string;

  /** 当前 Session step 已提交生效的 Agent env。 */
  env?: Readonly<Record<string, string>>;

  /** 当前 Agent Session 注入的 unrestricted 审批网关。 */
  approval_gateway?: ShellApprovalGateway;
}

/**
 * Shell tool 的显式执行上下文。
 *
 * 关键点（中文）
 * - 该对象由宿主在每次 `tool.execute` 时通过 `experimental_context` 传入。
 * - Shell 只读取自己的字段，不感知 Agent 的 SessionTurnContext。
 */
export interface ShellToolExecutionContext {
  /** 当前 Shell tool 调用的 session、turn 与 env 快照。 */
  shell_run_context: ShellToolRunContext;
}

/**
 * Shell 构造参数。
 */
export interface ShellOptions {
  /**
   * 项目根目录。未传时由 Workspace 构造阶段补齐。
   */
  root_path?: string;
  /**
   * Shell、Sandbox 与审计日志使用的内部数据根目录。
   *
   * 该目录必须与项目根目录分离，由 AgentWorkspace 组合阶段显式绑定。
   */
  data_path?: string;
  /**
   * 传给 shell 子进程的基础环境变量。
   */
  env?: Record<string, string | undefined>;
  /**
   * Safe Sandbox 额外允许读取的宿主目录。
   *
   * 说明（中文）
   * - 适合宿主托管的固定版本 CLI、shim 和只读运行时目录。
   * - 目录必须是绝对路径，且不能与 workspace 写边界重叠。
   * - 模型不能通过 `shell_exec` 或 `shell_session` 修改该配置。
   */
  safe_read_only_paths?: string[];
  /**
   * 当前平台的 Sandbox Adapter。
   *
   * 说明（中文）：Shell 核心不选择平台实现，调用方必须在组合根显式注入。
   */
  sandbox: ShellSandboxAdapter;
  /**
   * 可选日志器。
   */
  logger?: ShellRuntimeLogger;
}

/** Shell 绑定到 AgentWorkspace 时使用的路径。 */
export interface ShellBinding {
  /** 命令实际执行和文件权限约束使用的项目根目录。 */
  root_path: string;

  /** Shell、Sandbox 与审计产物使用的内部数据根目录。 */
  data_path: string;
}

/**
 * Shell tool action 名称。
 */
export type ShellToolAction =
  | "start"
  | "exec"
  | "status"
  | "read"
  | "write"
  | "wait"
  | "close"
  | "list";

/**
 * Shell tool 执行器协议。
 *
 * 关键点（中文）
 * - tool 从 `ToolExecutionOptions.experimental_context` 读取显式运行上下文。
 * - `run_action` 显式携带 session、turn 与 env，Shell 内部不读取隐式全局状态。
 */
export interface ShellToolRunner {
  /**
   * 执行 shell action。
   */
  run_action(params: {
    /**
     * action 名称。
     */
    action: ShellToolAction;
    /**
     * action payload。
     */
    payload: Record<string, unknown>;
    /**
     * 当前 tool 调用所属的 agent session id。
     */
    ownerContextId?: string;
    /**
     * 当前 tool 调用所属的 turn id。
     */
    turnId?: string;
    /** 当前 Session step 已提交生效的环境变量。 */
    env?: Readonly<Record<string, string>>;
    /** 当前 Session 注入的 unrestricted 审批网关。 */
    approval_gateway?: ShellApprovalGateway;
    /**
     * AI SDK 分配给当前 tool 调用的 id。
     *
     * 关键点（中文）
     * - Session Tool Runtime 使用它把完整输入、审批和输出投影到同一个 Tool Part。
     */
    toolCallId?: string;
  }): Promise<ShellActionResponse>;
}

type JsonObject = Record<string, unknown>;

/**
 * Shell 工具集合。
 */
export type ShellToolSet = Record<string, Tool>;
