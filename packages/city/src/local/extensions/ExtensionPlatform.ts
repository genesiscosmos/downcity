/**
 * 本地产品宿主的扩展组合根。数据库、City 和数据根均借用既有宿主所有权；
 * CLI 与 Desktop 使用相同目录、恢复顺序、模型解析与管理操作。
 */
import { is_model_reference, type ModelReference } from "@downcity/type";
import type { AgentOptions } from "@downcity/agent";
import type { ModelClient } from "@downcity/type";
import type { City } from "../../city/runtime/City.js";
import type { LocalDatabase } from "../database/LocalDatabase.js";
import type { AgentRepository } from "../repositories/AgentRepository.js";
import type { LocalAgentConfig } from "../types/LocalConfig.js";
import type { ExtensionCatalog } from "../types/ExtensionHost.js";
import type { ExtensionProject } from "../types/ExtensionProject.js";
import { ExtensionSecrets } from "./ExtensionSecrets.js";
import { ExtensionHost } from "./ExtensionHost.js";
import { ExtensionManager } from "./ExtensionManager.js";
import { ExtensionRepository } from "../repositories/ExtensionRepository.js";
import { ExtensionService } from "./ExtensionService.js";
import { ExtensionModelRegistry } from "./ExtensionModelRegistry.js";
import { resolve_extension_host_modules } from "./ExtensionModules.js";
import { ExtensionFailure } from "./ExtensionError.js";

/** 每个宿主一份，构造不导入项目入口；attach 后才允许 restore 执行。 */
export class ExtensionPlatform {
  readonly catalog: ExtensionCatalog = { agents: new Map(), downtowns: new Map(), models: new ExtensionModelRegistry() };
  readonly repository: ExtensionRepository;
  readonly service: ExtensionService;
  readonly manager: ExtensionManager;
  private runtime?: ExtensionHost;
  private city?: City;
  private readonly agent_defaults = new Map<string, Partial<AgentOptions>>();

  constructor(database: LocalDatabase, readonly root_path: string, private readonly agents: AgentRepository) {
    this.repository = new ExtensionRepository(database, true);
    this.manager = new ExtensionManager(this.repository, { root_path, host_modules: resolve_extension_host_modules(), runtime: {
      active_snapshot: (id) => this.runtime?.active_snapshot(id) ?? null,
      warnings: (id) => this.runtime?.warnings(id) ?? [],
      close_gate: async (id) => await this.require_runtime().close_gate(id),
      release: async (id) => await this.require_runtime().release(id),
      load: async (record, filename) => await this.require_runtime().load(record, filename),
    } });
    this.service = new ExtensionService(this.manager, this);
  }

  /** 先建立解析器再恢复项目，随后宿主才恢复依赖这些定义的 Agent。 */
  attach(city: City, invalidate: () => void): void {
    if (this.runtime) throw new Error("Extension platform is already attached");
    this.city = city;
    this.runtime = new ExtensionHost({ city, catalog: this.catalog, host_modules: resolve_extension_host_modules(), invalidate, refresh_agents: (extension_id) => this.refresh_agents(extension_id), secret: async (extension_id, version, name) => (await new ExtensionSecrets(this.root_path).read(extension_id, version))[name], assert_idle: async (extension_id) => {
      const prefix = `ext_${extension_id.replaceAll("-", "")}_`;
      // Downtown 连接由 City Town 独立登记；扩展卸载只检查自身执行租约，不读取全局当前连接。
      for (const config of this.agents.list()) {
        if (typeof config.execution?.definition_id !== "string" || !config.execution.definition_id.startsWith(prefix)) continue;
        const agent = city.agents.get(config.agent_id);
        if (agent?.sessions.has_live_execution()) throw new ExtensionFailure("project_busy", "An Agent using this extension has active work", "dispose", 4, { agent_id: agent.id });
      }
    } });
  }

  /** 初始化完成的同源 Power/UI 目录。 */
  power_catalog() { return this.runtime?.power_catalog() ?? []; }

  /** 仅当前代次可访问编译资产。 */
  async renderer_resource(power_id: string, generation: string, resource: string): Promise<Response> { return await this.require_runtime().renderer_resource(power_id, generation, resource); }

  /** UI 动作必须携带该页面的原运行代次，不允许旧页面调用新实例。 */
  async invoke_renderer(power_id: string, generation: string, surface: "mainview" | "config", action: string, input?: import("../../power/index.js").PowerJsonValue) { return await this.require_runtime().invoke_renderer(power_id, generation, surface, action, input); }

  /** 项目恢复只发布每个扩展自己的 Town 来源，不恢复全局当前连接。 */
  async restore(): Promise<void> { await this.manager.restore(); }

  /** 返回扩展来源目录；没有 selected 字段，避免形成全局连接绑定。 */
  connections() {
    return { items: [...this.catalog.downtowns].map(([entry_id, downtown]) => ({ entry_id, name: downtown.name, url: downtown.url, source: "extension" as const })), unavailable: false };
  }

  /** 扩展连接不能被切换为全局当前 Downtown；调用者应直接选择 Town 来源。 */
  select_connection(_entry_id: string | null): never {
    throw new ExtensionFailure("connection_selection_removed", "Extension connections are selected by Town model or service source", "source", 2);
  }

  /** 扩展模型永不回退到 Downtown。句柄每次执行解析当前目录代次。 */
  model(model: ModelReference): ModelClient | undefined {
    if (!("client" in model) || !this.catalog.models.owns(model.client)) return undefined;
    const client = this.catalog.models.handle(model.client);
    return client.id === model.id ? client : undefined;
  }

  /** 创建新 Agent 前解析定义并只返回行为，不接管身份或存储。 */
  behavior(config: LocalAgentConfig): Partial<AgentOptions> {
    const id = config.execution?.definition_id;
    if (typeof id !== "string") return {};
    const definition = this.catalog.agents.get(id);
    const acquire_execution = () => {
      const current = this.catalog.agents.get(id);
      if (!current) throw new ExtensionFailure("agent_definition_unavailable", "The Agent definition's extension is unavailable", "load");
      return this.require_runtime().acquire(this.project_id(id), `agent:${config.agent_id}`);
    };
    // 缺失定义仍能恢复身份和历史；只有执行入口报不可用。
    return { ...(definition?.behavior ?? {}), acquire_execution };
  }

  /** 保存产品默认工具等装配输入，用于重载时更新原 Agent 而不新建身份。 */
  agent_behavior(config: LocalAgentConfig, defaults: Partial<AgentOptions>): Partial<AgentOptions> {
    this.agent_defaults.set(config.agent_id, defaults);
    const behavior = this.behavior(config);
    return { ...defaults, ...behavior, instruction: config.instruction || behavior.instruction || defaults.instruction, tools: { ...defaults.tools, ...behavior.tools }, model: is_model_reference(config.execution?.model) ? this.model(config.execution.model) ?? defaults.model : behavior.model ?? defaults.model };
  }

  /** 同步发布点更新行为；Session ID/存储不变，旧运行引用不得复用。 */
  private refresh_agents(extension_id: string): void {
    const prefix = `ext_${extension_id.replaceAll("-", "")}_`;
    for (const config of this.agents.list()) {
      if (typeof config.execution?.definition_id !== "string" || !config.execution.definition_id.startsWith(prefix)) continue;
      const agent = this.city?.agents.get(config.agent_id);
      if (!agent) continue;
      const behavior = this.agent_behavior(config, this.agent_defaults.get(config.agent_id) ?? {});
      agent.reconfigure_behavior(behavior);
    }
  }

  private project_id(entry_id: string): string {
    const value = entry_id.match(/^ext_([a-f\d]{32})_/u)?.[1];
    if (!value) throw new ExtensionFailure("entry_invalid", "Extension entry identity is invalid", "load", 2);
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }

  /** 供创建选择器展示真实已发布定义。 */
  definitions(): NonNullable<ExtensionProject["agents"]> { return [...this.catalog.agents.values()]; }

  /** 宿主退出时只释放运行，不改变持久启动目标。City 必须仍可执行 Power 清理。 */
  async dispose(): Promise<void> {
    if (!this.runtime) return;
    for (const record of this.repository.list().reverse()) {
      if (this.runtime.active_snapshot(record.extension_id)) await this.runtime.close_gate(record.extension_id);
      await this.runtime.release(record.extension_id);
    }
  }

  private require_runtime(): ExtensionHost {
    if (!this.runtime || !this.city) throw new ExtensionFailure("host_unavailable", "Extension host is not initialized", "host", 5);
    return this.runtime;
  }
}
