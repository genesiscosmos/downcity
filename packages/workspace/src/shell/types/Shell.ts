/**
 * Shell 工具类型定义。
 *
 * 关键点（中文）
 * - 统一沉淀 `shell_exec` 与 `shell_session` 类型。
 * - `shell_id` 与 chat `sessionId` 严格分离，避免语义混淆。
 */

/**
 * shell 执行 sandbox 模式。
 */
export type ShellSandboxMode = "safe" | "unrestricted";

/**
 * shell unrestricted sandbox 申请原因。
 */
export type ShellUnrestrictedReason = string;

/**
 * 操作交互式 shell session 的输入。
 */
export type ShellSessionInput = {
  /** session 动作。 */
  action: "start" | "send" | "read" | "list" | "stop";
  /** 要启动的命令文本；仅 start 必填。 */
  cmd?: string;
  /** 已存在的 shell session ID；send/read/stop 必填。 */
  shell_id?: string;
  /** 要发送到 PTY 的输入文本；仅 send 使用。 */
  input?: string;
  /** shell 进程的工作目录。 */
  workdir?: string;
  /** 显式指定 shell 可执行文件。 */
  shell?: string;
  /** 是否使用 login shell 语义启动。 */
  login?: boolean;
  /** 启动后内联等待输出的毫秒数。 */
  inline_wait_ms?: number;
  /** send/read 后等待新输出的毫秒数。 */
  wait_ms?: number;
  /** 最多返回多少输出 token。 */
  max_output_tokens?: number;
  /** list 是否包含已结束会话。 */
  include_completed?: boolean;
  /** 进程退出时是否自动通知调用方。 */
  auto_notify_on_exit?: boolean;
  /** stop 是否强制结束子进程。 */
  force?: boolean;
  /** PTY 列数。 */
  cols?: number;
  /** PTY 行数。 */
  rows?: number;
  /** 命令执行 sandbox 模式；默认 safe。 */
  sandbox?: ShellSandboxMode;
  /** 请求 unrestricted sandbox 时展示给用户的原因。 */
  reason?: string;
};

/**
 * 执行一次非持久 shell 命令的输入。
 */
export type ShellExecInput = {
  /** 要执行的命令文本。 */
  cmd: string;
  /** 命令执行工作目录。 */
  workdir?: string;
  /** 显式指定 shell 可执行文件。 */
  shell?: string;
  /** 是否使用 login shell 语义启动。 */
  login?: boolean;
  /** 本次命令执行超时时间。 */
  timeout_ms?: number;
  /** 最多返回多少输出 token。 */
  max_output_tokens?: number;
  /** 命令执行 sandbox 模式；默认 safe。 */
  sandbox?: ShellSandboxMode;
  /** 请求 unrestricted sandbox 时展示给用户的原因。 */
  reason?: string;
};
