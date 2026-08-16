/** 本地文件型 Plugin 定义、注册与配置协议。 */

import type { JsonObject, Plugin } from "@downcity/agent";
import type { ZodType } from "zod";

/** 安装器从 Zod 生成的 Plugin 配置展示快照。 */
export interface LocalPluginConfigDefinition {
  /** 供 Catalog、CLI 与 Desktop 使用的完整 JSON Schema。 */
  schema: JsonObject;
  /** Zod 能从空对象完整解析时得到的默认配置。 */
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
}

/** Plugin constructor 暴露的运行时类型。 */
export interface LocalPluginRuntimeType {
  /** Plugin profile 的唯一 Zod 类型定义。 */
  config: ZodType;
}

/** 创建 Agent 独享 Plugin 实例的输入。 */
export interface LocalPluginCreateInput {
  /** 已通过 Plugin Zod 类型解析并补齐默认值的完整配置。 */
  config: JsonObject;
}

/** 内置与第三方 Plugin 共享的运行注册协议。 */
export interface LocalPluginRegistration {
  /** Plugin 的唯一静态定义。 */
  definition: LocalPluginDefinition;
  /** Plugin 的运行时配置类型；无配置 Plugin 可以省略。 */
  type?: LocalPluginRuntimeType;
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
  /** 安装器从 constructor Zod 类型生成的展示快照。 */
  config?: LocalPluginConfigDefinition;
  /** 可供更新命令重放的规范化来源。 */
  source: string;
  /** Git 来源解析得到的 commit SHA。 */
  revision?: string;
  /** 除 `plugin.json` 与 `config.toml` 外静态文件的内容摘要。 */
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
