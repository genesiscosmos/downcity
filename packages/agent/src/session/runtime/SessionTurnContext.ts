/**
 * SessionTurnContext 运行时实现。
 *
 * 关键点（中文）
 * - Session 创建并拥有上下文，Executor 和 Tool 通过领域分区协作。
 * - 所有可变数组、Plugin lease 与取消监听都封装在本模块内。
 * - Plugin 每次只获得新建的只读快照，不能越过扩展边界访问内核运行能力。
 */

import type { UIMessage } from "ai";
import type { SessionUserMessageV1 } from "@/executor/types/SessionRecords.js";
import type {
  SessionTurnContext,
  SessionTurnContextInit,
} from "@/types/executor/SessionTurnContext.js";
import type { AgentPluginExecutionLease } from "@/types/plugin/PluginRuntime.js";
import type { PluginExecutionContext } from "@/types/plugin/PluginExecutionContext.js";

/** 非 Turn 查询创建 Plugin 只读快照所需的稳定 Session 状态。 */
export interface CreateSessionPluginExecutionContextInput {
  /** 当前 Session 标识。 */
  session_id: string;
  /** 当前 Session 所属项目根目录。 */
  project_root: string;
  /** 当前 Session 已生效的 Workspace 环境变量。 */
  workspace_env: Readonly<Record<string, string>>;
  /** 当前 Session 已生效的 Agent instruction 文本。 */
  agent_systems: readonly string[];
}

/** SessionTurnContext 的唯一内置实现。 */
class DefaultSessionTurnContext implements SessionTurnContext {
  readonly session: SessionTurnContext["session"];
  readonly interactions: SessionTurnContext["interactions"];
  readonly shell: SessionTurnContext["shell"];

  private readonly abort_controller = new AbortController();
  private readonly upstream_abort_signal?: AbortSignal;
  private readonly abort_from_upstream: () => void;
  private disposed = false;
  private workspace_env_snapshot?: Readonly<Record<string, string>>;
  private agent_systems_snapshot: readonly string[] = Object.freeze([]);
  private plugin_lease?: AgentPluginExecutionLease;
  private injected_user_messages: SessionUserMessageV1[] = [];
  private deferred_messages: SessionUserMessageV1[] = [];
  private pending_assistant_parts: UIMessage["parts"] = [];

  readonly lifecycle: SessionTurnContext["lifecycle"];
  readonly step: SessionTurnContext["step"];
  readonly input: SessionTurnContext["input"];
  readonly output: SessionTurnContext["output"];

  constructor(private readonly init: SessionTurnContextInit) {
    const session_id = String(init.session_id || "").trim();
    if (!session_id) {
      throw new Error("SessionTurnContext requires a non-empty session_id");
    }
    const turn_id = String(init.turn_id || "").trim();
    if (!turn_id) {
      throw new Error("SessionTurnContext requires a non-empty turn_id");
    }
    const project_root = String(init.project_root || "").trim();
    this.session = Object.freeze({
      session_id,
      turn_id,
      ...(project_root ? { project_root } : {}),
    });
    this.interactions = init.interactions;
    this.shell = Object.freeze({
      ...(init.shell_approval_gateway
        ? { approval_gateway: init.shell_approval_gateway }
        : {}),
    });

    this.upstream_abort_signal = init.abort_signal;
    this.abort_from_upstream = () => {
      if (!this.abort_controller.signal.aborted) {
        this.abort_controller.abort(this.upstream_abort_signal?.reason);
      }
    };
    if (this.upstream_abort_signal?.aborted) {
      this.abort_from_upstream();
    } else {
      this.upstream_abort_signal?.addEventListener(
        "abort",
        this.abort_from_upstream,
        { once: true },
      );
    }

    this.lifecycle = Object.freeze({
      abort_signal: this.abort_controller.signal,
      abort: (reason?: unknown) => {
        if (!this.abort_controller.signal.aborted) {
          this.abort_controller.abort(reason);
        }
      },
      dispose: async () => await this.dispose(),
    });

    const context = this;
    this.step = Object.freeze({
      get workspace_env() {
        return context.workspace_env_snapshot;
      },
      get agent_systems() {
        return context.agent_systems_snapshot;
      },
      get plugins() {
        return context.plugin_lease;
      },
      commit: (input) => {
        context.workspace_env_snapshot = Object.freeze({
          ...input.workspace_env,
        });
        context.agent_systems_snapshot = Object.freeze([
          ...input.agent_systems,
        ]);
      },
      replace_plugins: async (plugins) => {
        const previous = context.plugin_lease;
        context.plugin_lease = plugins;
        if (previous && previous !== plugins) await previous.release();
      },
      release: async () => await context.release_plugins(),
      plugin_execution_context: () =>
        context.create_plugin_execution_context(),
    });

    this.input = Object.freeze({
      checkpoint: async () => {
        const injected = context.injected_user_messages;
        context.injected_user_messages = [];
        let queued: SessionUserMessageV1[] = [];
        try {
          queued = (await context.init.merge_step_input?.()) || [];
        } catch {
          queued = [];
        }
        return [...injected, ...queued];
      },
      has_pending: () => context.init.has_pending_step_input?.() === true,
      inject_user_message: (message) => {
        context.injected_user_messages.push(message);
      },
      defer_user_message: (message) => {
        context.deferred_messages.push(message);
      },
      deferred_user_messages: () => Object.freeze([...context.deferred_messages]),
      consume_history_reload: () =>
        context.init.consume_history_reload?.() === true,
    });

    this.output = Object.freeze({
      ...(init.assistant_output ? { assistant: init.assistant_output } : {}),
      enqueue_assistant_parts: (parts) => {
        context.pending_assistant_parts.push(...parts);
      },
      take_assistant_parts: () => {
        const parts = context.pending_assistant_parts;
        context.pending_assistant_parts = [];
        return [...parts];
      },
      publish_action: async (event) => {
        await context.init.publish_action?.(event);
      },
    });
  }

  /** 为 Plugin 生成不共享根对象引用的只读快照。 */
  private create_plugin_execution_context(): PluginExecutionContext {
    return Object.freeze({
      session_id: this.session.session_id,
      turn_id: this.session.turn_id,
      ...(this.session.project_root
        ? { project_root: this.session.project_root }
        : {}),
      ...(this.workspace_env_snapshot
        ? { workspace_env: this.workspace_env_snapshot }
        : {}),
      agent_systems: this.agent_systems_snapshot,
      abort_signal: this.abort_controller.signal,
    });
  }

  /** 释放当前 Step 捕获的 Plugin lease。 */
  private async release_plugins(): Promise<void> {
    const plugins = this.plugin_lease;
    this.plugin_lease = undefined;
    await plugins?.release();
  }

  /** 闭合当前运行拥有的全部资源。 */
  private async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.upstream_abort_signal?.removeEventListener(
      "abort",
      this.abort_from_upstream,
    );
    await this.release_plugins();
  }
}

/** 创建一次由 Session Turn 拥有的统一执行上下文。 */
export function create_session_turn_context(
  init: SessionTurnContextInit,
): SessionTurnContext {
  return new DefaultSessionTurnContext(init);
}

/** 为非 Turn 的 system 查询创建 Plugin 可读取的 Session 快照。 */
export function create_session_plugin_execution_context(
  input: CreateSessionPluginExecutionContextInput,
): PluginExecutionContext {
  return Object.freeze({
    session_id: input.session_id,
    project_root: input.project_root,
    workspace_env: Object.freeze({ ...input.workspace_env }),
    agent_systems: Object.freeze([...input.agent_systems]),
  });
}
