/**
 * 本地 CityEnvironment 只读数据源协议。
 *
 * Environment 只通过该协议读取 Plugin Resource 与 Installation，不拥有数据库连接，
 * 也不理解配置的写入流程。LocalCityStore 是默认实现。
 */

import type {
  LocalPluginInstallation,
  LocalPluginResource,
} from "@/local/types/LocalPlugin.js";

/** 本地运行环境装配 Plugin 所需的最小只读数据能力。 */
export interface LocalCityDataSource {
  /** 读取一个已解密的 Plugin Resource；不存在时返回 null。 */
  get_plugin_resource(plugin_name: string, resource_id: string): LocalPluginResource | null;

  /** 返回全部已安装第三方 Plugin 的持久化快照。 */
  list_plugin_installations(): LocalPluginInstallation[];
}
