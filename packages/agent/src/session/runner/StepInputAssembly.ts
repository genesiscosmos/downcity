/**
 * StepInputAssembly：为每个 Provider Step 装配完整模型输入。
 *
 * 关键点（中文）
 * - 属于 SessionLoop 的「输入环境」：刷新 Hook 执行视图、请求 Composer 组装、套用冻结
 *   system snapshot，并把显式 Turn 上下文绑定到工具执行回调。
 * - 只产出输入，不发请求、不判断是否继续；请求与循环归 `SessionExecutor`。
 */

import type {
  ModelClient,
  RuntimeTool as Tool,
  RuntimeToolExecutionOptions as ToolExecutionOptions,
  SessionHookRuntime,
} from "@downcity/type";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";
import type { SessionToolExecutionContext } from "@/types/executor/SessionToolExecutionContext.js";
import { is_action_result } from "@/types/action/ActionResult.js";
import type { SessionStepExecutionInput } from "@/types/session/SessionExecution.js";
import type {
  SessionComposer,
  SessionComposeInput,
  SessionStepInput,
} from "@/types/session/SessionComposer.js";

/** StepInputAssembly 构造参数。 */
export interface StepInputAssemblyOptions {
  /** 当前 Session 使用的统一 Composer。 */
  composer: SessionComposer;
  /** 为 Composer 创建当前 Step 的只读输入快照。 */
  get_compose_input: (
    turn_context: SessionTurnContext,
    advance_count: number,
  ) => Promise<SessionComposeInput>;
  /** 应用 Session 级冻结 system snapshot；未配置时直接使用 Composer 结果。 */
  apply_system_snapshot?: (input: SessionStepInput) => SessionStepInput;
  /** 创建当前 Session effective City 扩展执行视图。 */
  get_hooks?: () => SessionHookRuntime;
}

/** 每个模型 Step 的输入装配器。 */
export class StepInputAssembly {
  private readonly composer: StepInputAssemblyOptions["composer"];
  private readonly get_compose_input: StepInputAssemblyOptions["get_compose_input"];
  private readonly apply_system_snapshot?: StepInputAssemblyOptions["apply_system_snapshot"];
  private readonly get_hooks: StepInputAssemblyOptions["get_hooks"];

  constructor(options: StepInputAssemblyOptions) {
    this.composer = options.composer;
    this.get_compose_input = options.get_compose_input;
    this.apply_system_snapshot = options.apply_system_snapshot;
    this.get_hooks = options.get_hooks;
  }

  /**
   * 为下一个 Provider Step 装配唯一一份完整输入。
   *
   * 关键点（中文）：调用方必须先提交 Session 统一输入队列，再调用本方法；每次调用只读取
   * 一次 model、system 与 tools，并把它们交给同一个模型 step。
   */
  async resolve_step_input(
    turn_context: SessionTurnContext,
    advance_count: number,
  ): Promise<SessionStepExecutionInput> {
    const composed = await this.compose_step(turn_context, advance_count);
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
    advance_count: number,
  ): Promise<{
    input: SessionStepInput;
    model: ModelClient;
    context_window?: number;
  }> {
    await this.refresh_step_runtime(turn_context);
    const compose_input = await this.get_compose_input(
      turn_context,
      advance_count,
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
