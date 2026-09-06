/** CLI 与 Desktop 使用的统一 Plugin Catalog 类型。 */

/** Plugin 的本地来源。 */
export type PluginCatalogSource = "builtin" | "installed";

/** City 当前可用的一个 Plugin。 */
export interface PluginCatalogItem {
  /** Plugin 的全局稳定 ID。 */
  plugin_id: string;
  /** 用户可见标题。 */
  title: string;
  /** 用途说明。 */
  description: string;
  /** 可选图标地址。 */
  icon?: string;
  /** 可选语义化版本号。 */
  version?: string;
  /** 内置或第三方来源。 */
  source: PluginCatalogSource;
  /** 第三方 Plugin 的规范化来源。 */
  source_label?: string;
  /** Plugin 是否提供统一 City 运行入口。 */
  has_main: boolean;

  /** Plugin 是否提供专属 Sidebar。 */
  has_sidebar: boolean;

  /** Plugin 是否提供业务 Mainview。 */
  has_mainview: boolean;

  /** Plugin 是否提供设置中心 Config。 */
  has_config: boolean;
}
