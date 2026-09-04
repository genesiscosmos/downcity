/**
 * PluginRegistry 变化订阅类型。
 *
 * 关键点（中文）
 * - Agent 订阅 Registry 变化后同步 Plugin Tools 与 Session execution view。
 * - PluginRegistry 不直接修改 Agent 持有的工具集合。
 */

/** PluginRegistry 的单次配置变化。 */
export interface PluginRegistryChange {
  /** 当前修改是注册还是卸载。 */
  type: "register" | "unregister";

  /** 当前发生修改的 Plugin 稳定名称。 */
  plugin_name: string;
}

/** PluginRegistry 变化监听器。 */
export type PluginRegistrySubscriber = (
  /** 当前 Plugin 配置变化。 */
  change: PluginRegistryChange,
) => void;

/** 取消 PluginRegistry 变化订阅的函数。 */
export type PluginRegistryUnsubscribe = () => void;
