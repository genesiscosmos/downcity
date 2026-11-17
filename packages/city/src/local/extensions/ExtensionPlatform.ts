/**
 * 本地产品宿主的扩展组合根。数据库、City 和数据根均借用既有宿主所有权；
 * CLI 与 Desktop 使用相同目录、恢复顺序、模型解析与管理操作。
 */
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
  readonly catalog: ExtensionCatalog = { agents: new Map(), federations: new Map(), models: new ExtensionModelRegistry() };
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
      if ([...this.catalog.federations].some(([id, federation]) => id.startsWith(prefix) && city.federation.current === federation)) throw new ExtensionFailure("project_busy", "Switch the current Federation before changing its extension", "dispose", 4);
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

  /** 项目恢复后再恢复明确选择；来源失败时解除运行绑定，保留失效引用供用户修复。 */
  async restore(): Promise<void> { await this.manager.restore(); this.restore_binding(); }

  restore_binding(): void {
    const selected = this.repository.selected_federation();
    if (selected && this.city) this.city.federation.set(this.catalog.federations.get(selected));
  }

  /** 真实目录与失效持久选择分开呈现，不隐式选择替代连接。 */
  connections() {
    const selected = this.repository.selected_federation();
    return { selected, items: [...this.catalog.federations].map(([entry_id, federation]) => ({ entry_id, name: federation.name, url: federation.url, selected: selected === entry_id })), unavailable: Boolean(selected && !this.catalog.federations.has(selected)) };
  }

  /** 用户明确切换；同步关闭所有 Agent 输入后检查，不打断现有工作。 */
  select_connection(entry_id: string | null): void {
    if (!this.city) throw new ExtensionFailure("host_required", "Selecting an extension connection requires a running host", "host", 5);
    const next = entry_id ? this.catalog.federations.get(entry_id) : undefined;
    if (entry_id && !next) throw new ExtensionFailure("federation_unavailable", "Selected extension connection is unavailable", "load", 2);
    const guards: (() => void)[] = [];
    try {
      for (const agent of this.city.agents.list()) guards.push(agent.sessions.guard_idle());
      const previous = this.city.federation.current;
      this.city.federation.set(next);
      try { this.repository.select_federation(entry_id); }
      catch (error) { this.city.federation.set(previous); throw error; }
    } finally { for (const release of guards.reverse()) release(); }
  }

  /** 扩展模型永不回退到 Federation。句柄每次执行解析当前目录代次。 */
  model(model_id: string): ModelClient | undefined {
    return this.catalog.models.owns(model_id) ? this.catalog.models.handle(model_id) : undefined;
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
    return { ...defaults, ...behavior, instruction: config.instruction || behavior.instruction || defaults.instruction, tools: { ...defaults.tools, ...behavior.tools }, model: typeof config.execution?.model_id === "string" ? this.model(config.execution.model_id) ?? defaults.model : behavior.model ?? defaults.model };
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
    if (this.repository.selected_federation()) this.city?.federation.set(undefined);
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
