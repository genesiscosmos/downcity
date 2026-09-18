/**
 * City 本地产品数据组件内部聚合入口。
 *
 * 该入口提供 Downcity CLI 与 Desktop 使用的 Schema、Repository、环境装配和 Power
 * Loader。基础数据库 Adapter 仍不理解这些产品概念。
 */

export { ensure_local_schema } from "./database/LocalSchema.js";
export {
  LocalPowerLoader,
  load_local_city_power,
  verify_local_installed_power_integrity,
} from "./runtime/LocalPowerLoader.js";
export {
  resolve_local_agent_env,
  resolve_local_global_env,
} from "./runtime/LocalEnvironment.js";
export {
  AgentRepository,
  normalize_agent_id,
  create_agent_id,
  normalize_power_id,
} from "./repositories/AgentRepository.js";
export { WorkspaceRepository, normalize_workspace_id } from "./repositories/WorkspaceRepository.js";
export { PowerRepository } from "./repositories/PowerRepository.js";
export { LocalSettingRepository } from "./repositories/LocalSettingRepository.js";
export { GroupRepository, normalize_group_id } from "./repositories/GroupRepository.js";
export type {
  LocalAgentConfig,
  LocalGroupConfig,
  LocalWorkspaceConfig,
} from "./types/LocalConfig.js";
export type {
  LocalInstalledPowerDefinition,
  LocalPowerConfig,
  LocalPowerDefinition,
  LocalPowerRendererDefinition,
  LocalPowerRegistration,
} from "./types/LocalPower.js";
export type {
  LocalPowerLoaderOptions,
} from "./types/LocalRuntime.js";
