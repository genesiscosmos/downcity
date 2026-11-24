/** 扩展执行宿主的显式依赖及运行目录类型；持久仓储不接触真实能力实例。 */
import type { City } from "../../city/runtime/City.js";
import type { ExtensionAgentDefinition, ExtensionDowntown } from "./ExtensionProject.js";
import type { ExtensionModelRegistry } from "../extensions/ExtensionModelRegistry.js";

/** 全部能力发布前经过相同目录；仅宿主装配可写。 */
export interface ExtensionCatalog {
  /** 可创建的行为定义，以宿主稳定 ID 查询。 */
  agents: Map<string, ExtensionAgentDefinition>;
  /** 连接目录，当前绑定由宿主原有账户流程管理。 */
  downtowns: Map<string, ExtensionDowntown>;
  /** 与所有执行入口共享的模型目录。 */
  models: ExtensionModelRegistry;
}

/** 宿主装配时提供的最少生命周期依赖。 */
export interface ExtensionHostOptions {
  /** 已经正常创建且持有根租约的 City，绝不由扩展管理隐式创建。 */
  city: City;
  /** 当前实际 SDK 模块映射，用于恢复前检查快照绑定。 */
  host_modules: Readonly<Record<string, string>>;
  /** 共享能力目录。 */
  catalog: ExtensionCatalog;
  /** 查询宿主中 Agent 活跃执行、连接绑定与其他真实借用引用。 */
  assert_idle: (extension_id: string) => void | Promise<void>;
  /** 读取本项目及快照绑定的秘密引用，不能返回其他项目的值。 */
  secret: (extension_id: string, configuration_version: string, name: string) => Promise<string | undefined>;
  /** 在同步发布点更新既有 Agent 行为，不能异步打开新请求窗口。 */
  refresh_agents?: (extension_id: string) => void;
  /** 提交真实目录变化后刷新产品视图。 */
  invalidate: (change: import("../resources/types/ResourceChange.js").ResourceChange) => void;
}

