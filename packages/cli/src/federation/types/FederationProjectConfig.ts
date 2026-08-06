/**
 * Federation 项目与部署配置类型。
 *
 * 关键说明（中文）
 * - `federation.json` 只描述项目身份和部署意图，不保存运行中的 PID、凭证或健康状态。
 * - 本地启动与云端发布都属于 deployment，由 `fed deploy` 统一执行。
 * - 系统级运行状态保存在 Federation registry，不依赖当前工作目录。
 */

/** Federation 当前支持的部署目标。 */
export type FederationDeploymentTarget = "local" | "cloudflare-workers";

/** Federation 项目固定类型。 */
export type FederationProjectType = "federation";

/** 用户可以覆盖的部署阶段脚本。 */
export interface FederationDeploymentScriptsConfig {
  /** 覆盖目标内置构建阶段的 shell 命令。 */
  build?: string;
  /** 覆盖目标内置部署或本地启动阶段的 shell 命令。 */
  deploy?: string;
}

/** Cloudflare D1 数据库资源。 */
export interface FederationProjectD1ResourceConfig {
  /** 资源类型，固定为 Cloudflare D1。 */
  type: "d1";
  /** Worker runtime 中的数据库 binding 名称。 */
  binding: string;
  /** Cloudflare D1 数据库名称。 */
  name: string;
}

/** Cloudflare Queue 资源。 */
export interface FederationProjectQueueResourceConfig {
  /** 资源类型，固定为 Cloudflare Queue。 */
  type: "queue";
  /** Worker runtime 中的 Queue binding 名称。 */
  binding: string;
  /** Cloudflare Queue 名称。 */
  name: string;
}

/** Cloudflare R2 默认存储资源。 */
export interface FederationProjectStorageResourceConfig {
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
export interface FederationProjectResourcesConfig {
  /** Cloudflare Workers 使用的 D1 数据库。 */
  d1?: FederationProjectD1ResourceConfig;
  /** Cloudflare Workers 使用的异步 Queue。 */
  queue?: FederationProjectQueueResourceConfig;
  /** Cloudflare Workers 使用的默认文件存储。 */
  storage?: FederationProjectStorageResourceConfig;
}

/** Federation 的统一部署声明。 */
export interface FederationDeploymentConfig {
  /** 部署目标；本地启动也使用 `local` 目标。 */
  target: FederationDeploymentTarget;
  /** 本地部署监听地址，默认 `127.0.0.1`。 */
  host?: string;
  /** 本地部署固定端口；缺省时从 12314 开始自动分配。 */
  port?: number;
  /** 自定义部署完成后的固定访问 URL。 */
  url?: string;
  /** 对内置构建和部署阶段的脚本覆盖。 */
  scripts?: FederationDeploymentScriptsConfig;
  /** 部署目标需要的资源声明。 */
  resources: FederationProjectResourcesConfig;
}

/** `federation.json` 解析后的项目配置。 */
export interface FederationProjectConfig {
  /** 配置 schema 版本，当前固定为 1。 */
  schema: 1;
  /** 项目类型，固定为 `federation`。 */
  type: FederationProjectType;
  /** 跨目录识别同一个 Fed 的稳定唯一 ID。 */
  id: string;
  /** Fed 的用户可见名称。 */
  name: string;
  /** Federation 运行入口，相对项目根目录。 */
  entry: string;
  /** 本地或云端的统一部署声明。 */
  deployment: FederationDeploymentConfig;
}

/** 已读取并解析完成的 Federation 项目配置。 */
export interface FederationProjectConfigFile {
  /** Federation 项目根目录绝对路径。 */
  project_dir: string;
  /** `federation.json` 的绝对路径。 */
  config_path: string;
  /** 经过完整校验和默认值补齐的配置。 */
  config: FederationProjectConfig;
}

/** `fed deploy` 解析后的源码位置。 */
export interface FederationDeploySource {
  /** Federation 项目根目录。 */
  project_dir: string;
  /** 用户传入的原始路径。 */
  source: string;
}

/** `fed deploy` 命令执行选项。 */
export interface FederationDeployOptions {
  /** 用户传入的 Federation 项目路径。 */
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
