/**
 * Session system 快照与模型输入组装边界。
 *
 * 关键点（中文）
 * - 拥有 Session 创建后固定的 system snapshot，以及检查点生效的 env/hook 视图。
 * - Composer 只读取本对象生成的不可变输入，不接触 Session 持久化编排。
 * - Plugin Hook 失败只降级对应扩展内容，不改变 canonical Message。
 */

import type { JsonValue } from "@/types/common/Json.js";
import type {
  AgentSessionSystemBlock,
  AgentSessionSystemSnapshot,
} from "@/types/agent/SessionTypes.js";
import type {
  SessionComposeIdentity,
  SessionComposeInput,
  SessionStepInput,
} from "@/types/session/SessionComposer.js";
import type {
  SessionHookContextBlock,
  SessionSystemContextHookValue,
  SessionTurnContextHookValue,
} from "@/types/session/SessionHook.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";
import type { SessionHooks } from "@/session/SessionHooks.js";
import type { SessionCompositionOptions } from "@/types/session/SessionComposition.js";
import { create_session_hook_context } from "@/session/runtime/SessionTurnContext.js";
import { SESSION_HOOK_POINTS } from "@/session/SessionHookPoints.js";

/** 管理当前 Session 的 system snapshot 与 Step 组装输入。 */
export class SessionComposition {
  private readonly options: SessionCompositionOptions;
  private effective_instruction_blocks: AgentSessionSystemBlock[];
  private effective_workspace_env: Record<string, string>;
  private effective_hooks: SessionHooks;
  /** 当前 Session 首次生成后固定的完整 system snapshot。 */
  private snapshot_blocks: AgentSessionSystemBlock[] | null = null;
  /** 当前 Session instruction 的一次性恢复任务。 */
  private initialize_promise: Promise<void> | null = null;
  /** 串行化 snapshot / syncshot 对 system 与 instruction.md 的修改。 */
  private mutation_chain: Promise<void> = Promise.resolve();

  constructor(options: SessionCompositionOptions) {
    this.options = options;
    this.effective_instruction_blocks = options.instruction_system_blocks.map(
      (block) => ({ ...block }),
    );
    this.effective_workspace_env = { ...options.workspace_env };
    this.effective_hooks = options.hooks;
  }

  /** 恢复显式固化的完整 system snapshot。 */
  async initialize(): Promise<void> {
    if (!this.initialize_promise) {
      this.initialize_promise = (async () => {
        const persisted_instruction = await this.options.store.read_instruction();
        if (persisted_instruction === null) return;

        const instruction = persisted_instruction.trim();
        this.snapshot_blocks = instruction
          ? [{
              source: "instruction" as const,
              name: "snapshot",
              content: instruction,
            }]
          : [];
        const stable_system_blocks = this.effective_instruction_blocks
          .filter((block) => block.source !== "instruction")
          .map((block) => ({ ...block }));
        this.effective_instruction_blocks = [
          ...(instruction
            ? [{
                source: "instruction" as const,
                name: "agent",
                content: instruction,
              }]
            : []),
          ...stable_system_blocks,
        ];
      })();
    }
    await this.initialize_promise;
  }

  /** 把当前完整 system 显式固化到 instruction.md。 */
  async snapshot(): Promise<void> {
    await this.run_mutation(async () => {
      const system_snapshot = await this.read();
      await this.write_snapshot(system_snapshot.blocks);
    });
  }

  /** 使用 Agent 当前 instruction 与 Plugin 重新生成完整 system。 */
  async syncshot(): Promise<void> {
    await this.run_mutation(async () => {
      await this.initialize();
      const should_persist = await this.options.store.has_instruction();
      const composed = await this.options.composer.compose(
        await this.create_compose_input(undefined, 0, true),
      );
      const next_blocks = resolve_composed_system_blocks(composed);

      if (should_persist) await this.write_snapshot(next_blocks);
      this.effective_instruction_blocks =
        this.options.get_instruction_system_blocks().map((block) => ({ ...block }));
      this.snapshot_blocks = next_blocks;
    });
  }

  /** 读取当前 Session 生效的完整 system 快照。 */
  async read(): Promise<AgentSessionSystemSnapshot> {
    await this.initialize();
    const composed = await this.compose_for_view();
    return {
      session_id: this.options.session_id,
      session: {
        agent_id: this.options.agent_id,
        session_id: this.options.session_id,
        project_root: this.options.workspace_path,
        created_at: new Date(this.options.get_created_at()).toISOString(),
        timezone: this.options.get_timezone(),
      },
      blocks: resolve_composed_system_blocks(composed),
    };
  }

  /** 在 Session Command 检查点提交下一 Step 使用的 Workspace env。 */
  set_workspace_env(env: Record<string, string>): void {
    this.effective_workspace_env = { ...env };
  }

  /** 在 Session Command 检查点提交下一 Step 使用的 Hook 视图。 */
  set_hooks(hooks: SessionHooks): void {
    this.effective_hooks = hooks;
  }

  /** 返回当前检查点生效的 Hook 视图。 */
  get_effective_hooks(): SessionHooks {
    return this.effective_hooks;
  }

  /** 返回当前 Session 捕获的 instruction blocks 副本。 */
  instruction_blocks(): AgentSessionSystemBlock[] {
    return this.effective_instruction_blocks.map((block) => ({ ...block }));
  }

  /** 创建 Composer 共用的稳定 Session 身份快照。 */
  compose_identity(): SessionComposeIdentity {
    return {
      agent_id: this.options.agent_id,
      session_id: this.options.session_id,
      project_root: this.options.workspace_path,
      created_at: this.options.get_created_at(),
      timezone: this.options.get_timezone(),
    };
  }

  /** 为 Composer 创建当前 Step 的只读 Session 快照。 */
  async create_compose_input(
    turn_context: SessionTurnContext | undefined,
    retry_count: number,
    refresh_system = false,
  ): Promise<SessionComposeInput> {
    const instruction_system_blocks = refresh_system
      ? this.options.get_instruction_system_blocks().map((block) => ({ ...block }))
      : this.instruction_blocks();
    // Plugin system 参与 Compose，必须先看到当前检查点已确定的 env 与 instruction。
    turn_context?.step.commit({
      workspace_env: this.effective_workspace_env,
      agent_systems: instruction_system_blocks.map((block) => block.content),
    });
    const hook_context =
      turn_context?.step.hook_context() ||
      create_session_hook_context({
        session_id: this.options.session_id,
        session_origin: this.options.session_origin,
        project_root: this.options.workspace_path,
        workspace_env: this.effective_workspace_env,
        agent_systems: this.effective_instruction_blocks.map(
          (block) => block.content,
        ),
      });
    const history = await this.options.messages.context_snapshot();
    const plugin_runtime = refresh_system
      ? this.options.get_hooks()
      : turn_context?.step.hooks || this.effective_hooks;
    const plugin_system_blocks = this.snapshot_blocks && !refresh_system
      ? []
      : refresh_system
        ? await plugin_runtime.system_blocks(hook_context)
        : turn_context?.step.hooks
          ? await turn_context.step.hooks.system_blocks(hook_context)
          : await this.effective_hooks.system_blocks(hook_context);
    const resolved_plugin_system_blocks = this.snapshot_blocks && !refresh_system
      ? []
      : await this.resolve_plugin_system_context(
          plugin_runtime,
          plugin_system_blocks,
          turn_context?.session.turn_id,
        );
    const plugin_context_blocks = turn_context
      ? await turn_context.step.resolve_plugin_context_blocks(async () => {
          const hooks = turn_context.step.hooks;
          if (!hooks) return [];
          const value: SessionTurnContextHookValue = {
            session_id: this.options.session_id,
            turn_id: turn_context.session.turn_id,
            user_messages: history.messages.flatMap((message) => {
              if (
                message.type !== "user" ||
                message.turn_id !== turn_context.session.turn_id
              ) return [];
              return [{
                message_id: message.message_id,
                text: message.parts
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("\n"),
              }];
            }),
            blocks: [],
          };
          try {
            const output = await hooks.pipeline(
              SESSION_HOOK_POINTS.turn_context,
              value as unknown as JsonValue,
            ) as unknown as SessionTurnContextHookValue;
            return normalize_plugin_context_blocks(output?.blocks);
          } catch (error) {
            await this.log_plugin_hook_warning(
              SESSION_HOOK_POINTS.turn_context,
              error,
              turn_context.session.turn_id,
            );
            return [];
          }
        })
      : [];
    return {
      session: this.compose_identity(),
      state: {
        model: this.options.get_model(),
        model_context_window: this.options.get_model_context_window(),
        env: Object.freeze({ ...this.effective_workspace_env }),
        systems: Object.freeze(
          instruction_system_blocks.map((block) => block.content),
        ),
        tools: Object.freeze({ ...this.options.tools }),
        instruction_system_blocks,
        managed_plugin_system_blocks:
          this.snapshot_blocks && !refresh_system
            ? []
            : await this.options.get_managed_plugin_system_blocks(),
        plugin_system_blocks: resolved_plugin_system_blocks,
        plugin_context_blocks,
      },
      history,
      turn: {
        ...(turn_context ? { turn_id: turn_context.session.turn_id } : {}),
        retry_count,
      },
    };
  }

  /** 固定或应用当前 Session 的 system snapshot。 */
  apply_snapshot(input: SessionStepInput): SessionStepInput {
    if (!this.snapshot_blocks) {
      this.snapshot_blocks = resolve_composed_system_blocks(input);
    }
    return {
      ...input,
      system: this.snapshot_blocks.map((block) => ({
        role: "system" as const,
        content: block.content,
      })),
      system_blocks: this.snapshot_blocks.map((block) => ({ ...block })),
    };
  }

  /** 通过 pipeline point 解析 Plugin 追加的命名 system blocks。 */
  private async resolve_plugin_system_context(
    hooks: SessionHooks | NonNullable<SessionTurnContext["step"]["hooks"]>,
    blocks: readonly AgentSessionSystemBlock[],
    turn_id?: string,
  ): Promise<AgentSessionSystemBlock[]> {
    const value: SessionSystemContextHookValue = {
      session_id: this.options.session_id,
      ...(turn_id ? { turn_id } : {}),
      blocks: blocks.map((block) => ({ ...block })),
    };
    try {
      const output = await hooks.pipeline(
        SESSION_HOOK_POINTS.system_context,
        value as unknown as JsonValue,
      ) as unknown as SessionSystemContextHookValue;
      return normalize_plugin_system_blocks(output?.blocks);
    } catch (error) {
      await this.log_plugin_hook_warning(
        SESSION_HOOK_POINTS.system_context,
        error,
        turn_id,
      );
      return value.blocks;
    }
  }

  /** Plugin 上下文 Hook 失败只降级当前扩展内容。 */
  private async log_plugin_hook_warning(
    point_name: string,
    error: unknown,
    turn_id?: string,
  ): Promise<void> {
    try {
      await this.options.logger.log("warn", "[agent] session plugin hook failed", {
        session_id: this.options.session_id,
        ...(turn_id ? { turn_id } : {}),
        point_name,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Plugin 已经降级，日志失败不能反向阻断 Session。
    }
  }

  /** 使用统一 Composer 生成只读 system/history 查询结果。 */
  private async compose_for_view(): Promise<SessionStepInput> {
    const composed = await this.options.composer.compose(
      await this.create_compose_input(undefined, 0),
    );
    return this.apply_snapshot(composed);
  }

  /** 串行执行一次 Session system 修改。 */
  private async run_mutation(operation: () => Promise<void>): Promise<void> {
    const next = this.mutation_chain.then(operation, operation);
    this.mutation_chain = next.catch(() => undefined);
    await next;
  }

  /** 把指定完整 system blocks 原子写入 instruction.md。 */
  private async write_snapshot(
    blocks: readonly AgentSessionSystemBlock[],
  ): Promise<void> {
    await this.options.store.write_instruction(
      blocks.map((block) => block.content).join("\n\n"),
    );
  }
}

/** 把 system pipeline 输出限制为 Plugin 命名内容块。 */
function normalize_plugin_system_blocks(input: unknown): AgentSessionSystemBlock[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const name = String(record.name || "").trim();
    const content = String(record.content || "").trim();
    if (!name || !content) return [];
    return [{ source: "plugin" as const, name, content }];
  });
}

/** 把 Turn pipeline 输出限制为低权限动态参考内容块。 */
function normalize_plugin_context_blocks(input: unknown): SessionHookContextBlock[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const source_plugin = String(record.source_plugin || "").trim();
    const name = String(record.name || "").trim();
    const content = String(record.content || "").trim();
    if (
      !source_plugin ||
      !name ||
      !content ||
      record.trust_level !== "reference"
    ) return [];
    const citations = Array.isArray(record.citations)
      ? record.citations
          .map((citation) => String(citation || "").trim())
          .filter(Boolean)
      : [];
    const version = String(record.version || "").trim();
    return [{
      source_plugin,
      name,
      content,
      trust_level: "reference" as const,
      ...(citations.length > 0 ? { citations } : {}),
      ...(version ? { version } : {}),
    }];
  });
}

/** 把自定义 Composer 的 system content 转为可展示文本。 */
function stringify_system_content(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (content === null || content === undefined) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content || "").trim();
  }
}

/** 以实际模型输入为准，保留仍与其一致的 system block 来源信息。 */
function resolve_composed_system_blocks(
  composed: SessionStepInput,
): AgentSessionSystemBlock[] {
  const declared_blocks = composed.system_blocks || [];
  return composed.system.flatMap((message, index) => {
    const content = stringify_system_content(message.content);
    if (!content) return [];
    const declared = declared_blocks[index];
    if (declared && declared.content.trim() === content) {
      return [{ ...declared, content }];
    }
    return [{
      source: "session" as const,
      name: `custom_system:${index + 1}`,
      content,
    }];
  });
}
