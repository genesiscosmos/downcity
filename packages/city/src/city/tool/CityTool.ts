/**
 * City Tool：Agent 查询运行时事实的唯一只读入口。
 *
 * 关键点（中文）
 * - 一个工具、一个入口：载荷是 `{ namespace, action, args }`，省略字段返回索引而非报错。
 * - 与 Plugin 工具走同一条注入路径，由 `City.get_session_tools()` 在每个执行检查点生成。
 * - 可见 namespace 在每次生成工具时按 City 级策略重新解析，改配置不需要重启。
 * - 工具描述与动作索引全部由 namespace / action 对象自描述派生，不与实现漂移。
 */

import { resolve_runtime_timezone } from "@downcity/agent";
import {
  define_runtime_tool,
  type RuntimeTool,
  type RuntimeToolExecutionOptions,
} from "@downcity/type";
import type { Agent, SessionToolExecutionContext } from "@downcity/agent";
import type { WorkspaceRuntime } from "@/workspace/index.js";
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
import type { CityNamespace } from "@/city/tool/namespaces/CityNamespace.js";
import { create_city_tool_namespaces } from "@/city/tool/namespaces/index.js";

/** `city` 工具对模型暴露的输入 schema。 */
const city_tool_input_schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    namespace: {
      type: "string",
      description:
        "Namespace to use, for example env or sandbox. Omit to list the namespaces you can use.",
    },
    action: {
      type: "string",
      description:
        "Action inside the namespace, for example get. Omit to list the actions of that namespace.",
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
  /** 目标 namespace；省略时返回可见 namespace 索引。 */
  namespace?: unknown;
  /** 目标 action；省略时返回该 namespace 的动作索引。 */
  action?: unknown;
  /** 动作参数。 */
  args?: unknown;
}

/** City Tool 创建参数。 */
export interface CityToolOptions {
  /** City 内部事实源访问面；city tool 只读 Agent 与 Workspace 快照。 */
  readonly access: Pick<CityRuntimeAccess, "list_agents" | "list_workspaces">;
}

/** `city` 工具本体：持有 namespace，生成工具定义，并按载荷分发。 */
export class CityTool {
  /** 全部已注册 namespace，顺序即模型侧索引顺序。 */
  private readonly namespaces: readonly CityNamespace[] = create_city_tool_namespaces();

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
            context: this.context_of(agent, workspace, execution_options),
          }),
      }),
    };
  }

  /** 校验并执行一次调用，永远返回结果信封。 */
  private async dispatch(input: {
    /** 模型提交的原始载荷。 */
    call: CityToolCallInput;
    /** 本次调用可见的运行时事实。 */
    context: CityToolContext;
  }): Promise<CityToolResult> {
    let namespace: string | null = null;
    let action: string | null = null;
    try {
      namespace = read_name(input.call.namespace, "namespace");
      action = read_name(input.call.action, "action");
      const args = read_args(input.call.args);
      if (!namespace) {
        return city_tool_ok({
          namespace: null,
          action: null,
          data: { namespaces: this.namespaces.map((item) => item.describe()) },
        });
      }
      const target = this.namespaces.find((item) => item.namespace === namespace) ?? null;
      if (!target) {
        throw new CityToolRuntimeError({
          code: "not_found",
          message: `Unknown city namespace: ${namespace}.`,
          detail: { available_namespaces: this.namespaces.map((item) => item.namespace) },
        });
      }
      if (!action) {
        return city_tool_ok({
          namespace,
          action: null,
          data: {
            namespace: target.namespace,
            summary: target.summary,
            actions: target.describe_actions(),
          },
        });
      }
      const action_object = target.action(action);
      if (!action_object) {
        throw new CityToolRuntimeError({
          code: "not_found",
          message: `Unknown action "${action}" in namespace "${namespace}".`,
          detail: { available_actions: target.action_names() },
        });
      }
      const data = await action_object.execute(args, input.context);
      return city_tool_ok({ namespace, action, data: data === undefined ? null : data });
    } catch (error) {
      return city_tool_fail({ namespace, action, error });
    }
  }

  /** 组装一次调用可见的运行时事实。 */
  private context_of(
    agent: Agent,
    workspace: WorkspaceRuntime,
    execution_options: RuntimeToolExecutionOptions,
  ): CityToolContext {
    const execution_context = execution_options.context as
      | Partial<SessionToolExecutionContext>
      | undefined;
    const turn = execution_context?.session_turn_context;
    return {
      agent_id: agent.id,
      agent_name: String(agent.name || agent.id),
      session_id: turn?.session.session_id ?? null,
      turn_id: turn?.session.turn_id ?? null,
      workspace_id: workspace.id,
      workspace_name: String(workspace.name || workspace.id),
      workspace_path: workspace.path,
      model_id: agent.model?.id ?? null,
      timezone: resolve_runtime_timezone(),
      now: new Date(),
      sandbox: workspace.shell?.describe_sandbox() ?? null,
      agents: this.options.access.list_agents(),
      workspaces: this.options.access.list_workspaces(),
    };
  }

  /** 从已注册 namespace 派生工具描述。 */
  private describe(): string {
    return [
      "Read-only runtime facts about the current City: which agent, session and workspace you serve, "
        + "which sandbox you run in, and what else exists in this City.",
      "Use it when the answer depends on harness facts you cannot read from files or commands.",
      "Call with no arguments to list namespaces; omit \"action\" to list the actions of one namespace.",
      "",
      "Namespaces:",
      ...this.namespaces.map((namespace) => `- ${namespace.namespace}: ${namespace.summary}`),
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
