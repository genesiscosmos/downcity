/**
 * Desktop 本地数据库与 Repository 组合入口。
 *
 * Electron main 显式拥有数据库连接；数据库 Adapter 不理解 Agent、Workspace 或 Plugin。
 */

import {
  get_local_database_path,
  LocalCrypto,
  LocalDatabase,
  resolve_local_root_path,
} from "@downcity/local";
import {
  AgentRepository,
  ensure_local_schema,
  PluginRepository,
  SecureSettingRepository,
  WorkspaceRepository,
} from "@downcity/local/product";

/** Desktop main 使用的一组本地数据依赖。 */
export interface DesktopLocalData {
  /** 用户级数据根目录。 */
  root_path: string;
  /** 无业务语义的 SQLite Adapter。 */
  database: LocalDatabase;
  /** Agent 配置仓储。 */
  agents: AgentRepository;
  /** Workspace 配置仓储。 */
  workspaces: WorkspaceRepository;
  /** Plugin 配置仓储。 */
  plugins: PluginRepository;
  /** 平台加密设置仓储。 */
  secure_settings: SecureSettingRepository;
}

/** 显式创建 Desktop 本地数据依赖。 */
export function create_desktop_local_data(): DesktopLocalData {
  const root_path = resolve_local_root_path();
  const database = new LocalDatabase({ filename: get_local_database_path(root_path) });
  ensure_local_schema(database);
  const crypto_adapter = new LocalCrypto(root_path);
  const secure_settings = new SecureSettingRepository(database, crypto_adapter);
  const workspaces = new WorkspaceRepository(database, crypto_adapter);
  const agents = new AgentRepository(root_path);
  const plugins = new PluginRepository(root_path);
  return { root_path, database, agents, workspaces, plugins, secure_settings };
}
