/**
 * Executor：单个 session 的执行编排器。
 *
 * 关键点（中文）
 * - SDK 对外对象叫 `Session`，这里是内部执行层。
 * - 一个 Executor 只对应一个固定的 `session_id`。
 * - 负责 history 写入、显式运行上下文、executing 状态、Composer 编排与 tool-loop 执行。
 */

import type { LanguageModel, Tool, ToolExecutionOptions } from "ai";
import { CoreEngineRunner } from "@executor/core-engine/CoreEngineRunner.js";
import { ExecutorRecoveryPolicy } from "@executor/services/ExecutorRecoveryPolicy.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { SessionExecutor } from "@/executor/types/SessionExecutor.js";
import type { SessionRunContext } from "@/types/executor/SessionRunContext.js";
import type { SessionToolExecutionContext } from "@/types/executor/SessionToolExecutionContext.js";
import type { AgentPluginExecutionRuntime } from "@/types/plugin/PluginRuntime.js";
import { inject_read_image_user_message } from "@executor/tools/file/ReadImageToolBridge.js";
import type {
  SessionExecuteInput,
  SessionRunResult,
} from "@/executor/types/SessionRun.js";
import type {
  SessionComposer,
  SessionCompactionPlan,
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
    run_context: SessionRunContext,
    retry_count: number,
  ) => Promise<SessionComposeInput>;

  /** 应用 Session 级固定 system snapshot。 */
  apply_system_snapshot?: (input: SessionStepInput) => SessionStepInput;

  /** 提交 Composer 生成的持久化压缩计划。 */
  commit_compaction: (
    plan: SessionCompactionPlan,
    run_context: SessionRunContext,
  ) => Promise<void>;

  /**
   * 读取当前 session 使用的模型实例。
   */
  get_model: () => LanguageModel | undefined;

  /**
   * 统一日志器。
   */
  logger: Logger;

  /** 创建当前 Session effective Plugin 执行视图。 */
  get_plugins?: () => AgentPluginExecutionRuntime;
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
  private readonly commit_compaction: ExecutorOptions["commit_compaction"];
  private readonly get_model: ExecutorOptions["get_model"];
  private readonly get_plugins: ExecutorOptions["get_plugins"];
  private readonly logger: Logger;
  private readonly recovery_policy: ExecutorRecoveryPolicy;
  private readonly core_engine_runner: CoreEngineRunner;

  private executing = false;
  private abort_controller: AbortController | null = null;

  constructor(options: ExecutorOptions) {
    const session_id = String(options.session_id || "").trim();
    if (!session_id) {
      throw new Error("Executor requires a non-empty session_id");
    }

    this.session_id = session_id;
    this.composer = options.composer;
    this.get_compose_input = options.get_compose_input;
    this.apply_system_snapshot = options.apply_system_snapshot;
    this.commit_compaction = options.commit_compaction;
    this.get_model = options.get_model;
    this.get_plugins = options.get_plugins;
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
   * 请求停止当前执行。
   */
  stop(): boolean {
    if (!this.executing || !this.abort_controller) return false;
    if (!this.abort_controller.signal.aborted) {
      this.abort_controller.abort(new Error("Turn stopped"));
    }
    return true;
  }

  /**
   * 获取当前 session 的执行端口。
   *
   * 关键点（中文）
   * - 兼容 runtime/service 端口语义：Executor 自己就是执行端口。
   */
  get_executor(): SessionExecutor {
    return this;
  }

  /**
   * 运行当前 session 的一次请求。
   *
   * 关键点（中文）
   * - 这里直接承接单个 Session 实例的一次 run 外层编排。
   * - scope 绑定、assistant step 持久化、executing 状态都收在实例内部。
   */
  async run(params: {
    query: string;
    run_context?: SessionRunContext;
  }): Promise<SessionRunResult> {
    if (this.executing) {
      // 关键点（中文）：同一个 Session 实例只允许一个活跃 run，
      // 否则 step 回调、scope 与执行器状态都会互相污染。
      throw new Error("Executor.run does not support concurrent execution");
    }
    const query = String(params.query || "").trim();
    const run_context = this.createRunContext(params.run_context);
    const upstream_abort_signal = run_context.abort_signal;
    const abort_controller = new AbortController();
    const abort_from_upstream = () => {
      if (!abort_controller.signal.aborted) {
        abort_controller.abort(upstream_abort_signal?.reason);
      }
    };
    if (upstream_abort_signal?.aborted) {
      abort_from_upstream();
    } else {
      upstream_abort_signal?.addEventListener("abort", abort_from_upstream, {
        once: true,
      });
    }
    this.abort_controller = abort_controller;
    run_context.abort_signal = abort_controller.signal;
    this.executing = true;
    this.recovery_policy.reset_run_state();
    try {
      const result = await this.recovery_policy.run_with_retry({
        query,
        model: this.resolveModelOrThrow(),
        run_context,
        prepare_execute_input: async ({
          query: next_query,
          model,
          run_context: next_run_context,
          retry_count,
        }) =>
          await this.prepareExecuteInput(
            next_query,
            model,
            next_run_context,
            retry_count,
          ),
        execute_prepared_run: async ({
          execute_input,
          model,
          run_context: next_run_context,
        }) =>
          await this.executePreparedRun(
            execute_input,
            model,
            next_run_context,
          ),
      });
      return result;
    } finally {
      await this.release_step_plugins(run_context);
      this.recovery_policy.reset_run_state();
      if (this.abort_controller === abort_controller) {
        this.abort_controller = null;
      }
      upstream_abort_signal?.removeEventListener("abort", abort_from_upstream);
      this.executing = false;
    }
  }

  /**
   * 调用 Composer 组装当前轮执行输入。
   */
  private async prepareExecuteInput(
    query: string,
    _model: LanguageModel,
    run_context: SessionRunContext,
    retry_count: number,
  ): Promise<SessionExecuteInput> {
    if (retry_count > 0) {
      await this.logger.log("info", "[agent] compacting", {
        retryCount: retry_count,
      });
      await this.compact_history(run_context, retry_count);
    }
    const step = await this.compose_step(run_context, retry_count, true);
    return {
      query,
      system: step.input.system,
      messages: step.input.messages,
      tools: step.input.tools,
    };
  }

  /**
   * 执行一次已装配完成的运行材料。
   */
  private async executePreparedRun(
    input: SessionExecuteInput,
    model: LanguageModel,
    run_context: SessionRunContext,
  ): Promise<SessionRunResult> {
    return await this.core_engine_runner.run({
      execute_input: input,
      model,
      run_context,
      resolve_step_inputs: async () =>
        await this.resolve_step_inputs(run_context),
      reload_history: async () =>
        (await this.compose_step(run_context, 0, false)).input.messages,
    });
  }

  /**
   * 在 Assistant writer 完成后归档当前 canonical 历史。
   *
   * 关键点（中文）：持久化 compact 不能发生在流式 Assistant 草稿仍打开时，
   * 因此由 SessionTurn 在 writer complete/fail 之后显式调用。
   */
  async compact_history(
    run_context: SessionRunContext,
    retry_count = 0,
  ): Promise<{
    compacted: boolean;
    reason?: string;
  }> {
    try {
      const composed = await this.compose_step(
        run_context,
        retry_count,
        true,
      );
      const plan = await this.composer.compact({
        ...composed.compose_input,
        force: true,
      });
      if (!plan) return { compacted: false, reason: "nothing_to_compact" };
      await this.commit_compaction(plan, run_context);
      return { compacted: true };
    } catch (error) {
      return { compacted: false, reason: "compact_failed" };
    } finally {
      await this.release_step_plugins(run_context);
    }
  }

  /**
   * 解析下一 Session step 实际使用的运行配置。
   *
   * 关键点（中文）
   * - 调用方必须先提交 Session 统一输入队列，再调用本方法。
   * - 每次调用只读取一次 model、system 与 tools，并把它们传给同一个 `streamText()`。
   */
  private async resolve_step_inputs(run_context: SessionRunContext): Promise<{
    model: LanguageModel;
    system: SessionExecuteInput["system"];
    tools: SessionExecuteInput["tools"];
    context_window?: number;
  }> {
    const composed = await this.compose_step(run_context, 0, true);
    return {
      model: composed.model,
      system: composed.input.system,
      tools: this.bind_run_context_to_tools(
        composed.input.tools,
        run_context,
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
    run_context: SessionRunContext,
    retry_count: number,
    refresh_plugins: boolean,
  ): Promise<{
    compose_input: SessionComposeInput;
    input: SessionStepInput;
    model: LanguageModel;
  }> {
    if (refresh_plugins) await this.refresh_step_runtime(run_context);
    const compose_input = await this.get_compose_input(
      run_context,
      retry_count,
    );
    const model = compose_input.state.model;
    if (!model) throw new Error("requires a configured model.");
    run_context.workspace_env = Object.freeze({ ...compose_input.state.env });
    run_context.agent_systems = Object.freeze([
      ...compose_input.state.systems,
    ]);
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
    run_context: SessionRunContext,
  ): Promise<void> {
    await this.release_step_plugins(run_context);
    if (this.get_plugins) {
      run_context.agent_plugins = this.get_plugins().acquire();
    } else {
      delete run_context.agent_plugins;
    }
  }

  /**
   * 释放当前 Session step 持有的 Plugin execution lease。
   */
  private async release_step_plugins(
    run_context: SessionRunContext,
  ): Promise<void> {
    const plugins = run_context.agent_plugins;
    if (!plugins) return;
    delete run_context.agent_plugins;
    await plugins.release();
  }

  /**
   * 为所有 tool execute callback 绑定显式 Session 运行上下文。
   *
   * 关键点（中文）
   * - 每个 step 使用独立包装工具，不会在并行 Session 间共享可变指针。
   * - Agent 与 Shell 工具通过 ToolExecutionOptions.experimental_context 读取显式快照。
   */
  private bind_run_context_to_tools(
    tools: Record<string, Tool>,
    run_context: SessionRunContext,
  ): Record<string, Tool> {
    const execution_context: SessionToolExecutionContext = {
      session_run_context: run_context,
      shell_run_context: {
        ownerContextId: String(run_context.session_id || "").trim() || undefined,
        turnId: String(run_context.turn_id || "").trim() || undefined,
        ...(run_context.workspace_env ? { env: run_context.workspace_env } : {}),
        ...(run_context.shell_approval_gateway
          ? { approval_gateway: run_context.shell_approval_gateway }
          : {}),
      },
    };

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
          const tool_call_id = String(options.toolCallId || "").trim();
          if (tool_call_id && run_context.on_tool_input_ready) {
            await run_context.on_tool_input_ready({
              tool_call_id,
              tool_name: name,
              input: args,
            });
          }
          const output = await original_execute(args, {
            ...options,
            experimental_context: execution_context,
          });
          return inject_read_image_user_message({
            tool_name: name,
            output,
            run_context,
          });
        },
      };
    }
    return wrapped;
  }

  /**
   * 归一化本轮显式运行上下文。
   */
  private createRunContext(
    input?: SessionRunContext,
  ): SessionRunContext {
    const source = input || {
      session_id: this.session_id,
      injected_user_messages: [],
      deferred_persisted_user_messages: [],
      pending_assistant_file_parts: [],
    };
    const {
      session_id,
      project_root,
      injected_user_messages,
      deferred_persisted_user_messages,
      pending_assistant_file_parts,
      ...runtime_context
    } = source;
    return {
      ...runtime_context,
      session_id: String(session_id || this.session_id).trim(),
      ...(typeof project_root === "string" && project_root.trim()
        ? { project_root: project_root.trim() }
        : {}),
      injected_user_messages: Array.isArray(injected_user_messages)
        ? [...injected_user_messages]
        : [],
      deferred_persisted_user_messages: Array.isArray(deferred_persisted_user_messages)
        ? [...deferred_persisted_user_messages]
        : [],
      pending_assistant_file_parts: Array.isArray(pending_assistant_file_parts)
        ? [...pending_assistant_file_parts]
        : [],
    };
  }

  /**
   * 读取当前 session 模型。
   */
  private resolveModelOrThrow(): LanguageModel {
    const model = this.get_model();
    if (!model) {
      throw new Error("requires a configured model.");
    }
    return model;
  }
}
