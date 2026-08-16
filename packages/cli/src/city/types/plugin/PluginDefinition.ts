/** 第三方 Plugin 的单目录定义与运行协议。 */

import type {
  LocalInstalledPluginDefinition,
  LocalPluginDefinition,
} from "@downcity/local/product";

/** Plugin 来源目录与安装目录共享的清单文件名。 */
export const PLUGIN_DEFINITION_FILE_NAME = "plugin.json";

/** 当前支持的 Plugin 文件协议版本。 */
export const PLUGIN_DEFINITION_SCHEMA_VERSION = 1;

/** 安装器解析后的 Plugin 来源。 */
export interface ResolvedPluginSource {
  /** 保存后可供 update 重放的规范化来源。 */
  normalized_source: string;
  /** 本地目录绝对路径。 */
  local_path?: string;
  /** Git clone 使用的仓库 URL。 */
  git_url?: string;
  /** 可选 Git branch 或 tag。 */
  git_ref?: string;
}

/** 来源目录 `plugin.json` 必须声明的可安装 Plugin 包。 */
export interface PluginPackageDefinition extends LocalPluginDefinition {
  /** 文件协议版本。 */
  schema_version: 1;
  /** Plugin 语义化版本号。 */
  version: string;
  /** 相对来源目录的自包含 ESM 入口。 */
  entry: string;
}

/** 已安装 Plugin 的管理视图。 */
export type InstalledPlugin = LocalInstalledPluginDefinition;
