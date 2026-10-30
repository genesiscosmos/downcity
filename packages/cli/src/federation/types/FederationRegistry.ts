/**
 * 系统级 Federation registry 类型。
 *
 * 关键说明（中文）
 * - registry 描述已经部署或手动连接的 Fed 实例，与当前 shell 路径无关。
 * - 项目配置保留部署意图，registry 保存 URL、非敏感管理员 ID 与最近部署状态。
 * - 本地实例用 `fed_id + target` 定位，重复 deploy 会替换旧进程。
 */

import type {
  FederationDeploymentTarget,
  FederationProjectConfig,
} from "@/federation/types/FederationProjectConfig.js";

/** Federation 实例当前状态。 */
export type FederationServerStatus =
  | "starting"
  | "running"
  | "deployed"
  | "stopped"
  | "failed"
  | "unknown";

/** 系统级 Federation 实例记录。 */
export interface ServerProfile {
  /** Federation 用户可见名称。 */
  name: string;
  /** Federation HTTP 入口地址。 */
  base_url: string;
  /** Federation 管理员登录 ID；该字段不是秘密。 */
  admin_id?: string;
  /** 最近一次登录取得的有期限管理员 Session Token。 */
  admin_session_token?: string;
  /** 管理员 Session Token 到期时间。 */
  admin_session_expires_at?: string;
  /** 项目内声明的稳定 Fed ID；手动添加的远程地址可以没有。 */
  fed_id?: string;
  /** 本次实例使用的部署目标。 */
  target?: FederationDeploymentTarget;
  /** 部署来源的源码目录，仅用于源码追溯；运行时不得从该目录加载代码或配置。 */
  project_dir?: string;
  /** 本次部署的发布版本标识，用于关联当前实例与发布产物；未生成发布版本时可缺省。 */
  release_id?: string;
  /** 本次部署的发布产物目录，运行时代码从此目录加载，不依赖来源源码目录。 */
  release_dir?: string;
  /** 本次部署实际使用的运行时配置文件路径，用于定位实例加载的配置。 */
  runtime_config_path?: string;
  /** 本次部署实际使用的持久化数据目录，独立于源码与发布产物目录保存运行数据。 */
  data_dir?: string;
  /** 本地实例的主进程 PID。 */
  pid?: number;
  /** 本地实例每次启动生成的唯一 instance ID。 */
  instance_id?: string;
  /** 本地实例实际监听端口。 */
  port?: number;
  /** 本地实例 stdout/stderr 合并日志路径。 */
  log_path?: string;
  /** 最近一次成功或失败部署的 ISO 时间。 */
  deployed_at?: string;
  /** 实例最近一次已知状态。 */
  status?: FederationServerStatus;
  /** 部署时使用的项目配置快照。 */
  config_snapshot?: FederationProjectConfig;
}

/** Federation CLI 的系统级持久化状态；每次操作的目标由调用方局部持有。 */
export interface FederationClientConfig {
  /** 所有已登记 Federation 实例。 */
  servers: ServerProfile[];
  /** Cloudflare provider 最近使用的 account id。 */
  cloudflare_account_id?: string;
  /** 当前选择的模型 ID。 */
  model: string;
  /** 当前持久化的 CLI 语言。 */
  cli_locale?: "zh" | "en";
}
