/**
 * City 可安装 Plugin 的静态制品协议。
 *
 * 关键点（中文）
 * - 仓库 Manifest 和配置 Schema 都是静态 JSON，安装检查不会执行第三方代码。
 * - 数据库保存安装时解析后的 Manifest 快照，运行期不重新信任可变源文件。
 * - Agent Binding 持有配置值，Manifest 只持有配置协议和默认值。
 */

import type { JsonObject } from "@downcity/agent";

/** Plugin 仓库根目录中的清单文件名。 */
export const PLUGIN_MANIFEST_FILE_NAME = "downcity.plugin.json";

/** 当前支持的 Plugin Manifest 协议版本。 */
export const PLUGIN_MANIFEST_VERSION = 1;

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

/** Plugin 仓库 Manifest 中的配置制品引用。 */
export interface PluginManifestFileConfig {
  /** 相对 Plugin 根目录的 JSON Schema 文件路径。 */
  schema: string;

  /** 首次启用 Plugin 时使用的完整默认配置。 */
  defaults?: JsonObject;
}

/** Plugin 仓库根目录中的原始静态 Manifest。 */
export interface PluginManifestFile {
  /** Manifest 协议版本，当前固定为 1。 */
  manifest_version: number;

  /** Plugin 稳定名称，也是安装和 Binding 主键。 */
  name: string;

  /** Plugin 语义化版本号。 */
  version: string;

  /** 相对 Plugin 根目录的构建后、自包含 ESM 入口。 */
  entry: string;

  /** 面向用户展示的标题。 */
  title?: string;

  /** 面向用户展示的用途说明。 */
  description?: string;

  /** 可选配置协议与默认值。 */
  config?: PluginManifestFileConfig;
}

/** 安装后解析完成的 Plugin 配置协议快照。 */
export interface InstalledPluginConfigManifest {
  /** 配置 Schema 在 Plugin 制品内的相对路径。 */
  schema_path: string;

  /** 安装时读取并验证的标准 JSON Schema。 */
  schema: JsonObject;

  /** 已通过 Schema 校验的完整默认配置；必填配置无法默认时可省略。 */
  defaults?: JsonObject;
}

/** 安装后保存到全局数据库的 Plugin Manifest 快照。 */
export interface PluginManifest {
  /** Manifest 协议版本。 */
  manifest_version: number;

  /** Plugin 稳定名称。 */
  name: string;

  /** Plugin 语义化版本号。 */
  version: string;

  /** 相对 Plugin 根目录的 ESM 入口。 */
  entry: string;

  /** 面向用户展示的标题。 */
  title?: string;

  /** 面向用户展示的用途说明。 */
  description?: string;

  /** 安装时固化的配置协议快照。 */
  config?: InstalledPluginConfigManifest;
}

/** 全局数据库中的已安装 Plugin 记录。 */
export interface InstalledPlugin {
  /** Plugin 稳定名称。 */
  plugin_name: string;

  /** 规范化安装来源，例如 Git URL、GitHub shorthand 或本地绝对路径。 */
  source: string;

  /** Git 来源实际安装的 commit SHA；本地来源不提供。 */
  resolved_commit?: string;

  /** 当前安装版本。 */
  version: string;

  /** 已安装 ESM 入口的绝对路径。 */
  entry_path: string;

  /** 安装时解析完成的 Manifest 快照。 */
  manifest: PluginManifest;

  /** 安装制品内容的 SHA-256 摘要。 */
  integrity: string;

  /** 首次安装时间，使用 ISO 8601 字符串。 */
  installed_at: string;

  /** 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** 第三方 Plugin ESM 入口必须导出的 CLI 内部 Factory 契约。 */
export interface ExternalPluginFactory {
  /** 使用 CLI 已校验配置创建一个 Agent Runtime Plugin。 */
  create(input: {
    /** 当前 Agent 对该 Plugin 的完整配置。 */
    config: JsonObject;
  }): Promise<import("@downcity/agent").Plugin> | import("@downcity/agent").Plugin;
}
