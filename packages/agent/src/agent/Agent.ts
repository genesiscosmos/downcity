/**
 * Agent：身份、模型、指令与 Plugin 的主体对象。
 *
 * 职责说明（中文）
 * - Agent 不绑定 Workspace；调用方通过 `enter()` 让同一个 Agent 进入项目。
 * - PluginRegistry 只属于 Agent，所有 Workspace 共享同一份注册定义。
 * - Workspace Tool、Session、Shell 与项目日志由 AgentWorkspace 独立持有。
 */

import type { Tool } from "ai";
import type { AgentModel } from "@/agent/AgentModel.js";
import { AgentWorkspace } from "@/agent/AgentWorkspace.js";
import { normalize_instruction_input } from "@/agent/AgentInstructions.js";
import { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import type {
  AgentOptions,
  AgentCity,
  AgentSessionConstructor,
} from "@/types/agent/AgentOptions.js";
import type { WorkspaceBase } from "@downcity/workspace";
import type { AgentPluginContext } from "@/types/plugin/AgentPluginContext.js";
import type { PluginWebServices } from "@/types/plugin/PluginServices.js";
import type {
  AgentCreateSessionOptions,
  AgentSessionCollection,
} from "@/types/agent/AgentSessionCollection.js";
import { Logger } from "@/utils/logger/Logger.js";

/** SDK Agent 主体。 */
export class Agent {
  /** Agent 的全局稳定标识。 */
  readonly id: string;

  /** Agent 当前绑定的 City 资源容器；未加入 City 时为空。 */
  private bound_city?: AgentCity;

  /** Agent 默认模型；Session 可以显式覆盖。 */
  readonly model?: AgentModel;

  /** Agent 面向用户的 Session 创建入口。 */
  readonly sessions: AgentSessionCollection;

  /** 当前 Agent 持有的 Web 搜索与文档能力。 */
  readonly web?: PluginWebServices;

  /** Agent 注册的唯一 PluginRegistry。 */
  readonly plugins: PluginRegistry;

  /** Agent 自定义 Tool；进入每个 Workspace 时与项目 Tool 合并。 */
  readonly custom_tools: Record<string, Tool>;

  /** Agent 使用的 Session 类。 */
  readonly session_class?: AgentSessionConstructor;

  /** AgentPlugin 的内部访问名，仍指向 Agent 唯一 Registry。 */
  readonly plugin_registry: PluginRegistry;

  /** 当前 Agent 已进入的 Workspace。 */
  private readonly workspaces_by_id = new Map<string, AgentWorkspace>();

  /** Agent 级日志器，不绑定任何 Workspace。 */
  private readonly logger = new Logger();

  /** 当前 Agent configured instruction。 */
  private readonly instruction: string[];

  /** Agent 释放状态。 */
  private dispose_promise?: Promise<void>;

  constructor(options: AgentOptions) {
    this.id = String(options.id || "").trim();
    if (!this.id) throw new Error("Agent requires a non-empty id");
    this.model = options.model;
    this.web = options.web;
    this.instruction = normalize_instruction_input(options.instruction);
    const agent = this;
    const agent_plugin_context: AgentPluginContext = Object.freeze({
      agent_id: this.id,
      logger: this.logger,
      web: this.web,
      get instructions() {
        return agent.get_instructions();
      },
    });
    this.plugins = new PluginRegistry(agent_plugin_context, options.plugins || []);
    this.plugin_registry = this.plugins;
    this.custom_tools = options.tools && typeof options.tools === "object"
      ? { ...options.tools }
      : {};
    this.session_class = options.session_class;
    this.sessions = {
      create: async (input) => await this.create_session(input),
    };
  }

  /** 返回 Agent 当前绑定的 City；仅由 City 集合建立绑定。 */
  get city(): AgentCity | undefined {
    return this.bound_city;
  }

  /**
   * 将 Agent 纳入 City。
   *
   * 该方法是 City 集合与 Agent 之间的内部装配协议，应用代码应调用
   * `city.agents.add(agent)`，不要直接调用它。
   */
  attach_city(city: AgentCity): void {
    if (this.bound_city && this.bound_city !== city) {
      throw new Error(`Agent "${this.id}" already belongs to another City`);
    }
    this.bound_city = city;
  }

  /** 解除 Agent 与 City 的内部绑定；仅由 City 生命周期调用。 */
  detach_city(city: AgentCity): void {
    if (this.bound_city === city) this.bound_city = undefined;
  }

  /**
   * 进入一个 Workspace。
   *
   * 同一 Agent 可以同时进入多个 Workspace；同一 Workspace ID 重复进入时返回已有
   * 作用域，防止重复创建 Shell、SessionStore 与后台任务。
   */
  enter(workspace: WorkspaceBase): AgentWorkspace {
    if (this.dispose_promise) throw new Error("Cannot enter Workspace after Agent disposal");
    const workspace_id = String(workspace?.id || "").trim();
    if (!workspace_id) throw new Error("Agent.enter requires a Workspace with a stable id");
    if (this.city && this.city.workspace(workspace_id) !== workspace) {
      throw new Error(`Workspace "${workspace_id}" does not belong to the Agent City`);
    }
    const existing = this.workspaces_by_id.get(workspace_id);
    if (existing) {
      if (existing.workspace !== workspace) {
        throw new Error(`Agent already entered Workspace "${workspace_id}" with another instance`);
      }
      return existing;
    }
    const entry = new AgentWorkspace({ agent: this, workspace });
    this.workspaces_by_id.set(workspace_id, entry);
    return entry;
  }

  /** 返回当前 Agent 已进入的 Workspace 作用域。 */
  workspaces(): readonly AgentWorkspace[] {
    return [...this.workspaces_by_id.values()];
  }

  /** 按稳定 ID 读取已进入的 Workspace。 */
  workspace(workspace_id_input: string): AgentWorkspace | null {
    return this.workspaces_by_id.get(String(workspace_id_input || "").trim()) ?? null;
  }

  /** 更新 Agent 的静态基础指令。 */
  set_instruction(input: string | string[]): void {
    const next_instruction = normalize_instruction_input(input);
    this.instruction.splice(0, this.instruction.length, ...next_instruction);
  }

  /** 返回 Agent 指令快照。 */
  get_instructions(): readonly string[] {
    return [...this.instruction];
  }

  /** 返回 Agent 级日志器。 */
  get_logger(): Logger {
    return this.logger;
  }

  /** 由 AgentWorkspace.leave() 回收已离开的作用域。 */
  release_workspace(workspace_id: string, entry: AgentWorkspace): void {
    if (this.workspaces_by_id.get(workspace_id) === entry) {
      this.workspaces_by_id.delete(workspace_id);
    }
  }

  /** 释放 Agent 进入的全部 Workspace 与 Agent Plugin。 */
  async dispose(): Promise<void> {
    this.dispose_promise ??= (async () => {
      const entries = [...this.workspaces_by_id.values()];
      const results = await Promise.allSettled(entries.map(async (entry) => await entry.leave()));
      await this.plugins.unregister_all();
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : []
      );
      this.bound_city?.release_agent(this);
      if (errors.length > 0) throw new AggregateError(errors, "Agent dispose failed");
    })();
    await this.dispose_promise;
  }

  /** 在指定 City Workspace 中创建属于当前 Agent 的 Session。 */
  private async create_session(input: AgentCreateSessionOptions) {
    if (!input?.workspace) throw new Error("agent.sessions.create requires a Workspace");
    return await this.enter(input.workspace).sessions.create({
      ...(input.session_id ? { session_id: input.session_id } : {}),
    });
  }
}
