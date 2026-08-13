/**
 * CLI 本地数据库与 Repository 组合入口。
 *
 * 组合只发生在 CLI 产品层；`LocalDatabase` 保持无业务语义，各 Repository 直接暴露
 * 自己拥有的领域查询和写入能力。
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
import { AgentTokenRepository } from "@/city/runtime/auth/AgentTokenRepository.js";
import { ensure_cli_local_schema } from "@/city/runtime/LocalCliSchema.js";

/** CLI 进程使用的一组本地数据依赖。 */
export interface CliLocalData {
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
  /** CLI Agent HTTP Bearer Token 仓储。 */
  agent_tokens: AgentTokenRepository;
}

/** 显式创建 CLI 本地数据依赖。 */
export function create_cli_local_data(root_path_input?: string): CliLocalData {
  const root_path = resolve_local_root_path(root_path_input);
  const database = new LocalDatabase({ filename: get_local_database_path(root_path) });
  ensure_local_schema(database);
  ensure_cli_local_schema(database);
  const crypto_adapter = new LocalCrypto(root_path);
  const secure_settings = new SecureSettingRepository(database, crypto_adapter);
  const workspaces = new WorkspaceRepository(database, crypto_adapter);
  const agents = new AgentRepository(database, crypto_adapter, workspaces);
  const plugins = new PluginRepository(database, crypto_adapter);
  const agent_tokens = new AgentTokenRepository(database);
  return { root_path, database, agents, workspaces, plugins, secure_settings, agent_tokens };
}

/** 在短连接本地数据依赖上执行同步操作。 */
export function with_cli_local_data<TResult>(
  handler: (data: CliLocalData) => TResult,
): TResult {
  const data = create_cli_local_data();
  try {
    return handler(data);
  } finally {
    data.database.close();
  }
}
