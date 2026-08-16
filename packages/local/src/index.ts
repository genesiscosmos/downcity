/**
 * @downcity/local 本地数据库基础设施入口。
 *
 * 该入口只暴露无业务语义的数据库和路径能力。Agent、Workspace、Plugin 等
 * 产品数据组件统一从 `@downcity/local/product` 导入。
 */

export { LocalDatabase } from "./database/LocalDatabase.js";
export type {
  LocalDatabaseMutationResult,
  LocalDatabaseOptions,
  LocalDatabaseQueryResult,
  LocalDatabaseStatement,
  LocalDatabaseTransaction,
  LocalDatabaseValue,
  LocalPreparedMutationResult,
  LocalPreparedStatement,
} from "./types/Database.js";
export {
  get_local_database_path,
  get_local_agent_path,
  get_local_agents_path,
  get_local_env_path,
  get_local_plugin_path,
  get_local_plugins_path,
  resolve_local_root_path,
} from "./runtime/LocalPaths.js";
