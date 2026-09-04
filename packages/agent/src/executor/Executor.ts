/**
 * Executor：单个 session 的执行编排器。
 *
 * 关键点（中文）
 * - SDK 对外对象叫 `Session`，这里是内部执行层。
 * - 一个 Executor 只对应一个固定的 `session_id`。
 * - 负责显式 Turn 上下文消费、executing 状态、Composer 编排与 Tool Loop 执行。
 */

import type {
  ModelClient,
  RuntimeTool as Tool,
  RuntimeToolExecutionOptions as ToolExecutionOptions,
} from "@downcity/type";
import { CoreEngineRunner } from "@executor/core-engine/CoreEngineRunner.js";
import { ExecutorRecoveryPolicy } from "@executor/services/ExecutorRecoveryPolicy.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type {
  SessionCompactHistory,
  SessionExecutor,
} from "@/types/session/SessionExecution.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";
import type { SessionToolExecutionContext } from "@/types/executor/SessionToolExecutionContext.js";
import type { SessionExtensionRuntime } from "@downcity/type/session";
import { is_action_result } from "@/types/action/ActionResult.js";
import { generate_id } from "@/utils/Id.js";
import {
  normalize_session_context_content,
  normalize_session_context_tag,
} from "@/session/messages/SessionUserContext.js";
import type {
  SessionStepExecutionInput,
  SessionTurnExecutionResult,
} from "@/types/session/SessionExecution.js";
import type {
  SessionComposer,
  SessionComposeInput,
  SessionStepInput,
} from "@/types/session/SessionComposer.js";

type ExecutorOptions = {
  /**
   * 当前会话 ID。
   */
  session_id: string;

  /** 当前 Session 使用的统一 Composer。 */
  composer: SessionComposer;

  /** 为 Composer 创建当前 Step 的只读输入快照。 */
  get_compose_input: (
    turn_context: SessionTurnContext | undefined,
    retry_count: number,
  ) => Promise<SessionComposeInput>;

  /** 应用 Session 级固定 system snapshot。 */
  apply_system_snapshot?: (input: SessionStepInput) => SessionStepInput;

  /** 请求 Session 领域生成并提交 canonical 历史压缩。 */
  compact_history: SessionCompactHistory;

  /**
   * 读取当前 session 使用的模型实例。
   */
  get_model: () => ModelClient | undefined;

  /**
   * 统一日志器。
   */
  logger: Logger;

  /** 创建当前 Session effective City 扩展执行视图。 */
  get_extensions?: () => SessionExtensionRuntime;
};

/**
 * Executor 单实例实现。
 */
export class Executor implements SessionExecutor {
  /**
   * 当前 session 标识。
   */
  readonly session_id: string;

  private readonly composer: SessionComposer;
  private readonly get_compose_input: ExecutorOptions["get_compose_input"];
  private readonly apply_system_snapshot?: ExecutorOptions["apply_system_snapshot"];
  private readonly compact_history: ExecutorOptions["compact_history"];
  private readonly get_model: ExecutorOptions["get_model"];
  private readonly get_extensions: ExecutorOptions["get_extensions"];
  private readonly logger: Logger;
  private readonly recovery_policy: ExecutorRecoveryPolicy;
  private readonly core_engine_runner: CoreEngineRunner;

  private executing = false;

  constructor(options: ExecutorOptions) {
    const session_id = String(options.session_id || "").trim();
    if (!session_id) {
      throw new Error("Executor requires a non-empty session_id");
    }

    this.session_id = session_id;
    this.composer = options.composer;
    this.get_compose_input = options.get_compose_input;
    this.apply_system_snapshot = options.apply_system_snapshot;
    this.compact_history = options.compact_history;
    this.get_model = options.get_model;
    this.get_extensions = options.get_extensions;
    this.logger = options.logger;
    this.recovery_policy = new ExecutorRecoveryPolicy({
      session_id: this.session_id,
      should_compact: (error) => this.composer.should_compact(error),
      logger: this.logger,
    });
    this.core_engine_runner = new CoreEngineRunner({
      session_id: this.session_id,
      logger: this.logger,
      should_compact_on_error: (error) =>
        this.composer.should_compact(error),
    });
  }

  /**
   * 返回当前 session 是否正在执行。
   */
  is_executing(): boolean {
    return this.executing;
  }

  /**
   * 执行当前 Session 的一次 Turn。
   *
   * 关键点（中文）
   * - 这里直接承接单个 Session 实例的一次 Turn 执行编排。
   * - scope 绑定、assistant step 持久化、executing 状态都收在实例内部。
   */
  async execute(params: {
    query: string;
    turn_context: SessionTurnContext;
  }): Promise<SessionTurnExecutionResult> {
    if (this.executing) {
      // 关键点（中文）：同一个 Session 实例只允许一个活跃 Turn 执行，
      // 否则 step 回调、scope 与执行器状态都会互相污染。
      throw new Error("Executor.execute does not support concurrent execution");
    }
    const query = String(params.query || "").trim();
    const turn_context = params.turn_context;
    this.executing = true;
    this.recovery_policy.reset_execution_state();
    try {
      const result = await this.recovery_policy.execute_with_retry({
        query,
        model: this.resolve_model_or_throw(),
        turn_context,
        prepare_execute_input: async ({
          query: next_query,
          model,
          turn_context: next_turn_context,
          retry_count,
        }) =>
          await this.prepare_execute_input(
            next_query,
            model,
            next_turn_context,
            retry_count,
          ),
        execute_prepared_input: async ({
          execute_input,
          model,
          turn_context: next_turn_context,
        }) =>
          await this.execute_prepared_input(
            execute_input,
            model,
            next_turn_context,
          ),
      });
      return result;
    } finally {
      this.recovery_policy.reset_execution_state();
      this.executing = false;
    }
  }

  /**
   * 调用 Composer 组装当前轮执行输入。
   */
  private async prepare_execute_input(
    query: string,
    _model: ModelClient,
    turn_context: SessionTurnContext,
    retry_count: number,
  ): Promise<SessionStepExecutionInput> {
    if (retry_count > 0) {
      await this.logger.log("info", "[agent] compacting", {
        retryCount: retry_count,
      });
      await this.compact_history({
        turn_id: turn_context.session.turn_id,
      });
    }
    const step = await this.compose_step(turn_context, retry_count, true);
    return {
      query,
      system: step.input.system,
      messages: step.input.messages,
      ...(step.compose_input.history.summary?.summary_id
        ? { history_summary_id: step.compose_input.history.summary.summary_id }
        : {}),
      tools: step.input.tools,
    };
  }

  /**
   * 执行一次已装配完成的 Step 输入。
   */
  private async execute_prepared_input(
    input: SessionStepExecutionInput,
    model: ModelClient,
    turn_context: SessionTurnContext,
  ): Promise<SessionTurnExecutionResult> {
    return await this.core_engine_runner.execute({
      execute_input: input,
      model,
      turn_context,
      resolve_step_inputs: async () =>
        await this.resolve_step_inputs(turn_context),
      reload_history: async () => {
        const step = await this.compose_step(turn_context, 0, false);
        return {
          messages: step.input.messages,
          ...(step.compose_input.history.summary?.summary_id
            ? { summary_id: step.compose_input.history.summary.summary_id }
            : {}),
        };
      },
    });
  }

  /**
   * 解析下一 Session step 实际使用的运行配置。
   *
   * 关键点（中文）
   * - 调用方必须先提交 Session 统一输入队列，再调用本方法。
   * - 每次调用只读取一次 model、system 与 tools，并把它们传给同一个模型 step。
   */
  private async resolve_step_inputs(turn_context: SessionTurnContext): Promise<{
    model: ModelClient;
    system: SessionStepExecutionInput["system"];
    tools: SessionStepExecutionInput["tools"];
    context_window?: number;
  }> {
    const composed = await this.compose_step(turn_context, 0, true);
    return {
      model: composed.model,
      system: composed.input.system,
      tools: this.bind_turn_context_to_tools(
        composed.input.tools,
        turn_context,
      ),
      ...(composed.compose_input.state.model_context_window !== undefined
        ? {
            context_window:
              composed.compose_input.state.model_context_window,
          }
        : {}),
    };
  }

  /** 读取只读 Session 快照并交给统一 Composer。 */
  private async compose_step(
    turn_context: SessionTurnContext | undefined,
    retry_count: number,
    refresh_extensions: boolean,
  ): Promise<{
    compose_input: SessionComposeInput;
    input: SessionStepInput;
    model: ModelClient;
  }> {
    if (refresh_extensions && turn_context) await this.refresh_step_runtime(turn_context);
    const compose_input = await this.get_compose_input(
      turn_context,
      retry_count,
    );
    const model = compose_input.state.model;
    if (!model) throw new Error("requires a configured model.");
    turn_context?.step.commit({
      workspace_env: compose_input.state.env,
      agent_systems: compose_input.state.systems,
    });
    const raw_input = await this.composer.compose(compose_input);
    return {
      compose_input,
      input: this.apply_system_snapshot
        ? this.apply_system_snapshot(raw_input)
        : raw_input,
      model,
    };
  }

  /**
   * 刷新当前 Session step 的 effective Agent 运行视图。
   */
  private async refresh_step_runtime(
    turn_context: SessionTurnContext,
  ): Promise<void> {
    const extensions = await this.get_extensions?.().acquire();
    await turn_context.step.replace_extensions(extensions);
  }

  /**
   * 为所有 tool execute callback 绑定显式 Session 运行上下文。
   *
   * 关键点（中文）
   * - 每个 step 使用独立包装工具，不会在并行 Session 间共享可变指针。
   * - Agent 与 Shell 工具通过 RuntimeToolExecutionOptions.context 读取显式快照。
   */
  private bind_turn_context_to_tools(
    tools: Record<string, Tool>,
    turn_context: SessionTurnContext,
  ): Record<string, Tool> {
    const wrapped: Record<string, Tool> = {};
    for (const [name, tool] of Object.entries(tools)) {
      const original_execute = tool.execute;
      if (typeof original_execute !== "function") {
        wrapped[name] = tool;
        continue;
      }
      wrapped[name] = {
        ...tool,
        execute: async (args: unknown, options: ToolExecutionOptions) => {
          const tool_call_id = String(options.tool_call_id || "").trim();
          if (!tool_call_id) {
            throw new Error(`Tool execution requires toolCallId: ${name}`);
          }
          if (tool_call_id && turn_context.output.assistant) {
            await turn_context.output.assistant.prepare_tool_input({
              tool_call_id,
              tool_name: name,
              input: args,
            });
          }
          const abort_signal = options.abort_signal ||
            turn_context.lifecycle.abort_signal;
          const execution_context: SessionToolExecutionContext = {
            session_turn_context: turn_context,
            action_execution_context: {
              call_id: tool_call_id,
              abort_signal,
              session: {
                session_id: turn_context.session.session_id,
                turn_id: turn_context.session.turn_id,
                interactions: turn_context.interactions,
              },
              ...(turn_context.session.project_root
                ? { workspace_path: turn_context.session.project_root }
                : {}),
              ...(turn_context.step.workspace_env
                ? { workspace_env: turn_context.step.workspace_env }
                : {}),
            },
            shell_execution_context: {
              session: {
                session_id: turn_context.session.session_id,
                turn_id: turn_context.session.turn_id,
              },
              call_id: tool_call_id,
              abort_signal,
              ...(turn_context.step.workspace_env
                ? { workspace_env: turn_context.step.workspace_env }
                : {}),
              ...(turn_context.shell.approval_gateway
                ? { approval_gateway: turn_context.shell.approval_gateway }
                : {}),
            },
          };
          const output = await original_execute(args, {
            ...options,
            context: execution_context,
          });
          if (!is_action_result(output)) return output;
          if (Array.isArray(output.effects)) {
            turn_context.effects.append(output.effects);
          }
          for (const message of output.messages) {
            if (message.role === "assistant") {
              turn_context.output.enqueue_assistant_parts(message.parts);
              continue;
            }
            const now = Date.now();
            turn_context.input.inject_user_message({
              message_id: `runtime-user:${turn_context.session.session_id}:${generate_id()}`,
              session_id: turn_context.session.session_id,
              turn_id: turn_context.session.turn_id,
              sequence: 0,
              revision: 1,
              visibility: "internal",
              created_at: now,
              updated_at: now,
              type: "user",
              input_type: "steer",
              parts: message.parts.map((part, index) => {
                if (part.type === "text") {
                  return {
                    part_id: `runtime-text:${index + 1}`,
                    type: "text" as const,
                    text: part.text,
                    state: "done" as const,
                  };
                }
                if (part.type === "context") {
                  return {
                    part_id: `runtime-context:${index + 1}`,
                    type: "context" as const,
                    tag: normalize_session_context_tag(part.tag),
                    context: normalize_session_context_content(part.context),
                  };
                }
                if (part.type === "file") {
                  return {
                    part_id: `runtime-file:${index + 1}`,
                    type: "file" as const,
                    media_type: part.media_type,
                    url: part.url,
                    ...(part.filename ? { filename: part.filename } : {}),
                  };
                }
                return {
                  part_id: `runtime-data:${index + 1}`,
                  type: "data" as const,
                  data_type: part.data_type,
                  data: part.data,
                  ...(part.data_id ? { data_id: part.data_id } : {}),
                };
              }),
            });
          }
          return output.output;
        },
      };
    }
    return wrapped;
  }

  /**
   * 读取当前 session 模型。
   */
  private resolve_model_or_throw(): ModelClient {
    const model = this.get_model();
    if (!model) {
      throw new Error("requires a configured model.");
    }
    return model;
  }
}
