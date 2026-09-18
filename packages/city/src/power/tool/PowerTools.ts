/**
 * Power 运行时工具。
 *
 * 设计目标（中文）
 * - 每个 Power 直接注册为一个模型工具，工具名即 power 名；不存在通用调用入口。
 * - 工具只负责 Downcity Runtime Tool 协议适配，不理解具体 power 的业务语义。
 * - 动作声明 `access: "write"` 时，工具在执行前请求调用方审批。
 */

import {
  define_runtime_tool,
  type RuntimeToolExecutionOptions as ToolExecutionOptions,
} from "@downcity/type";
import type {
  AgentPowerTools,
  CreatePowerToolOptions,
  PowerToolInput,
} from "@/power/types/PowerTool.js";
import type { PowerDefinition } from "@/power/types/PowerRuntime.js";
import { invoke_power_tool } from "./PowerToolRuntime.js";
import { power_tool_input_schema } from "./PowerToolSchemas.js";
import type { SessionToolExecutionContext, SessionTurnContext } from "@downcity/agent";

/**
 * 要求当前 power 工具具有 Executor 显式绑定的 Session 上下文。
 */
function require_turn_context(options: ToolExecutionOptions): SessionTurnContext {
  const execution_context = options.context as
    | Partial<SessionToolExecutionContext>
    | undefined;
  const turn_context = execution_context?.session_turn_context;
  if (!turn_context) {
    throw new Error("power tool requires an explicit Session Turn context");
  }
  return turn_context;
}

/** 取描述文本首行，用于工具描述中的动作摘要。 */
function first_line(text: string | undefined): string {
  return String(text || "").trim().split("\n")[0].trim();
}

/**
 * 由 power 定义派生工具描述。
 *
 * 关键点（中文）
 * - 描述只列动作 id 与一行摘要，参数 schema 留给省略 action 的索引响应，
 *   避免每个动作的完整 schema 常驻工具描述。
 */
export function describe_power_tool(power: PowerDefinition): string {
  const title = String(power.title || power.name || "").trim();
  const description = String(power.description || "").trim();
  const actions = Object.entries(power.actions || {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const header = description || title || `Power "${power.name}".`;
  if (actions.length === 0) return header;
  return [
    header,
    "",
    "Actions (omit \"action\" to list them with their input schema):",
    ...actions.map(([action_id, action]) => `- ${action_id}: ${first_line(action.description)}`),
  ].join("\n");
}

/** 读取本次调用是否需要审批。 */
function needs_approval(power: PowerDefinition, input: unknown): boolean {
  const action_id = String((input as PowerToolInput | undefined)?.action || "").trim();
  if (!action_id) return false;
  return power.actions?.[action_id]?.approval === true;
}

/**
 * 创建一个 power 工具。
 *
 * 关键点（中文）
 * - 工具名由调用方以 power 名登记；本函数只构造工具定义。
 * - 动作仅当显式声明 `approval: true` 时才请求调用方审批。
 */
export function create_power_tool(options: CreatePowerToolOptions) {
  const power_name = String(options.power.name || "").trim();
  return define_runtime_tool<PowerToolInput>({
    description: describe_power_tool(options.power),
    input_schema: power_tool_input_schema,
    needs_approval: (input) => needs_approval(options.power, input),
    execute: async (input, execution_options) =>
      await invoke_power_tool({
        powers: options.powers,
        power_name,
        turn_context: require_turn_context(execution_options),
        call_id: String(execution_options.tool_call_id || "").trim(),
        input: input as PowerToolInput,
      }),
  });
}

/**
 * 为全部给定 power 创建工具集合。
 *
 * 关键点（中文）
 * - 没有任何动作的 power 不产生空壳工具。
 * - 返回字典的键即模型侧工具名。
 */
export function create_power_tools(options: {
  /** 当前检查点可见的 power 定义。 */
  definitions: readonly PowerDefinition[];
  /** 当前 Agent 自己的 power 调用面。 */
  powers: CreatePowerToolOptions["powers"];
}): AgentPowerTools {
  const tools: AgentPowerTools = {};
  for (const power of options.definitions) {
    const power_name = String(power.name || "").trim();
    if (!power_name) continue;
    if (Object.keys(power.actions || {}).length === 0) continue;
    tools[power_name] = create_power_tool({ power, powers: options.powers });
  }
  return tools;
}
