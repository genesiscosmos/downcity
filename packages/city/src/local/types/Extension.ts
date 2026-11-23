/**
 * 代码项目扩展的持久协议与宿主端口。
 * 身份、准备目标和活动运行分别记录，避免磁盘快照被误报为在线能力。
 */

/** 可展示且不携带 URL 凭证的来源。 */
export interface ExtensionSource {
  /** 来源类别。 */
  kind: "local" | "git";
  /** 规范本地绝对路径或去凭证 Git 地址。 */
  location: string;
  /** 本地 realpath 或已知仓库规范身份。 */
  identity: string;
  /** 首次确定并保存的分支、限定 tag 或固定 commit。 */
  ref?: string;
  /** 首次是否使用远端默认分支，用于后续别名去重。 */
  default_ref?: boolean;
}

/** 不包含源文件或秘密的错误。 */
export interface ExtensionError {
  /** 稳定机器错误码。 */
  code: string;
  /** 可展示的简短错误。 */
  message: string;
  /** 当前失败阶段。 */
  stage: "source" | "dependencies" | "compile" | "load" | "dispose" | "host";
  /** 明确的非秘密上下文。 */
  details?: Record<string, unknown>;
}

/** 宿主固定并校验的快照引用。 */
export interface ExtensionSnapshot {
  /** 独立编译代次，不能复用 Node 模块缓存。 */
  snapshot_id: string;
  /** 固定源码与编译产物摘要。 */
  integrity: string;
  /** Node 入口相对于代次目录的路径。 */
  entry: string;
  /** 源项目展示名。 */
  name: string;
  /** 实际解析的 Git commit；本地来源不设置。 */
  commit?: string;
  /** 宿主编译器契约版本。 */
  compiler_version: string;
  /** 固定依赖目录内容摘要，浏览器恢复编译前也必须核对。 */
  dependency_integrity: string;
  /** 实际绑定宿主模块位置和 SDK 版本的摘要，升级后不得静默恢复旧绑定。 */
  sdk_signature: string;
  /** 本代次应用的配置版本。 */
  configuration_version: string;
  /** 创建时间。 */
  created_at: string;
}

/** 项目导出成功后确认的能力数量。 */
export interface ExtensionCapabilityCounts {
  /** Power 数量。 */
  powers: number;
  /** Agent 行为定义数量，不是实际 Agent 实例数。 */
  agents: number;
  /** 文本模型数量。 */
  models: number;
  /** Downtown 数量。 */
  downtowns: number;
}

/** 两端统一操作结果；活动字段由当前宿主实时投影。 */
export interface ExtensionResult {
  /** 宿主生成的稳定项目 ID。 */
  extension_id: string;
  /** 最近一次已接受操作 ID。 */
  operation_id: string | null;
  /** 规范来源。 */
  source: ExtensionSource;
  /** 用户可见项目名。 */
  name: string;
  /** 当前状态；removed 只在显式查询中出现。 */
  status: "pending" | "loading" | "ready" | "needs_configuration" | "error" | "removed";
  /** 真实已发布并能接受新请求的运行代次。 */
  active_snapshot: ExtensionSnapshot | null;
  /** 已明确登记但尚未发布的下次目标。 */
  pending_snapshot: ExtensionSnapshot | null;
  /** 入口执行成功后才可确定的数量。 */
  capability_counts: ExtensionCapabilityCounts | null;
  /** 已加载后台能力但部分可选界面不可用等非致命限制。 */
  warnings?: readonly ExtensionError[];
  /** 最近一次操作错误；可以与 ready 并存。 */
  error: ExtensionError | null;
}

/** 安全配置视图；秘密只报告字段是否已有值。 */
export interface ExtensionConfigurationView {
  /** 当前入口明确请求的字段集合。 */
  fields: readonly import("./ExtensionProject.js").ExtensionConfigurationField[];
  /** 待应用普通配置，不包含秘密字段。 */
  config: Record<string, unknown>;
  /** 已保存秘密的字段名。 */
  configured_secrets: string[];
  /** 当前待应用配置版本。 */
  staged_version: string;
  /** 当前确认运行目标的配置版本。 */
  applied_version: string | null;
}

/** 单次操作的持久幂等结果。 */
export interface ExtensionOperation {
  /** 客户端生成或宿主生成的操作 ID。 */
  operation_id: string;
  /** 操作及输入摘要，拒绝同 ID 不同输入。 */
  fingerprint: string;
  /** 本次操作项目。 */
  extension_id: string;
  /** 尚在执行时为空。 */
  result: ExtensionResult | null;
}

/** 持久记录额外保留恢复目标，不把它当成活动运行。 */
export interface ExtensionRecord extends ExtensionResult {
  /** 最新执行入口显式请求的字段，仅来自专用配置请求。 */
  configuration_fields?: readonly import("./ExtensionProject.js").ExtensionConfigurationField[];
  /** 持久启动目标，不根据缓存时间猜测。 */
  target_snapshot: ExtensionSnapshot | null;
  /** 最近成功版本，供准备失败及诊断保留。 */
  successful_snapshot: ExtensionSnapshot | null;
  /** 当前待应用配置版本。 */
  configuration_version: string;
  /** 已保存普通配置版本；秘密只能保存外部引用。 */
  configurations: Record<string, Record<string, unknown>>;
}

/** 准备管线显式依赖，不根据开发仓库路径猜测宿主 SDK。 */
export interface ExtensionPreparationOptions {
  /** 数据根，只在持有租约后写入。 */
  root_path: string;
  /** 当前项目 ID。 */
  extension_id: string;
  /** 本次使用的配置版本。 */
  configuration_version: string;
  /** SDK 包及公开子路径到同一宿主模块的绝对路径映射。 */
  host_modules: Readonly<Record<string, string>>;
  /** 上次明确登记的快照，仅用于兼容依赖解析复用。 */
  previous_snapshot?: ExtensionSnapshot | null;
  /** 下载、采集和编译取消信号。 */
  signal?: AbortSignal;
}

/** 由实际宿主实现生命周期，管理器不创建 City。 */
export interface ExtensionRuntime {
  /** 暂停新请求后检查在途占用；busy 时须恢复原入口。 */
  close_gate: (extension_id: string) => Promise<void>;
  /** 释放上一运行；失败后门禁保持关闭。 */
  release: (extension_id: string) => Promise<void>;
  /** 执行及原子发布全部能力；失败须清理已登记资源。 */
  load: (record: ExtensionRecord, snapshot_path: string) => Promise<ExtensionCapabilityCounts>;
  /** 当前已发布且可以接收请求的代次；唯一运行事实源。 */
  active_snapshot: (extension_id: string) => string | null;
  /** 当前运行的非致命限制，不把后台加载成功写成页面可用。 */
  warnings?: (extension_id: string) => readonly ExtensionError[];
}

/** 管理器构造参数；租约和数据库由上层唯一持有。 */
export interface ExtensionManagerOptions {
  /** 当前规范数据根。 */
  root_path: string;
  /** 同一宿主的 SDK 模块映射。 */
  host_modules: Readonly<Record<string, string>>;
  /** 在线能力端口；离线必须省略。 */
  runtime?: ExtensionRuntime;
}
