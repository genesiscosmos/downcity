/**
 * StepInput：为每个 Step 准备发给模型的输入。
 *
 * 关键点（中文）
 * - 同时拥有「冻结的 system 快照」与「每步宿主事实采集」，因为二者互为前提：首次组装
 *   的结果就是快照，而快照一旦冻结就不再重新采集 Power system。
 * - 只产出输入，不发请求、不判断是否继续；请求与循环归 `SessionExecutor`。
 * - 不拥有 Message、Turn 或 Store 生命周期。
 */

import type {
  JsonValue,
  ModelClient,
  AgentTool as Tool,
  SessionHookContextBlock,
  SessionTurnContextHookValue,
  ToolCallContext,
} from "@downcity/type";
import type { BoundAgentTool, ToolCallSite } from "@/types/tool/BoundAgentTool.js";
import type {
  AgentSessionSystemBlock,
  AgentSessionSystemSnapshot,
} from "@/types/agent/SessionTypes.js";
import type {
  SessionComposeIdentity,
  SessionComposeInput,
  SessionStepInput,
} from "@/types/session/SessionComposer.js";
import type { SessionStepExecutionInput } from "@/types/session/SessionExecution.js";
import type { StepInputOptions } from "@/types/session/StepInput.js";
import type { SessionTurnContext } from "@/types/turn/SessionTurnContext.js";
import type { SessionToolExecutionContext } from "@/types/turn/SessionToolExecutionContext.js";
import type { SessionDerivedStore } from "@/types/store/SessionStorage.js";
import { is_action_result } from "@/types/action/ActionResult.js";
import { SESSION_HOOK_POINTS } from "@/session/input/SessionHookPoints.js";
import { run_pipeline_point } from "@/session/input/SessionHookRunner.js";
import { resolve_session_power_system_blocks } from "@/session/input/SessionSystem.js";

/** 当前 Session 的每步模型输入装配者。 */
export class StepInput {
  private readonly options: StepInputOptions;
  private effective_instruction_blocks: AgentSessionSystemBlock[];
  /** 当前 Session 首次组装后冻结的完整 system；null 表示尚未冻结。 */
  private frozen_blocks: AgentSessionSystemBlock[] | null = null;
  /** 当前 Session 的一次性初始化任务。 */
  private initialize_promise: Promise<void> | null = null;
  /** 串行化 snapshot / syncshot 对 system 与 instruction.md 的修改。 */
  private mutation_chain: Promise<void> = Promise.resolve();

  constructor(options: StepInputOptions) {
    this.options = options;
    this.effective_instruction_blocks = options.instruction_system_blocks.map(
      (block) => ({ ...block }),
    );
  }

  /** 初始化派生 schema，并恢复显式固化的 system 快照。 */
  async initialize(): Promise<void> {
    if (!this.initialize_promise) {
      this.initialize_promise = (async () => {
        await this.options.store.initialize();
        await this.options.composer.initialize({ derived: this.derived_store() });
        const persisted_instruction = await this.options.store.read_instruction();
        if (persisted_instruction === null) return;

        const instruction = persisted_instruction.trim();
        this.frozen_blocks = instruction
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
    const initialize_promise = this.initialize_promise;
    try {
      await initialize_promise;
    } catch (error) {
      if (this.initialize_promise === initialize_promise) {
        this.initialize_promise = null;
      }
      throw error;
    }
  }

  /**
   * 为下一个 Provider Step 组装唯一一份输入。
   *
   * 关键点（中文）
   * - 调用方必须先提交 Session 统一输入队列，再调用本方法。
   * - 首次调用会把组装出的完整 system 冻结为当前 Session 的 system 快照。
   */
  async build(
    turn_context: SessionTurnContext,
    advance_count: number,
  ): Promise<SessionStepExecutionInput> {
    const compose_input = await this.gather(turn_context, advance_count);
    const model = compose_input.state.model;
    if (!model) throw new Error("requires a configured model.");
    turn_context.step.commit({
      workspace_env: compose_input.state.env,
      agent_systems: compose_input.state.systems,
    });
    const composed = await this.options.composer.compose(compose_input);
    const frozen = this.apply_frozen_system(composed);
    return {
      model,
      system: frozen.system,
      messages: frozen.messages,
      tools: this.bind_turn_context_to_tools(frozen.tools, turn_context),
      ...(compose_input.state.model_context_window !== undefined
        ? { context_window: compose_input.state.model_context_window }
        : {}),
    };
  }

  /** 把当前完整 system 显式固化到 instruction.md。 */
  async snapshot(): Promise<void> {
    await this.run_mutation(async () => {
      const system_snapshot = await this.read_system();
      await this.write_snapshot(system_snapshot.blocks);
    });
  }

  /** 使用 Agent 当前 instruction 与 Power 重新生成完整 system。 */
  async syncshot(): Promise<void> {
    await this.run_mutation(async () => {
      await this.initialize();
      const should_persist = await this.options.store.has_instruction();
      const composed = await this.options.composer.compose(
        await this.gather(undefined, 0, true),
      );
      const next_blocks = resolve_composed_system_blocks(composed);

      if (should_persist) await this.write_snapshot(next_blocks);
      this.effective_instruction_blocks =
        this.options.get_instruction_system_blocks().map((block) => ({ ...block }));
      this.frozen_blocks = next_blocks;
    });
  }

  /** 读取当前 Session 生效的完整 system 快照。 */
  async read_system(): Promise<AgentSessionSystemSnapshot> {
    await this.initialize();
    const composed = await this.options.composer.compose(
      await this.gather(undefined, 0),
    );
    return {
      session_id: this.options.session_id,
      session: {
        agent_id: this.options.agent_id,
        session_id: this.options.session_id,
        project_root: this.options.workspace_path,
        created_at: new Date(this.options.get_created_at()).toISOString(),
        timezone: this.options.get_timezone(),
      },
      blocks: resolve_composed_system_blocks(this.apply_frozen_system(composed)),
    };
  }

  /** 返回当前 Session 捕获的 instruction blocks 副本。 */
  instruction_blocks(): AgentSessionSystemBlock[] {
    return this.effective_instruction_blocks.map((block) => ({ ...block }));
  }

  /** 创建 Composer 共用的稳定 Session 身份快照。 */
  identity(): SessionComposeIdentity {
    return {
      agent_id: this.options.agent_id,
      session_id: this.options.session_id,
      project_root: this.options.workspace_path,
      created_at: this.options.get_created_at(),
      timezone: this.options.get_timezone(),
    };
  }

  /** 采集当前 Step 的宿主事实，交给 Composer 组装。 */
  private async gather(
    turn_context: SessionTurnContext | undefined,
    advance_count: number,
    refresh_system = false,
  ): Promise<SessionComposeInput> {
    const instruction_system_blocks = refresh_system
      ? this.options.get_instruction_system_blocks().map((block) => ({ ...block }))
      : this.instruction_blocks();
    const workspace_env = Object.freeze({ ...this.options.get_workspace_env() });
    // Power system 参与 Compose，必须先看到当前检查点已确定的 env 与 instruction。
    turn_context?.step.commit({
      workspace_env,
      agent_systems: instruction_system_blocks.map((block) => block.content),
    });
    const call_context = turn_context
      ? this.create_tool_call_context(turn_context, {
          tool_call_id: "",
          messages: [],
        })
      : this.create_session_call_context(workspace_env);
    const hooks = this.options.get_hooks();
    const resolved_power_system_blocks = this.frozen_blocks && !refresh_system
      ? []
      : await resolve_session_power_system_blocks({
          session_id: this.options.session_id,
          ...(turn_context?.session.turn_id
            ? { turn_id: turn_context.session.turn_id }
            : {}),
          hooks,
          context: call_context,
          on_error: async (error) => await this.log_power_hook_warning(
            SESSION_HOOK_POINTS.system_context,
            error,
            turn_context?.session.turn_id,
          ),
        });
    const power_context_blocks = turn_context
      ? await turn_context.step.resolve_power_context_blocks(async () => {
          const value: SessionTurnContextHookValue = {
            session_id: this.options.session_id,
            turn_id: turn_context.session.turn_id,
            user_messages: turn_context.input.user_messages().map((message) => ({
                message_id: message.message_id,
                text: message.parts
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("\n"),
              })),
            blocks: [],
          };
          try {
            const output = await run_pipeline_point({
              hooks,
              point_name: SESSION_HOOK_POINTS.turn_context,
              value: value as unknown as JsonValue,
              context: call_context,
            });
            return normalize_power_context_blocks(
              (output as unknown as SessionTurnContextHookValue)?.blocks,
            );
          } catch (error) {
            await this.log_power_hook_warning(
              SESSION_HOOK_POINTS.turn_context,
              error,
              turn_context.session.turn_id,
            );
            return [];
          }
        })
      : [];
    return {
      session: this.identity(),
      state: {
        model: this.options.get_model(),
        model_context_window: this.options.get_model_context_window(),
        env: workspace_env,
        systems: Object.freeze(
          instruction_system_blocks.map((block) => block.content),
        ),
        tools: Object.freeze({ ...this.options.get_tools() }),
        instruction_system_blocks,
        power_system_blocks: resolved_power_system_blocks,
        power_context_blocks,
      },
      history: await this.options.store.list_messages(),
      derived: this.derived_store(),
      turn: {
        ...(turn_context ? { turn_id: turn_context.session.turn_id } : {}),
        advance_count,
      },
    };
  }

  /** 返回当前 Composer 命名空间的派生存储视图。 */
  private derived_store(): SessionDerivedStore {
    return this.options.store.derived_store(this.options.composer.name);
  }

  /**
   * 冻结或套用当前 Session 的 system 快照。
   *
   * 关键点（中文）：首次调用把组装结果记成快照；之后每次都覆盖为快照，保证同一 Session
   * 的 system 不再漂移。
   */
  private apply_frozen_system(input: SessionStepInput): SessionStepInput {
    if (!this.frozen_blocks) {
      this.frozen_blocks = resolve_composed_system_blocks(input);
    }
    return {
      ...input,
      system: this.frozen_blocks.map((block) => ({
        role: "system" as const,
        content: block.content,
      })),
      system_blocks: this.frozen_blocks.map((block) => ({ ...block })),
    };
  }

  /** Power 上下文 Hook 失败只降级当前扩展内容。 */
  private async log_power_hook_warning(
    point_name: string,
    error: unknown,
    turn_id?: string,
  ): Promise<void> {
    try {
      await this.options.logger.log("warn", "[agent] session power hook failed", {
        session_id: this.options.session_id,
        ...(turn_id ? { turn_id } : {}),
        point_name,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Power 已经降级，日志失败不能反向阻断 Session。
    }
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

  /**
   * 把工具包装为已绑定调用环境的工具。
   *
   * 关键点（中文）
   * - 包装层是上下文注入的唯一位置：捕获 Session 级信息，并在每次调用时
   *   合并模型 Step 提供的调用身份与消息快照。
   * - 每个 step 使用独立包装，不会在并行 Session 间共享可变指针。
   */
  private bind_turn_context_to_tools(
    tools: Record<string, Tool>,
    turn_context: SessionTurnContext,
  ): Record<string, BoundAgentTool> {
    const wrapped: Record<string, BoundAgentTool> = {};
    for (const [name, tool] of Object.entries(tools)) {
      const original_execute = tool.execute;
      if (typeof original_execute !== "function") {
        wrapped[name] = tool as unknown as BoundAgentTool;
        continue;
      }
      wrapped[name] = {
        ...tool,
        execute: async (args: unknown, site: ToolCallSite) => {
          const tool_call_id = String(site.tool_call_id || "").trim();
          if (!tool_call_id) {
            throw new Error(`Tool execution requires toolCallId: ${name}`);
          }
          if (turn_context.output.assistant) {
            await turn_context.output.assistant.prepare_tool_input({
              tool_call_id,
              tool_name: name,
              input: args,
            });
          }
          const context = this.create_tool_call_context(turn_context, {
            tool_call_id,
            abort_signal: site.abort_signal || turn_context.lifecycle.abort_signal,
            messages: site.messages,
          });
          const output = await original_execute(args, context);
          if (!is_action_result(output)) return output;
          if (Array.isArray(output.effects)) {
            turn_context.effects.append(output.effects);
          }
          for (const message of output.messages) {
            if (message.role === "agent") {
              turn_context.output.enqueue_assistant_parts(message.parts);
              continue;
            }
            await turn_context.input.append_internal(message.parts);
          }
          return output.output;
        },
      };
    }
    return wrapped;
  }

  /** 构造不属任何 Turn 的调用环境；用于 system 查询。 */
  private create_session_call_context(
    workspace_env: Readonly<Record<string, string>>,
  ): ToolCallContext {
    const workspace = this.options.get_workspace?.();
    return Object.freeze({
      agent_id: this.options.agent_id,
      agent_name: this.options.agent_name,
      agent_description: this.options.agent_description,
      agent_instructions: Object.freeze(
        this.effective_instruction_blocks.map((block) => block.content),
      ),
      session_id: this.options.session_id,
      session_origin: this.options.session_origin,
      ...(workspace ? { workspace } : {}),
      messages: Object.freeze([]),
      workspace_env,
    });
  }

  /** 构造一次工具调用获得的值快照。 */
  private create_tool_call_context(
    turn_context: SessionTurnContext,
    site: ToolCallSite,
  ): ToolCallContext {
    const workspace_env = turn_context.step.workspace_env;
    const agent_systems = turn_context.step.agent_systems;
    const workspace = this.options.get_workspace?.();
    return Object.freeze({
      agent_id: this.options.agent_id,
      agent_name: this.options.agent_name,
      agent_description: this.options.agent_description,
      agent_instructions: Object.freeze([...(agent_systems ?? [])]),
      session_id: this.options.session_id,
      session_origin: this.options.session_origin,
      ...(workspace ? { workspace } : {}),
      turn_id: turn_context.session.turn_id,
      abort_signal: site.abort_signal,
      tool_call_id: site.tool_call_id,
      messages: site.messages,
      interactions: turn_context.interactions,
      ...(workspace_env ? { workspace_env } : {}),
    });
  }
}

/** 把 Turn pipeline 输出限制为低权限动态参考内容块。 */
function normalize_power_context_blocks(input: unknown): SessionHookContextBlock[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const source_power = String(record.source_power || "").trim();
    const name = String(record.name || "").trim();
    const content = String(record.content || "").trim();
    if (
      !source_power ||
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
      source_power,
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
