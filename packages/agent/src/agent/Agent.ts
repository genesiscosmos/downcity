/**
 * Agent：本地 Agent 核心入口与 facade。
 *
 * 职责说明（中文）
 * - 对外暴露 `Agent` 这一唯一的本地实例类。
 * - Agent 直接持有自身状态与长期运行时对象，避免额外 Assembly 复制同一批字段。
 * - Session 集合由 `AgentSessions` 管理；长期运行状态由 `AgentState` 管理。
 */

import type { Tool } from "ai";
import type { AgentModel } from "@/agent/AgentModel.js";
import { AgentContext } from "@/agent/AgentContext.js";
import type { AgentOptions } from "@/types/agent/AgentOptions.js";
import type { Shell } from "@downcity/shell";
import type { Workspace } from "@/workspace/Workspace.js";
import { Logger } from "@/utils/logger/Logger.js";
import { resolve_agent_env } from "@/config/AgentEnv.js";
import { normalizeInstructionInput } from "@/agent/AgentInstructions.js";
import { AgentSessions } from "@/agent/AgentSessions.js";
import { AgentState } from "@/agent/AgentState.js";
import { generateId } from "@/utils/Id.js";
import { PluginRegistry } from "@/plugin/core/PluginRegistry.js";

/**
 * SDK 本地 Agent。
 */
export class Agent {
  /** 当前 Agent 的稳定标识，用于区分 Session 存储目录与运行时归属。 */
  readonly id: string;

  /** 当前 Agent 引用的项目资源与安全边界。 */
  readonly workspace: Workspace;

  /** 当前 Agent 向所有 Session 提供的工具集合。 */
  readonly tools: Record<string, Tool>;

  /** 当前 Agent 已装配的 Plugin 调用与注册入口。 */
  readonly plugins: PluginRegistry;

  /** 当前 Agent 的本地 Session 创建、恢复、查询与归档入口。 */
  readonly sessions: AgentSessions;

  /**
   * 当前 Agent 持有的默认运行时模型实例。
   *
   * 关键点（中文）
   * - Agent 只持有调用方传入的实例，不负责模型选择、持久化或恢复。
   * - Session 未设置自己的模型时，执行会回退使用该实例。
   */
  readonly model?: AgentModel;

  /** 当前 Agent 独享的运行日志器。 */
  private readonly logger: Logger;

  /** 提供给 Plugin、Session 与宿主集成层共享的 Agent 执行上下文。 */
  private readonly context: AgentContext;

  /** 当前 Agent configured env 的可变共享对象。 */
  private readonly env: Record<string, string>;

  /** 调用方提供的自定义 Session 类；省略时使用 SDK 默认实现。 */
  private readonly SessionClass: AgentOptions["Session"];

  /** 当前 Agent 的长期运行状态与生命周期。 */
  private readonly state: AgentState;

  /** 当前 Agent configured instruction 的可变有序集合。 */
  private instruction: string[];

  constructor(options: AgentOptions) {
    this.id = String(options.id || "").trim();
    if (!this.id) throw new Error("Agent requires a non-empty id");
    if (!options.workspace) throw new Error("Agent requires a Workspace");
    this.workspace = options.workspace;
    const store = this.workspace.bind_agent(this.id);

    this.SessionClass = options.Session;
    this.model = options.model;
    this.tools = {
      ...this.workspace.tools,
      ...(options.tools && typeof options.tools === "object"
        ? options.tools
        : {}),
    };
    this.logger = new Logger();
    this.logger.bind_workspace(this.workspace.files);
    this.env = resolve_agent_env(this.workspace.path, options.env);
    this.instruction = normalizeInstructionInput(options.instruction);

    this.plugins = new PluginRegistry(options.plugins || []);

    this.sessions = new AgentSessions({
      agent_id: this.id,
      workspace_path: this.workspace.path,
      store,
      tools: this.tools,
      logger: this.logger,
      get_instruction: () => this.instruction,
      get_agent_env: () => this.getEnv(),
      get_agent_plugins: () => this.plugins.execution_view(),
      ensure_agent_ready: async () => {
        await this.ready();
      },
      get_agent_model: () => this.model,
      SessionClass: this.SessionClass,
    });
    this.context = new AgentContext({
      ...(this.workspace.shell ? { shell: this.workspace.shell } : {}),
      agent_id: this.id,
      rootPath: this.workspace.path,
      files: this.workspace.files,
      logger: this.logger,
      get_env: () => this.env,
      get_systems: () => this.instruction,
      sessions: this.sessions,
      plugins: this.plugins,
    });

    // 关键点（中文）：装配完成后创建唯一状态对象，并立即启动长期运行时。
    this.state = new AgentState({
      context: this.context,
      plugins: this.plugins,
      sessions: this.sessions,
      tools: this.tools,
    });
  }

  /**
   * 等待 Agent 持有的长期运行时启动完成。
   *
   * 关键点（中文）
   * - Agent 构造完成即开始启动 plugin lifecycle 与 ActionSchedule。
   * - 调用方在需要确认运行时就绪时使用，例如启动后立刻读取 plugin 状态。
   */
  async ready(): Promise<void> {
    await this.state.ready();
  }

  /**
   * 释放当前 Agent 持有的长期运行时对象。
   *
   * 关键点（中文）
   * - 关闭 plugin lifecycle 与 ActionSchedule 等 Agent 自有资源。
   * - Workspace 与 Agent 一对一绑定，因此这里同时关闭 Shell 与 Sandbox。
   * - 不负责任何 transport（RPC / HTTP）；transport 由 `@downcity/server` 自行管理。
   */
  async dispose(): Promise<void> {
    try {
      await this.state.dispose();
    } finally {
      try {
        await this.logger.saveAllLogs();
      } finally {
        await this.workspace.dispose();
      }
    }
  }

  /**
   * 更新当前 SDK Agent 的静态基础指令。
   */
  setInstruction(input: string | string[]): void {
    const next_instruction = normalizeInstructionInput(input);
    this.instruction.splice(0, this.instruction.length, ...next_instruction);
  }

  /**
   * 返回当前 agent env 的浅拷贝快照。
   *
   * 关键点（中文）
   * - 返回的是拷贝，调用方修改它不会影响 agent 真实状态。
   * - 想改 env 请使用 `setEnv` / `patchEnv`。
   */
  getEnv(): Record<string, string> {
    return { ...this.env };
  }

  /**
   * 整体覆盖 agent env。
   *
   * 关键点（中文）
   * - 直接清空当前共享 env 对象，再写入新值，保证 plugin / runtime / shell 看到的是同一引用。
   * - 仅写入字符串值，`null` / `undefined` 表示删除该 key。
   */
  setEnv(next: Record<string, string | null | undefined>): void {
    for (const key of Object.keys(this.env)) {
      delete this.env[key];
    }
    this.apply_env_patch(next);
    this.sessions.broadcast_env(this.env, generateId());
  }

  /**
   * 增量合并 agent env。
   *
   * 关键点（中文）
   * - `null` / `undefined` 表示删除该 key；其他值会强制转字符串后写入。
   * - configured env 原地更新；已有 Session 在下一 step 检查点提交 effective env。
   */
  patchEnv(patch: Record<string, string | null | undefined>): void {
    this.apply_env_patch(patch);
    this.sessions.broadcast_env(this.env, generateId());
  }

  /**
   * 原地应用一次 env patch，不触发重复广播。
   */
  private apply_env_patch(
    patch: Record<string, string | null | undefined>,
  ): void {
    if (!patch || typeof patch !== "object") return;
    for (const [raw_key, raw_value] of Object.entries(patch)) {
      const key = String(raw_key || "").trim();
      if (!key) continue;
      if (raw_value === null || raw_value === undefined) {
        delete this.env[key];
        continue;
      }
      this.env[key] = String(raw_value);
    }
  }

  /**
   * 返回当前 agent 绑定的统一日志器。
   */
  getLogger(): Logger {
    return this.logger;
  }

  /**
   * 返回当前 agent context。
   */
  getContext(): AgentContext {
    return this.context;
  }

  /**
   * 返回当前 agent 挂载的 Shell。
   */
  getShell(): Shell | undefined {
    return this.workspace.shell;
  }
}
