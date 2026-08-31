/**
 * City 提供给 Agent Plugin factory 的宿主装配上下文。
 *
 * 设计边界（中文）：
 * - City 负责读取 Profile、创建上下文并调用 factory；
 * - factory 只负责创建一个新的 Plugin 实例；
 * - Agent 负责接管实例后的运行、Action 与生命周期；
 * - Agent 不反向依赖 City，也不读取 Plugin 安装目录。
 */

import type { JsonObject, Logger } from "@/index.js";

/** City 可以为未来宿主能力增加的显式扩展集合。 */
export type PluginHostExtensions = Readonly<Record<string, unknown>>;

/** Agent Plugin factory 的宿主装配上下文。 */
export interface PluginHostContext {
  /** 当前 Plugin 的稳定 ID。 */
  readonly plugin_id: string;

  /** City 读取并校验后的 Plugin profile。 */
  readonly profile: JsonObject;

  /** Plugin 运行时私有数据目录；不用于存放 City 管理的 profile 配置。 */
  readonly data_path: string;

  /** City 提供的宿主日志器。 */
  readonly logger: Logger;

  /** City 为未来宿主能力保留的显式扩展区。 */
  readonly extensions: PluginHostExtensions;
}

/** `plugin.json.agent` 指向的 Agent Plugin 模块。 */
export interface AgentPluginModule<Plugin = unknown> {
  /** 根据 City 宿主上下文创建一个新的 Agent Plugin 实例。 */
  readonly default: (
    context: PluginHostContext,
  ) => Plugin | Promise<Plugin>;
}
