/**
 * Shell Sandbox 共享类型。
 *
 * 关键点（中文）
 * - Shell session 负责进程生命周期，Sandbox 只负责按策略启动进程。
 * - 宿主只能增加额外只读目录，不能扩大 workspace 之外的写权限。
 * - 具体平台 adapter 共同消费 Shell 核心生成的同一份已解析策略。
 */

/** Sandbox 网络模式。 */
export type SandboxNetworkMode = "off" | "full";

/** 当前支持的 Sandbox 执行后端。 */
export type SandboxBackend = string;

/**
 * 宿主传入的 Safe Sandbox 扩展能力。
 */
export interface ShellSafePolicy {
  /**
   * 宿主批准的额外只读目录。
   *
   * 说明（中文）
   * - 目录必须是已存在的绝对目录。
   * - 运行时会解析 realpath，并拒绝 group/world writable 目录。
   * - 该字段不能来自模型 tool input 或 workspace 配置。
   */
  read_only_paths: string[];
}

/**
 * 单次 Safe Sandbox 执行使用的最终策略。
 */
export interface ResolvedSandboxPolicy {
  /** 当前平台使用的 Safe Sandbox 后端。 */
  backend: SandboxBackend;
  /** 当前 workspace 根目录绝对路径。 */
  root_path: string;
  /** 当前 agent 级 Sandbox 持久目录。 */
  sandbox_dir: string;
  /** 子进程使用的 HOME。 */
  home_dir: string;
  /** 子进程使用的临时目录。 */
  tmp_dir: string;
  /** 子进程使用的 cache 目录。 */
  cache_dir: string;
  /** 允许导出到子进程的环境变量名称。 */
  env_allowlist: string[];
  /** 最终只读路径集合，所有路径均已经规范化。 */
  read_only_paths: string[];
  /**
   * 宿主显式批准的项目外只读路径。
   *
   * 说明（中文）
   * - 本集合是 `read_only_paths` 的子集，不包含 adapter 自动发现的系统目录。
   * - 需要修改宿主 ACL 的 adapter 只能授权本集合，禁止触碰系统目录。
   */
  host_read_only_paths: string[];
  /** 最终可读写路径集合，固定收敛在 workspace 内。 */
  read_write_paths: string[];
  /** 当前网络访问模式。 */
  network_mode: SandboxNetworkMode;
  /** 当前完整策略的稳定摘要。 */
  fingerprint: string;
}

/**
 * 平台 adapter 解析系统只读目录时使用的宿主输入。
 */
export interface ShellSandboxHostInput {
  /** Sandbox 收敛前的完整基础环境变量。 */
  base_env: NodeJS.ProcessEnv;
}

/** sandbox 预检失败原因。 */
export type SandboxPreflightIssueCode =
  | "unsupported-platform"
  | "missing-command"
  | "userns-disabled"
  | "unsupported-windows-version"
  | "sandbox-runtime-unavailable";

/** 单条 sandbox 预检失败。 */
export interface SandboxPreflightIssue {
  /** 机器可读的失败原因。 */
  code: SandboxPreflightIssueCode;
  /** 人类可读的失败说明。 */
  message: string;
  /** 可复制的修复建议列表。 */
  fixes: string[];
}

/** sandbox adapter 的宿主预检结果。 */
export interface SandboxPreflightResult {
  /** 当前宿主是否满足 adapter 启动要求。 */
  ok: boolean;
  /** 当前宿主平台。 */
  platform: NodeJS.Platform;
  /** 当前 adapter 的稳定后端标识。 */
  backend: SandboxBackend;
  /** 预检发现的问题集合。 */
  issues: SandboxPreflightIssue[];
}

/**
 * Shell 平台 Sandbox Adapter 契约。
 *
 * 关键点（中文）
 * - adapter 只负责宿主探测、系统只读目录和受限进程启动。
 * - workspace 写边界、宿主路径校验和策略指纹始终由 Shell 核心维护。
 */
export interface ShellSandboxAdapter {
  /** 当前 adapter 的稳定后端标识。 */
  readonly backend: SandboxBackend;
  /** 检查当前宿主是否满足 adapter 的运行要求。 */
  preflight(): Promise<SandboxPreflightResult>;
  /** 解析当前平台执行命令必须读取的系统目录。 */
  resolve_system_read_only_paths(input: ShellSandboxHostInput): Promise<string[]>;
  /** 使用已经校验完成的统一策略启动受限进程。 */
  spawn(request: SandboxSpawnRequest): Promise<SandboxSpawnResult>;
  /**
   * 释放 adapter 持有的平台资源。
   *
   * 说明（中文）
   * - 无状态 adapter 可以不实现本方法。
   * - 持有代理、临时 ACL 或平台 broker 的 adapter 必须在这里完成清理。
   * - Shell 会先关闭全部活动 session，再调用本方法。
   */
  dispose?(): Promise<void>;
}

/**
 * 单次 Sandbox 后端启动参数。
 */
export interface SandboxSpawnRequest {
  /** 当前执行记录标识。 */
  execution_id: string;
  /** 当前执行记录目录。 */
  execution_dir: string;
  /** 要执行的完整命令文本。 */
  cmd: string;
  /** 最终工作目录。 */
  cwd: string;
  /** shell 可执行文件路径。 */
  shell_path: string;
  /** 是否使用 login shell 语义。 */
  login: boolean;
  /** Sandbox 收敛前的基础环境变量。 */
  base_env: NodeJS.ProcessEnv;
  /** 当前请求已经解析和校验的 Safe Sandbox 策略。 */
  policy: ResolvedSandboxPolicy;
  /** 是否使用 PTY 启动进程。 */
  terminal?: boolean;
  /** PTY 列数。 */
  cols?: number;
  /** PTY 行数。 */
  rows?: number;
}

/**
 * unrestricted 宿主进程启动参数。
 */
export type UnrestrictedSpawnRequest = Omit<SandboxSpawnRequest, "policy">;

/**
 * pipe 与 PTY 进程统一句柄。
 */
export interface ShellProcessHandle {
  /** 当前子进程 pid。 */
  pid?: number;
  /** 当前进程 stdin 是否仍可写。 */
  readonly writable: boolean;
  /** 注册合并后的 stdout/stderr 输出监听器。 */
  onData(callback: (chunk: string | Buffer) => void): void;
  /** 注册进程退出监听器。 */
  onExit(callback: (exit_code: number) => void): void;
  /** 注册进程启动或运行错误监听器。 */
  onError(callback: (error: Error) => void): void;
  /** 向 stdin 或 PTY 写入原始字符。 */
  write(chars: string): Promise<void>;
  /**
   * 结束 pipe stdin 并向子进程发送 EOF。
   *
   * 说明（中文）
   * - 仅 pipe 句柄提供该能力，PTY session 需要持续保持交互输入。
   * - one-shot 调用必须主动关闭 stdin，避免平台执行器等待输入转发结束而无法退出。
   */
  close_stdin?(): void;
  /** 结束当前子进程。 */
  kill(signal?: NodeJS.Signals): void;
}

/**
 * Sandbox 启动后的统一结果。
 */
export interface SandboxSpawnResult {
  /** 已启动的子进程句柄。 */
  child: ShellProcessHandle;
  /** 子进程实际使用的工作目录。 */
  cwd: string;
  /** 当前进程是否受 Safe Sandbox 限制。 */
  sandboxed: boolean;
  /** 当前执行使用的 Sandbox 模式。 */
  sandbox_mode: "safe" | "unrestricted";
  /** 当前执行使用的后端。 */
  backend: SandboxBackend;
  /** 当前实际网络访问模式。 */
  network_mode: SandboxNetworkMode;
  /** 当前 agent 级 Sandbox 持久目录。 */
  sandbox_dir: string;
  /** 当前子进程 HOME。 */
  home_dir: string;
  /** 当前子进程临时目录。 */
  tmp_dir: string;
  /** 当前子进程 cache 目录。 */
  cache_dir: string;
  /** Safe Sandbox 策略摘要；unrestricted 执行时为空。 */
  policy_fingerprint?: string;
}
