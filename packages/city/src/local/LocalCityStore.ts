/**
 * LocalCityStore：CLI 与 Desktop 共用的本地 City Store Adapter。
 *
 * 它只拥有 `~/.downcity/downcity.db` 的连接与 Agent、Workspace、Plugin 配置。
 * 运行时对象的创建统一归 City 和 LocalCityEnvironment，Store 不导入或返回它们。
 */

import type { CityStore } from "@/types/CityStore.js";
import type { CityAgentConfig } from "@/types/CityAgentConfig.js";
import { LocalDatabase } from "@/local/store/LocalDatabase.js";
import { LocalCrypto } from "@/local/store/LocalCrypto.js";
import { LocalConfigRepository } from "@/local/store/LocalConfigRepository.js";
import { LocalPluginRepository } from "@/local/store/LocalPluginRepository.js";
import { resolve_local_root_path } from "@/local/store/LocalPaths.js";
import type {
  LocalAgentConfig,
  LocalCityStoreOptions,
  LocalWorkspaceConfig,
} from "@/local/types/LocalCity.js";
import type {
  LocalAgentPluginBinding,
  LocalPluginInstallation,
  LocalPluginResource,
} from "@/local/types/LocalPlugin.js";
import type { LocalCityDataSource } from "@/local/types/LocalCityDataSource.js";

/** 本地持久化 City Store。 */
export class LocalCityStore implements CityStore, LocalCityDataSource {
  /** 用户级数据根目录。 */
  readonly root_path: string;

  /** 本地数据库连接。 */
  private readonly database: LocalDatabase;

  /** 配置仓储。 */
  private readonly config_repository: LocalConfigRepository;

  /** Plugin Binding、Resource 与 installation 的统一仓储。 */
  private readonly plugin_repository: LocalPluginRepository;

  /** Store 是否已经释放。 */
  private disposed = false;

  /** 当前宿主显式选择的 Agent ID；空值表示读取全部配置。 */
  private readonly selected_agent_ids?: ReadonlySet<string>;

  constructor(options: LocalCityStoreOptions = {}) {
    this.root_path = resolve_local_root_path(options.root_path);
    this.database = new LocalDatabase(this.root_path);
    const crypto_adapter = new LocalCrypto(this.root_path);
    this.config_repository = new LocalConfigRepository(this.database, crypto_adapter);
    this.plugin_repository = new LocalPluginRepository(this.database, crypto_adapter);
    this.plugin_repository.migrate_legacy_chat_resources();
    this.selected_agent_ids = options.agent_ids
      ? new Set(options.agent_ids.map((agent_id) => String(agent_id || "").trim()).filter(Boolean))
      : undefined;
  }

  /** 从数据库读取全部可装配的 Agent 配置。 */
  async load_agent_configs(): Promise<readonly CityAgentConfig[]> {
    this.assert_open();
    const configs = this.config_repository.list_agents().filter((config) =>
      config.workspace_id
      && (!this.selected_agent_ids || this.selected_agent_ids.has(config.agent_id)),
    );
    return configs.map((config) => this.to_agent_config(config));
  }

  /** 列出本地 Agent 配置管理视图。 */
  list_agent_configs(): LocalAgentConfig[] {
    this.assert_open();
    return this.config_repository.list_agents();
  }

  /** 列出本地 Workspace 配置。 */
  list_workspace_configs(): LocalWorkspaceConfig[] {
    this.assert_open();
    return this.config_repository.list_workspaces();
  }

  /** 按 ID 读取 Workspace 配置。 */
  get_workspace_config(workspace_id: string): LocalWorkspaceConfig | null {
    this.assert_open();
    return this.config_repository.get_workspace(workspace_id);
  }

  /** 按本地路径读取 Workspace 配置。 */
  get_workspace_config_by_path(workspace_path: string): LocalWorkspaceConfig | null {
    this.assert_open();
    return this.config_repository.get_workspace_by_path(workspace_path);
  }

  /** 按 ID 读取本地 Agent 配置。 */
  get_agent_config(agent_id: string): LocalAgentConfig | null {
    this.assert_open();
    return this.config_repository.get_agent(agent_id);
  }

  /** 读取一个已解密的平台级安全配置。 */
  get_secure_setting<T>(key: string): T | null {
    this.assert_open();
    return this.config_repository.get_secure_setting<T>(key);
  }

  /** 创建一个供 CLI 管理流程使用的 Agent 配置。 */
  create_agent_config(input: {
    /** Agent ID。 */
    agent_id: string;
    /** 配置版本。 */
    version?: string;
    /** 执行配置。 */
    execution?: import("@downcity/agent").JsonObject;
    /** LLM 配置。 */
    llm?: import("@downcity/agent").JsonObject;
  }): LocalAgentConfig {
    this.assert_open();
    return this.config_repository.create_agent(input);
  }

  /** 保存供 CLI 管理流程使用的 Agent 配置。 */
  save_agent_config(input: LocalAgentConfig): LocalAgentConfig {
    this.assert_open();
    return this.config_repository.save_agent_config(input);
  }

  /** 删除 Agent 配置及其 Agent 级关联数据。 */
  remove_agent_config(agent_id: string): void {
    this.assert_open();
    this.config_repository.remove_agent(agent_id);
  }

  /** 按路径创建或读取 Workspace 配置。 */
  ensure_workspace(input: {
    /** Workspace 路径。 */
    workspace_path: string;
    /** 可选稳定 ID。 */
    workspace_id?: string;
    /** 可选展示名称。 */
    name?: string;
  }): LocalWorkspaceConfig {
    this.assert_open();
    return this.config_repository.ensure_workspace(input);
  }

  /** 为历史未绑定 Agent 写入唯一 Workspace 关系。 */
  bind_agent_workspace(agent_id: string, workspace_id: string): void {
    this.assert_open();
    this.config_repository.bind_agent_workspace(agent_id, workspace_id);
  }

  /** 列出一个 Agent 的全部 Plugin Binding。 */
  list_agent_plugin_bindings(agent_id: string): LocalAgentPluginBinding[] {
    this.assert_open();
    return this.plugin_repository.list_agent_bindings(agent_id);
  }

  /** 读取一个 Agent 的指定 Plugin Binding。 */
  get_agent_plugin_binding(agent_id: string, plugin_name: string): LocalAgentPluginBinding | null {
    this.assert_open();
    return this.plugin_repository.get_agent_binding(agent_id, plugin_name);
  }

  /** 新建或更新一个 Agent Plugin Binding。 */
  save_agent_plugin_binding(
    input: Omit<LocalAgentPluginBinding, "created_at" | "updated_at">,
  ): LocalAgentPluginBinding {
    this.assert_open();
    return this.plugin_repository.save_agent_binding(input);
  }

  /** 删除一个 Agent Plugin Binding。 */
  remove_agent_plugin_binding(agent_id: string, plugin_name: string): void {
    this.assert_open();
    this.plugin_repository.remove_agent_binding(agent_id, plugin_name);
  }

  /** 列出一个 Plugin 的全部 Resource。 */
  list_plugin_resources(plugin_name: string): LocalPluginResource[] {
    this.assert_open();
    return this.plugin_repository.list_resources(plugin_name);
  }

  /** 读取一个 Plugin Resource。 */
  get_plugin_resource(plugin_name: string, resource_id: string): LocalPluginResource | null {
    this.assert_open();
    return this.plugin_repository.get_resource(plugin_name, resource_id);
  }

  /** 新建或更新一个完整 Plugin Resource。 */
  save_plugin_resource(input: {
    /** 拥有该 Resource 的 Plugin 名称。 */
    plugin_name: string;
    /** 需要持久化的完整 Resource Item。 */
    item: LocalPluginResource["item"];
  }): LocalPluginResource {
    this.assert_open();
    return this.plugin_repository.save_resource(input);
  }

  /** 删除一个未被 Binding 引用的 Plugin Resource。 */
  remove_plugin_resource(plugin_name: string, resource_id: string): void {
    this.assert_open();
    this.plugin_repository.remove_resource(plugin_name, resource_id);
  }

  /** 列出全部第三方 Plugin installation。 */
  list_plugin_installations(): LocalPluginInstallation[] {
    this.assert_open();
    return this.plugin_repository.list_installations();
  }

  /** 按 ID 读取第三方 Plugin installation。 */
  get_plugin_installation(installation_id: string): LocalPluginInstallation | null {
    this.assert_open();
    return this.plugin_repository.get_installation(installation_id);
  }

  /** 新建或更新第三方 Plugin installation。 */
  save_plugin_installation(input: LocalPluginInstallation): LocalPluginInstallation {
    this.assert_open();
    return this.plugin_repository.save_installation(input);
  }

  /** 删除没有 Binding 或 Resource 引用的 Plugin installation。 */
  remove_plugin_installation(installation_id: string): LocalPluginInstallation {
    this.assert_open();
    return this.plugin_repository.remove_installation(installation_id);
  }

  /** 断言一个 Plugin 没有任何持久化 Binding 或 Resource。 */
  assert_plugin_unused(plugin_name: string): void {
    this.assert_open();
    this.plugin_repository.assert_plugin_unused(plugin_name);
  }

  /** 释放数据库连接，不删除持久化数据。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.database.close();
  }

  /** 同步关闭仅由配置管理命令创建的 Store 连接。 */
  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.database.close();
  }

  /** 把本地管理配置转换为 City 装配配置。 */
  private to_agent_config(config: LocalAgentConfig): CityAgentConfig {
    if (!config.workspace_id) throw new Error(`Agent requires a Workspace binding: ${config.agent_id}`);
    const workspace = this.config_repository.get_workspace(config.workspace_id);
    if (!workspace) throw new Error(`Workspace not found: ${config.workspace_id}`);
    return {
      agent_id: config.agent_id,
      version: config.version,
      workspace,
      ...(config.execution ? { execution: config.execution } : {}),
      ...(config.llm ? { llm: config.llm } : {}),
      plugins: config.plugins,
    };
  }

  /** 断言 Store 仍可使用。 */
  private assert_open(): void {
    if (this.disposed) throw new Error("LocalCityStore is disposed");
  }

}
