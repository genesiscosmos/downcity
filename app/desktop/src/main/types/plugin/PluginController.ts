/** Desktop PluginController 的内部解析类型。 */

import type {
  LocalInstalledPluginDefinition,
  LocalPluginDefinition,
  LocalPluginRegistration,
} from "@downcity/local/product";
import type { DesktopPluginSource } from "../../../common/types/DesktopApi.js";

/** 内置或第三方 Plugin 的统一解析结果。 */
export interface ResolvedDesktopPlugin {
  /** 宿主可展示的统一静态定义。 */
  readonly definition: LocalPluginDefinition & {
    /** 官方 Plugin 随注册定义提供的 Markdown 用户说明。 */
    readonly readme?: string;
  };

  /** Plugin 的安装来源类型。 */
  readonly source: DesktopPluginSource;

  /** 内置 Plugin 的进程内注册；第三方 Plugin 不设置。 */
  readonly registration?: LocalPluginRegistration;

  /** 第三方 Plugin 的已安装清单；内置 Plugin 不设置。 */
  readonly installed?: LocalInstalledPluginDefinition;
}
