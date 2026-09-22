/**
 * SessionTurnContext 运行时实现。
 *
 * 关键点（中文）
 * - Session 创建并拥有上下文，Executor 和 Tool 通过领域分区协作。
 * - 所有可变数组、Power lease 与取消监听都封装在本模块内。
 * - Power 每次只获得新建的只读快照，不能越过扩展边界访问内核运行能力。
 */

import type { ToolEffect } from "@downcity/type";
import type { SessionUserMessage } from "@downcity/type";
import type { SessionAgentContent } from "@downcity/type";
import type {
  SessionTurnContext,
  SessionTurnContextInit,
} from "@/types/turn/SessionTurnContext.js";
import type { SessionHookContextBlock } from "@downcity/type";
import type { SessionOrigin } from "@downcity/type";
import { normalize_session_origin } from "@downcity/type";

/** SessionTurnContext 的唯一内置实现。 */
class DefaultSessionTurnContext implements SessionTurnContext {
  readonly session: SessionTurnContext["session"];
  readonly interactions: SessionTurnContext["interactions"];

  private readonly abort_controller = new AbortController();
  private readonly upstream_abort_signal?: AbortSignal;
  private readonly abort_from_upstream: () => void;
  private disposed = false;
  private workspace_env_snapshot?: Readonly<Record<string, string>>;
  private agent_systems_snapshot: readonly string[] = Object.freeze([]);
  /** 整个 Turn 共享的扩展动态上下文。 */
  private power_context_blocks_snapshot: readonly SessionHookContextBlock[] = Object.freeze([]);
  /** 并发或重复解析时复用的唯一 Promise。 */
  private power_context_blocks_promise?: Promise<readonly SessionHookContextBlock[]>;
  private observed_user_messages: SessionUserMessage[] = [];
  private pending_assistant_parts: SessionAgentContent[] = [];
  private turn_effects: ToolEffect[] = [];

  readonly lifecycle: SessionTurnContext["lifecycle"];
  readonly step: SessionTurnContext["step"];
  readonly input: SessionTurnContext["input"];
  readonly output: SessionTurnContext["output"];
  readonly effects: SessionTurnContext["effects"];

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
      get power_context_blocks() {
        return context.power_context_blocks_snapshot;
      },
      commit: (input) => {
        context.workspace_env_snapshot = Object.freeze({
          ...input.workspace_env,
        });
        context.agent_systems_snapshot = Object.freeze([
          ...input.agent_systems,
        ]);
      },
      resolve_power_context_blocks: async (resolver) =>
        await context.resolve_power_context_blocks(resolver),
    });

    this.input = Object.freeze({
      observe_user_message: (message) => {
        if (message.turn_id !== context.session.turn_id) {
          throw new Error(`Observed User Message belongs to another Turn: ${message.message_id}`);
        }
        context.observed_user_messages.push(structuredClone(message));
      },
      user_messages: () => Object.freeze(
        context.observed_user_messages.map((message) => structuredClone(message)),
      ),
      checkpoint: async () => {
        await context.init.commit_step_input?.();
      },
      has_pending: () => context.init.has_pending_step_input?.() === true,
      append_internal: async (parts) => {
        if (!context.init.append_internal_user_message) {
          throw new Error("SessionTurnContext cannot persist internal User input");
        }
        return await context.init.append_internal_user_message(
          parts.map((part) => structuredClone(part)),
        );
      },
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
      report_model_request_failure: (notice) => {
        context.init.report_model_request_failure?.(notice);
      },
    });

    this.effects = Object.freeze({
      append: (effects) => {
        if (effects.length === 0) return;
        context.turn_effects.push(...effects);
        init.on_effects_changed?.(Object.freeze([...context.turn_effects]));
      },
      snapshot: () => Object.freeze([...context.turn_effects]),
    });
  }

  /** 每个 Turn 只执行一次 Power 动态上下文解析，并保存不可变快照。 */
  private async resolve_power_context_blocks(
    resolver: () => Promise<readonly SessionHookContextBlock[]>,
  ): Promise<readonly SessionHookContextBlock[]> {
    this.power_context_blocks_promise ??= (async () => {
      const blocks = await resolver();
      this.power_context_blocks_snapshot = Object.freeze(
        (Array.isArray(blocks) ? blocks : []).map((block) => Object.freeze({
          ...block,
          ...(block.citations
            ? { citations: Object.freeze([...block.citations]) as unknown as string[] }
            : {}),
        })),
      );
      return this.power_context_blocks_snapshot;
    })();
    return await this.power_context_blocks_promise;
  }

  /** 闭合当前运行拥有的全部资源。 */
  private async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.upstream_abort_signal?.removeEventListener(
      "abort",
      this.abort_from_upstream,
    );
  }
}

/** 创建一次由 Session Turn 拥有的统一执行上下文。 */
export function create_session_turn_context(
  init: SessionTurnContextInit,
): SessionTurnContext {
  return new DefaultSessionTurnContext(init);
}
