/**
 * 代码项目扩展作者入口。项目只导出一个能力对象或配置函数；
 * 管理器与持久仓储属于 local 宿主面，不暴露给项目执行上下文。
 */
export { ExtensionConfigurationRequest } from "./local/extensions/ExtensionConfiguration.js";
export type { ExtensionProject, ExtensionEntry, ExtensionContext, ExtensionAgentDefinition, ExtensionDowntown, ExtensionConfigurationField, ExtensionPowerDefinition } from "./local/types/ExtensionProject.js";
