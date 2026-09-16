/**
 * City Tool 装配与 Tool 定义。
 *
 * 关键点（中文）
 * - `city` 是每个 Agent/Workspace 执行检查点动态生成的 Tool，与 Plugin 工具走同一条注入路径。
 * - 可见 namespace 在每次生成工具时按 City 级配置重新解析，配置修改无需重启。
 * - 工具描述从注册表派生，namespace 增减时模型侧描述自动跟上，不会与实现漂移。
 */

import { define_runtime_tool, type RuntimeTool, type RuntimeToolExecutionOptions } from "@downcity/type";
import type { Agent, SessionToolExecutionContext } from "@downcity/agent";
import type { WorkspaceRuntime } from "@/workspace/index.js";
import type { CityRuntimeAccess } from "@/city/types/CityRuntimeAccess.js";
import type { CityToolHost } from "@/city/types/CityTool.js";
import type {
  CityToolContext,
  CityToolNamespaceProvider,
} from "@/city/types/CityTool.js";
import { CityToolDispatcher, type CityToolCallInput } from "@/city/tool/CityToolDispatcher.js";
import { city_tool_input_schema } from "@/city/tool/CityToolSchemas.js";
import { resolve_runtime_timezone } from "@/city/tool/CityToolTime.js";
import {
  resolve_city_tool_policy,
  resolve_visible_namespaces,
} from "@/city/tool/CityToolVisibility.js";
import { CityToolRegistry } from "@/city/tool/CityToolRegistry.js";
import { create_city_tool_registry } from "@/city/tool/namespaces/index.js";

/** City Tool 运行时创建参数。 */
export interface CityToolRuntimeOptions {
  /** City 内部事实源访问面；city tool 只读 Agent 与 Workspace 快照。 */
  readonly access: Pick<CityRuntimeAccess, "list_agents" | "list_workspaces">;
  /** 宿主提供的 City 级配置读取能力；未提供时为 null，此时全部使用默认可见性。 */
  readonly host: CityToolHost | null;
}

/** 单个 Agent/Workspace 检查点生成 city tool 的输入。 */
export interface CreateCityToolInput {
  /** 当前执行所属 Agent。 */
  readonly agent: Agent;
  /** 当前执行所属 Workspace。 */
  readonly workspace: WorkspaceRuntime;
}

/** 按 namespace 注册表组装 `city` 工具的运行时。 */
export class CityToolRuntime {
  /** 第一期全部 namespace 的注册表。 */
  private readonly registry: CityToolRegistry;

  /** 载荷校验与分发。 */
  private readonly dispatcher: CityToolDispatcher;

  constructor(private readonly options: CityToolRuntimeOptions) {
    this.registry = create_city_tool_registry();
    this.dispatcher = new CityToolDispatcher(this.registry);
  }

  /** 为明确的 Agent/Workspace 执行检查点创建 `city` 工具。 */
  tools(input: CreateCityToolInput): Record<string, RuntimeTool> {
    const policy = resolve_city_tool_policy(this.read_config());
    const visible = resolve_visible_namespaces({
      policy,
      agent_id: input.agent.id,
      providers: this.registry.list(),
    });
    if (visible.length === 0) return {};
    return {
      city: define_runtime_tool<CityToolCallInput>({
        description: build_tool_description(visible),
        input_schema: city_tool_input_schema,
        execute: async (call, execution_options) =>
          await this.dispatcher.dispatch({
            call: call as CityToolCallInput,
            visible,
            context: this.create_context({ ...input, execution_options }),
          }),
      }),
    };
  }

  /**
   * 读取 City 级 city tool 配置。
   *
   * 关键点（中文）
   * - 配置由用户手工编辑，读取失败不能让全部 Session 建不出来，因此按缺省处理。
   */
  private read_config(): Record<string, unknown> {
    try {
      return this.options.host?.read_config() ?? {};
    } catch {
      return {};
    }
  }

  /** 组装一次调用可见的运行时事实。 */
  private create_context(input: CreateCityToolInput & {
    /** Executor 为本次 Tool Call 绑定的显式执行上下文。 */
    execution_options: RuntimeToolExecutionOptions;
  }): CityToolContext {
    const execution_context = input.execution_options.context as
      | Partial<SessionToolExecutionContext>
      | undefined;
    const turn = execution_context?.session_turn_context;
    return {
      agent_id: input.agent.id,
      agent_name: String(input.agent.name || input.agent.id),
      session_id: turn?.session.session_id ?? null,
      turn_id: turn?.session.turn_id ?? null,
      workspace_id: input.workspace.id,
      workspace_name: String(input.workspace.name || input.workspace.id),
      workspace_path: input.workspace.path,
      model_id: input.agent.model?.id ?? null,
      timezone: resolve_runtime_timezone(),
      now: new Date(),
      sandbox: input.workspace.shell?.describe_sandbox() ?? null,
      agents: this.options.access.list_agents(),
      workspaces: this.options.access.list_workspaces(),
    };
  }
}

/** 从可见 namespace 派生工具描述。 */
function build_tool_description(visible: readonly CityToolNamespaceProvider[]): string {
  return [
    "Read-only runtime facts about the current City: which agent, session and workspace you serve, "
      + "which sandbox you run in, and what else exists in this City.",
    "Use it when the answer depends on harness facts you cannot read from files or commands.",
    "Call with no arguments to list namespaces; omit \"action\" to list the actions of one namespace.",
    "",
    "Namespaces:",
    ...visible.map((provider) => `- ${provider.namespace}: ${provider.summary}`),
  ].join("\n");
}
