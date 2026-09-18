/**
 * PowerRegistry 变化订阅协议。
 *
 * 关键点（中文）
 * - Agent 执行网关订阅 City 唯一 Registry 的变化后同步 Power Tools。
 * - PowerRegistry 不直接修改 Agent 持有的工具集合。
 */

/** PowerRegistry 的单次配置变化。 */
export interface PowerRegistryChange {
  /** 当前修改是注册还是卸载。 */
  readonly type: "register" | "unregister";

  /** 当前发生修改的 Power 稳定名称。 */
  readonly power_name: string;
}

/** PowerRegistry 变化监听器。 */
export type PowerRegistrySubscriber = (
  /** 当前 Power 配置变化。 */
  change: PowerRegistryChange,
) => void;

/** 取消 PowerRegistry 变化订阅的函数。 */
export type PowerRegistryUnsubscribe = () => void;
