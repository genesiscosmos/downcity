/**
 * Shell action 类型定义。
 *
 * 关键点（中文）
 * - `shell_id` 是 shell 会话的唯一标识，与 chat `sessionId` 严格区分。
 * - 这些类型同时服务于 shell runtime 状态管理与 agent tool 协议。
 */

export type ShellSessionStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "killed"
  | "expired";

/**
 * shell 执行 sandbox 模式。
 */
export type ShellSandboxMode = "safe" | "unrestricted";

/**
 * unrestricted sandbox 审批状态。
 */
export type ShellApprovalStatus = "approved" | "denied" | "expired";

/**
 * shell approval 模式。
 *
 * 说明（中文）
 * - `ask` 是默认模式，unrestricted shell 每次执行前都需要用户审批。
 * - `always-allow` 只作用于当前 session，会自动通过本应进入审批队列的 shell 请求。
 * - 该模式不改变 sandbox 权限模型，只影响 approval 是否需要等待人工确认。
 */
export type ShellApprovalMode = "ask" | "always-allow";

/**
 * shell unrestricted sandbox 审批来源工具。
 */
export type ShellApprovalToolName = "shell_exec" | "shell_session" | "shell_write";

/**
 * shell 会话关联的外部引用。
 *
 * 说明（中文）
 * - 用于记录诸如第三方平台 `thread_id`、任务链接等弱结构化引用。
 * - 不要求所有 shell 都存在该信息；仅在可识别时附加。
 */
export type ShellExternalRef = {
  /** 引用类别，例如 `thread_id`。 */
  kind: string;
  /** 引用的原始值。 */
  value: string;
  /** 可选的人类可读标签。 */
  label?: string;
};

/**
 * shell 会话快照。
 *
 * 说明（中文）
 * - 该对象是 shell runtime 对外暴露的统一状态视图。
 * - 内部运行态（child process / waiter 集合）不会暴露给上层。
 */
export type ShellSessionSnapshot = {
  /** shell 唯一标识。 */
  shellId: string;
  /** 发起该 shell 的 chat/context 标识；不存在时表示非聊天上下文触发。 */
  ownerContextId?: string;
  /** 原始命令字符串。 */
  cmd: string;
  /** 命令执行工作目录（绝对路径）。 */
  cwd: string;
  /** 实际使用的 shell 可执行文件路径。 */
  shellPath: string;
  /** 当前 shell 是否运行在 sandbox 中。 */
  sandboxed?: boolean;
  /** 当前 shell 的 Downcity sandbox 模式。 */
  sandboxMode?: ShellSandboxMode;
  /** unrestricted sandbox 审批状态。 */
  approvalStatus?: ShellApprovalStatus;
  /** unrestricted sandbox 审批请求 ID。 */
  approvalId?: string;
  /** unrestricted sandbox 申请原因。 */
  approvalReason?: string;
  /** 当前 shell 是否允许继续写入 stdin。 */
  stdinWritable?: boolean;
  /** 当前 shell 是否通过 PTY 运行。 */
  terminal?: boolean;
  /** PTY 列数；仅 `terminal=true` 时存在。 */
  cols?: number;
  /** PTY 行数；仅 `terminal=true` 时存在。 */
  rows?: number;
  /** 当前 shell 使用的 sandbox backend。 */
  sandboxBackend?: string;
  /** 当前 shell 采用的 sandbox 网络模式。 */
  sandboxNetworkMode?: "off" | "restricted" | "full";
  /** 当前 Safe Sandbox 策略摘要；unrestricted 执行时为空。 */
  sandboxPolicyFingerprint?: string;
  /** 当前 agent 级 sandbox 的持久目录。 */
  sandboxDir?: string;
  /** 当前 shell 在 sandbox 中使用的 HOME。 */
  sandboxHomeDir?: string;
  /** 当前 shell 在 sandbox 中使用的临时目录。 */
  sandboxTmpDir?: string;
  /** 当前 shell 在 sandbox 中使用的 XDG cache 目录。 */
  sandboxCacheDir?: string;
  /** 当前 shell 状态。 */
  status: ShellSessionStatus;
  /** 子进程 pid；若尚未创建成功则为空。 */
  pid?: number;
  /** shell 创建时间戳（毫秒）。 */
  startedAt: number;
  /** 最近一次状态或输出变更时间戳（毫秒）。 */
  updatedAt: number;
  /** shell 结束时间戳（毫秒）；运行中为空。 */
  endedAt?: number;
  /** 进程退出码；运行中为空。 */
  exitCode?: number;
  /** 最近一次收到输出的时间戳（毫秒）。 */
  lastOutputAt?: number;
  /** 最近一小段输出预览，供状态查询快速展示。 */
  lastOutputPreview?: string;
  /** 当前累计输出字符数。 */
  outputChars: number;
  /** 因内存缓存裁剪而丢弃的字符数。 */
  droppedChars: number;
  /** 状态版本号；任意输出/状态变化都递增。 */
  version: number;
  /** 是否在 shell 结束后自动回投到所属 chat，让主 agent 自己回复。 */
  autoNotifyOnExit: boolean;
  /** 自动回投是否已经发送，避免重复通知。 */
  notificationSent: boolean;
  /** 从输出中识别到的外部引用集合。 */
  externalRefs: ShellExternalRef[];
};

/**
 * shell 启动请求。
 */
export type ShellStartRequest = {
  /** 要执行的完整 shell 命令。 */
  cmd: string;
  /** 可选工作目录；为空时回退项目根目录。 */
  cwd?: string;
  /** 可选 shell 路径，例如 `/bin/zsh` 或 `C:\\Windows\\System32\\cmd.exe`。 */
  shell?: string;
  /** POSIX Shell 是否以 login 模式启动；Windows cmd 会忽略该值。 */
  login?: boolean;
  /** 启动后内联等待多久再返回首批状态/输出。 */
  inlineWaitMs?: number;
  /** 单次读取输出返回给模型的 token 上限。 */
  maxOutputTokens?: number;
  /** 显式指定 owner sessionId。 */
  ownerContextId?: string;
  /** 显式指定当前 turn id。 */
  turnId?: string;
  /** 是否在 shell 结束后自动回投主 chat agent。 */
  autoNotifyOnExit?: boolean;
  /** 是否使用 PTY 运行；交互式 session 默认 true，一次性 exec 默认 false。 */
  terminal?: boolean;
  /** PTY 列数；仅 `terminal=true` 时生效。 */
  cols?: number;
  /** PTY 行数；仅 `terminal=true` 时生效。 */
  rows?: number;
  /** 命令执行 sandbox 模式；默认 safe。 */
  sandbox?: ShellSandboxMode;
  /** 请求 unrestricted sandbox 时展示给用户的原因。 */
  reason?: string;
  /** 内部审批来源工具名；普通调用方不需要传。 */
  approvalToolName?: ShellApprovalToolName;
  /**
   * AI SDK 分配给当前 tool 调用的 id。
   *
   * 说明（中文）
   * - 用于让 shell approval 事件与 AI SDK 的 tool-call / tool-result 事件共用同一 toolCallId。
   */
  toolCallId?: string;
};

/**
 * shell 一次性执行请求。
 *
 * 说明（中文）
 * - 适合短命令与无需中途查询状态的场景。
 * - 底层仍复用 shell session 引擎，但调用方不需要管理 `shell_id`。
 */
export type ShellExecRequest = {
  /** 要执行的完整 shell 命令。 */
  cmd: string;
  /** 可选工作目录；为空时回退项目根目录。 */
  cwd?: string;
  /** 可选 shell 路径，例如 `/bin/zsh` 或 `C:\\Windows\\System32\\cmd.exe`。 */
  shell?: string;
  /** POSIX Shell 是否以 login 模式启动；Windows cmd 会忽略该值。 */
  login?: boolean;
  /** 整个一次性执行的总超时时间（毫秒）。 */
  timeoutMs?: number;
  /** 单次读取输出返回给模型的 token 上限。 */
  maxOutputTokens?: number;
  /** 命令执行 sandbox 模式；默认 safe。 */
  sandbox?: ShellSandboxMode;
  /** 请求 unrestricted sandbox 时展示给用户的原因。 */
  reason?: string;
  /** 显式指定 owner sessionId。 */
  ownerContextId?: string;
  /** 显式指定当前 turn id。 */
  turnId?: string;
  /**
   * AI SDK 分配给当前 tool 调用的 id。
   *
   * 说明（中文）
   * - 用于让 shell approval 事件与 AI SDK 的 tool-call / tool-result 事件共用同一 toolCallId。
   */
  toolCallId?: string;
};

/**
 * shell 查询请求。
 *
 * 说明（中文）
 * - `shellId` 优先级最高。
 * - 若未提供 `shellId`，允许在同一 owner context 下按 `cmd` 模糊匹配最近一个会话。
 */
export type ShellQueryRequest = {
  /** 目标 shell_id。 */
  shellId?: string;
  /** 命令关键字；用于在当前 context 下查找最近匹配会话。 */
  cmd?: string;
  /** 显式指定 owner sessionId。 */
  ownerContextId?: string;
  /** 是否允许匹配已结束会话。 */
  includeCompleted?: boolean;
};

/**
 * shell 输出读取请求。
 */
export type ShellReadRequest = ShellQueryRequest & {
  /** 从哪个字符偏移开始读取；默认从头或从最新游标外部自行维护。 */
  fromCursor?: number;
  /** 单次读取输出返回给模型的 token 上限。 */
  maxOutputTokens?: number;
};

/**
 * shell stdin 写入请求。
 */
export type ShellWriteRequest = {
  /** 目标 shell_id。 */
  shellId: string;
  /** 要写入 stdin 的原始文本。 */
  chars: string;
  /** 向 unrestricted shell session 写入 stdin 时展示给用户的原因。 */
  reason?: string;
  /** 显式指定 owner sessionId。 */
  ownerContextId?: string;
  /** 显式指定当前 turn id。 */
  turnId?: string;
  /**
   * AI SDK 分配给当前 tool 调用的 id。
   *
   * 说明（中文）
   * - 用于让 shell approval 事件与 AI SDK 的 tool-call / tool-result 事件共用同一 toolCallId。
   */
  toolCallId?: string;
};

/**
 * shell 等待请求。
 *
 * 说明（中文）
 * - `afterVersion` 用于等待“状态变化”而非模型侧空轮询。
 * - 可同时附带 `fromCursor`，一旦变化就顺便取回新的输出增量。
 */
export type ShellWaitRequest = {
  /** 目标 shell_id。 */
  shellId: string;
  /** 仅当版本号大于该值时才立即返回。 */
  afterVersion?: number;
  /** 读取输出的起始字符游标。 */
  fromCursor?: number;
  /** 最大等待时间（毫秒）。 */
  timeoutMs?: number;
  /** 单次读取输出返回给模型的 token 上限。 */
  maxOutputTokens?: number;
};

/**
 * shell 关闭请求。
 */
export type ShellCloseRequest = {
  /** 目标 shell_id。 */
  shellId: string;
  /** 是否强制 kill（SIGKILL）；默认优雅终止。 */
  force?: boolean;
};

/**
 * shell session 列表请求。
 */
export type ShellListRequest = {
  /** 显式指定 owner sessionId。 */
  ownerContextId?: string;
  /** 是否包含已结束会话；默认 true。 */
  includeCompleted?: boolean;
};

/**
 * shell 输出块。
 *
 * 说明（中文）
 * - 统一用于 `start/read/wait` 的输出增量返回。
 * - `startCursor/endCursor` 采用字符偏移，便于上层自行维护断点。
 */
export type ShellOutputChunk = {
  /** 本次输出块对应的 shell_id。 */
  shellId: string;
  /** 本次读取返回的文本。 */
  output: string;
  /** 本次读取的起始字符游标。 */
  startCursor: number;
  /** 本次读取结束后的字符游标。 */
  endCursor: number;
  /** 原始待读取文本字符数。 */
  originalChars: number;
  /** 原始待读取文本行数。 */
  originalLines: number;
  /** 是否仍有未读输出。 */
  hasMoreOutput: boolean;
};

/**
 * shell runtime 对 agent tool 返回的统一数据结构。
 */
export type ShellActionResponse = {
  /** shell 当前快照。 */
  shell?: ShellSessionSnapshot;
  /** session 列表；仅 `shell_session.list` 返回。 */
  sessions?: ShellSessionSnapshot[];
  /** 可选输出块；仅在 start/read/wait 中返回。 */
  chunk?: ShellOutputChunk;
  /** 操作说明或附加提示。 */
  note?: string;
};
