/** 本地文件型 Plugin 定义、注册与配置协议。 */

import type { JsonObject, Plugin } from "@downcity/agent";

/** Plugin 在静态定义中声明的配置协议。 */
export interface LocalPluginConfigDefinition {
  /** 校验 profile 并驱动 CLI、Desktop 表单的完整 JSON Schema。 */
  schema: JsonObject;
  /** `default` profile 不存在时使用的完整默认配置。 */
  defaults?: JsonObject;
}

/** 内置与第三方 Plugin 共享的静态领域定义。 */
export interface LocalPluginDefinition {
  /** Plugin 的全局稳定 ID。 */
  id: string;
  /** 面向用户展示的标题。 */
  title?: string;
  /** 面向用户展示的用途说明。 */
  description: string;
  /** Plugin profile 的可选 JSON Schema 与默认配置。 */
  config?: LocalPluginConfigDefinition;
}

/** 创建 Agent 独享 Plugin 实例的输入。 */
export interface LocalPluginCreateInput {
  /** 已通过 `plugin.json` JSON Schema 校验的完整配置。 */
  config: JsonObject;
}

/** 内置与第三方 Plugin 共享的运行注册协议。 */
export interface LocalPluginRegistration {
  /** Plugin 的唯一静态定义。 */
  definition: LocalPluginDefinition;
  /** 创建一个归当前 Agent 所有的 Plugin 实例。 */
  create(input: LocalPluginCreateInput): Plugin;
}

/** `plugins/<plugin_id>/plugin.json` 中的第三方 Plugin 定义。 */
export interface LocalInstalledPluginDefinition extends LocalPluginDefinition {
  /** 文件协议版本。 */
  schema_version: 1;
  /** Plugin 语义化版本号。 */
  version: string;
  /** 相对 Plugin 目录的自包含 ESM 入口。 */
  entry: string;
  /** 可供更新命令重放的规范化来源。 */
  source: string;
  /** Git 来源解析得到的 commit SHA。 */
  revision?: string;
  /** `package.json` 与自包含 ESM 入口文件的内容摘要。 */
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
