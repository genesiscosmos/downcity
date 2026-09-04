/**
 * Shell 对象入口。
 *
 * 关键点（中文）
 * - Shell 是 Workspace 的主要命令执行对象，拥有 tools、sessions 与 sandbox。
 * - Workspace 组合 Shell 实例，并负责把它绑定到项目资源边界。
 */

import type { ShellHostContext } from "@downcity/type/shell";
import type {
  ShellOptions,
  ShellBinding,
  ShellExecutionContext,
  ShellToolAction,
  ShellToolSet,
} from "@downcity/type/shell";
import type { ShellActionResponse } from "@downcity/type/shell";
import type { ShellRuntimeState } from "@/shell/session/ShellRuntimeTypes.js";
import {
  close_all_shell_sessions,
  close_shell_session,
  create_shell_runtime_state,
  exec_shell_command,
  get_shell_session_status,
  list_shell_sessions,
  read_shell_session,
  start_shell_session,
  wait_shell_session,
  write_shell_session,
} from "@/shell/session/ShellActionRuntime.js";
import { create_shell_tools } from "@/shell/tool/ShellTools.js";
import { resolve_sandbox_policy } from "@/shell/sandbox/SandboxPolicy.js";
import {
  run_sandbox_command,
  type SandboxStartInput,
} from "@/shell/sandbox/Sandbox.js";

/**
 * Shell 运行时对象。
 */
export class Shell {
  /** 当前 Shell 唯一的平台 Sandbox Adapter。 */
  readonly sandbox: ShellOptions["sandbox"];
  /**
   * Shell 内部状态。
   */
  private readonly state: ShellRuntimeState;

  /**
   * Shell 宿主配置。
   */
  private host_options: ShellOptions;

  /**
   * 模型可调用的 shell tools。
   */
  readonly tools: ShellToolSet;

  constructor(options: ShellOptions) {
    this.sandbox = options.sandbox;
    this.host_options = {
      ...options,
      safe_read_only_paths: [...(options.safe_read_only_paths || [])],
    };
    this.state = create_shell_runtime_state();
    this.tools = {
      ...create_shell_tools({
        run_action: async (params) =>
          await this.run_action(
            params.action,
            params.payload,
            params.execution,
          ),
      }),
    };
  }

  /**
   * 将 Shell 一次性绑定到 Workspace 根目录。
   *
   * 关键点（中文）
   * - 同一个 Shell 可以被同一路径重复绑定，方便组合根幂等初始化。
   * - 已绑定后拒绝切换目录，避免活动进程与后续命令跨越 Workspace 安全边界。
   */
  bind(input: ShellBinding): void {
    const next_root_path = String(input?.root_path || "").trim();
    const next_data_path = String(input?.data_path || "").trim();
    if (!next_root_path || !next_data_path) {
      throw new Error("Shell.bind requires root_path and data_path");
    }
    const current_root_path = String(this.host_options.root_path || "").trim();
    const current_data_path = String(this.host_options.data_path || "").trim();
    if (
      (current_root_path && current_root_path !== next_root_path)
      || (current_data_path && current_data_path !== next_data_path)
    ) {
      throw new Error(
        `Shell is already bound to another Agent execution context: ${current_root_path}`,
      );
    }
    this.host_options.root_path = next_root_path;
    this.host_options.data_path = next_data_path;
  }

  /**
   * 释放所有 shell sessions。
   */
  async dispose(): Promise<void> {
    await close_all_shell_sessions(this.state, true);
    for (const session of this.state.sessions.values()) {
      if (session.cleanup_timer) {
        clearTimeout(session.cleanup_timer);
      }
    }
    this.state.sessions.clear();
    this.state.context = null;
    await this.sandbox.dispose?.();
  }

  /**
   * 更新当前 Shell 的 Workspace 基础环境变量。
   *
   * 关键点（中文）
   * - Workspace 在构造和 env 修改时调用本方法。
   * - Session Tool 仍优先使用单个 Step 显式传入的 effective env。
   * - 已启动进程保持创建时的环境，新值只影响后续进程。
   */
  set_env(env: Readonly<Record<string, string>>): void {
    this.host_options.env = { ...env };
  }

  /**
   * 替换 Safe Sandbox 的宿主只读目录。
   *
   * 关键点（中文）
   * - 权限收缩或切换时先关闭活动 shell，避免旧进程继续持有已撤销权限。
   * - 只读目录只影响后续启动的进程，不会扩大 workspace 之外的写权限。
   */
  async set_safe_read_only_paths(paths: string[]): Promise<void> {
    const current_paths = this.host_options.safe_read_only_paths || [];
    const next_paths = Array.from(new Set(
      paths.map((value) => String(value || "").trim()).filter(Boolean),
    ));
    if (
      current_paths.length === next_paths.length &&
      current_paths.every((value, index) => value === next_paths[index])
    ) {
      return;
    }
    const root_path = String(this.host_options.root_path || "").trim();
    const data_path = String(this.host_options.data_path || "").trim();
    if (root_path && data_path) {
      await resolve_sandbox_policy({
        sandbox: this.sandbox,
        root_path: root_path,
        data_path: data_path,
        env: this.host_options.env,
        safe_read_only_paths: next_paths,
        logger: this.host_options.logger,
      }, {
        ...process.env,
        ...this.host_options.env,
      });
    }
    const next_path_set = new Set(next_paths);
    const removes_access = current_paths.some((value) => !next_path_set.has(value));
    if (removes_access) {
      await close_all_shell_sessions(this.state, true);
    }
    this.host_options.safe_read_only_paths = next_paths;
  }

  /**
   * 使用当前 Shell 已配置的 adapter 执行一次 Safe Sandbox 命令。
   *
   * 关键点（中文）：宿主服务复用同一个 Shell 安全边界，无需自行持有平台 adapter。
   */
  async run_safe_command(
    input: Omit<SandboxStartInput, "context" | "sandbox_mode">,
  ): ReturnType<typeof run_sandbox_command> {
    return await run_sandbox_command({
      ...input,
      context: this.create_host_context(),
    });
  }

  private async run_action(
    action: ShellToolAction,
    payload: Record<string, unknown>,
    execution: ShellExecutionContext,
  ): Promise<ShellActionResponse> {
    const session_id = execution.session?.session_id;
    const turn_id = execution.session?.turn_id;
    const context = this.create_host_context(execution);
    const payload_with_context: Record<string, unknown> = {
      ...payload,
      ...(session_id ? { owner_context_id: session_id } : {}),
      ...(turn_id ? { turn_id: turn_id } : {}),
      ...(execution.call_id ? { tool_call_id: execution.call_id } : {}),
    };
    switch (action) {
      case "start":
        return await start_shell_session(this.state, context, payload_with_context as never);
      case "exec":
        return await exec_shell_command(this.state, context, payload_with_context as never);
      case "status":
        return await get_shell_session_status(this.state, context, payload_with_context as never);
      case "read":
        return await read_shell_session(this.state, context, payload_with_context as never);
      case "write":
        return await write_shell_session(this.state, context, payload_with_context as never);
      case "wait":
        return await wait_shell_session(this.state, context, payload_with_context as never);
      case "close":
        return await close_shell_session(this.state, context, payload_with_context as never);
      case "list":
        return await list_shell_sessions(this.state, context, payload_with_context as never);
      default:
        throw new Error(`Unknown shell action: ${String(action)}`);
    }
  }

  /**
   * 根据单次 action 的显式运行上下文构建宿主上下文。
   */
  private create_host_context(
    execution: ShellExecutionContext = {},
  ): ShellHostContext {
    const root_path = String(this.host_options.root_path || "").trim();
    const data_path = String(this.host_options.data_path || "").trim();
    if (!root_path || !data_path) {
      throw new Error("Shell requires root_path and data_path from Agent private runtime directory");
    }
    const session_id = execution.session?.session_id || "";
    const turn_id = execution.session?.turn_id || "";
    return {
      sandbox: this.sandbox,
      root_path: root_path,
      data_path: data_path,
      env: execution.workspace_env || this.host_options.env,
      safe_read_only_paths: this.host_options.safe_read_only_paths,
      config: {},
      logger: this.host_options.logger,
      approval_gateway: execution.approval_gateway,
      shell_integration: {
        get_run_context: () => ({
          ...(session_id ? { session_id: session_id } : {}),
          ...(turn_id ? { turn_id: turn_id } : {}),
        }),
      },
    };
  }

}
