/**
 * CLI 宿主的持久 Agent 创建流程。
 * 复用本地 Agent 仓储和标准装配入口，创建失败时清理本次定义和运行时资源。
 */
import type { Agent } from "@downcity/agent";
import type { City, CityCreateAgentInput } from "@downcity/city";
import { create_agent_id } from "@downcity/city/local";
import type { CliLocalData } from "@/city/runtime/LocalData.js";
import { create_cli_agent } from "@/city/runtime/AgentAssembly.js";

/** 持久化并注册一个不绑定 Workspace 的 Agent。 */
export async function create_cli_persistent_agent(
  input: CityCreateAgentInput,
  data: CliLocalData,
  city: City,
): Promise<Agent> {
  const agent_id = create_agent_id(input.name);
  const config = data.agents.create({
    agent_id,
    name: input.name,
    description: input.description,
    instruction: input.instruction,
    execution: { type: "api", model_id: input.model_id },
  });
  let agent: Agent | undefined;
  try {
    agent = await create_cli_agent({ config, root_path: data.root_path });
    city.agents.add(agent);
    return agent;
  } catch (error) {
    data.agents.remove(config.agent_id);
    await agent?.dispose().catch(() => undefined);
    throw error;
  }
}
