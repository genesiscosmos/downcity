/**
 * City 提供给 Plugin setup 的宿主装配上下文。
 *
 * 设计边界（中文）：
 * - City 负责读取配置、创建上下文并调用 setup；
 * - setup 只负责创建一个新的 Plugin 实例；
 * - Agent 负责接管实例后的运行、Action 与生命周期；
 * - Agent 不反向依赖 City，也不读取 Plugin 安装目录。
 */

import type { JsonObject, Logger } from "@downcity/agent";

/** City 可以为未来宿主能力增加的显式扩展集合。 */
export type PluginHostExtensions = Readonly<Record<string, unknown>>;

/** Plugin setup 的宿主装配上下文。 */
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

/** Plugin setup 模块导出的静态配置和实例装配函数。 */
export interface PluginSetupModule<Plugin = unknown> {
  /** Plugin 配置 JSON Schema。 */
  readonly schema: JsonObject;

  /** 根据 City 宿主上下文创建一个新的 Plugin 实例。 */
  readonly setup: (
    context: PluginHostContext,
  ) => Plugin | Promise<Plugin>;
}
