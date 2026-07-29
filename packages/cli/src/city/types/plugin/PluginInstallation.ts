/**
 * City Plugin 的静态 Manifest、运行类型与内部安装记录。
 *
 * 关键点（中文）
 * - 对外运行协议只有 Plugin constructor 数组，不存在 Project Runtime 或 Plugin Factory。
 * - 每个 Plugin constructor 自带静态 Manifest 和可选 Resource Resolver。
 * - installation 只负责共享来源、入口与文件生命周期，是 CLI 内部存储概念。
 */

import type { JsonObject, Plugin } from "@downcity/agent";
import type {
  PluginResourceItem,
  PluginResourceResolver,
} from "@/city/types/plugin/PluginResource.js";

/** Plugin 安装制品根目录中的静态清单文件名。 */
export const PLUGIN_INSTALLATION_MANIFEST_FILE_NAME = "downcity.plugin.json";

/** 当前支持的静态安装清单协议版本。 */
export const PLUGIN_INSTALLATION_MANIFEST_VERSION = 3;

/** 安装器解析后的 Plugin 来源。 */
export interface ResolvedPluginSource {
  /** 保存到数据库、可供 update 重放的规范化来源。 */
  normalized_source: string;

  /** 本地目录绝对路径；Git 来源不提供。 */
  local_path?: string;

  /** Git clone 使用的仓库 URL；本地来源不提供。 */
  git_url?: string;

  /** 可选 Git branch 或 tag。 */
  git_ref?: string;
}

/** 一个 Plugin 的配置协议。 */
export interface PluginConfigManifest {
  /** 完整的 JSON Schema 2020-12 配置协议。 */
  schema: JsonObject;

  /** 首次启用 Plugin 时使用的完整默认配置。 */
  defaults?: JsonObject;
}

/** 一个 Plugin 的 Resource Item 协议。 */
export interface PluginResourcesManifest {
  /** 完整的 Resource Item JSON Schema。 */
  schema: JsonObject;
}

/** Plugin constructor 持有并写入静态安装清单的 Manifest。 */
export interface PluginManifest {
  /** Plugin 全局唯一稳定名称，也是 Binding 与 Resource 主键。 */
  name: string;

  /** 可选 Plugin 语义化版本号。 */
  version?: string;

  /** 面向用户展示的标题。 */
  title?: string;

  /** 面向用户展示的非空用途说明。 */
  description: string;

  /** 可选配置协议与默认值。 */
  config?: PluginConfigManifest;

  /** 可选完整 Resource Item 协议。 */
  resources?: PluginResourcesManifest;
}

/** 安装阶段读取的静态制品清单。 */
export interface PluginInstallationManifest {
  /** 静态清单协议版本。 */
  manifest_version: number;

  /** 相对安装根目录的构建后、自包含 ESM 入口。 */
  entry: string;

  /** 入口模块导出的全部 Plugin Manifest，顺序与运行数组一致。 */
  plugins: PluginManifest[];
}

/** CLI 传入 Plugin constructor 的统一初始化参数。 */
export interface PluginInitializationInput {
  /** 当前 Agent 对该 Plugin 的完整配置。 */
  config: JsonObject;

  /** Resource ID 已解析成的完整、不可变 Resource Item 快照。 */
  resources: PluginResourceItem[];
}

/** CLI 可以统一实例化的 Plugin constructor 静态契约。 */
export interface PluginType {
  /** 使用已校验配置和 Resource Item 创建一个独立 Plugin 实例。 */
  new(input: PluginInitializationInput): Plugin;

  /** Plugin 自己持有的静态协议与展示信息。 */
  readonly manifest: PluginManifest;

  /** 创建或刷新 Resource 时由 CLI 调用的可选静态 Resolver。 */
  readonly resolve_resource?: PluginResourceResolver;
}

/** 全局数据库中的内部 Plugin 安装记录。 */
export interface InstalledPluginInstallation {
  /** 由规范化来源稳定派生、仅供 CLI 管理共享制品的内部 ID。 */
  installation_id: string;

  /** 规范化安装来源，例如 Git URL、GitHub shorthand 或本地绝对路径。 */
  source: string;

  /** Git 来源实际安装的 commit SHA；本地来源不提供。 */
  resolved_commit?: string;

  /** 已安装 ESM 入口的绝对路径。 */
  entry_path: string;

  /** 安装时解析完成的静态 Manifest 快照。 */
  manifest: PluginInstallationManifest;

  /** 安装制品内容的 SHA-256 摘要。 */
  integrity: string;

  /** 首次安装时间，使用 ISO 8601 字符串。 */
  installed_at: string;

  /** 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** 按 Plugin 名称定位到的内部安装记录和 Manifest。 */
export interface InstalledPluginReference {
  /** 拥有该 Plugin 共享制品的内部安装记录。 */
  installation: InstalledPluginInstallation;

  /** 该 Plugin 在安装快照中的静态 Manifest。 */
  manifest: PluginManifest;
}
