/** 第三方 Power 的单目录定义与运行协议。 */

import type {
  LocalInstalledPowerDefinition,
  LocalPowerDefinition,
} from "@downcity/city/local";

/** Power 来源目录与安装目录共享的清单文件名。 */
export const POWER_DEFINITION_FILE_NAME = "power.json";

/** 当前支持的 Power 文件协议版本。 */
export const POWER_DEFINITION_SCHEMA_VERSION = 1;

/** 安装器解析后的 Power 来源。 */
export interface ResolvedPowerSource {
  /** 保存后可供 update 重放的规范化来源。 */
  normalized_source: string;
  /** 本地目录绝对路径。 */
  local_path?: string;
  /** Git clone 使用的仓库 URL。 */
  git_url?: string;
  /** 可选 Git branch 或 tag。 */
  git_ref?: string;
}

/** 来源目录 `power.json` 必须声明的可安装 Power 包。 */
export interface PowerPackageDefinition extends Omit<
  LocalPowerDefinition,
  "has_main" | "has_sidebar" | "has_mainview" | "has_config"
> {
  /** 文件协议版本。 */
  schema_version: 1;
  /** Power 语义化版本号。 */
  version: string;
  /** 相对来源目录的统一 City Power ESM 入口。 */
  main?: string;

  /** Renderer 入口及其静态 Sidebar、Mainview 与 Config 插槽。 */
  renderer?: import("@downcity/city/local").LocalPowerRendererDefinition;
}

/** 已安装 Power 的管理视图。 */
export type InstalledPower = LocalInstalledPowerDefinition;
