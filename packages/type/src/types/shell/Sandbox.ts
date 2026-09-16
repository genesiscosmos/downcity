/**
 * Shell Sandbox 中立协议。
 *
 * 关键点（中文）
 * - Shell 持有 Provider，Provider 为 Shell 绑定的 Workspace 创建独立且可恢复的隔离环境。
 * - Workspace Sandbox 只暴露命令启动与停止能力，不理解 Agent 或 Chat Session。
 * - 宿主文件只有通过 Workspace 绑定显式挂载后才会进入隔离环境。
 */

/** Sandbox Provider 自检发现的单条问题。 */
export interface SandboxProviderIssue {
  /** 机器可读的问题代码。 */
  code: string;
  /** 面向用户的问题说明。 */
  message: string;
  /** 可直接执行或参考的修复建议。 */
  fixes: string[];
}

/** Sandbox Provider 当前宿主可用性。 */
export interface SandboxProviderStatus {
  /** 当前 Provider 是否可以创建 Workspace Sandbox。 */
  ok: boolean;
  /** Provider 的稳定后端标识。 */
  backend: string;
  /** 自检发现的问题集合。 */
  issues: SandboxProviderIssue[];
}

/** Shell 为绑定的 Workspace 创建持久 Sandbox 时提供的绑定信息。 */
export interface WorkspaceSandboxBinding {
  /** Workspace 的稳定业务标识。 */
  workspace_id: string;
  /** 需要显式挂载到隔离环境的宿主项目目录。 */
  workspace_path: string;
  /** Shell 快照、日志等 Downcity 私有运行数据目录。 */
  runtime_path: string;
}

/** Sandbox 内启动单个命令所需的最小参数。 */
export interface SandboxProcessRequest {
  /** Downcity Shell Session 的稳定标识。 */
  execution_id: string;
  /** 要交给 Shell 解释器执行的完整命令。 */
  cmd: string;
  /** Sandbox 内的绝对工作目录。 */
  cwd: string;
  /** Sandbox 内的 Shell 可执行文件路径。 */
  shell_path: string;
  /** 是否使用 login shell 语义。 */
  login: boolean;
  /** 当前命令显式获得的环境变量快照。 */
  env: Readonly<Record<string, string>>;
  /** 是否通过 PTY 启动命令。 */
  terminal?: boolean;
  /** PTY 列数。 */
  cols?: number;
  /** PTY 行数。 */
  rows?: number;
}

/** pipe、PTY 与远程命令统一进程句柄。 */
export interface ShellProcessHandle {
  /** 当前子进程在执行环境中的 PID。 */
  pid?: number;
  /** 当前进程 stdin 是否仍可写。 */
  readonly writable: boolean;
  /** 注册合并后的 stdout/stderr 输出监听器。 */
  on_data(callback: (chunk: string | Buffer) => void): void;
  /** 注册进程退出监听器。 */
  on_exit(callback: (exit_code: number) => void): void;
  /** 注册进程启动或运行错误监听器。 */
  on_error(callback: (error: Error) => void): void;
  /** 向 stdin 或 PTY 写入原始字符。 */
  write(chars: string): Promise<void>;
  /** 关闭非交互进程的 stdin。 */
  close_stdin?(): void;
  /** 请求结束当前进程。 */
  kill(signal?: NodeJS.Signals): void;
}

/** Shell 在 Sandbox 或宿主启动进程后的中立结果。 */
export interface ShellProcessResult {
  /** 已启动的进程句柄。 */
  child: ShellProcessHandle;
  /** 进程实际使用的工作目录。 */
  cwd: string;
  /** 当前执行后端的稳定标识。 */
  backend: string;
  /** Sandbox 执行时使用的稳定环境身份；host 执行时省略。 */
  sandbox_id?: string;
}

/** 单个 Workspace 独享的持久隔离环境。 */
export interface WorkspaceSandbox {
  /** 当前隔离环境的稳定身份。 */
  readonly id: string;
  /** 当前实现的稳定后端标识。 */
  readonly backend: string;
  /** Workspace 在隔离环境中的固定挂载路径。 */
  readonly workspace_path: string;
  /** 在隔离环境中启动一个命令。 */
  spawn(request: SandboxProcessRequest): Promise<ShellProcessResult>;
  /** 停止计算资源但保留 Sandbox 文件系统和工具环境。 */
  stop(): Promise<void>;
  /** 删除并重建时由宿主显式调用；普通释放不得删除持久状态。 */
  reset?(): Promise<void>;
}

/** Workspace Sandbox 中的一条显式挂载。 */
export interface WorkspaceSandboxMount {
  /** 挂载在宿主侧的真实路径。 */
  host_path: string;
  /** 同一个挂载在隔离环境内的绝对路径。 */
  sandbox_path: string;
  /** 隔离环境内的访问模式。 */
  mode: "ro" | "rw";
}

/**
 * Workspace Sandbox 的只读自省快照。
 *
 * 关键点（中文）
 * - 只描述隔离环境已经成立的事实，不触发 Sandbox 创建或启动。
 * - 消费者用于回答「我在什么环境里跑、什么被挂进来了」，不参与命令执行。
 */
export interface WorkspaceSandboxSnapshot {
  /** Provider 的稳定后端标识，例如 microsandbox。 */
  backend: string;
  /** 当前隔离环境的稳定身份，用于跨进程恢复同一个 Sandbox。 */
  sandbox_id: string;
  /** 隔离环境内启动命令时使用的默认工作目录。 */
  workdir: string;
  /** 当前隔离环境显式挂载的全部宿主目录。 */
  mounts: readonly WorkspaceSandboxMount[];
  /** 停止计算资源后文件系统是否仍然保留。 */
  persistent: boolean;
}

/** Shell 构造时显式注入的 Workspace Sandbox 工厂。 */
export interface SandboxProvider {
  /** Provider 的稳定后端标识。 */
  readonly backend: string;
  /** 检查宿主是否满足隔离环境运行要求。 */
  check(): Promise<SandboxProviderStatus>;
  /** 为一个 Workspace 创建延迟启动的持久隔离环境。 */
  create_workspace(binding: WorkspaceSandboxBinding): WorkspaceSandbox;
}
