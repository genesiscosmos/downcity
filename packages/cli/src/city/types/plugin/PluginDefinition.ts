/** 第三方 Plugin 的单制品定义与运行协议。 */

import type { JsonObject, Plugin } from "@downcity/agent";
import type { LocalInstalledPlugin } from "@downcity/local/product";

/** Plugin 源目录中的静态清单文件名。 */
export const PLUGIN_MANIFEST_FILE_NAME = "downcity.plugin.json";

/** 当前支持的单 Plugin 清单协议版本。 */
export const PLUGIN_MANIFEST_VERSION = 4;

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

/** Plugin profile 的配置协议。 */
export interface PluginConfigManifest {
  /** 完整 JSON Schema 2020-12 协议。 */
  schema: JsonObject;
  /** `default` profile 不存在时使用的完整默认配置。 */
  defaults?: JsonObject;
}

/** 源制品声明的唯一 Plugin。 */
export interface PluginManifest {
  /** 清单协议版本。 */
  manifest_version: 4;
  /** Plugin 的全局稳定 ID。 */
  id: string;
  /** Plugin 语义化版本号。 */
  version: string;
  /** 用户可见标题。 */
  title?: string;
  /** 非空用途说明。 */
  description: string;
  /** 相对制品根目录的自包含 ESM 入口。 */
  entry: string;
  /** 可选 profile Schema 与默认值。 */
  config?: PluginConfigManifest;
}

/** CLI 可以统一实例化的 Plugin constructor。 */
export interface PluginType {
  /** 使用已校验 profile 创建 Agent 独享实例。 */
  new(input: { /** 完整 Plugin profile。 */ config: JsonObject }): Plugin;
  /** constructor 自带的静态 Manifest。 */
  readonly manifest: {
    /** Plugin 的稳定 ID。 */
    name: string;
    /** 可选语义化版本号。 */
    version?: string;
    /** 可选用户可见标题。 */
    title?: string;
    /** 非空用途说明。 */
    description: string;
    /** 可选 profile Schema 与默认值。 */
    config?: PluginConfigManifest;
  };
}

/** 已安装 Plugin 的管理视图。 */
export type InstalledPlugin = LocalInstalledPlugin;
