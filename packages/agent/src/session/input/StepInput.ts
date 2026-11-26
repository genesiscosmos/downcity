/**
 * StepInput：为每个 Step 准备发给模型的输入。
 *
 * 关键点（中文）
 * - 拥有基础 system 快照与每步宿主事实采集；基础快照冻结后不再重新采集 Power system。
 * - Composer 的动态 system 上下文在基础快照之后逐步组装，不参与冻结或快照持久化。
 * - 只产出输入，不发请求、不判断是否继续；请求与循环归 `SessionExecutor`。
 * - 不拥有 Message、Turn 或 Store 生命周期。
 */

import { model_input_digest } from "../runner/SessionModelInput.js";
import { build_model_step_call } from "@/model/ModelStepCall.js";
import type { JsonValue, ModelClient, AgentTool as Tool, SessionHookContextBlock, SessionTurnContextHookValue, ToolCallContext, WorkspaceRuntime } from "@downcity/type";
import { compose_prompt_power_tools, prompt_power_context_blocks, read_turn_prompt_powers, set_turn_prompt_powers } from "./PromptPowers.js";
import type { BoundAgentTool, ToolCallSite } from "@/types/tool/BoundAgentTool.js";
import { create_lookup_tool } from "@/model/results/LookupTool.js";
import { lookup_result } from "@/model/results/ResultReader.js";
import type { AgentSessionSystemBlock, AgentSessionSystemSnapshot } from "@/types/agent/SessionTypes.js";
import type { SessionComposeIdentity, SessionComposeInput, SessionStepInput } from "@/types/session/SessionComposer.js";
import type { SessionStepExecutionInput } from "@/types/session/SessionExecution.js";
import type { StepInputOptions } from "@/types/session/StepInput.js";
import type { SessionTurnContext } from "@/types/turn/SessionTurnContext.js";
import type { SessionDerivedStore } from "@/types/store/SessionStorage.js";
import { is_action_result, SESSION_HOOK_POINTS, session_call_context, read_session_call_context } from "@downcity/type";
import { max_request_media_bytes } from "@downcity/type/workspace";
import { measure_request } from "@/session/runner/RequestBudget.js";
import { run_pipeline_point } from "@/session/input/SessionHookRunner.js";
import { normalize_power_system_blocks, resolve_session_power_system_blocks } from "@/session/input/SessionSystem.js";
import { to_system_messages } from "./composer/ComposerAssembly.js";
import { resolve_model_client } from "@/model/DeferredModelClient.js";

/** 当前 Session 的每步模型输入装配者。 */
export class StepInput {
  private readonly options: StepInputOptions;
  private effective_instruction_blocks: AgentSessionSystemBlock[];
  /** 当前目录对应的环境变量快照；由目录实例提供。 */
  private readonly workspace_env_by_id = new Map<string, Record<string, string>>();
  /** 当前目录变化时取消的旧订阅。 */
  private workspace_env_unsubscribe?: () => void;
  /** 当前 Session 冻结的基础 system，不含 Composer 动态上下文；null 表示尚未冻结。 */
  private frozen_blocks: AgentSessionSystemBlock[] | null = null;
  /** 当前 Session 的一次性初始化任务。 */
  private initialize_promise: Promise<void> | null = null;
  /** 串行化 snapshot / syncshot 对基础 system 与持久快照的修改。 */
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
   * - 首次调用冻结基础 system；动态摘要由本次 Composer 结果提供。
   */
  async build(
    turn_context: SessionTurnContext,
    advance_count: number,
  ): Promise<SessionStepExecutionInput> {
    // 首轮先冻结基础 system，再运行动态 Turn hook；hook 读到的版本标记与模型相同。
    await this.read_frozen_system();
    let compose_input = await this.gather(turn_context, advance_count);
    const model = compose_input.state.model;
    if (!model) throw new Error("requires a configured model.");
    turn_context.step.commit({
      workspace_env: compose_input.state.env,
      agent_systems: compose_input.state.systems,
    });
    let composed = await this.options.composer.compose(compose_input);
    let frozen = this.apply_frozen_system(composed);
    // 必要上下文更新与冻结基线重复占用窗口时，在发送前检查点完整替换同源块。
    const initial_budget = measure_request({ model, system: frozen.system, messages: frozen.messages, tools: frozen.tools as unknown as Record<string, BoundAgentTool>, context_window: compose_input.state.model_context_window });
    const checkpoint_updates = compose_input.state.power_context_blocks.filter(block => block.checkpoint_block);
    if (checkpoint_updates.length && initial_budget.input_budget !== null && initial_budget.estimated_input_tokens > initial_budget.input_budget) {
      await this.refresh_context_snapshot(checkpoint_updates);
      compose_input = await this.gather(turn_context, advance_count);
      compose_input = { ...compose_input, state: { ...compose_input.state, power_context_blocks: compose_input.state.power_context_blocks.filter(block => !checkpoint_updates.some(update => update.source_power === block.source_power && update.name === block.name)) } };
      composed = await this.options.composer.compose(compose_input);
      frozen = this.apply_frozen_system(composed);
    }
    const request: SessionStepExecutionInput = {
      model,
      system: frozen.system,
      messages: frozen.messages,
      tools: frozen.tools as unknown as Record<string, BoundAgentTool>,
      ...(compose_input.state.model_context_window !== undefined
        ? { context_window: compose_input.state.model_context_window }
        : {}),
    };
    const configured_model = this.options.get_model();
    const configured_tools = Object.entries(this.options.get_tools()).map(([name, tool]) => ({ name, execute: tool.execute, is_available: tool.is_available }));
    const config_digest = () => model_input_digest({
      model_id: this.options.get_model()?.id, timezone: this.options.get_timezone(),
      workspace: this.options.get_workspace_path(), env: this.read_workspace_env(), instruction: this.instruction_blocks(),
      tools: build_model_step_call([], [], this.options.get_tools() as Record<string, BoundAgentTool>).tools,
    });
    const original_config = config_digest();
    request.validate_retry = async () => {
      if (powers.some(power => power.abort_signal?.aborted)) throw new Error("Original Power execution is unavailable");
      const current_tools = this.options.get_tools();
      if (configured_tools.some(tool => current_tools[tool.name]?.execute !== tool.execute
        || current_tools[tool.name]?.is_available !== tool.is_available)
        || this.options.get_model() !== configured_model || config_digest() !== original_config) {
        throw new Error("Model or tool configuration changed; start a new request");
      }
    };
    const budget = measure_request(request);
    // 留出后续工具结果与引用协议开销；拒绝不能容纳的显式读取，避免成功回执后才超限。
    const media_tokens = Math.max(0, (budget.input_budget ?? 0) - budget.estimated_input_tokens - 8192);
    // 只捕获未绑定工具及值快照；失败描述不能保留原 Turn 的闭包。
    const tools = frozen.tools;
    const powers = read_turn_prompt_powers(turn_context);
    const step_state = structuredClone({ workspace_env: compose_input.state.env, agent_systems: compose_input.state.systems });
    const power_blocks = structuredClone(turn_context.step.power_context_blocks);
    const user_messages = structuredClone(turn_context.input.user_messages());
    const rebind_retry = async (context: SessionTurnContext): Promise<SessionStepExecutionInput> => {
      if (powers.length) set_turn_prompt_powers(context, powers);
      context.step.commit(structuredClone(step_state));
      await context.step.resolve_power_context_blocks(async () => structuredClone(power_blocks));
      for (const message of user_messages) context.input.observe_user_message(message);
      return { ...request, rebind_retry, tools: this.bind_turn_context_to_tools(tools, context, media_tokens) };
    };
    return { ...request, rebind_retry, tools: this.bind_turn_context_to_tools(tools, turn_context, media_tokens) };
  }

  /** 只持久化基础 system 快照，动态摘要继续从 Composer 派生状态读取。 */
  async snapshot(): Promise<void> {
    await this.run_mutation(async () => {
      await this.write_snapshot(await this.read_frozen_system());
    });
  }

  /** 使用 Agent 当前 instruction 与 Power 刷新基础 system，不固化动态摘要。 */
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

  /** 预览当前模型 system：冻结的基础指令加本次 Composer 动态上下文。 */
  async read_system(): Promise<AgentSessionSystemSnapshot> {
    await this.initialize();
    const composed = await this.options.composer.compose(
      await this.gather(undefined, 0),
    );
    return {
      session_id: this.options.session_id,
      session: {
        id: this.options.session_id,
        project_root: this.options.get_workspace_path(),
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

  /**
   * 读取当前目录的环境变量。
   *
   * 关键点（中文）
   * - 目录是可变会话配置，环境订阅也随之切换：首次遇到某个目录时建立订阅，
   *   后续读取直接取其快照，不再重建。
   * - 没有目录时返回空对象。
   */
  private read_workspace_env(): Record<string, string> {
    const workspace = this.options.get_workspace?.();
    if (!workspace) {
      this.workspace_env_unsubscribe?.();
      this.workspace_env_unsubscribe = undefined;
      return {};
    }
    const cached = this.workspace_env_by_id.get(workspace.id);
    if (cached) return cached;
    // 同一 Session 只保留当前目录的订阅，避免旧目录继续推送。
    this.workspace_env_unsubscribe?.();
    this.workspace_env_by_id.set(workspace.id, { ...workspace.get_env() });
    this.workspace_env_unsubscribe = workspace.subscribe_env(() => {
      this.workspace_env_by_id.set(workspace.id, { ...workspace.get_env() });
    });
    return this.workspace_env_by_id.get(workspace.id) as Record<string, string>;
  }

  /** 创建 Composer 共用的稳定 Session 身份快照。 */
  identity(): SessionComposeIdentity {
    return {
      ...session_call_context(read_session_call_context(this.options)),
      agent_id: this.options.agent_id,
      session_id: this.options.session_id,
      project_root: this.options.get_workspace_path(),
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
    const workspace_env = Object.freeze({ ...this.read_workspace_env() });
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
            system_blocks: Object.freeze((this.frozen_blocks ?? []).map((block) => Object.freeze({ ...block }))),
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
            if (error && typeof error === "object" && "code" in error && error.code === "SESSION_CONTEXT_REQUIRED") throw error;
            await this.log_power_hook_warning(
              SESSION_HOOK_POINTS.turn_context,
              error,
              turn_context.session.turn_id,
            );
            return [];
          }
        })
      : [];
    const tools = { ...this.options.get_tools() };
    if (turn_context) {
      for (const [name, tool] of Object.entries(compose_prompt_power_tools(turn_context))) {
        if (Object.hasOwn(tools, name)) throw new Error(`Prompt Power name conflicts with existing tool: ${name}`);
        tools[name] = tool;
      }
    }
    // 先按真实 Session 身份收窄工具面，Composer 与模型只看到本次允许的能力。
    for (const [name, tool] of Object.entries(tools)) {
      if (tool.is_available && !await tool.is_available(call_context)) delete tools[name];
    }
    // 执行时先恢复完整客户端，预算与 Composer 不能使用只有 ID 的占位模型。
    const selected_model = this.options.get_model();
    const model = turn_context ? await resolve_model_client(selected_model) : selected_model;
    return {
      session: this.identity(),
      attachment_root: this.options.store.attachments.root_path,
      state: {
        model,
        model_context_window: this.options.get_model_context_window(),
        env: workspace_env,
        systems: Object.freeze(
          instruction_system_blocks.map((block) => block.content),
        ),
        tools: Object.freeze(tools),
        instruction_system_blocks,
        power_system_blocks: resolved_power_system_blocks,
        power_context_blocks: [
          ...power_context_blocks,
          ...(turn_context ? prompt_power_context_blocks(turn_context) : []),
        ],      },
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

  /** 读取或首次捕获基础快照；持久化入口不能从包含动态上下文的预览反推快照。 */
  private async read_frozen_system(): Promise<AgentSessionSystemBlock[]> {
    await this.initialize();
    if (!this.frozen_blocks) {
      const composed = await this.options.composer.compose(await this.gather(undefined, 0));
      this.frozen_blocks = resolve_composed_system_blocks(composed);
    }
    return this.frozen_blocks.map((block) => ({ ...block }));
  }

  /** 发送前安全检查点，完整替换已声明的同源块并保留原位置顺序。 */
  private async refresh_context_snapshot(updates: readonly SessionHookContextBlock[]): Promise<void> {
    const replacements = new Map<string, AgentSessionSystemBlock>();
    for (const update of updates) {
      const block = update.checkpoint_block;
      if (!block || block.source !== "power" || !block.name.startsWith(`${update.source_power}/`)) throw new Error("Invalid required context checkpoint ownership");
      if (replacements.has(block.name)) throw new Error("Duplicate context checkpoint replacement");
      replacements.set(block.name, block);
    }
    const next = (this.frozen_blocks ?? []).map(block => {
      const replacement = replacements.get(block.name);
      if (!replacement) return block;
      replacements.delete(block.name);
      return { ...replacement, position: block.position };
    });
    if (replacements.size) throw new Error("Required context checkpoint has no frozen baseline; refresh the Session snapshot");
    await this.write_snapshot(next);
    this.frozen_blocks = next;
  }

  /** 基础 system 保持冻结；当前动态上下文统一追加，供请求和预览共用。 */
  private apply_frozen_system(input: SessionStepInput): SessionStepInput {
    this.frozen_blocks ??= resolve_composed_system_blocks(input);
    const system_blocks = [
      ...this.frozen_blocks,
      ...(input.context_system_blocks ?? []),
    ].map((block) => ({ ...block }));
    return {
      ...input,
      system: to_system_messages(system_blocks),
      system_blocks,
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

  /** 把指定基础 system blocks 原子写入持久快照。 */
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
    media_tokens: number,
  ): Record<string, BoundAgentTool> {
    if (Object.hasOwn(tools, "lookup")) throw new Error("Tool name is reserved by the result reader: lookup");
    const wrapped: Record<string, BoundAgentTool> = {};
    // 每个 Step 独立预留；并发工具不能分别通过总量校验后一起突破上限。
    let reserved_media_bytes = 0;
    let reserved_media_tokens = 0;
    const reserve_media = (bytes: number, existing_bytes: number, estimated_tokens: number): boolean => {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(existing_bytes) || existing_bytes < 0
        || !Number.isSafeInteger(estimated_tokens) || estimated_tokens <= 0
        || existing_bytes + reserved_media_bytes + bytes > max_request_media_bytes
        || reserved_media_tokens + estimated_tokens > media_tokens) return false;
      reserved_media_bytes += bytes;
      reserved_media_tokens += estimated_tokens;
      return true;
    };
    for (const [name, tool] of Object.entries(tools)) {
      const original_execute = tool.execute;
      if (typeof original_execute !== "function") {
        wrapped[name] = tool as unknown as BoundAgentTool;
        continue;
      }
      wrapped[name] = {
        ...tool,
        prepare_input: async (input, site) => {
          await turn_context.output.assistant?.prepare_tool_input({
            tool_call_id: site.tool_call_id,
            tool_name: name,
            input,
          });
          return {
            public_input: input,
            execution_input: turn_context.interactions
              ? turn_context.interactions.resolve_secret_references(input)
              : input,
          };
        },
        redact_output: (value) => turn_context.interactions
          ? turn_context.interactions.redact_secret_values(value)
          : value,
        execute: async (args: unknown, site: ToolCallSite) => {
          const tool_call_id = String(site.tool_call_id || "").trim();
          if (!tool_call_id) {
            throw new Error(`Tool execution requires toolCallId: ${name}`);
          }
          const context = Object.freeze({ ...this.create_tool_call_context(turn_context, {
            tool_call_id,
            abort_signal: site.abort_signal || turn_context.lifecycle.abort_signal,
            messages: site.messages,
          }), reserve_media });
          let output: unknown;
          try {
            output = await original_execute(args, context);
          } catch (error) {
            if (!turn_context.interactions) throw error;
            const safe_error = turn_context.interactions.redact_secret_values(error);
            throw new Error(
              safe_error && typeof safe_error === "object" && "message" in safe_error
                ? String(safe_error.message)
                : String(safe_error),
            );
          }
          const safe_output = turn_context.interactions
            ? turn_context.interactions.redact_secret_values(output)
            : output;
          if (!is_action_result(safe_output)) return safe_output;
          if (Array.isArray(safe_output.effects)) {
            turn_context.effects.append(safe_output.effects);
          }
          for (const message of safe_output.messages) {
            if (message.role === "agent") {
              if (context.abort_signal?.aborted) throw context.abort_signal.reason ?? new Error("Tool execution stopped");
              const published_parts = turn_context.output.assistant
                ? await turn_context.output.assistant.append_result_parts(message.parts, tool_call_id)
                : undefined;
              turn_context.output.enqueue_assistant_parts(message.parts, { source_tool_call_id: tool_call_id, published_parts });
              continue;
            }
            await turn_context.input.append_input({
              kind: "tool_media", source: { tool_call_id, turn_id: turn_context.session.turn_id }, content: message.parts,
            });
          }
          return safe_output.output;
        },
      };
    }
    wrapped.lookup = create_lookup_tool((input) => lookup_result(input, this.options.store, this.options.read_result_session));
    return wrapped;
  }

  /** 构造不属任何 Turn 的调用环境；用于 system 查询。 */
  private create_session_call_context(
    workspace_env: Readonly<Record<string, string>>,
  ): ToolCallContext {
    const workspace = this.resolve_active_workspace();
    return Object.freeze({
      agent_id: this.options.agent_id,
      agent_name: this.options.get_agent_name(),
      agent_role: this.options.get_agent_role?.(),
      agent_description: this.options.get_agent_description(),
      agent_instructions: Object.freeze(
        this.effective_instruction_blocks.map((block) => block.content),
      ),
      session_id: this.options.session_id,
      ...session_call_context(read_session_call_context(this.options)),
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
    const workspace = this.resolve_active_workspace();
    return Object.freeze({
      agent_id: this.options.agent_id,
      agent_name: this.options.get_agent_name(),
      agent_role: this.options.get_agent_role?.(),
      agent_description: this.options.get_agent_description(),
      agent_instructions: Object.freeze([...(agent_systems ?? [])]),
      session_id: this.options.session_id,
      ...session_call_context(read_session_call_context(this.options)),
      ...(workspace ? { workspace } : {}),
      read_attachment: async (input: import("@downcity/type/workspace").ReadFileToolInput) => {
        site.abort_signal?.throwIfAborted();
        const attachments = this.options.store.attachments;
        if (!attachments.owns_local_file(input.file_path)) return null;
        if (!await this.options.store.has_attachment(input.file_path)) {
          return { success: false as const, error_code: "sandbox_denied" as const, message: "Attachment is not registered in this Session" };
        }
        return await attachments.read_file(input, site.abort_signal);
      },
      turn_id: turn_context.session.turn_id,
      execution_id: turn_context.session.execution_id,
      abort_signal: site.abort_signal,
      tool_call_id: site.tool_call_id,
      messages: site.messages,
      interactions: turn_context.interactions,
      ...(workspace_env ? { workspace_env } : {}),
    });
  }

  /** 解析当前生效的 Workspace 实例。 */
  private resolve_active_workspace(): WorkspaceRuntime | undefined {
    return this.options.get_workspace?.();
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
    const checkpoint_block = normalize_power_system_blocks([record.checkpoint_block])[0];
    return [{
      source_power,
      name,
      content,
      trust_level: "reference" as const,
      ...(citations.length > 0 ? { citations } : {}),
      ...(version ? { version } : {}),
      ...(checkpoint_block ? { checkpoint_block } : {}),
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
