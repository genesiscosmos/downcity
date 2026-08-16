/**
 * CLI 本地存储与 Repository 组合入口。
 *
 * Agent 与 Plugin 使用文件仓储，Workspace 等本地业务仍使用 SQLite。组合只发生在
 * CLI 产品层，各 Repository 直接暴露自己拥有的领域查询和写入能力。
 */

import {
  get_local_database_path,
  LocalDatabase,
  resolve_local_root_path,
} from "@downcity/local";
import {
  AgentRepository,
  ensure_local_schema,
  PluginRepository,
  LocalSettingRepository,
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
  /** 平台明文设置仓储。 */
  settings: LocalSettingRepository;
  /** CLI Agent HTTP Bearer Token 仓储。 */
  agent_tokens: AgentTokenRepository;
}

/** 显式创建 CLI 本地数据依赖。 */
export function create_cli_local_data(root_path_input?: string): CliLocalData {
  const root_path = resolve_local_root_path(root_path_input);
  const database = new LocalDatabase({ filename: get_local_database_path(root_path) });
  ensure_local_schema(database);
  ensure_cli_local_schema(database);
  const settings = new LocalSettingRepository(database);
  const workspaces = new WorkspaceRepository(database);
  const agents = new AgentRepository(root_path);
  const plugins = new PluginRepository(root_path);
  const agent_tokens = new AgentTokenRepository(database);
  return { root_path, database, agents, workspaces, plugins, settings, agent_tokens };
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
