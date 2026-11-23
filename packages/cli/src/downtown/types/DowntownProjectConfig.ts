/**
 * Downtown 项目与部署配置类型。
 *
 * 关键说明（中文）
 * - `downtown.toml` 只描述项目身份和部署意图，不保存运行中的 PID、凭证或健康状态。
 * - 本地启动与云端发布都属于 deployment，由 `fed deploy` 统一执行。
 * - Downtown registry 保存登记记录，本地服务由用户级系统 manager 管理，不依赖当前工作目录。
 */

/** Downtown 当前支持的部署目标。 */
export type DowntownDeploymentTarget = "local" | "cloudflare-workers";

/** Downtown 项目固定类型。 */
export type DowntownProjectType = "downtown";

/** 用户可以覆盖的部署阶段脚本。 */
export interface DowntownDeploymentScriptsConfig {
  /** 覆盖目标内置构建阶段的 shell 命令。 */
  build?: string;
  /** 覆盖 Cloudflare 发布阶段；local 必须执行独立 release 入口，不接受 shell 启动命令。 */
  deploy?: string;
}

/** Cloudflare D1 数据库资源。 */
export interface DowntownProjectD1ResourceConfig {
  /** 资源类型，固定为 Cloudflare D1。 */
  type: "d1";
  /** Worker runtime 中的数据库 binding 名称。 */
  binding: string;
  /** Cloudflare D1 数据库名称。 */
  name: string;
}

/** 已存在的 Cloudflare Hyperdrive PostgreSQL 资源，不自动创建数据库。 */
export interface DowntownProjectHyperdriveResourceConfig {
  /** 资源类型，固定为 Hyperdrive。 */
  type: "hyperdrive";
  /** Worker 中接收 connectionString 的 binding 名称。 */
  binding: string;
  /** 配置读取器从 id 或 id_env 解析并校验的现有 Hyperdrive ID。 */
  id: string;
  /** 可选的 Hyperdrive ID 进程环境变量名；配置输入中与 id 二选一。 */
  id_env?: string;
  /** 准备阶段独立 PG URL 所在的进程环境变量名；仅保存名称，不保存连接值。 */
  database_url_env?: string;
}

/** Cloudflare Queue 资源。 */
export interface DowntownProjectQueueResourceConfig {
  /** 资源类型，固定为 Cloudflare Queue。 */
  type: "queue";
  /** Worker runtime 中的 Queue binding 名称。 */
  binding: string;
  /** Cloudflare Queue 名称。 */
  name: string;
  /**
   * 消息耗尽重试次数后转入的现有死信 Queue 名称，必须为非空字符串。
   * CLI 仅传给 Wrangler consumer，不自动创建该队列；省略时不配置死信队列。
   */
  dead_letter_queue?: string;
  /**
   * 每条消息首次消费失败后的最大重试次数，取 0–100 的整数；0 表示不重试。
   * 省略时使用 Cloudflare 默认值；耗尽后按 consumer 的死信队列配置处理。
   */
  max_retries?: number;
}

/** Cloudflare R2 默认存储资源。 */
export interface DowntownProjectStorageResourceConfig {
  /** 资源类型，固定为 Cloudflare R2。 */
  type: "r2";
  /** Worker runtime 中的 R2 binding 名称。 */
  binding: string;
  /** Cloudflare R2 bucket 名称。 */
  name: string;
  /** R2 文件的公开 URL 前缀。 */
  public_url_prefix: string;
}

/** 部署目标使用的可选资源集合。 */
export interface DowntownProjectResourcesConfig {
  /** Cloudflare Workers 使用的 D1 数据库。 */
  d1?: DowntownProjectD1ResourceConfig;
  /** Cloudflare Workers 使用的现有 PostgreSQL Hyperdrive binding。 */
  hyperdrive?: DowntownProjectHyperdriveResourceConfig;
  /** Cloudflare Workers 使用的异步 Queue。 */
  queue?: DowntownProjectQueueResourceConfig;
  /** Cloudflare Workers 使用的默认文件存储。 */
  storage?: DowntownProjectStorageResourceConfig;
}

/** Local Downtown 的用户级系统服务策略；Cloudflare Workers 不接受此配置。 */
export interface DowntownProcessConfig {
  /**
   * 是否持久启用用户级自动启动，默认 false；只有显式 true 才安装到 macOS LaunchAgents
   * 或启用 Linux systemd default.target.wants。macOS 在用户登录后启动；Linux 需要用户
   * manager 可用，CLI 不自动启用 linger。主动 stop 会禁用自动启动，直到 deploy/restart
   * 显式重新开启；这些操作按配置恢复自动启动策略。
   */
  auto_start: boolean;
  /**
   * 是否在进程异常退出后自动恢复，默认 true；恢复间隔固定为 10 秒，60 秒内最多 5 次。
   * 主动 stop 不触发恢复，且停止状态跨系统重启保留，直到用户显式 deploy/restart。
   */
  restart_on_failure: boolean;
}

/** Downtown 的统一部署声明。 */
export interface DowntownDeploymentConfig {
  /** 部署目标；本地启动也使用 `local` 目标。 */
  target: DowntownDeploymentTarget;
  /** 本地部署监听地址，默认 `127.0.0.1`。 */
  host?: string;
  /** 本地部署固定端口，缺省为 12314；占用时报错，不读取历史端口或自动换端口。 */
  port?: number;
  /** 自定义部署完成后的固定访问 URL。 */
  url?: string;
  /** Local 用户级服务策略；读取器始终补齐默认值，手工构造配置时可以省略。 */
  process?: DowntownProcessConfig;
  /** 对内置构建和部署阶段的脚本覆盖。 */
  scripts?: DowntownDeploymentScriptsConfig;
  /**
   * Cloudflare Workers 的 UTC 定时触发规则，最多 3 条五字段 cron。
   * 按分钟、小时、日、月、星期排列，支持数字、*、范围、列表与步长；星期为 0–6。
   * 例如分钟字段使用每五分钟步长；Worker 需自行实现 scheduled 入口。
   */
  crons?: string[];
  /** 部署目标需要的资源声明。 */
  resources: DowntownProjectResourcesConfig;
}

/** `downtown.toml` 解析后的项目配置。 */
export interface DowntownProjectConfig {
  /** 配置 schema 版本，当前固定为 1。 */
  schema: 1;
  /** 项目类型，固定为 `downtown`。 */
  type: DowntownProjectType;
  /** 跨目录识别同一个 Fed 的稳定唯一 ID。 */
  id: string;
  /** Fed 的用户可见名称。 */
  name: string;
  /** Downtown 构建输入入口，相对项目根目录；local 会编译到独立发布产物。 */
  entry: string;
  /** 本地或云端的统一部署声明。 */
  deployment: DowntownDeploymentConfig;
}

/** 已读取并解析完成的 Downtown 项目配置。 */
export interface DowntownProjectConfigFile {
  /** Downtown 项目根目录绝对路径。 */
  project_dir: string;
  /** `downtown.toml` 的绝对路径。 */
  config_path: string;
  /** 经过完整校验和默认值补齐的配置。 */
  config: DowntownProjectConfig;
}

/** `fed deploy` 解析后的源码位置。 */
export interface DowntownDeploySource {
  /** Downtown 项目根目录。 */
  project_dir: string;
  /** 用户传入的原始路径。 */
  source: string;
}

/** `fed deploy` 命令执行选项。 */
export interface DowntownDeployOptions {
  /** 用户传入的 Downtown 项目路径。 */
  source: string;
  /** 是否只执行目标的 dry-run。 */
  dry_run: boolean;
  /** 是否只验证当前登记实例。 */
  verify_only: boolean;
  /** 是否在部署完成后验证健康状态。 */
  verify: boolean;
  /** 是否跳过内置构建阶段。 */
  skip_build: boolean;
  /** 是否跳过内置类型检查阶段。 */
  skip_typecheck: boolean;
  /** Cloudflare 部署显式使用的 account id。 */
  account_id?: string;
  /** 是否通过基础设施部署权限恢复管理员。 */
  admin_reset: boolean;
  /** 是否跳过管理员恢复的交互确认。 */
  yes: boolean;
}
