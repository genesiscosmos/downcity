/** 第三方 Power 的单目录定义与运行协议。 */

import type {
  LocalInstalledPowerDefinition,
  LocalPowerDefinition,
} from "@downcity/city/local";

/** Power 来源目录与安装目录共享的清单文件名。 */
export const POWER_DEFINITION_FILE_NAME = "power.json";

/** 当前支持的 Power 文件协议版本。 */
export const POWER_DEFINITION_SCHEMA_VERSION = 1;

/** 来源目录 `power.json` 必须声明的可安装 Power 包。 */
export interface PowerPackageDefinition extends Omit<
  LocalPowerDefinition,
  "has_main" | "has_page" | "has_config"
> {
  /** 文件协议版本。 */
  schema_version: 1;
  /** Power 语义化版本号。 */
  version: string;
  /** 相对来源目录的统一 City Power ESM 入口。 */
  main?: string;

  /** 完整宿主协议到预构建入口、能力及逐文件资源声明的映射。 */
  renderers?: import("@downcity/city/power").PowerRendererBindings;
}

/** 已安装 Power 的管理视图。 */
export type InstalledPower = LocalInstalledPowerDefinition;
