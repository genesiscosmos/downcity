/**
 * Shell 对象运行时类型。
 *
 * 关键点（中文）
 * - 这里定义 `new Shell(...)` 对外可见的最小构造参数。
 * - Shell 自己拥有 tools、Shell Sessions 与 Workspace Sandbox。
 * - Sandbox Provider 在 Shell 构造时显式注入，具体 Sandbox 随 Shell 生命周期释放。
 */

import type { RuntimeTool } from "@downcity/type";
import type {
  ShellActionResponse,
} from "./ShellAction.js";
import type { ShellApprovalGateway } from "./ShellApproval.js";
import type { SandboxProvider } from "./Sandbox.js";

/**
 * Shell 运行时日志器。
 */
export interface ShellRuntimeLogger {
  /**
   * 输出 warning 日志。
   */
  warn(message: string, meta?: Record<string, unknown>): void;
}

/** Shell Tool 一次调用获得的最小执行上下文。 */
export interface ShellExecutionContext {
  /** 当前调用所属的 Session 范围。 */
  readonly session?: {
    /** 当前 Session 标识。 */
    readonly session_id: string;
    /** 当前 Turn 标识。 */
    readonly turn_id: string;
  };
  /** 当前 Shell Tool Call 标识。 */
  readonly call_id?: string;
  /** 当前调用的取消信号。 */
  readonly abort_signal?: AbortSignal;
  /** 当前 Session 注入的宿主执行审批网关。 */
  readonly approval_gateway?: ShellApprovalGateway;
  /** 当前 Step 已提交生效的环境变量。 */
  readonly workspace_env?: Readonly<Record<string, string>>;
}

/**
 * Shell tool 的显式执行上下文。
 *
 * 关键点（中文）
 * - 该对象由宿主在每次 `tool.execute` 时通过 `context` 传入。
 * - Shell 只读取自己的字段，不感知 Agent 的 SessionTurnContext。
 */
export interface ShellToolExecutionContext {
  /** 当前 Shell Tool 的执行上下文。 */
  readonly shell_execution_context: ShellExecutionContext;
}

/**
 * Shell 构造参数。
 */
export interface ShellOptions {
  /**
   * 为当前 Shell 创建 Workspace Sandbox 的 Provider。
   *
   * 关键点（中文）
   * - Provider 只负责创建具体隔离环境，不归 City 或 Workspace 持有。
   * - Shell 绑定 Workspace 时创建 Sandbox，并在自身释放时停止 Sandbox。
   */
  sandbox_provider: SandboxProvider;
  /**
   * 传给 shell 子进程的基础环境变量。
   */
  env?: Record<string, string | undefined>;
  /**
   * 可选日志器。
   */
  logger?: ShellRuntimeLogger;
}

/** Shell 绑定到 Agent private runtime directory 时使用的路径。 */
export interface ShellBinding {
  /** 当前 Shell 所属 Workspace 的稳定标识。 */
  workspace_id: string;

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
 * - tool 从 `RuntimeToolExecutionOptions.context` 读取显式运行上下文。
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
    /** 当前 Shell Tool 的执行上下文。 */
    execution: ShellExecutionContext;
  }): Promise<ShellActionResponse>;
}

type JsonObject = Record<string, unknown>;

/**
 * Shell 工具集合。
 */
export type ShellToolSet = Record<string, RuntimeTool>;
