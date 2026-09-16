/**
 * city tool `agent` namespace。
 *
 * 关键点（中文）
 * - 返回当前 City 中全部 Agent，不做 Workspace 过滤：协作认知边界是 City，不是 Workspace。
 * - 只提供列表与详情；委派、创建等写操作不进入第一期 city tool。
 */

import type {
  CityToolActionCall,
  CityToolContext,
  CityToolNamespaceProvider,
} from "@/city/types/CityTool.js";
import type { CityToolAgentSummary } from "@/city/types/CityToolNamespaces.js";
import { assert_known_args, read_required_string_arg } from "@/city/tool/CityToolArgs.js";
import {
  CityToolRuntimeError,
  unexpected_city_tool_action,
} from "@/city/tool/CityToolErrors.js";

/** 构造单个 Agent 摘要。 */
function to_summary(
  context: CityToolContext,
  agent: CityToolContext["agents"][number],
): CityToolAgentSummary {
  return {
    agent_id: agent.id,
    name: String(agent.name || agent.id),
    model_id: agent.model?.id ?? null,
    is_current: agent.id === context.agent_id,
  };
}

/** 列出当前 City 可见的全部 Agent。 */
function list_agents(context: CityToolContext): { agents: CityToolAgentSummary[] } {
  return { agents: context.agents.map((agent) => to_summary(context, agent)) };
}

/** 读取单个 Agent 详情。 */
function get_agent(call: CityToolActionCall): { agent: CityToolAgentSummary } {
  assert_known_args({ args: call.args, allowed: ["agent_id"], action: call.action });
  const agent_id = read_required_string_arg({
    args: call.args,
    name: "agent_id",
    action: call.action,
  });
  const agent = call.context.agents.find((item) => item.id === agent_id);
  if (!agent) {
    throw new CityToolRuntimeError({
      code: "not_found",
      message: `Agent not visible in this City: ${agent_id}.`,
      detail: { current_agent_id: call.context.agent_id },
    });
  }
  return { agent: to_summary(call.context, agent) };
}

/** 创建 `agent` namespace provider。 */
export function create_agent_namespace(): CityToolNamespaceProvider {
  return {
    namespace: "agent",
    summary: "Agents registered in this City, including the current one.",
    actions: [
      {
        action: "list",
        summary: "List every agent visible in this City.",
        args: [],
        returns: "agents(agent_id, name, model_id, is_current)",
        capability: "read",
        sensitivity: "public",
      },
      {
        action: "get",
        summary: "Read one agent by id.",
        args: [
          {
            name: "agent_id",
            type: "string",
            required: true,
            description: "Agent identifier, as returned by agent.list.",
          },
        ],
        returns: "agent(agent_id, name, model_id, is_current)",
        capability: "read",
        sensitivity: "public",
      },
    ],
    handle: async (call: CityToolActionCall) => {
      switch (call.action) {
        case "list":
          assert_known_args({ args: call.args, allowed: [], action: call.action });
          return list_agents(call.context);
        case "get":
          return get_agent(call);
        default:
          throw unexpected_city_tool_action({ namespace: "agent", action: call.action });
      }
    },
  };
}
