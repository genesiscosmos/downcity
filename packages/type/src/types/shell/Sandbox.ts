/**
 * Shell Sandbox 中立协议。
 *
 * 关键点（中文）
 * - Shell 持有 Provider，Provider 为 Shell 绑定的 Workspace 创建独立且可恢复的隔离环境。
 * - Workspace Sandbox 只暴露命令启动与停止能力，不理解 Agent 或 Chat Session。
 * - 宿主文件只有通过 Workspace 绑定显式授权后才会进入隔离环境的可见范围。
 * - 平台差异（microVM、原生 OS 围栏、云电脑）全部收敛到 Provider，协议不绑定具体实现。
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

/** 隔离环境对宿主目录的访问模式。 */
export type SandboxAccessMode = "ro" | "rw";

/** 隔离环境的出网策略。 */
export type SandboxNetworkMode = "allow" | "deny";

/**
 * 宿主显式授权给隔离环境的一条目录。
 *
 * 关键点（中文）：这里只表达「哪个宿主目录、什么访问模式」，如何翻译成平台规则由 Provider 决定。
 */
export interface WorkspaceSandboxMountRequest {
  /** 宿主侧的真实目录。 */
  host_path: string;
  /** 隔离环境内对该目录的访问模式。 */
  access: SandboxAccessMode;
  /** 申请原因；进入审批展示与审计记录。 */
  reason: string;
}

/**
 * 启动器收到的最终命令。
 *
 * 关键点（中文）：到达这里时平台包装已经完成，启动器只负责创建进程。
 */
export interface SandboxLaunchRequest {
  /** 已经包装完成的可执行文件路径。 */
  command: string;
  /** 已经包装完成的参数列表。 */
  args: readonly string[];
  /** 宿主侧绝对工作目录。 */
  cwd: string;
  /** 交给子进程的环境变量。 */
  env: Readonly<Record<string, string>>;
  /** 本次执行的记录目录，供启动器落盘。 */
  execution_dir: string;
  /** 是否通过 PTY 启动命令。 */
  terminal?: boolean;
  /** PTY 列数。 */
  cols?: number;
  /** PTY 行数。 */
  rows?: number;
}

/**
 * 宿主提供的进程启动能力。
 *
 * 关键点（中文）
 * - 原生隔离 Provider 无法自己创建进程：进程句柄实现（PTY、信号、早到输出缓存）属于 Shell 一侧。
 * - 由 Shell 在绑定 Workspace 时注入；Provider 只把包装好的命令交回来。
 * - 自带执行通道的 Provider（microVM、云电脑）忽略该端口。
 */
export interface SandboxProcessLauncher {
  /** 在宿主启动一个已经包装完成的命令，并返回统一进程句柄。 */
  launch(request: SandboxLaunchRequest): Promise<ShellProcessHandle>;
}

/** 一次失败输出被翻译后的围栏解释。 */
export interface SandboxDenialExplanation {
  /** 被拒绝的宿主路径；无法定位时为空字符串。 */
  path: string;
  /** 机器可读原因码。 */
  code: "read_denied" | "write_denied";
  /** 面向模型的一句话说明。 */
  reason: string;
  /** 当前策略允许写入的根路径，供模型直接换路径重试。 */
  writable_roots: readonly string[];
}

/** Shell 为绑定的 Workspace 创建持久 Sandbox 时提供的绑定信息。 */
export interface WorkspaceSandboxBinding {
  /** Workspace 的稳定业务标识。 */
  workspace_id: string;
  /** 需要显式挂载到隔离环境的宿主项目目录。 */
  workspace_path: string;
  /** Shell 快照、日志等 Downcity 私有运行数据目录。 */
  runtime_path: string;
  /** 除 Workspace 之外显式授权给隔离环境的宿主目录。 */
  granted_mounts?: readonly WorkspaceSandboxMountRequest[];
  /** 隔离环境出网策略；默认允许。 */
  network?: SandboxNetworkMode;
  /** 宿主进程启动器；自带执行通道的 Provider 可以忽略。 */
  launcher?: SandboxProcessLauncher;
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
  /** Workspace 在隔离环境中的固定挂载路径；原生隔离下等于宿主路径。 */
  readonly workspace_path: string;
  /** 在隔离环境中启动一个命令。 */
  spawn(request: SandboxProcessRequest): Promise<ShellProcessResult>;
  /** 返回当前生效的隔离事实；不创建也不启动任何资源。 */
  describe(): WorkspaceSandboxSnapshot;
  /** 停止计算资源但保留文件系统和工具环境。 */
  stop(): Promise<void>;
  /** 删除并重建时由宿主显式调用；普通释放不得删除持久状态。 */
  reset?(): Promise<void>;
  /** 把一次失败输出翻译成可执行的围栏解释；无法定位时返回 null。 */
  explain_denial?(output: string): SandboxDenialExplanation | null;
}

/** Workspace Sandbox 中的一条显式挂载。 */
export interface WorkspaceSandboxMount {
  /** 挂载在宿主侧的真实路径。 */
  host_path: string;
  /** 同一个挂载在隔离环境内的绝对路径。 */
  sandbox_path: string;
  /** 隔离环境内的访问模式。 */
  mode: SandboxAccessMode;
}

/** 隔离环境的读取范围模型。 */
export type SandboxReadScope =
  /** 宿主全部可读，只有显式排除列表不可读；macOS 原生隔离属于这种。 */
  | "host"
  /** 仅显式挂载的目录可读；microVM 与云电脑属于这种。 */
  | "mounts";

/**
 * Workspace Sandbox 的只读自省快照。
 *
 * 关键点（中文）
 * - 只描述隔离环境已经成立的事实，不触发 Sandbox 创建或启动。
 * - `mounts` 只报语义授权（Workspace 与显式授权目录），供路径翻译使用。
 * - `writable_roots` / `read_scope` / `denied_read_paths` 描述真实生效的读写边界，
 *   与 `mounts` 不重叠：后端派生的系统与工具链规则只出现在这里。
 * - `policy_digest` 覆盖完整生效策略，供审计还原当时围栏。
 */
export interface WorkspaceSandboxSnapshot {
  /** Provider 的稳定后端标识，例如 native。 */
  backend: string;
  /** 当前隔离环境的稳定身份，用于跨进程恢复同一个 Sandbox。 */
  sandbox_id: string;
  /** 隔离环境内启动命令时使用的默认工作目录。 */
  workdir: string;
  /** 当前语义授权给隔离环境的宿主目录。 */
  mounts: readonly WorkspaceSandboxMount[];
  /** 当前生效的出网策略。 */
  network: SandboxNetworkMode;
  /** 当前生效的读取范围模型。 */
  read_scope: SandboxReadScope;
  /** 当前允许写入的宿主根路径；写入白名单的真实来源。 */
  writable_roots: readonly string[];
  /** 当前强制拒绝读取的宿主路径；仅在 read_scope 为 host 时生效。 */
  denied_read_paths: readonly string[];
  /** 当前生效完整策略的稳定摘要，用于审计还原与变更比对。 */
  policy_digest: string;
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
