/**
 * City Plugin 安装清单类型。
 *
 * 关键点（中文）
 * - Manifest 只描述可安装制品与配置协议，不进入 Agent Runtime Plugin 对象。
 * - 配置值由全局数据库中的 Agent Plugin Binding 持有。
 */

import type { JsonObject } from "@downcity/agent";

/** Plugin 仓库根目录中的清单文件名。 */
export const PLUGIN_MANIFEST_FILE_NAME = "downcity.plugin.json";

/** 可安装 Plugin 的静态清单。 */
export interface PluginManifest {
  /** Plugin 稳定名称，也是全局安装主键。 */
  name: string;

  /** Plugin 语义化版本号。 */
  version: string;

  /** 相对 Plugin 根目录的构建后 ESM 入口。 */
  entry: string;

  /** 面向用户展示的标题。 */
  title?: string;

  /** 面向用户展示的用途说明。 */
  description?: string;

  /** 用于配置表单和运行前校验的 JSON Schema。 */
  config_schema?: JsonObject;

  /** Agent 首次启用该 Plugin 时使用的默认配置。 */
  default_config?: JsonObject;
}

/** 全局数据库中的已安装 Plugin 记录。 */
export interface InstalledPlugin {
  /** Plugin 稳定名称。 */
  plugin_name: string;

  /** 安装来源，例如 HTTPS Git URL 或本地目录。 */
  source: string;

  /** 当前安装版本。 */
  version: string;

  /** 已安装 ESM 入口的绝对路径。 */
  entry_path: string;

  /** 完整安装清单。 */
  manifest: PluginManifest;

  /** 可选制品完整性摘要。 */
  integrity?: string;

  /** 首次安装时间，使用 ISO 8601 字符串。 */
  installed_at: string;

  /** 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** 第三方 Plugin ESM 入口必须导出的 Factory。 */
export interface ExternalPluginFactory {
  /** 使用 City 已校验配置创建一个 Agent Runtime Plugin。 */
  create(input: {
    /** 当前 Agent 的稳定 ID。 */
    agent_id: string;

    /** 当前 Agent 绑定的 Workspace 绝对路径。 */
    workspace_path: string;

    /** 当前 Agent 对该 Plugin 的完整配置。 */
    config: JsonObject;
  }): Promise<import("@downcity/agent").Plugin> | import("@downcity/agent").Plugin;
}
