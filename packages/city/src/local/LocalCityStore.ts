/**
 * LocalCityStore：CLI 与 Desktop 共用的本地 City Store Adapter。
 *
 * 它拥有 `~/.downcity/downcity.db` 的连接、Agent/Workspace/Plugin 配置和本地 Agent
 * 恢复逻辑。City 只调用本模块实现的 CityStore 协议，不知道本地平台细节。
 */

import { Agent, Workspace } from "@downcity/agent";
import type {
  AgentDefinition,
  AgentModel,
} from "@downcity/agent";
import type { CityStore } from "@/types/CityStore.js";
import { AskQuestionsTool } from "@downcity/agent/tools";
import { Shell } from "@downcity/shell";
import type { AgentPluginDefinition } from "@downcity/agent";
import { LocalDatabase } from "@/local/store/LocalDatabase.js";
import { LocalCrypto } from "@/local/store/LocalCrypto.js";
import { LocalConfigRepository } from "@/local/store/LocalConfigRepository.js";
import { LocalPluginLoader } from "@/local/store/LocalPluginLoader.js";
import { LocalPluginRepository } from "@/local/store/LocalPluginRepository.js";
import { LocalEmbassySession } from "@/local/store/LocalEmbassySession.js";
import { resolve_local_agent_env } from "@/local/store/LocalEnvironment.js";
import { resolve_local_root_path } from "@/local/store/LocalPaths.js";
import type {
  LocalAgentConfig,
  LocalWorkspaceConfig,
  NewLocalAgentInput,
} from "@/local/types/LocalCity.js";
import type {
  LocalAgentPluginBinding,
  LocalPluginInstallation,
  LocalPluginResource,
} from "@/local/types/LocalPlugin.js";
import type {
  LocalCityStoreRuntimeOptions,
  LocalModelResolver,
  LocalPluginType,
} from "@/local/types/LocalRuntime.js";

/** 本地持久化 City Store。 */
export class LocalCityStore implements CityStore {
  /** 用户级数据根目录。 */
  readonly root_path: string;

  /** 本地数据库连接。 */
  private readonly database: LocalDatabase;

  /** 配置仓储。 */
  private readonly config_repository: LocalConfigRepository;

  /** Plugin 恢复器。 */
  private readonly plugin_loader: LocalPluginLoader;

  /** Plugin Binding、Resource 与 installation 的统一仓储。 */
  private readonly plugin_repository: LocalPluginRepository;

  /** 统一本地配置中的 Embassy 用户会话。 */
  private readonly embassy_session: LocalEmbassySession;

  /** Store 是否已经释放。 */
  private disposed = false;

  /** 当前宿主的模型解析器。 */
  private readonly model_resolver?: LocalModelResolver;

  /** 当前宿主显式选择的 Agent ID；空值表示恢复全部。 */
  private readonly selected_agent_ids?: ReadonlySet<string>;

  constructor(options: LocalCityStoreRuntimeOptions = {}) {
    this.root_path = resolve_local_root_path(options.root_path);
    this.database = new LocalDatabase(this.root_path);
    const crypto_adapter = new LocalCrypto(this.root_path);
    this.config_repository = new LocalConfigRepository(this.database, crypto_adapter);
    this.plugin_repository = new LocalPluginRepository(this.database, crypto_adapter);
    this.plugin_repository.migrate_legacy_chat_resources();
    this.embassy_session = new LocalEmbassySession(this.config_repository);
    this.plugin_loader = new LocalPluginLoader(this.database, crypto_adapter, this.embassy_session, {
      ...options,
      root_path: this.root_path,
    });
    this.model_resolver = options.model_resolver;
    this.selected_agent_ids = options.agent_ids
      ? new Set(options.agent_ids.map((agent_id) => String(agent_id || "").trim()).filter(Boolean))
      : undefined;
  }

  /** 从数据库恢复全部可绑定 Workspace 的 native Agent。 */
  async load_agents(): Promise<readonly Agent[]> {
    this.assert_open();
    const configs = this.config_repository.list_agents().filter((config) =>
      config.workspace_id
      && (!this.selected_agent_ids || this.selected_agent_ids.has(config.agent_id)),
    );
    const agents: Agent[] = [];
    try {
      for (const config of configs) agents.push(await this.restore_agent(config));
      return agents;
    } catch (error) {
      await Promise.allSettled(agents.map(async (agent) => await agent.dispose()));
      throw error;
    }
  }

  /** 持久化一个具有稳定定义的 Agent。 */
  async save_agent(agent: Agent): Promise<void> {
    this.assert_open();
    if (!agent.definition) {
      throw new Error(`Agent cannot be persisted without definition: ${agent.id}`);
    }
    this.config_repository.save_agent(agent.id, agent.definition);
  }

  /** 删除 Agent 的持久化配置。 */
  async remove_agent(agent_id: string): Promise<void> {
    this.assert_open();
    this.config_repository.remove_agent(agent_id);
  }

  /** 创建一个尚未写入数据库的 native Agent。 */
  async new_agent(input: NewLocalAgentInput): Promise<Agent> {
    this.assert_open();
    const workspace = this.config_repository.ensure_workspace({
      workspace_id: input.workspace_id,
      workspace_path: input.workspace_path,
      name: input.workspace_name,
    });
    const definition = this.build_definition(input, workspace);
    return await this.create_agent_instance({
      agent_id: input.agent_id,
      definition,
      workspace,
    });
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

  /** 返回当前本地宿主的唯一内建 Plugin constructor 集合。 */
  plugin_types(): LocalPluginType[] {
    this.assert_open();
    return this.plugin_loader.create_builtin_types();
  }

  /** 加载指定内建或第三方 Plugin 所属入口的完整 constructor 数组。 */
  async load_plugin_types(plugin_name: string): Promise<LocalPluginType[]> {
    this.assert_open();
    return await this.plugin_loader.load_plugin_types(plugin_name);
  }

  /** 根据统一 Embassy User Session 创建指定 Agent 模型。 */
  async create_model(model_id: string, env: NodeJS.ProcessEnv = process.env): Promise<AgentModel> {
    this.assert_open();
    if (this.model_resolver) return await this.model_resolver(model_id, env);
    return await this.embassy_session.create_model(model_id, env);
  }

  /** 重新读取一个 Agent 当前绑定 Workspace 的环境快照。 */
  reload_agent_env(agent_id: string): Record<string, string> {
    this.assert_open();
    const config = this.config_repository.get_agent(agent_id);
    if (!config?.workspace_id) throw new Error(`Agent requires a Workspace binding: ${agent_id}`);
    const workspace = this.config_repository.get_workspace(config.workspace_id);
    if (!workspace) throw new Error(`Workspace not found: ${config.workspace_id}`);
    const env = this.resolve_agent_env(workspace.workspace_path);
    return env;
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

  /** 从配置创建一个完整 Agent。 */
  private async restore_agent(config: LocalAgentConfig): Promise<Agent> {
    if (!config.workspace_id) throw new Error(`Agent requires a Workspace binding: ${config.agent_id}`);
    const workspace = this.config_repository.get_workspace(config.workspace_id);
    if (!workspace) throw new Error(`Workspace not found: ${config.workspace_id}`);
    return await this.create_agent_instance({
      agent_id: config.agent_id,
      definition: { ...config, workspace_id: config.workspace_id },
      workspace,
    });
  }

  /** 组装 Workspace、Shell、Model、Plugin 和 Agent。 */
  private async create_agent_instance(input: {
    /** Agent ID。 */
    agent_id: string;
    /** Agent 定义。 */
    definition: AgentDefinition;
    /** Workspace 配置。 */
    workspace: LocalWorkspaceConfig;
  }): Promise<Agent> {
    const env = this.resolve_agent_env(input.workspace.workspace_path);
    const model_id = read_model_id(input.definition.execution);
    const model = model_id
      ? (this.model_resolver
          ? await this.model_resolver(model_id, process.env)
          : this.embassy_session.create_agent_model(model_id, process.env))
      : undefined;
    const plugins = await this.plugin_loader.load_plugins(
      input.agent_id,
      input.definition.plugins,
    );
    const sandbox = await this.create_platform_sandbox();
    const workspace = new Workspace({
      path: input.workspace.workspace_path,
      shell: new Shell({ sandbox }),
      env,
    });
    return new Agent({
      id: input.agent_id,
      workspace,
      model,
      plugins,
      definition: input.definition,
      tools: { ask_question: AskQuestionsTool },
    });
  }

  /** 读取平台和 Workspace env。 */
  private resolve_agent_env(workspace_path: string): Record<string, string> {
    return resolve_local_agent_env({
      root_path: this.root_path,
      workspace_path,
      process_env: process.env,
    });
  }

  /** 根据当前操作系统选择 Sandbox。 */
  private async create_platform_sandbox() {
    if (process.platform === "darwin") {
      const { MacOsSeatbeltSandbox } = await import("@downcity/sandbox-macos");
      return new MacOsSeatbeltSandbox();
    }
    if (process.platform === "linux") {
      const { LinuxBubblewrapSandbox } = await import("@downcity/sandbox-linux");
      return new LinuxBubblewrapSandbox();
    }
    if (process.platform === "win32") {
      const { WindowsMxcSandbox } = await import("@downcity/sandbox-windows-mxc");
      return new WindowsMxcSandbox();
    }
    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  /** 断言 Store 仍可使用。 */
  private assert_open(): void {
    if (this.disposed) throw new Error("LocalCityStore is disposed");
  }

  /** 构造 Agent 定义。 */
  private build_definition(input: NewLocalAgentInput, workspace: LocalWorkspaceConfig): AgentDefinition {
    return {
      version: input.version || "1.0.0",
      workspace_id: workspace.workspace_id,
      workspace_name: workspace.name,
      ...(input.execution ? { execution: input.execution } : {}),
      ...(input.llm ? { llm: input.llm } : {}),
      plugins: input.plugins || [],
    };
  }
}

function read_model_id(execution: AgentDefinition["execution"]): string {
  if (!execution || typeof execution.model_id !== "string") return "";
  return execution.model_id.trim();
}
