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
  SessionHookRuntime,
} from "@downcity/type";
import { CoreEngineRunner } from "@executor/core-engine/CoreEngineRunner.js";
import { ExecutorRecoveryPolicy } from "@executor/services/ExecutorRecoveryPolicy.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { SessionExecutor } from "@/types/session/SessionExecution.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";
import type { SessionToolExecutionContext } from "@/types/executor/SessionToolExecutionContext.js";
import { is_action_result } from "@/types/action/ActionResult.js";
import type {
  SessionStepExecutionInput,
  SessionTurnExecutionResult,
} from "@/types/session/SessionExecution.js";
import type {
  SessionComposer,
  SessionComposeInput,
  SessionStepInput,
} from "@/types/session/SessionComposer.js";
import type { SessionContextRecoveryReason } from "@/types/session/SessionContextPolicy.js";

type ExecutorOptions = {
  /**
   * 当前会话 ID。
   */
  session_id: string;

  /** 当前 Session 使用的统一 Composer。 */
  composer: SessionComposer;

  /** 为 Composer 创建当前 Step 的只读输入快照。 */
  get_compose_input: (
    turn_context: SessionTurnContext,
    retry_count: number,
  ) => Promise<SessionComposeInput>;

  /** 请求当前 Composer 推进派生上下文状态。 */
  recover_context: (reason: SessionContextRecoveryReason) => Promise<boolean>;

  /** 应用 Session 级固定 system snapshot。 */
  apply_system_snapshot?: (input: SessionStepInput) => SessionStepInput;

  /**
   * 统一日志器。
   */
  logger: Logger;

  /** 创建当前 Session effective City 扩展执行视图。 */
  get_hooks?: () => SessionHookRuntime;
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
  private readonly recover_context: ExecutorOptions["recover_context"];
  private readonly apply_system_snapshot?: ExecutorOptions["apply_system_snapshot"];
  private readonly get_hooks: ExecutorOptions["get_hooks"];
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
    this.recover_context = options.recover_context;
    this.apply_system_snapshot = options.apply_system_snapshot;
    this.get_hooks = options.get_hooks;
    this.logger = options.logger;
    this.recovery_policy = new ExecutorRecoveryPolicy({
      session_id: this.session_id,
      recover_context: async (error) =>
        is_provider_context_limit_error(error)
          ? await this.recover_context("provider_context_limit")
          : false,
      logger: this.logger,
    });
    this.core_engine_runner = new CoreEngineRunner({
      session_id: this.session_id,
      logger: this.logger,
      should_compact_on_error: (error) =>
        is_provider_context_limit_error(error),
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
    turn_context: SessionTurnContext;
  }): Promise<SessionTurnExecutionResult> {
    if (this.executing) {
      // 关键点（中文）：同一个 Session 实例只允许一个活跃 Turn 执行，
      // 否则 step 回调、scope 与执行器状态都会互相污染。
      throw new Error("Executor.execute does not support concurrent execution");
    }
    const turn_context = params.turn_context;
    this.executing = true;
    try {
      const result = await this.recovery_policy.execute_with_retry({
        execute_turn: async (retry_count) =>
          await this.core_engine_runner.execute({
            turn_context,
            resolve_step_input: async () =>
              await this.resolve_step_input(turn_context, retry_count),
          }),
      });
      return result;
    } finally {
      this.executing = false;
    }
  }

  /**
   * 为下一 Provider Step 生成唯一一份完整输入。
   *
   * 关键点（中文）
   * - 调用方必须先提交 Session 统一输入队列，再调用本方法。
   * - 每次调用只读取一次 model、system 与 tools，并把它们传给同一个模型 step。
   */
  private async resolve_step_input(
    turn_context: SessionTurnContext,
    retry_count: number,
  ): Promise<SessionStepExecutionInput> {
    const composed = await this.compose_step(turn_context, retry_count);
    return {
      model: composed.model,
      system: composed.input.system,
      messages: composed.input.messages,
      tools: this.bind_turn_context_to_tools(
        composed.input.tools,
        turn_context,
      ),
      ...(composed.context_window !== undefined
        ? {
            context_window: composed.context_window,
          }
        : {}),
    };
  }

  /** 读取只读 Session 快照并交给统一 Composer。 */
  private async compose_step(
    turn_context: SessionTurnContext,
    retry_count: number,
  ): Promise<{
    input: SessionStepInput;
    model: ModelClient;
    context_window?: number;
  }> {
    await this.refresh_step_runtime(turn_context);
    const compose_input = await this.get_compose_input(
      turn_context,
      retry_count,
    );
    const model = compose_input.state.model;
    if (!model) throw new Error("requires a configured model.");
    turn_context.step.commit({
      workspace_env: compose_input.state.env,
      agent_systems: compose_input.state.systems,
    });
    const raw_input = await this.composer.compose(compose_input);
    return {
      input: this.apply_system_snapshot
        ? this.apply_system_snapshot(raw_input)
        : raw_input,
      model,
      ...(compose_input.state.model_context_window !== undefined
        ? { context_window: compose_input.state.model_context_window }
        : {}),
    };
  }

  /**
   * 刷新当前 Session step 的 effective Agent 运行视图。
   */
  private async refresh_step_runtime(
    turn_context: SessionTurnContext,
  ): Promise<void> {
    const hooks = await this.get_hooks?.().open();
    await turn_context.step.replace_hooks(hooks);
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

}

/** Core Engine 的单 Step 内恢复仍需同步识别 Provider 上下文错误。 */
function is_provider_context_limit_error(error: unknown): boolean {
  const message = String(error ?? "").toLowerCase();
  return message.includes("context_length") ||
    message.includes("too long") ||
    message.includes("maximum context") ||
    message.includes("context window");
}
