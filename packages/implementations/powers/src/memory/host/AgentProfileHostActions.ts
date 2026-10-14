/** Profile 宿主管理入口，使用已登记 Agent 身份并委托领域模块，不直接操作文件。 */
import { z } from "zod";
import type { PowerLifecycleContext } from "@downcity/city/power";
import type { AgentProfile } from "@/memory/runtime/AgentProfile.js";

/** 注册读取、状态和精确编辑；管理入口不能指定目录路径。 */
export function register_profile_host_actions(context: PowerLifecycleContext, profile: AgentProfile): void {
  const scope_schema = z.object({ agent_id: z.string().min(1) });
  const edit_schema = scope_schema.extend({
    version: z.string().min(1),
    edits: z.array(z.object({ old_text: z.string().min(1), new_text: z.string() })).min(1).max(32),
  });
  const assert_agent = async (agent_id: string): Promise<void> => {
    if (!(await context.system.list_agents()).some((agent) => agent.agent_id === agent_id)) throw new Error("Unknown Profile Agent");
  };
  context.power.action({ id: "memory.profile_read", run: async (input) => {
    const { agent_id } = scope_schema.parse(input);
    await assert_agent(agent_id);
    return await profile.read(agent_id);
  } });
  context.power.action({ id: "memory.profile_status", run: async (input) => {
    const { agent_id } = scope_schema.parse(input);
    await assert_agent(agent_id);
    return await profile.status(agent_id);
  } });
  context.power.action({ id: "memory.profile_edit", run: async (input) => {
    const { agent_id, version, edits } = edit_schema.parse(input);
    await assert_agent(agent_id);
    return await profile.edit(agent_id, version, edits);
  } });
}
