/** 本地文件型 Power 定义、统一实例注册与唯一配置协议。 */

import type {
  CityPowerRegistration,
  PowerDefinition,
  PowerJsonObject,
} from "@/power/index.js";

/** Power Renderer 入口及其静态 UI 插槽声明。 */
export interface LocalPowerRendererDefinition {
  /** 相对 Power 根目录的 Renderer ESM 入口。 */
  entry: string;
  /** Renderer 是否提供 Power 专属 Sidebar。 */
  sidebar: boolean;
  /** Renderer 是否提供与 Sidebar 协作的业务 Mainview。 */
  mainview: boolean;
  /** Renderer 是否提供独立的设置中心 Config。 */
  config: boolean;
}

/** 内置与第三方 Power 共享的静态领域定义。 */
export interface LocalPowerDefinition {
  /** Power 的全局稳定 ID。 */
  id: string;
  /** 面向用户展示的标题。 */
  title?: string;
  /** 面向用户展示的用途说明。 */
  description: string;
  /** Power 用户文档路径。 */
  readme: string;
  /** Power 图标地址。 */
  icon?: string;
  /** Power 是否提供统一 main 运行入口。 */
  has_main: boolean;
  /** Power 是否提供专属 Sidebar。 */
  has_sidebar: boolean;
  /** Power 是否提供业务 Mainview。 */
  has_mainview: boolean;
  /** Power 是否提供设置中心 Config。 */
  has_config: boolean;
}

/** 内置与第三方 Power 共享的 City 注册协议。 */
export type LocalPowerRegistration = CityPowerRegistration;

/** powers/<power_id>/power.json 中的第三方 Power 定义。 */
export interface LocalInstalledPowerDefinition extends Omit<
  LocalPowerDefinition,
  "has_main" | "has_sidebar" | "has_mainview" | "has_config"
> {
  /** 文件协议版本。 */
  schema_version: 1;
  /** Power 语义化版本号。 */
  version: string;
  /** 相对 Power 目录的统一 City Power ESM 入口。 */
  main?: string;
  /** Renderer 入口及其静态 UI 插槽。 */
  renderer?: LocalPowerRendererDefinition;
  /** 可供更新命令重放的规范化来源。 */
  source: string;
  /** Git 来源解析得到的 commit SHA。 */
  revision?: string;
  /** 安装制品内容摘要。 */
  integrity: string;
  /** 首次安装时间。 */
  installed_at: string;
  /** 最近更新时间。 */
  updated_at: string;
}

/** config.toml 的标准持久化结构。 */
export interface LocalPowerConfig {
  /** 配置协议版本。 */
  schema_version: 2;
  /** 当前 Power 拥有的唯一配置。 */
  config: PowerJsonObject;
}
