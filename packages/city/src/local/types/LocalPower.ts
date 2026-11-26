/** 本地文件型 Power 定义、统一实例注册与唯一配置协议。 */

import type {
  CityPowerRegistration,
  PowerDefinition,
  PowerJsonObject,
} from "@/power/index.js";

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
  /** Power 是否提供完整业务页面。 */
  has_page: boolean;
  /** Power 是否提供与工作区分离的设置中心 Config 面板。 */
  has_config: boolean;
}

/** 内置与第三方 Power 共享的 City 注册协议。 */
export type LocalPowerRegistration = CityPowerRegistration;

/** 单个第三方 Power 定义读取或注册加载失败，保留稳定 ID 与原始异常。 */
export interface LocalPowerLoadFailure {
  /** 加载失败的已安装 Power 稳定 ID，供宿主定位与展示故障。 */
  power_id: string;
  /** 定义读取、完整性校验或模块加载抛出的原始值，未经字符串化或替换。 */
  error: unknown;
}

/** 逐目录读取已安装定义的结果，成功定义与失败记录分别按稳定 ID 排序。 */
export interface LocalInstalledPowerListResult {
  /** 成功读取并通过定义校验的已安装 Power，按稳定 ID 排序。 */
  definitions: LocalInstalledPowerDefinition[];
  /** 读取或校验失败的目录 ID 与原始异常，按目录 ID 排序。 */
  failures: LocalPowerLoadFailure[];
}

/** 一次逐项隔离加载的结果，定义读取失败在前，随后为注册加载失败。 */
export interface LocalPowerLoadResult {
  /** 内置注册在前，随后为成功加载且提供 main 的已安装 Power 注册。 */
  registrations: CityPowerRegistration[];
  /** 每个加载失败的已安装 Power 及其原始异常；失败不影响其他注册。 */
  failures: LocalPowerLoadFailure[];
}

/** powers/<power_id>/power.json 中的第三方 Power 定义。 */
export interface LocalInstalledPowerDefinition extends Omit<
  LocalPowerDefinition,
  "has_main" | "has_page" | "has_config"
> {
  /** 文件协议版本。 */
  schema_version: 1;
  /** Power 语义化版本号。 */
  version: string;
  /** 相对 Power 目录的统一 City Power ESM 入口。 */
  main?: string;
  /** 完整宿主协议到预构建入口、能力与运行文件的静态映射。 */
  renderers?: import("../../power/types/PowerRendererBinding.js").PowerRendererBindings;
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

/** 安装摘要使用的静态清单，不包含来源、配置或安装时间。 */
export type LocalPowerPackageManifest = Pick<LocalInstalledPowerDefinition, "id" | "version" | "main" | "readme" | "icon" | "renderers">;
