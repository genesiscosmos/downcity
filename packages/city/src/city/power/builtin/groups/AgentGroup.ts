/**
 * city power `agent` 动作组。
 *
 * 关键点（中文）
 * - 返回当前 City 中全部 Agent，不做 Workspace 过滤：协作认知边界是 City，不是 Workspace。
 * - 只提供列表与详情；委派、创建等写操作不进入 city power。
 * - `get` 与 `list` 共用同一个摘要构造，避免两处口径漂移。
 */

import type { CityPowerContext } from "@/city/types/CityPowerContext.js";
import type { CityToolAgentSummary } from "@/city/types/CityPowerData.js";
import { CityAction, CityActionError } from "@/city/power/builtin/CityAction.js";
import { CityActionGroup } from "@/city/power/builtin/CityActionGroup.js";
import { z } from "zod";

/** 把 Agent 投影为模型可读摘要。 */
function describe_agent(
  context: CityPowerContext,
  agent: CityPowerContext["agents"][number],
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
  readonly description = "List every agent visible in this City.";
  readonly returns = "agents(agent_id, name, model_id, is_current)";

  protected async run(
    _args: Record<string, never>,
    context: CityPowerContext,
  ): Promise<{ agents: CityToolAgentSummary[] }> {
    return { agents: context.agents.map((agent) => describe_agent(context, agent)) };
  }
}

/** `agent.get` 的输入。 */
const get_agent_input = z.strictObject({
  /** Agent identifier, as returned by agent.list. */
  agent_id: z.string().trim().min(1).describe("Agent identifier, as returned by agent.list."),
});

/** 按标识读取单个 Agent。 */
class GetAgentAction extends CityAction<z.infer<typeof get_agent_input>> {
  readonly action = "get";
  readonly description = "Read one agent by id.";
  readonly returns = "agent(agent_id, name, model_id, is_current)";
  readonly args_schema = get_agent_input;

  protected async run(
    args: z.infer<typeof get_agent_input>,
    context: CityPowerContext,
  ): Promise<{ agent: CityToolAgentSummary }> {
    const agent = context.agents.find((item) => item.id === args.agent_id);
    if (!agent) {
      throw new CityActionError({
        code: "not_found",
        message: `Agent not visible in this City: ${args.agent_id}.`,
        detail: { current_agent_id: context.agent_id },
      });
    }
    return { agent: describe_agent(context, agent) };
  }
}

/** `agent` 动作组。 */
export class AgentGroup extends CityActionGroup {
  readonly group = "agent";
  readonly summary = "Agents registered in this City, including the current one.";
  protected readonly actions = [new ListAgentsAction(), new GetAgentAction()];
}
