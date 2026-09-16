/**
 * city tool `agent` method。
 *
 * 关键点（中文）
 * - 返回当前 City 中全部 Agent，不做 Workspace 过滤：协作认知边界是 City，不是 Workspace。
 * - 只提供列表与详情；委派、创建等写操作不进入第一期 city tool。
 * - `get` 与 `list` 共用同一个摘要构造，避免两处口径漂移。
 */

import type { CityToolContext } from "@/city/types/CityTool.js";
import type { CityToolAgentSummary } from "@/city/types/CityToolMethods.js";
import {
  CityAction,
  string_arg,
  type CityToolArgs,
} from "@/city/tool/CityAction.js";
import { CityMethod } from "@/city/tool/CityMethod.js";
import { CityToolRuntimeError } from "@/city/tool/CityToolResult.js";

/** 把 Agent 投影为模型可读摘要。 */
function describe_agent(
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
class ListAgentsAction extends CityAction {
  readonly action = "list";
  readonly summary = "List every agent visible in this City.";
  readonly returns = "agents(agent_id, name, model_id, is_current)";

  protected async run(
    _args: CityToolArgs,
    context: CityToolContext,
  ): Promise<{ agents: CityToolAgentSummary[] }> {
    return { agents: context.agents.map((agent) => describe_agent(context, agent)) };
  }
}

/** 按标识读取单个 Agent。 */
class GetAgentAction extends CityAction {
  readonly action = "get";
  readonly summary = "Read one agent by id.";
  readonly returns = "agent(agent_id, name, model_id, is_current)";
  readonly args = [string_arg("agent_id", "Agent identifier, as returned by agent.list.")];

  protected async run(
    args: CityToolArgs,
    context: CityToolContext,
  ): Promise<{ agent: CityToolAgentSummary }> {
    const agent_id = this.require_string(args, "agent_id");
    const agent = context.agents.find((item) => item.id === agent_id);
    if (!agent) {
      throw new CityToolRuntimeError({
        code: "not_found",
        message: `Agent not visible in this City: ${agent_id}.`,
        detail: { current_agent_id: context.agent_id },
      });
    }
    return { agent: describe_agent(context, agent) };
  }
}

/** `agent` method。 */
export class AgentMethod extends CityMethod {
  readonly method = "agent";
  readonly summary = "Agents registered in this City, including the current one.";
  protected readonly actions = [new ListAgentsAction(), new GetAgentAction()];
}
