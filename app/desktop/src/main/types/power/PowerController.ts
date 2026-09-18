/** Desktop PowerController 的内部解析类型。 */

import type {
  LocalInstalledPowerDefinition,
  LocalPowerDefinition,
  LocalPowerRegistration,
} from "@downcity/city/local";
import type { DesktopPowerSource } from "../../../common/types/DesktopApi.js";

/** 内置或第三方 Power 的统一解析结果。 */
export interface ResolvedDesktopPower {
  /** 宿主可展示的统一静态定义。 */
  readonly definition: LocalPowerDefinition;

  /** Power 的安装来源类型。 */
  readonly source: DesktopPowerSource;

  /** 内置 Power 的进程内注册；第三方 Power 不设置。 */
  readonly registration?: LocalPowerRegistration;

  /** 第三方 Power 的已安装清单；内置 Power 不设置。 */
  readonly installed?: LocalInstalledPowerDefinition;
}
