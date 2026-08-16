/** 本地文件型 Plugin 定义与配置协议。 */

import type { JsonObject } from "@downcity/agent";

/** Plugin constructor 对外声明的静态 Manifest。 */
export interface LocalPluginManifest {
  /** Plugin 的全局稳定 ID。 */
  name: string;
  /** 可选 Plugin 语义化版本号。 */
  version?: string;
  /** 面向用户展示的标题。 */
  title?: string;
  /** 面向用户展示的用途说明。 */
  description: string;
  /** Plugin profile 的 Schema 与默认值。 */
  config?: {
    /** 完整 JSON Schema。 */
    schema: JsonObject;
    /** `default` profile 不存在时使用的完整默认配置。 */
    defaults?: JsonObject;
  };
}

/** `plugins/<plugin_id>/plugin.json` 中的第三方 Plugin 描述。 */
export interface LocalInstalledPlugin {
  /** 文件协议版本。 */
  schema_version: 1;
  /** Plugin 的全局稳定 ID，同时也是目录名。 */
  id: string;
  /** Plugin 语义化版本号。 */
  version: string;
  /** 面向用户展示的标题。 */
  title?: string;
  /** 面向用户展示的用途说明。 */
  description: string;
  /** 可供更新命令重放的规范化来源。 */
  source: string;
  /** Git 来源解析得到的 commit SHA。 */
  resolved_commit?: string;
  /** 相对 Plugin 目录的 ESM 入口。 */
  entry: string;
  /** Plugin profile 的完整 JSON Schema。 */
  config_schema?: JsonObject;
  /** `default` profile 不存在时使用的默认配置。 */
  default_config?: JsonObject;
  /** `artifact/` 制品内容摘要。 */
  integrity: string;
  /** 首次安装时间。 */
  installed_at: string;
  /** 最近更新时间。 */
  updated_at: string;
}

/** `config.toml` 的标准管理视图。 */
export interface LocalPluginConfig {
  /** 配置协议版本。 */
  schema_version: 1;
  /** 按稳定名称保存的全部 Plugin profile。 */
  profiles: Record<string, JsonObject>;
}
