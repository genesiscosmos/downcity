/**
 * CLI/City Platform：control plane / managed-agent 类型定义。
 *
 * 关键点（中文）
 * - control plane runtime 自身的进程状态类型仍保留在这里，因为它属于 city control plane 的公开契约。
 * - 多 agent 平台视图、managed agent registry 结构也集中在这里，避免 city/agent 双侧重复维护。
 * - 文件名使用 `Platform`，强调这些类型服务于平台控制面，而不是某个具体 UI 页面实现。
 */

/**
 * 平台控制面中的单个 agent 选项。
 */
export interface PlatformAgentOption {
  /**
   * UI 侧唯一标识（使用 project_root 绝对路径）。
   */
  id: string;

  /**
   * Agent 全局配置中的稳定标识。
   */
  agent_id: string;

  /**
   * agent 项目根目录（绝对路径）。
   */
  project_root: string;

  /**
   * 当前 downcity 托管的 Agent 进程是否存活。
   */
  running: boolean;

  /**
   * 可访问的 runtime 主机地址（已归一化，不会是 0.0.0.0/::）。
   */
  host?: string;

  /**
   * runtime 端口。
   */
  port?: number;

  /**
   * runtime 基础地址（例如 http://127.0.0.1:5314）。
   */
  baseUrl?: string;

  /**
   * registry 首次登记时间（ISO8601）。
   */
  startedAt: string;

  /**
   * registry 最近刷新时间（ISO8601）。
   */
  updated_at: string;

  /**
   * 最近停止时间（ISO8601，可选）。
   */
  stoppedAt?: string;

  /**
   * 当前读取到的 downcity 托管进程 pid（仅 running=true 时有值）。
   */
  daemonPid?: number;

  /**
   * downcity 托管进程日志路径（用于排障展示）。
   */
  logPath?: string;

  /**
   * 当前 agent 的 chat 渠道运行快照。
   */
  chatProfiles?: Array<{
    /**
     * 渠道名（telegram/feishu/qq）。
     */
    channel: string;
    /**
     * 链路状态（connected/disconnected/unknown）。
     */
    linkState?: string;
    /**
     * 状态文案（如 polling/ws_online/config_missing）。
     */
    statusText?: string;
  }>;

  /**
   * 当前 Agent 全局配置绑定的模型 ID。
   */
  modelId?: string;
}

/**
 * `/api/ui/agents` 响应体。
 */
export interface PlatformAgentsResponse {
  /**
   * 请求是否成功。
   */
  success: boolean;

  /**
   * 当前 DC CLI 版本号。
   */
  cityVersion: string;

  /**
   * 当前可选的 agent 列表。
   */
  agents: PlatformAgentOption[];

  /**
   * 当前选中的 agent id（无可用 agent 时为空字符串）。
   */
  selectedAgentId: string;
}

/**
 * 平台控制面使用的本地 GGUF 模型列表响应。
 */
export interface PlatformLocalModelsResponse {
  /**
   * 请求是否成功。
   */
  success: boolean;

  /**
   * 实际扫描使用的模型目录。
   */
  modelsDir: string;

  /**
   * 当前发现的本地模型文件列表。
   */
  models: string[];
}

/**
 * 平台控制面使用的 agent 目录探测结果。
 */
export interface PlatformAgentDirectoryInspection {
  /**
   * 探测的项目绝对路径。
   */
  project_root: string;

  /**
   * 该目录是否已满足最小 agent 初始化条件。
   */
  initialized: boolean;

  /** 该目录是否已出现在 managed agent registry 中。 */
  knownAgent: boolean;

  /**
   * 若已登记，当前 downcity 托管进程是否运行中。
   */
  running: boolean;

  /**
   * 当前目录解析出的 agent id（若存在）。
   */
  agent_id?: string;

  /**
   * 当前读取到的主模型 ID（若存在）。
   */
  modelId?: string;

}

/**
 * 控制面运行时元数据。
 */
export interface ControlPlaneRuntimeMeta {
  /**
   * UI 进程 pid。
   */
  pid: number;

  /**
   * UI 监听主机。
   */
  host: string;

  /**
   * UI 监听端口。
   */
  port: number;

  /**
   * 启动时间（ISO8601）。
   */
  startedAt: string;
}

/**
 * 控制面运行状态视图。
 */
export interface ControlPlaneRuntimeStatus {
  /**
   * UI 是否运行中。
   */
  running: boolean;

  /**
   * UI pid（运行中时有值）。
   */
  pid?: number;

  /**
   * UI 展示主机（运行中时有值）。
   *
   * 说明（中文）
   * - `0.0.0.0` / `::` 会展示为本机可访问地址，避免用户把通配地址复制到浏览器。
   */
  host?: string;

  /**
   * UI 实际绑定主机（运行中时有值）。
   *
   * 说明（中文）
   * - 用于判断当前控制面是否真的以公网模式监听。
   * - 可能是 `127.0.0.1`、`0.0.0.0`、自定义 IP 或域名。
   */
  bindHost?: string;

  /**
   * UI 监听端口（运行中时有值）。
   */
  port?: number;

  /**
   * 可访问 URL（运行中时有值）。
   */
  url?: string;

  /**
   * UI 日志路径。
   */
  logPath: string;

  /**
   * 状态文件路径。
   */
  pidPath: string;
}

/**
 * 平台控制面使用的配置文件状态项。
 */
export interface PlatformConfigFileStatusItem {
  /**
   * 配置状态逻辑名称（例如 `agent_config`、`control_plane_pid`）。
   */
  key: string;

  /**
   * 配置文件分组（`platform` 或 `agent`）。
   */
  scope: "platform" | "agent";

  /**
   * 配置文件展示标签。
   */
  label: string;

  /**
   * 配置文件绝对路径。
   */
  path: string;

  /**
   * 是否存在。
   */
  exists: boolean;

  /**
   * 是否为普通文件。
   */
  isFile: boolean;

  /**
   * 是否可读。
   */
  readable: boolean;

  /**
   * 文件大小（字节）。
   */
  sizeBytes: number;

  /**
   * 最后修改时间（ISO8601）。
   */
  mtime: string;

  /**
   * 归一化状态（ok/missing/error）。
   */
  status: "ok" | "missing" | "error";

  /**
   * 状态原因（例如 `file_not_found`、`not_a_file`）。
   */
  reason: string;
}

/**
 * `/api/ui/config-status` 响应体。
 */
export interface PlatformConfigStatusResponse {
  /**
   * 请求是否成功。
   */
  success: boolean;

  /**
   * 当前选中的 agent id（可能为空）。
   */
  selectedAgentId: string;

  /**
   * 当前选中的 Agent 配置 id（可能为空）。
   */
  selectedAgentProjectId: string;

  /**
   * 配置文件状态列表。
   */
  items: PlatformConfigFileStatusItem[];
}

/**
 * control plane 管理的单条 agent registry 记录。
 */
export interface ManagedAgentRegistryEntry {
  /**
   * agent 项目根目录绝对路径。
   */
  project_root: string;

  /**
   * registry 最近一次记录的 downcity 托管进程 pid。
   */
  pid: number;

  /**
   * 首次登记时间（ISO8601）。
   */
  startedAt: string;

  /**
   * 最近刷新时间（ISO8601）。
   */
  updated_at: string;

  /**
   * registry 记录状态。
   */
  status: "running" | "stopped";

  /**
   * 最近停止时间（仅 stopped 时有值）。
   */
  stoppedAt?: string;
}

/**
 * control plane 管理的 agent registry 文件结构。
 */
export interface ManagedAgentRegistryV1 {
  /**
   * registry schema 版本。
   */
  v: 1;

  /**
   * registry 最近更新时间（ISO8601）。
   */
  updated_at: string;

  /**
   * 当前登记的 agent 列表。
   */
  agents: ManagedAgentRegistryEntry[];
}

/**
 * `downcity agent list --running` 输出可复用的受管 agent 运行态视图。
 */
export interface ManagedAgentProcessView {
  /**
   * agent 项目根目录绝对路径。
   */
  project_root: string;

  /**
   * registry 中登记的 pid。
   */
  registeredPid: number;

  /**
   * 当前实际存活的 downcity 托管进程 pid。
   */
  daemonPid: number;

  /**
   * 当前是否运行中。
   */
  running: boolean;

  /**
   * 首次启动时间（ISO8601）。
   */
  startedAt: string;

  /**
   * 最近更新时间（ISO8601）。
   */
  updated_at: string;

  /**
   * downcity 托管进程日志文件路径。
   */
  logPath: string;
}
