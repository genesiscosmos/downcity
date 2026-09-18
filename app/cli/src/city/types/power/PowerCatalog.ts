/** CLI 与 Desktop 使用的统一 Power Catalog 类型。 */

/** Power 的本地来源。 */
export type PowerCatalogSource = "builtin" | "installed";

/** City 当前可用的一个 Power。 */
export interface PowerCatalogItem {
  /** Power 的全局稳定 ID。 */
  power_id: string;
  /** 用户可见标题。 */
  title: string;
  /** 用途说明。 */
  description: string;
  /** 可选图标地址。 */
  icon?: string;
  /** 可选语义化版本号。 */
  version?: string;
  /** 内置或第三方来源。 */
  source: PowerCatalogSource;
  /** 第三方 Power 的规范化来源。 */
  source_label?: string;
  /** Power 是否提供统一 City 运行入口。 */
  has_main: boolean;

  /** Power 是否提供专属 Sidebar。 */
  has_sidebar: boolean;

  /** Power 是否提供业务 Mainview。 */
  has_mainview: boolean;

  /** Power 是否提供设置中心 Config。 */
  has_config: boolean;
}
