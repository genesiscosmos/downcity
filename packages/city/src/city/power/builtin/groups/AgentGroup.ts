/**
 * city power `agent` 动作组。
 *
 * 关键点（中文）
 * - 返回当前 City 中全部 Agent，不做 Workspace 过滤：协作认知边界是 City，不是 Workspace。
 * - list 包含职责简介，协作对象选择不需要额外 get。
 * - create 通过宿主完成持久化和注册；工作会话交互属于 session 工具。
 */

import type { CityPowerContext } from "@/city/types/CityPowerContext.js";
import type { CityToolAgentSummary } from "@/city/types/CityPowerData.js";
import { CityAction, CityActionError } from "@/city/power/builtin/CityAction.js";
import { CityActionGroup } from "@/city/power/builtin/CityActionGroup.js";
import { z } from "zod";
import type { CityCreateAgent } from "@/city/types/CityCreateAgent.js";

/** 把 Agent 投影为模型可读摘要。 */
function describe_agent(
  context: CityPowerContext,
  agent: CityPowerContext["agents"][number],
): CityToolAgentSummary {
  return {
    agent_id: agent.id,
    name: String(agent.name || agent.id),
    description: agent.description,
    model_id: agent.model?.id ?? null,
    is_current: agent.id === context.agent_id,
  };
}

/** 列出当前 City 可见的全部 Agent。 */
class ListAgentsAction extends CityAction {
  readonly action = "list";
  readonly description = "List every agent visible in this City.";
  readonly returns = "agents(agent_id, name, description, model_id, is_current)";

  protected async run(
    _args: Record<string, never>,
    context: CityPowerContext,
  ): Promise<{ agents: CityToolAgentSummary[] }> {
    return { agents: context.agents.map((agent) => describe_agent(context, agent)) };
  }
}

/** 持久 Agent 的创建参数；身份标识由宿主生成。 */
const create_agent_input = z.strictObject({
  name: z.string().trim().min(1).describe("Display name for the new persistent agent."),
  description: z.string().trim().min(1).describe("Short description of the agent's responsibilities, shown in agent.list."),
  instruction: z.string().trim().min(1).describe("Complete persistent instructions defining the agent's role and working principles."),
  model_id: z.string().trim().min(1).describe("Default model ID, such as a model_id returned by agent.list."),
});

/** 创建前请求用户审批；宿主拥有持久化、模型装配和注册生命周期。 */
class CreateAgentAction extends CityAction<z.infer<typeof create_agent_input>> {
  readonly action = "create";
  readonly description = "Create and register a persistent agent with a name, responsibility description, instructions, and default model. Requires user approval.";
  readonly returns = "agent(agent_id, name, description, model_id, is_current)";
  readonly access = "write" as const;
  readonly approval = true;
  readonly args_schema = create_agent_input;

  constructor(private readonly create_agent?: CityCreateAgent) {
    super();
  }

  protected async run(
    args: z.infer<typeof create_agent_input>,
    context: CityPowerContext,
  ): Promise<{ agent: CityToolAgentSummary }> {
    if (!this.create_agent) {
      throw new CityActionError({
        code: "unsupported_action",
        message: "This host has not configured persistent Agent creation (runtime.create_agent).",
      });
    }
    const agent = await this.create_agent(args);
    return { agent: describe_agent(context, agent) };
  }
}

/** `agent` 动作组。 */
export class AgentGroup extends CityActionGroup {
  readonly group = "agent";
  protected readonly actions;

  constructor(create_agent?: CityCreateAgent) {
    super();
    this.actions = [new ListAgentsAction(), new CreateAgentAction(create_agent)];
  }
}
