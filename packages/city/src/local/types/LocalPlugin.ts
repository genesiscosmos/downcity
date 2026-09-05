/** 本地文件型 Plugin 定义、统一实例注册与 Profile 配置协议。 */

import type {
  CityPluginRegistration,
  PluginDefinition,
  PluginJsonObject,
} from "@/plugin/index.js";

/** Plugin Renderer 入口及其静态 UI 插槽声明。 */
export interface LocalPluginRendererDefinition {
  /** 相对 Plugin 根目录的 Renderer ESM 入口。 */
  entry: string;
  /** Renderer 是否提供 Plugin 专属 Sidebar。 */
  sidebar: boolean;
  /** Renderer 是否提供与 Sidebar 协作的业务 Mainview。 */
  mainview: boolean;
  /** Renderer 是否提供独立的设置中心 Config。 */
  config: boolean;
}

/** 内置与第三方 Plugin 共享的静态领域定义。 */
export interface LocalPluginDefinition {
  /** Plugin 的全局稳定 ID。 */
  id: string;
  /** 面向用户展示的标题。 */
  title?: string;
  /** 面向用户展示的用途说明。 */
  description: string;
  /** Plugin 用户文档路径。 */
  readme: string;
  /** Plugin 图标地址。 */
  icon?: string;
  /** Plugin 是否提供统一 main 运行入口。 */
  has_main: boolean;
  /** Plugin 是否提供专属 Sidebar。 */
  has_sidebar: boolean;
  /** Plugin 是否提供业务 Mainview。 */
  has_mainview: boolean;
  /** Plugin 是否提供设置中心 Config。 */
  has_config: boolean;
}

/** 内置与第三方 Plugin 共享的 City 注册协议。 */
export type LocalPluginRegistration = CityPluginRegistration;

/** plugins/<plugin_id>/plugin.json 中的第三方 Plugin 定义。 */
export interface LocalInstalledPluginDefinition extends Omit<
  LocalPluginDefinition,
  "has_main" | "has_sidebar" | "has_mainview" | "has_config"
> {
  /** 文件协议版本。 */
  schema_version: 1;
  /** Plugin 语义化版本号。 */
  version: string;
  /** 相对 Plugin 目录的统一 City Plugin ESM 入口。 */
  main?: string;
  /** Renderer 入口及其静态 UI 插槽。 */
  renderer?: LocalPluginRendererDefinition;
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

/** config.toml 的标准管理视图。 */
export interface LocalPluginConfig {
  /** 配置协议版本。 */
  schema_version: 1;
  /** 按稳定名称保存的全部 Plugin Profile。 */
  profiles: Record<string, PluginJsonObject>;
}
