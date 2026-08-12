/**
 * 本地 Plugin 持久化记录。
 *
 * 这些类型只描述 CLI 与 Desktop 共享的数据，不包含安装交互、Schema 表单或运行时
 * Plugin constructor。
 */

import type { JsonObject } from "@downcity/agent";

/** Agent 与一个 Plugin 的持久化绑定。 */
export interface LocalAgentPluginBinding {
  /** 目标 Agent 的稳定 ID。 */
  agent_id: string;
  /** Plugin 的全局稳定名称。 */
  plugin_name: string;
  /** 当前宿主恢复 Agent 时是否实例化该 Plugin。 */
  enabled: boolean;
  /** Plugin Manifest 约束的完整配置。 */
  config: JsonObject;
  /** 当前绑定引用的 Plugin Resource ID。 */
  resource_ids: string[];
  /** 首次绑定时间，使用 ISO 8601 字符串。 */
  created_at: string;
  /** 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** Plugin Resource 中可由具体 Plugin 扩展的完整 Item。 */
export interface LocalPluginResourceItem extends JsonObject {
  /** Plugin 范围内唯一的稳定 ID。 */
  id: string;
  /** Plugin 定义的 Resource 类型。 */
  type: string;
  /** 面向用户展示的 Resource 名称。 */
  name: string;
}

/** 一个全局 Plugin Resource 的持久化记录。 */
export interface LocalPluginResource {
  /** 拥有该 Resource 的 Plugin 名称。 */
  plugin_name: string;
  /** Resource 的稳定 ID。 */
  resource_id: string;
  /** 加密保存的完整 Resource Item。 */
  item: LocalPluginResourceItem;
  /** 首次创建时间，使用 ISO 8601 字符串。 */
  created_at: string;
  /** 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** 第三方 Plugin 安装清单中的最小 Plugin Manifest。 */
export interface LocalPluginManifest {
  /** Plugin 全局稳定名称。 */
  name: string;
  /** 可选 Plugin 语义化版本号。 */
  version?: string;
  /** 面向用户展示的标题。 */
  title?: string;
  /** 面向用户展示的用途说明。 */
  description: string;
  /** 可选配置 Schema 与默认值。 */
  config?: {
    /** 完整 JSON Schema。 */
    schema: JsonObject;
    /** 首次启用时使用的完整默认配置。 */
    defaults?: JsonObject;
  };
  /** 可选 Resource Item Schema。 */
  resources?: {
    /** 完整 Resource Item JSON Schema。 */
    schema: JsonObject;
  };
}

/** 第三方 Plugin 安装制品的静态 Manifest 快照。 */
export interface LocalPluginInstallationManifest {
  /** 安装清单协议版本。 */
  manifest_version: number;
  /** 相对安装目录的 ESM 入口。 */
  entry: string;
  /** 该入口导出的全部 Plugin Manifest。 */
  plugins: LocalPluginManifest[];
}

/** 一个第三方 Plugin 制品的内部安装记录。 */
export interface LocalPluginInstallation {
  /** 由安装来源稳定派生的内部 ID。 */
  installation_id: string;
  /** 可供更新操作重放的规范化来源。 */
  source: string;
  /** Git 来源实际安装的 commit SHA。 */
  resolved_commit?: string;
  /** 已安装 ESM 入口的绝对路径。 */
  entry_path: string;
  /** 安装时校验完成的 Manifest 快照。 */
  manifest: LocalPluginInstallationManifest;
  /** 安装制品内容摘要。 */
  integrity: string;
  /** 首次安装时间，使用 ISO 8601 字符串。 */
  installed_at: string;
  /** 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}
