/**
 * Agent：身份、模型、指令与 Plugin 的主体对象。
 *
 * 职责说明（中文）
 * - Agent 不绑定 Workspace；调用方通过 `agent.sessions.create({ workspace })` 选择本次执行环境。
 * - PluginRegistry 只属于 Agent，所有 Workspace 共享同一份注册定义。
 * - Workspace Tool、Session、Shell 与项目日志由 AgentWorkspace 独立持有。
 */

import type { Tool } from "ai";
import type { AgentModel } from "@/agent/AgentModel.js";
import { normalize_instruction_input } from "@/agent/AgentInstructions.js";
import { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import type {
  AgentOptions,
  AgentSessionConstructor,
} from "@/types/agent/AgentOptions.js";
import type { AgentPluginContext } from "@/types/plugin/AgentPluginContext.js";
import type { PluginWebServices } from "@/types/plugin/PluginServices.js";
import type { City } from "../city/index.js";
import type {
  AgentCreateSessionOptions,
  AgentSessionCollection,
} from "@/types/agent/AgentSessionCollection.js";
import { Logger } from "@/utils/logger/Logger.js";
import {
  agent_city,
  clear_agent_runtime,
  create_agent_workspace,
  initialize_agent_runtime,
  list_agent_workspaces,
} from "@/internal/AgentRuntime.js";

/** SDK Agent 主体。 */
export class Agent {
  /** Agent 的全局稳定标识。 */
  readonly id: string;

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

  /** 当前 Agent 所在的完整 City；未加入 City 时为空。 */
  get city(): City | undefined {
    return agent_city(this);
  }

  /** Agent 级日志器，不绑定任何 Workspace。 */
  private readonly logger = new Logger();

  /** 当前 Agent configured instruction。 */
  private readonly instruction: string[];

  /** Agent 释放状态。 */
  private dispose_promise?: Promise<void>;

  constructor(options: AgentOptions) {
    this.id = String(options.id || "").trim();
    if (!this.id) throw new Error("Agent requires a non-empty id");
    initialize_agent_runtime(this);
    this.model = options.model;
    this.web = options.web;
    this.instruction = normalize_instruction_input(options.instruction);
    const agent = this;
    const agent_plugin_context: AgentPluginContext = Object.freeze({
      agent_id: this.id,
      logger: this.logger,
      web: this.web,
      get city() {
        return agent_city(agent);
      },
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

  /** 释放 Agent 进入的全部 Workspace 与 Agent Plugin。 */
  async dispose(): Promise<void> {
    this.dispose_promise ??= (async () => {
      const entries = [...list_agent_workspaces(this)];
      const results = await Promise.allSettled(entries.map(async (entry) => await entry.leave()));
      await this.plugins.unregister_all();
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : []
      );
      agent_city(this)?.release_agent(this);
      clear_agent_runtime(this);
      if (errors.length > 0) throw new AggregateError(errors, "Agent dispose failed");
    })();
    await this.dispose_promise;
  }

  /** 在指定 City Workspace 中创建属于当前 Agent 的 Session。 */
  private async create_session(input: AgentCreateSessionOptions) {
    if (!input?.workspace) throw new Error("agent.sessions.create requires a Workspace");
    if (this.dispose_promise) throw new Error("Cannot create a Session after Agent disposal");
    return await create_agent_workspace(this, input.workspace).sessions.create({
      ...(input.session_id ? { session_id: input.session_id } : {}),
    });
  }
}
