/**
 * City Tool：Agent 触碰 City 的唯一工具。
 *
 * 关键点（中文）
 * - 一个工具、一个入口：载荷是 `{ method, action, args }`，省略字段返回索引而非报错。
 * - City 全部内建能力都是 method：只读事实（env / sandbox / workspaces / agent / usage）
 *   与需要额度或文件的能力（image / sound）用同一套契约，只是各自声明 `capability`。
 * - 每次执行检查点即时生成工具定义；工具描述与索引全部由 method / action 自描述派生。
 * - method 私有文件按 Agent + method 隔离，不跨 method 共享。
 */

import { resolve_runtime_timezone } from "@downcity/agent";
import {
  define_runtime_tool,
  type RuntimeTool,
  type RuntimeToolExecutionOptions,
  type SessionSystemBlock,
} from "@downcity/type";
import type { Agent, SessionToolExecutionContext } from "@downcity/agent";
import type { Embassy } from "@downcity/federation";
import type { FileSystem, WorkspaceRuntime } from "@/workspace/index.js";
import type { CityRuntimeAccess } from "@/city/types/CityRuntimeAccess.js";
import type {
  CityToolContext,
  CityToolResult,
} from "@/city/types/CityTool.js";
import {
  city_tool_fail,
  city_tool_ok,
  CityToolRuntimeError,
} from "@/city/tool/CityToolResult.js";
import type { CityMethod } from "@/city/tool/CityMethod.js";
import { create_city_tool_methods } from "@/city/tool/methods/index.js";

/** `city` 工具对模型暴露的输入 schema。 */
const city_tool_input_schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    method: {
      type: "string",
      description:
        "Method group to use, for example env or image. Omit to list the methods you can use.",
    },
    action: {
      type: "string",
      description:
        "Action inside the method, for example get or create. Omit to list the actions of that method.",
    },
    args: {
      type: "object",
      additionalProperties: true,
      default: {},
      description: "JSON arguments passed to the action.",
    },
  },
};

/** 模型提交给 city tool 的原始载荷。 */
interface CityToolCallInput {
  /** 目标 method；省略时返回 method 索引。 */
  method?: unknown;
  /** 目标 action；省略时返回该 method 的动作索引。 */
  action?: unknown;
  /** 动作参数。 */
  args?: unknown;
}

/** City Tool 创建参数。 */
export interface CityToolOptions {
  /** City 内部事实源访问面；city tool 只读 Agent 与 Workspace 快照。 */
  readonly access: Pick<CityRuntimeAccess, "list_agents" | "list_workspaces">;
  /** 按 Agent 与 method 分配私有文件端口。 */
  readonly files_for: (agent_id: string, method_id: string) => FileSystem;
  /** City 持有的 Federation Embassy；未配置时省略。 */
  readonly embassy?: Embassy;
}

/** 一次调用的会话范围；无会话场景传 null。 */
export interface CityToolScope {
  /** 当前 Session 标识。 */
  readonly session_id: string | null;
  /** 当前 Turn 标识。 */
  readonly turn_id: string | null;
  /** 当前 Turn 取消信号。 */
  readonly abort_signal?: AbortSignal;
}

/** `city` 工具本体：持有全部 method，生成工具定义，并按载荷分发。 */
export class CityTool {
  /** 全部已注册 method，顺序即模型侧索引顺序。 */
  private readonly methods: readonly CityMethod[] = create_city_tool_methods();

  constructor(private readonly options: CityToolOptions) {}

  /**
   * 为明确的 Agent/Workspace 执行检查点生成 `city` 工具。
   *
   * 关键点（中文）
   * - 可用性与 Plugin 同一口径：City 注册什么，每个 Agent 就能用什么。
   */
  tools(agent: Agent, workspace: WorkspaceRuntime): Record<string, RuntimeTool> {
    return {
      city: define_runtime_tool<CityToolCallInput>({
        description: this.describe(),
        input_schema: city_tool_input_schema,
        execute: async (call, execution_options) =>
          await this.dispatch({
            call: call as CityToolCallInput,
            agent,
            workspace,
            execution_options,
          }),
      }),
    };
  }

  /**
   * 收集全部 method 的 session system 说明。
   *
   * 关键点（中文）
   * - 说明与工具来自同一份 method 声明，不会出现「工具在但说明缺失」。
   */
  async system_blocks(agent: Agent, workspace: WorkspaceRuntime): Promise<SessionSystemBlock[]> {
    const blocks: SessionSystemBlock[] = [];
    for (const method of this.methods) {
      const content = String(
        await method.system(this.context_of(method.method, agent, workspace)) ?? "",
      ).trim();
      if (!content) continue;
      blocks.push({ source: "plugin", name: method.method, content });
    }
    return blocks;
  }

  /**
   * 程序化调用入口，供插件与宿主使用。
   *
   * 关键点（中文）
   * - 不进模型工具清单；plugin↔plugin 场景借用 City 能力时走这里。
   * - method 未声明 `invoke` 时直接失败，不做静默降级。
   */
  async invoke(input: {
    /** 目标 Agent。 */
    agent: Agent;
    /** 目标 Workspace。 */
    workspace: WorkspaceRuntime;
    /** 目标 method 标识。 */
    method: string;
    /** 目标动作名。 */
    action: string;
    /** 动作输入。 */
    payload: unknown;
    /** 会话范围。 */
    scope?: CityToolScope;
  }): Promise<unknown> {
    const method = this.methods.find((item) => item.method === input.method);
    if (!method) throw new Error(`City method not found: ${input.method}`);
    if (!method.invoke) {
      throw new Error(`City method has no programmatic actions: ${input.method}`);
    }
    return await method.invoke(
      input.action,
      input.payload,
      this.context_of(input.method, input.agent, input.workspace, input.scope),
    );
  }

  /** 指定 method 是否登记在当前 City。 */
  has_method(method_id: string): boolean {
    return this.methods.some((item) => item.method === method_id);
  }

  /** 校验并执行一次调用，永远返回结果信封。 */
  private async dispatch(input: {
    /** 模型提交的原始载荷。 */
    call: CityToolCallInput;
    /** 当前 Agent。 */
    agent: Agent;
    /** 当前 Workspace。 */
    workspace: WorkspaceRuntime;
    /** 单个工具调用绑定的执行上下文。 */
    execution_options: RuntimeToolExecutionOptions;
  }): Promise<CityToolResult> {
    let method_id: string | null = null;
    let action: string | null = null;
    try {
      method_id = read_name(input.call.method, "method");
      action = read_name(input.call.action, "action");
      const args = read_args(input.call.args);
      if (!method_id) {
        return city_tool_ok({
          method: null,
          action: null,
          data: { methods: this.methods.map((item) => item.describe()) },
        });
      }
      const target = this.methods.find((item) => item.method === method_id) ?? null;
      if (!target) {
        throw new CityToolRuntimeError({
          code: "not_found",
          message: `Unknown city method: ${method_id}.`,
          detail: { available_methods: this.methods.map((item) => item.method) },
        });
      }
      if (!action) {
        return city_tool_ok({
          method: method_id,
          action: null,
          data: {
            method: target.method,
            summary: target.summary,
            actions: target.describe_actions(),
          },
        });
      }
      const action_object = target.action(action);
      if (!action_object) {
        throw new CityToolRuntimeError({
          code: "not_found",
          message: `Unknown action "${action}" in method "${method_id}".`,
          detail: { available_actions: target.action_names() },
        });
      }
      const data = await action_object.execute(
        args,
        this.context_of(method_id, input.agent, input.workspace, {
          execution_context: input.execution_options.context,
        }),
      );
      return city_tool_ok({ method: method_id, action, data: data === undefined ? null : data });
    } catch (error) {
      return city_tool_fail({ method: method_id, action, error });
    }
  }

  /** 组装一次调用可见的上下文；method 私有文件在这里分配。 */
  private context_of(
    method_id: string,
    agent: Agent,
    workspace: WorkspaceRuntime,
    input: Partial<CityToolScope> & { execution_context?: unknown } = {},
  ): CityToolContext {
    const turn = (input.execution_context as
      | Partial<SessionToolExecutionContext>
      | undefined)?.session_turn_context;    const session_id = input.session_id ?? turn?.session.session_id ?? null;
    const turn_id = input.turn_id ?? turn?.session.turn_id ?? null;
    const abort_signal = input.abort_signal ?? turn?.lifecycle?.abort_signal;
    return {
      method_id,
      agent_id: agent.id,
      agent_name: String(agent.name || agent.id),
      session_id,
      turn_id,
      workspace_id: workspace.id,
      workspace_name: String(workspace.name || workspace.id),
      workspace_path: workspace.path,
      model_id: agent.model?.id ?? null,
      timezone: resolve_runtime_timezone(),
      now: new Date(),
      sandbox: workspace.shell?.describe_sandbox() ?? null,
      agents: this.options.access.list_agents(),
      workspaces: this.options.access.list_workspaces(),
      files: this.options.files_for(agent.id, method_id),
      ...(this.options.embassy ? { embassy: this.options.embassy } : {}),
      ...(abort_signal ? { abort_signal } : {}),
    };
  }

  /** 从 method 派生工具描述。 */
  private describe(): string {
    return [
      "The single entry point for City capabilities: read-only runtime facts and City-owned "
        + "capabilities such as image generation and speech.",
      "Use it when the answer depends on harness facts you cannot read from files or commands.",
      "Call with no arguments to list methods; omit \"action\" to list the actions of one method.",
      "",
      "Methods:",
      ...this.methods.map((method) => `- ${method.method}: ${method.summary}`),
    ].join("\n");
  }
}

/** 读取可选的 snaker 名称字段。 */
function read_name(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const name = typeof value === "string" ? value.trim() : "";
  if (name) return name;
  throw new CityToolRuntimeError({
    code: "invalid_args",
    message: `"${field}" must be a non-empty string when provided.`,
  });
}

/** 读取动作参数对象。 */
function read_args(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new CityToolRuntimeError({
    code: "invalid_args",
    message: "\"args\" must be a JSON object when provided.",
  });
}
