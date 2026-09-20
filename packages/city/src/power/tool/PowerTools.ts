/**
 * Power 运行时工具。
 *
 * 设计目标（中文）
 * - 每个 Power 直接注册为一个模型工具，工具名即 power 名；不存在通用调用入口。
 * - 工具只负责 Downcity Runtime Tool 协议适配，不理解具体 power 的业务语义。
 * - 需要审批的动作在执行时自行请求审批，工具层不做预判。
 */

import {
  define_agent_tool,
  type ToolCallContext,
} from "@downcity/type";
import type {
  AgentPowerTools,
  CreatePowerToolOptions,
  PowerToolInput,
} from "@/power/types/PowerTool.js";
import type { PowerDefinition } from "@/power/types/PowerRuntime.js";
import { invoke_power_tool } from "./PowerToolRuntime.js";
import { power_tool_input_schema } from "./PowerToolSchemas.js";

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

/**
 * 创建一个 power 工具。
 *
 * 关键点（中文）
 * - 工具名由调用方以 power 名登记；本函数只构造工具定义。
 * - 需要审批的动作由动作自己在执行时请求，工具层不再预判。
 */
export function create_power_tool(options: CreatePowerToolOptions) {
  const power_name = String(options.power.name || "").trim();
  return define_agent_tool<PowerToolInput>({
    description: describe_power_tool(options.power),
    input_schema: power_tool_input_schema,
    execute: async (input: PowerToolInput, call_context: ToolCallContext) =>
      await invoke_power_tool({
        power: options.power,
        context_factory: options.context_factory,
        call_context,
        input,
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
  /** 把工具调用环境扩展为插件侧完整上下文。 */
  context_factory: CreatePowerToolOptions["context_factory"];
}): AgentPowerTools {
  const tools: AgentPowerTools = {};
  for (const power of options.definitions) {
    const power_name = String(power.name || "").trim();
    if (!power_name) continue;
    if (Object.keys(power.actions || {}).length === 0) continue;
    tools[power_name] = create_power_tool({
      power,
      context_factory: options.context_factory,
    });
  }
  return tools;
}
