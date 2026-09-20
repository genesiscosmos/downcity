/**
 * Workspace Shell。
 *
 * 关键点（中文）
 * - Shell 属于 Workspace，并持有与 Chat Session 独立的 Shell Sessions。
 * - Shell 构造时接收 Sandbox Provider，并拥有由它创建的 Workspace Sandbox。
 * - 默认命令进入当前 Workspace 独享的持久 Sandbox，host 目标必须经过审批。
 */

import path from "node:path";
import type {
  ShellActionResponse,
  ShellBinding,
  ShellExecutionContext,
  ShellHostContext,
  ShellOptions,
  ShellToolAction,
  ShellToolSet,
  SandboxProcessLauncher,
  SandboxProvider,
  WorkspaceSandbox,
  WorkspaceSandboxSnapshot,
  WorkspaceShellSandboxCommandInput,
} from "@downcity/type/shell";
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
import { run_sandbox_command } from "@/shell/sandbox/Sandbox.js";
import { create_sandbox_process_launcher } from "@/shell/sandbox/SandboxLauncher.js";

/** Workspace 命令与长期进程服务。 */
export class Shell {
  /** 当前 Shell 的实例级运行状态。 */
  private readonly state: ShellRuntimeState;
  /** 构造期宿主配置。 */
  private readonly options: ShellOptions;
  /** 为当前 Shell 创建具体 Workspace Sandbox 的 Provider。 */
  private readonly sandbox_provider: SandboxProvider;
  /** 宿主进程启动器；原生隔离 Provider 依赖它创建本地进程。 */
  private readonly launcher: SandboxProcessLauncher;
  /** Workspace env 的最新快照。 */
  private env: Record<string, string | undefined>;
  /** 当前 Shell 的一次性 Workspace 绑定。 */
  private binding?: ShellBinding;
  /** 当前 Workspace 交给 Shell 使用的持久 Sandbox。 */
  private sandbox?: WorkspaceSandbox;
  /** Shell 首次释放产生的稳定 Promise，保证资源只收口一次。 */
  private dispose_promise?: Promise<void>;
  /** 模型可调用的 Shell tools。 */
  readonly tools: ShellToolSet;

  constructor(options: ShellOptions) {
    if (!options?.sandbox_provider) {
      throw new Error("Shell requires sandbox_provider");
    }
    this.options = { ...options };
    this.sandbox_provider = options.sandbox_provider;
    this.launcher = create_sandbox_process_launcher();
    this.env = { ...(options.env || {}) };
    this.state = create_shell_runtime_state();
    this.tools = create_shell_tools({
      run_action: async (params) =>
        await this.run_action(params.action, params.payload, params.execution),
    });
  }

  /** 将 Shell 一次性绑定到 Workspace，并创建由自身持有的持久 Sandbox。 */
  bind(input: ShellBinding): void {
    const workspace_id = String(input?.workspace_id || "").trim();
    const root_path = String(input?.root_path || "").trim();
    const data_path = String(input?.data_path || "").trim();
    if (!workspace_id || !root_path || !data_path) {
      throw new Error(
        "Shell.bind requires workspace_id, root_path and data_path",
      );
    }
    const next_binding: ShellBinding = {
      workspace_id,
      root_path: path.resolve(root_path),
      data_path: path.resolve(data_path),
    };
    if (this.binding) {
      if (
        this.binding.workspace_id !== next_binding.workspace_id
        || this.binding.root_path !== next_binding.root_path
        || this.binding.data_path !== next_binding.data_path
      ) {
        throw new Error("Shell is already bound to Workspace: " + this.binding.workspace_id);
      }
      return;
    }
    const sandbox = this.sandbox_provider.create_workspace({
      workspace_id: next_binding.workspace_id,
      workspace_path: next_binding.root_path,
      runtime_path: next_binding.data_path,
      ...(input.granted_mounts ? { granted_mounts: input.granted_mounts } : {}),
      ...(input.network ? { network: input.network } : {}),
      launcher: this.launcher,
    });
    this.sandbox = sandbox;
    this.binding = next_binding;
  }

  /** 关闭全部 Shell Sessions，再停止 Sandbox 计算资源并保留持久文件系统。 */
  async dispose(): Promise<void> {
    this.dispose_promise ??= (async () => {
      const errors: unknown[] = [];
      try {
        await this.close_sessions();
      } catch (error) {
        errors.push(error);
      }
      try {
        await (this.sandbox?.stop() ?? Promise.resolve());
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) throw new AggregateError(errors, "Shell dispose failed");
    })();
    await this.dispose_promise;
  }

  /** 关闭现有 Shell Sessions，并显式删除、重建当前持久 Sandbox。 */
  async reset_sandbox(): Promise<void> {
    const sandbox = this.require_sandbox();
    const results = await Promise.allSettled([
      this.close_sessions(),
    ]);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    if (errors.length > 0) {
      throw new AggregateError(errors, "Shell sessions close failed before Sandbox reset");
    }
    if (!sandbox.reset) {
      throw new Error(`Sandbox Provider ${this.sandbox_provider.backend} does not support reset`);
    }
    await sandbox.reset();
  }

  /** 更新后续命令使用的 Workspace 环境变量。 */
  set_env(env: Readonly<Record<string, string>>): void {
    this.env = { ...env };
  }

  /**
   * 返回当前 Workspace Sandbox 的只读自省快照。
   *
   * 关键点（中文）
   * - 只读取已经成立的绑定与 Sandbox 实例，不创建也不启动 Sandbox。
   * - 生效事实由 Provider 回答，Shell 不再自行拼装挂载列表。
   */
  describe_sandbox(): WorkspaceSandboxSnapshot | null {
    if (!this.sandbox || !this.binding) return null;
    return this.sandbox.describe();
  }

  /** 在当前 Workspace 的持久 Sandbox 中执行一次短命令。 */
  async run_sandbox_command(input: WorkspaceShellSandboxCommandInput) {
    const context = this.create_host_context();
    const execution_dir = path.join(
      this.require_binding().data_path,
      "commands",
      input.execution_id,
    );
    return await run_sandbox_command({
      context,
      execution_id: input.execution_id,
      execution_dir,
      cmd: input.cmd,
      cwd: input.cwd,
      shell_path: input.shell_path,
      login: input.login,
      env: { ...this.env, ...input.env },
      terminal: input.terminal,
      cols: input.cols,
      rows: input.rows,
    });
  }

  /** 将模型 Tool action 路由到当前 Shell 实例。 */
  private async run_action(
    action: ShellToolAction,
    payload: Record<string, unknown>,
    execution: ShellExecutionContext,
  ): Promise<ShellActionResponse> {
    const session_id = execution.session?.session_id;
    const turn_id = execution.session?.turn_id;
    const context = this.create_host_context(execution);
    const request = {
      ...payload,
      ...(session_id ? { owner_context_id: session_id } : {}),
      ...(turn_id ? { turn_id } : {}),
      ...(execution.call_id ? { tool_call_id: execution.call_id } : {}),
    };
    switch (action) {
      case "start":
        return await start_shell_session(this.state, context, request as never);
      case "exec":
        return await exec_shell_command(this.state, context, request as never);
      case "status":
        return await get_shell_session_status(this.state, context, request as never);
      case "read":
        return await read_shell_session(this.state, context, request as never);
      case "write":
        return await write_shell_session(this.state, context, request as never);
      case "wait":
        return await wait_shell_session(this.state, context, request as never);
      case "close":
        return await close_shell_session(this.state, context, request as never);
      case "list":
        return await list_shell_sessions(this.state, context, request as never);
      default:
        throw new Error("Unknown shell action: " + String(action));
    }
  }

  /** 根据单次 Tool 调用创建 Shell 最小宿主上下文。 */
  private create_host_context(execution: ShellExecutionContext = {}): ShellHostContext {
    const binding = this.require_binding();
    const sandbox = this.require_sandbox();
    const session_id = execution.session?.session_id || "";
    const turn_id = execution.session?.turn_id || "";
    return {
      sandbox,
      launcher: this.launcher,
      root_path: binding.root_path,
      data_path: binding.data_path,
      env: execution.workspace_env || this.env,
      config: {},
      logger: this.options.logger,
      approval_gateway: execution.approval_gateway,
      shell_integration: {
        get_run_context: () => ({
          ...(session_id ? { session_id } : {}),
          ...(turn_id ? { turn_id } : {}),
        }),
      },
    };
  }

  /** 返回已完成的一次性 Workspace 绑定。 */
  private require_binding(): ShellBinding {
    if (!this.binding) {
      throw new Error("Shell must be bound to a Workspace before execution");
    }
    return this.binding;
  }

  /** 返回 Shell 自己持有的具体 Workspace Sandbox。 */
  private require_sandbox(): WorkspaceSandbox {
    if (!this.sandbox) {
      throw new Error("Shell must be bound to a Workspace before Sandbox access");
    }
    return this.sandbox;
  }

  /** 关闭并清理全部 Shell Sessions；单个关闭失败不阻止内存状态收口。 */
  private async close_sessions(): Promise<void> {
    const results = await Promise.allSettled([close_all_shell_sessions(this.state, true)]);
    for (const session of this.state.sessions.values()) {
      if (session.cleanup_timer) clearTimeout(session.cleanup_timer);
    }
    this.state.sessions.clear();
    this.state.context = null;
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    if (errors.length > 0) throw new AggregateError(errors, "Shell sessions close failed");
  }
}
