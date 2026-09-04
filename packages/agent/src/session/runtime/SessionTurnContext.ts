/**
 * SessionTurnContext 运行时实现。
 *
 * 关键点（中文）
 * - Session 创建并拥有上下文，Executor 和 Tool 通过领域分区协作。
 * - 所有可变数组、Plugin lease 与取消监听都封装在本模块内。
 * - Plugin 每次只获得新建的只读快照，不能越过扩展边界访问内核运行能力。
 */

import type { SessionUserMessage } from "@/types/session/SessionMessage.js";
import type { SessionAssistantResultPart } from "@/types/session/SessionContent.js";
import type {
  SessionTurnContext,
  SessionTurnContextInit,
} from "@/types/executor/SessionTurnContext.js";
import type {
  SessionExtensionExecutionContext,
  SessionExtensionExecutionLease,
} from "@/types/session/SessionExtension.js";
import type { SessionOrigin } from "@/types/session/SessionOrigin.js";
import { normalize_session_origin } from "@/session/SessionOrigin.js";
import type { SessionPluginContextBlock } from "@/types/session/SessionPluginHook.js";
import type { WorkspaceFileMutation } from "@downcity/workspace";

/** 非 Turn 查询创建 Plugin 只读快照所需的稳定 Session 状态。 */
export interface CreateSessionExtensionExecutionContextInput {
  /** 当前 Session 标识。 */
  session_id: string;
  /** 当前 Session 的完整来源元数据。 */
  session_origin: SessionOrigin;
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
  private extension_lease?: SessionExtensionExecutionLease;
  /** 整个 Turn 共享的 Plugin 动态上下文，不随 Step lease 切换而失效。 */
  private plugin_context_blocks_snapshot: readonly SessionPluginContextBlock[] = Object.freeze([]);
  /** 并发或重复解析时复用的唯一 Promise。 */
  private plugin_context_blocks_promise?: Promise<readonly SessionPluginContextBlock[]>;
  private injected_user_messages: SessionUserMessage[] = [];
  private deferred_messages: SessionUserMessage[] = [];
  private pending_assistant_parts: SessionAssistantResultPart[] = [];
  private workspace_file_mutations: WorkspaceFileMutation[] = [];

  readonly lifecycle: SessionTurnContext["lifecycle"];
  readonly step: SessionTurnContext["step"];
  readonly input: SessionTurnContext["input"];
  readonly output: SessionTurnContext["output"];
  readonly workspace_changes: SessionTurnContext["workspace_changes"];

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
      origin: Object.freeze(normalize_session_origin(init.session_origin)),
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
      get extensions() {
        return context.extension_lease;
      },
      get plugin_context_blocks() {
        return context.plugin_context_blocks_snapshot;
      },
      commit: (input) => {
        context.workspace_env_snapshot = Object.freeze({
          ...input.workspace_env,
        });
        context.agent_systems_snapshot = Object.freeze([
          ...input.agent_systems,
        ]);
      },
      replace_extensions: async (extensions) => {
        const previous = context.extension_lease;
        context.extension_lease = extensions;
        if (previous && previous !== extensions) await previous.release();
      },
      resolve_plugin_context_blocks: async (resolver) =>
        await context.resolve_plugin_context_blocks(resolver),
      release: async () => await context.release_extensions(),
      extension_execution_context: (call_id?: string) =>
        context.create_extension_execution_context(call_id),
    });

    this.input = Object.freeze({
      checkpoint: async () => {
        const injected = context.injected_user_messages;
        context.injected_user_messages = [];
        let queued: SessionUserMessage[] = [];
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

    this.workspace_changes = Object.freeze({
      record_file_mutations: (mutations) => {
        context.workspace_file_mutations.push(...mutations);
      },
      file_mutations: () => Object.freeze([...context.workspace_file_mutations]),
    });
  }

  /** 每个 Turn 只执行一次 Plugin 动态上下文解析，并保存不可变快照。 */
  private async resolve_plugin_context_blocks(
    resolver: () => Promise<readonly SessionPluginContextBlock[]>,
  ): Promise<readonly SessionPluginContextBlock[]> {
    this.plugin_context_blocks_promise ??= (async () => {
      const blocks = await resolver();
      this.plugin_context_blocks_snapshot = Object.freeze(
        (Array.isArray(blocks) ? blocks : []).map((block) => Object.freeze({
          ...block,
          ...(block.citations
            ? { citations: Object.freeze([...block.citations]) as unknown as string[] }
            : {}),
        })),
      );
      return this.plugin_context_blocks_snapshot;
    })();
    return await this.plugin_context_blocks_promise;
  }

  /** 为 City 扩展生成不共享根对象引用的只读快照。 */
  private create_extension_execution_context(call_id?: string): SessionExtensionExecutionContext {
    const normalized_call_id = String(call_id || "").trim();
    return Object.freeze({
      session_id: this.session.session_id,
      session_origin: this.session.origin,
      turn_id: this.session.turn_id,
      ...(normalized_call_id ? { call_id: normalized_call_id } : {}),
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

  /** 释放当前 Step 捕获的扩展 lease。 */
  private async release_extensions(): Promise<void> {
    const extensions = this.extension_lease;
    this.extension_lease = undefined;
    await extensions?.release();
  }

  /** 闭合当前运行拥有的全部资源。 */
  private async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.upstream_abort_signal?.removeEventListener(
      "abort",
      this.abort_from_upstream,
    );
    await this.release_extensions();
  }
}

/** 创建一次由 Session Turn 拥有的统一执行上下文。 */
export function create_session_turn_context(
  init: SessionTurnContextInit,
): SessionTurnContext {
  return new DefaultSessionTurnContext(init);
}

/** 为非 Turn 的 system 查询创建 Plugin 可读取的 Session 快照。 */
export function create_session_extension_execution_context(
  input: CreateSessionExtensionExecutionContextInput,
): SessionExtensionExecutionContext {
  return Object.freeze({
    session_id: input.session_id,
    session_origin: Object.freeze(normalize_session_origin(input.session_origin)),
    project_root: input.project_root,
    workspace_env: Object.freeze({ ...input.workspace_env }),
    agent_systems: Object.freeze([...input.agent_systems]),
  });
}
